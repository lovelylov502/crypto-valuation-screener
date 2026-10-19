import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client, type InStatement, type TransactionMode } from "@libsql/client";
import { initializeHistory } from "./historyDatabase";
import { initializeDailyRaw } from "./dailyRawDatabase";
import { reconcileDailyRawBudget, type DailyRawBudgetEvidence } from "./dailyRawBudgetReconciliation";

let db: Client;
const now = new Date("2026-10-19T16:00:00Z"), originalReserved = 6_489_815;
const evidence: DailyRawBudgetEvidence = { proofSha256: "a".repeat(64), codeSha256: "b".repeat(64), observedAt: "2026-10-19T15:18:41Z" };
const auditTable = "history_budget_reconciliations";
const budget = async () => Number((await db.execute("SELECT reserved FROM history_budget WHERE month='2026-10'")).rows[0].reserved);
const hasAuditTable = async () => (await db.execute(`SELECT name FROM sqlite_schema WHERE name='${auditTable}'`)).rows.length > 0;
const preserved = async () => (await db.batch(["SELECT * FROM daily_raw_runs ORDER BY id", "SELECT * FROM history_runs", "SELECT * FROM history_assets", "SELECT * FROM history_fundamentals"], "read")).map(result => result.rows);
const reconcile = (options: Partial<Parameters<typeof reconcileDailyRawBudget>[1]> = {}) => reconcileDailyRawBudget(db, { evidence, now, ...options });

function watchMutations(rewrite?: (statement: InStatement) => InStatement) {
  const mutations: string[] = [], transaction = db.transaction.bind(db);
  const track = (statement: InStatement) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (!/^\s*SELECT\b/i.test(sql)) mutations.push(sql);
  };
  vi.spyOn(db, "transaction").mockImplementation(async (mode?: TransactionMode) => {
    const tx = await transaction(mode), execute = tx.execute.bind(tx), batch = tx.batch.bind(tx);
    vi.spyOn(tx, "execute").mockImplementation(async statement => { track(statement); return execute(rewrite ? rewrite(statement) : statement); });
    vi.spyOn(tx, "batch").mockImplementation(async statements => { statements.forEach(track); return batch(statements); });
    return tx;
  });
  return mutations;
}

beforeEach(async () => {
  db = createClient({ url: ":memory:" }); await initializeHistory(db); await initializeDailyRaw(db);
  await db.batch([
    { sql: "INSERT INTO history_budget VALUES('2026-10',?)", args: [originalReserved] },
    ...[
      ["initial", "raw-double-v1", 142_852, 71_118, 69_929],
      ["hold", "raw-table-weights-v1", 557, 301, 92],
      ["fill3", "raw-table-weights-v1", 1_984_162, 1_934_426, 1_888_634],
    ].map(([id, version, cost, rows, days]) => ({ sql: "INSERT INTO daily_raw_runs(id,started_at,max_estimated_writes,estimated_writes,rows_written,days_written,accounting_version) VALUES(?,'2026-10-19T10:00:00.000Z',3200000,?,?,?,?)", args: [id, cost, rows, days, version] })),
    "INSERT INTO history_runs VALUES('original-run','original estimated data')",
    "INSERT INTO history_assets VALUES('alpha','original asset','original hash')",
    "INSERT INTO history_fundamentals VALUES('alpha','2020-01-01','original fundamental','original hash')",
  ], "write");
});
afterEach(() => { vi.restoreAllMocks(); db.close(); });

it("defaults to a read-only plan without initializing an audit table", async () => {
  const before = await preserved(), mutations = watchMutations(), result = await reconcile();
  expect(db.transaction).toHaveBeenCalledWith("read");
  expect(mutations).toEqual([]); expect(await hasAuditTable()).toBe(false);
  expect(result).toMatchObject({ status: "eligible", month: "2026-10", currentReserved: originalReserved, grossReserved: originalReserved, rawEstimatedWrites: 2_127_571, legacyReserved: 4_362_244, creditDelta: -1_000_000, bookkeepingCredits: 8, cumulativeNetAdjustment: 0, projectedReserved: 5_489_823, projectedRemainingEstimatedWrites: 2_510_177, projectedBackfillAfterMaintenanceReserve: 2_010_177, audit: null });
  expect(await budget()).toBe(originalReserved); expect(await preserved()).toEqual(before);
});

it("applies exactly one signed credit with a separate immutable audit, preserving all old records", async () => {
  const before = await preserved(), mutations = watchMutations(), result = await reconcile({ apply: true });
  expect(result).toMatchObject({ status: "applied", currentReserved: 5_489_823, grossReserved: originalReserved, cumulativeNetAdjustment: -999_992 });
  expect(await budget()).toBe(5_489_823); expect(await preserved()).toEqual(before);
  expect(result.audit).toMatchObject({ id: "legacy-withoutrowid-2026-10-v1", month: "2026-10", credit_delta: -1_000_000, bookkeeping_credits: 8, reserved_before: originalReserved, reserved_after: 5_489_823, raw_estimated_writes: 2_127_571, legacy_reserved: 4_362_244, proof_sha256: evidence.proofSha256, code_sha256: evidence.codeSha256, proof_observed_at: "2026-10-19T15:18:41.000Z", applied_at: now.toISOString() });
  expect(Object.keys(result.audit!)).not.toContain("proof");
  expect(mutations).toHaveLength(5); // One table, two immutable-audit triggers, two data rows.
  expect(mutations.filter(sql => /^(INSERT|UPDATE)/.test(sql)).map(sql => sql.match(/^(?:INSERT INTO|UPDATE) (\w+)/)?.[1])).toEqual(["history_budget", auditTable]);
  await expect(db.execute(`UPDATE ${auditTable} SET reason='changed'`)).rejects.toThrow("daily_raw_budget_audit_immutable");
  await expect(db.execute(`DELETE FROM ${auditTable}`)).rejects.toThrow("daily_raw_budget_audit_immutable");
  await expect(db.execute("UPDATE history_budget SET reserved=8000001")).rejects.toThrow("CHECK constraint");
});

it("replays the same apply with zero SQL writes after later raw work", async () => {
  await reconcile({ apply: true });
  await db.batch(["UPDATE daily_raw_runs SET estimated_writes=estimated_writes+1000 WHERE id='fill3'", "UPDATE history_budget SET reserved=reserved+1000 WHERE month='2026-10'"], "write");
  const mutations = watchMutations(), result = await reconcile({ apply: true });
  expect(mutations).toEqual([]);
  expect(result).toMatchObject({ status: "already-applied", currentReserved: 5_490_823, grossReserved: originalReserved + 1000, legacyReserved: 4_362_244, cumulativeNetAdjustment: -999_992 });
  expect(await budget()).toBe(5_490_823);
});

it.each([
  { proofSha256: "c".repeat(64) }, { codeSha256: "c".repeat(64) }, { observedAt: "2026-10-19T15:19:41Z" },
])("rejects conflicting replay evidence before a write: %j", async changed => {
  await reconcile({ apply: true }); const mutations = watchMutations();
  await expect(reconcile({ apply: true, evidence: { ...evidence, ...changed } })).rejects.toThrow("audit_evidence_conflict");
  expect(mutations).toEqual([]); expect(await budget()).toBe(5_489_823);
});

it("rolls back audit initialization when the counter compare-and-swap affects zero rows", async () => {
  watchMutations(statement => {
    if (typeof statement !== "string" && statement.sql.startsWith("UPDATE history_budget")) return { ...statement, args: [-999_992, "2026-10", originalReserved + 1] };
    return statement;
  });
  await expect(reconcile({ apply: true })).rejects.toThrow("cas_failed");
  expect(await budget()).toBe(originalReserved); expect(await hasAuditTable()).toBe(false);
});

it.each([
  ["ALTER TABLE history_market ADD COLUMN extra TEXT", "legacy_schema_changed"],
  ["CREATE INDEX unexpected_legacy_index ON history_market(content_hash)", "legacy_index_changed"],
  ["CREATE TRIGGER unexpected_legacy_trigger AFTER INSERT ON history_market BEGIN SELECT 1; END", "legacy_trigger_present"],
])("rejects a changed legacy schema/index/trigger before mutation: %s", async (sql, message) => {
  await db.execute(sql); const mutations = watchMutations();
  await expect(reconcile({ apply: true })).rejects.toThrow(message);
  expect(mutations).toEqual([]); expect(await budget()).toBe(originalReserved); expect(await hasAuditTable()).toBe(false);
});

it("rejects a changed legacy reservation basis before mutation", async () => {
  await db.execute("UPDATE history_budget SET reserved=reserved+1"); const mutations = watchMutations();
  await expect(reconcile({ apply: true })).rejects.toThrow("legacy_basis_changed");
  expect(mutations).toEqual([]); expect(await budget()).toBe(originalReserved + 1);
});

it.each([
  ["raw-new-policy-v2", "2026-10-19T00:00:00Z", "unsupported_run_accounting"],
  ["raw-table-weights-v1", "2026-09-19T00:00:00Z", "run_outside_fixed_month"],
])("rejects an unsupported or cross-month raw run: %s %s", async (version, startedAt, message) => {
  await db.execute({ sql: "INSERT INTO daily_raw_runs(id,started_at,max_estimated_writes,accounting_version) VALUES('unknown',?,100,?)", args: [startedAt, version] });
  const mutations = watchMutations(); await expect(reconcile({ apply: true })).rejects.toThrow(message);
  expect(mutations).toEqual([]); expect(await budget()).toBe(originalReserved);
});

it("rejects a different current month before opening any transaction", async () => {
  const transaction = vi.spyOn(db, "transaction");
  await expect(reconcile({ apply: true, now: new Date("2026-11-01T00:00:00Z") })).rejects.toThrow("outside_fixed_month");
  expect(transaction).not.toHaveBeenCalled(); expect(await hasAuditTable()).toBe(false);
});

it("keeps both counter and audit rolled back if insertion is interrupted", async () => {
  watchMutations(statement => {
    if (typeof statement !== "string" && statement.sql.startsWith(`INSERT INTO ${auditTable}`)) throw Error("simulated socket failure");
    return statement;
  });
  await expect(reconcile({ apply: true })).rejects.toThrow("unknown_outcome_inspect_read_only_no_retry");
  expect(await budget()).toBe(originalReserved); expect(await hasAuditTable()).toBe(false);
});

it("resolves a lost commit response through read-only audit inspection without repeating writes", async () => {
  const transaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementationOnce(async (mode?: TransactionMode) => {
    const tx = await transaction(mode), commit = tx.commit.bind(tx);
    vi.spyOn(tx, "commit").mockImplementationOnce(async () => { await commit(); throw Error("lost response"); }); return tx;
  });
  await expect(reconcile({ apply: true })).rejects.toThrow("unknown_outcome_inspect_read_only_no_retry");
  vi.restoreAllMocks(); const mutations = watchMutations(), result = await reconcile();
  expect(db.transaction).toHaveBeenCalledWith("read"); expect(mutations).toEqual([]);
  expect(result).toMatchObject({ status: "already-applied", currentReserved: 5_489_823, cumulativeNetAdjustment: -999_992 });
  expect(await budget()).toBe(5_489_823);
});
