import { createHash } from "node:crypto";
import type { Client, Row, Transaction } from "@libsql/client";
import { HISTORY_STORAGE_LIMIT, HISTORY_WRITE_LIMIT } from "./historyDatabase";

const ID = "legacy-withoutrowid-2026-10-v1", MONTH = "2026-10", LEGACY_RESERVED = 4_362_244;
const CREDIT_DELTA = -1_000_000, BOOKKEEPING = 8, NET_DELTA = CREDIT_DELTA + BOOKKEEPING;
const TABLE = "history_budget_reconciliations";
const REASON = "One-time partial release of proven legacy single-row WITHOUT ROWID double weighting; original estimates retained";
const legacySchema = {
  history_assets: "CREATE TABLE history_assets (slug TEXT PRIMARY KEY, payload TEXT NOT NULL, content_hash TEXT NOT NULL) WITHOUT ROWID",
  history_sources: "CREATE TABLE history_sources (id TEXT PRIMARY KEY, payload TEXT NOT NULL) WITHOUT ROWID",
  history_fundamentals: "CREATE TABLE history_fundamentals (slug TEXT NOT NULL, day TEXT NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL, PRIMARY KEY(slug,day)) WITHOUT ROWID",
  history_market: "CREATE TABLE history_market (slug TEXT NOT NULL, day TEXT NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL, PRIMARY KEY(slug,day)) WITHOUT ROWID",
  history_valuations: "CREATE TABLE history_valuations (slug TEXT NOT NULL, days INTEGER NOT NULL, day TEXT NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL, PRIMARY KEY(slug,days,day)) WITHOUT ROWID",
  history_fetches: "CREATE TABLE history_fetches (id TEXT PRIMARY KEY, payload TEXT NOT NULL) WITHOUT ROWID",
  history_runs: "CREATE TABLE history_runs (id TEXT PRIMARY KEY, payload TEXT NOT NULL) WITHOUT ROWID",
  history_budget: "CREATE TABLE history_budget (month TEXT PRIMARY KEY, reserved INTEGER NOT NULL CHECK(reserved<=8000000)) WITHOUT ROWID",
};
const names = Object.keys(legacySchema), quotedNames = names.map(name => `'${name}'`).join(",");
const auditSchema = `CREATE TABLE ${TABLE}(
  id TEXT PRIMARY KEY CHECK(id='${ID}'),month TEXT NOT NULL CHECK(month='${MONTH}'),
  credit_delta INTEGER NOT NULL CHECK(credit_delta=${CREDIT_DELTA}),bookkeeping_credits INTEGER NOT NULL CHECK(bookkeeping_credits=${BOOKKEEPING}),
  reserved_before INTEGER NOT NULL,reserved_after INTEGER NOT NULL CHECK(reserved_after=reserved_before+credit_delta+bookkeeping_credits AND reserved_after BETWEEN 0 AND 8000000),
  raw_estimated_writes INTEGER NOT NULL,legacy_reserved INTEGER NOT NULL CHECK(legacy_reserved=${LEGACY_RESERVED}),
  schema_sha256 TEXT NOT NULL,code_sha256 TEXT NOT NULL,proof_sha256 TEXT NOT NULL,proof_observed_at TEXT NOT NULL,evidence_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL,storage_bytes_before INTEGER NOT NULL,reason TEXT NOT NULL) WITHOUT ROWID`;
const auditTriggers = ["UPDATE", "DELETE"].map(operation => `CREATE TRIGGER ${TABLE}_${operation.toLowerCase()}_immutable BEFORE ${operation} ON ${TABLE} BEGIN SELECT RAISE(ABORT,'daily_raw_budget_audit_immutable'); END`);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalizedSql = (sql: string) => sql.replace(/\bIF\s+NOT\s+EXISTS\b/gi, "").replace(/\s+/g, "").toLowerCase();
const fail = (reason: string): never => { throw Error(`daily_raw_budget_reconciliation_${reason}`); };
const integer = (value: unknown) => { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) fail("invalid_counter"); return number; };

export interface DailyRawBudgetEvidence { proofSha256: string; observedAt: string; codeSha256: string }
export interface DailyRawBudgetReconciliationReport {
  id: string; month: string; status: "eligible" | "applied" | "already-applied";
  currentReserved: number; grossReserved: number; rawEstimatedWrites: number; legacyReserved: number;
  creditDelta: number; bookkeepingCredits: number; cumulativeNetAdjustment: number; projectedReserved: number;
  projectedRemainingEstimatedWrites: number; projectedBackfillAfterMaintenanceReserve: number; storageBytesBefore: number;
  schemaSha256: string; evidenceSha256: string; evidence: DailyRawBudgetEvidence; audit: Record<string, unknown> | null;
}
interface Snapshot { reserved: number; raw: number; bytes: number; pageSize: number; schemaHash: string; audit: Row | null; hasAuditTable: boolean }

async function snapshot(tx: Transaction): Promise<Snapshot> {
  const results = await tx.batch([
    `SELECT name,sql FROM sqlite_schema WHERE type='table' AND name IN (${quotedNames},'daily_raw_runs','${TABLE}') ORDER BY name`,
    `SELECT m.name AS table_name,p.name,p.origin FROM sqlite_schema m JOIN pragma_index_list(m.name) p WHERE m.type='table' AND m.name IN (${quotedNames},'${TABLE}') ORDER BY m.name,p.name`,
    `SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name IN (${quotedNames},'${TABLE}') ORDER BY name`,
    `SELECT reserved FROM history_budget WHERE month='${MONTH}'`,
    "SELECT id,started_at,max_estimated_writes,estimated_writes,rows_written,days_written,accounting_version FROM daily_raw_runs ORDER BY id",
    "SELECT (SELECT page_count FROM pragma_page_count)*(SELECT page_size FROM pragma_page_size) AS bytes,(SELECT page_size FROM pragma_page_size) AS page_size",
  ]);
  const tables = new Map(results[0].rows.map(row => [String(row.name), String(row.sql)]));
  for (const [name, sql] of Object.entries(legacySchema)) {
    if (normalizedSql(tables.get(name) ?? "") !== normalizedSql(sql)) fail("legacy_schema_changed");
    const indexes = results[1].rows.filter(row => row.table_name === name);
    if (indexes.length !== 1 || indexes[0].origin !== "pk") fail("legacy_index_changed");
  }
  if (results[2].rows.some(row => names.includes(String(row.tbl_name)))) fail("legacy_trigger_present");
  const runSql = normalizedSql(tables.get("daily_raw_runs") ?? "");
  if (!runSql.includes("max_estimated_writes<=8000000") || !runSql.endsWith("withoutrowid")) fail("raw_run_schema_changed");
  let raw = 0;
  for (const run of results[4].rows) {
    if (!["raw-double-v1", "raw-table-weights-v1"].includes(String(run.accounting_version))) fail("unsupported_run_accounting");
    const started = new Date(String(run.started_at));
    if (!Number.isFinite(started.getTime()) || started.toISOString().slice(0, 7) !== MONTH) fail("run_outside_fixed_month");
    const cost = integer(run.estimated_writes), allowance = integer(run.max_estimated_writes);
    if (allowance < 8 || allowance > HISTORY_WRITE_LIMIT || cost > allowance || integer(run.days_written) > integer(run.rows_written)) fail("invalid_raw_run");
    raw += cost;
  }
  if (!Number.isSafeInteger(raw)) fail("invalid_counter");
  const hasAuditTable = tables.has(TABLE);
  let audit: Row | null = null;
  if (hasAuditTable) {
    if (normalizedSql(tables.get(TABLE)!) !== normalizedSql(auditSchema)) fail("audit_schema_changed");
    const indexes = results[1].rows.filter(row => row.table_name === TABLE), triggers = results[2].rows.filter(row => row.tbl_name === TABLE);
    if (indexes.length !== 1 || indexes[0].origin !== "pk" || triggers.length !== 2 || auditTriggers.some(sql => !triggers.some(row => normalizedSql(String(row.sql)) === normalizedSql(sql)))) fail("audit_schema_changed");
    const rows = (await tx.execute(`SELECT * FROM ${TABLE}`)).rows;
    if (rows.length > 1 || rows.some(row => row.id !== ID)) fail("audit_conflict");
    audit = rows[0] ?? null;
  }
  if (results[3].rows.length !== 1) fail("monthly_counter_missing");
  const reserved = integer(results[3].rows[0].reserved), bytes = integer(results[5].rows[0].bytes), pageSize = integer(results[5].rows[0].page_size);
  if (reserved > HISTORY_WRITE_LIMIT) fail("monthly_counter_invalid");
  const schemaHash = hash(names.map(name => [name, normalizedSql(tables.get(name)!), results[1].rows.filter(row => row.table_name === name).map(row => [row.name, row.origin])]));
  return { reserved, raw, bytes, pageSize, schemaHash, audit, hasAuditTable };
}

/** Fixed October 2026 operation; dry-run never initializes or changes a table. */
export async function reconcileDailyRawBudget(db: Client, options: { evidence: DailyRawBudgetEvidence; apply?: boolean; now?: Date }): Promise<DailyRawBudgetReconciliationReport> {
  const now = options.now ?? new Date(), evidence = { proofSha256: options.evidence.proofSha256, observedAt: options.evidence.observedAt, codeSha256: options.evidence.codeSha256 };
  if (!Number.isFinite(now.getTime()) || now.toISOString().slice(0, 7) !== MONTH) fail("outside_fixed_month");
  if (HISTORY_WRITE_LIMIT !== 8_000_000 || HISTORY_STORAGE_LIMIT !== 4_000_000_000) fail("caps_changed");
  if (!/^[a-f0-9]{64}$/.test(evidence.proofSha256) || !/^[a-f0-9]{64}$/.test(evidence.codeSha256) || !/^2026-10-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(evidence.observedAt)) fail("invalid_evidence");
  const observedAt = new Date(evidence.observedAt);
  if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > now.getTime()) fail("invalid_evidence");
  evidence.observedAt = observedAt.toISOString();
  const tx = await db.transaction(options.apply ? "write" : "read");
  let attemptedWrite = false;
  try {
    const state = await snapshot(tx), evidenceHash = hash({ id: ID, month: MONTH, creditDelta: CREDIT_DELTA, bookkeepingCredits: BOOKKEEPING, legacyReserved: LEGACY_RESERVED, schemaSha256: state.schemaHash, ...evidence });
    const old = state.audit;
    if (old && (old.evidence_sha256 !== evidenceHash || old.proof_sha256 !== evidence.proofSha256 || old.code_sha256 !== evidence.codeSha256 || old.proof_observed_at !== evidence.observedAt || old.schema_sha256 !== state.schemaHash || Number(old.credit_delta) !== CREDIT_DELTA || Number(old.bookkeeping_credits) !== BOOKKEEPING || Number(old.reserved_after) !== Number(old.reserved_before) + NET_DELTA || Number(old.legacy_reserved) !== LEGACY_RESERVED || Number(old.reserved_before) - Number(old.raw_estimated_writes) !== LEGACY_RESERVED || old.reason !== REASON)) fail("audit_evidence_conflict");
    const adjustment = old ? NET_DELTA : 0, legacy = state.reserved - state.raw - adjustment;
    if (legacy !== LEGACY_RESERVED) fail("legacy_basis_changed");
    const projected = old ? state.reserved : state.reserved + NET_DELTA;
    if (projected < 0 || projected > HISTORY_WRITE_LIMIT || (!old && state.bytes + state.pageSize * 8 >= HISTORY_STORAGE_LIMIT)) fail("cap_preflight");
    let audit: Record<string, unknown> | null = old ? { ...old } : null;
    if (options.apply && !old) {
      attemptedWrite = true;
      if (!state.hasAuditTable) for (const sql of [auditSchema, ...auditTriggers]) await tx.execute(sql);
      const changed = await tx.execute({ sql: `UPDATE history_budget SET reserved=reserved+? WHERE month=? AND reserved=?`, args: [NET_DELTA, MONTH, state.reserved] });
      if (changed.rowsAffected !== 1) fail("cas_failed");
      audit = { id: ID, month: MONTH, credit_delta: CREDIT_DELTA, bookkeeping_credits: BOOKKEEPING, reserved_before: state.reserved, reserved_after: projected, raw_estimated_writes: state.raw, legacy_reserved: LEGACY_RESERVED, schema_sha256: state.schemaHash, code_sha256: evidence.codeSha256, proof_sha256: evidence.proofSha256, proof_observed_at: evidence.observedAt, evidence_sha256: evidenceHash, applied_at: now.toISOString(), storage_bytes_before: state.bytes, reason: REASON };
      const columns = Object.keys(audit), inserted = await tx.execute({ sql: `INSERT INTO ${TABLE}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`, args: columns.map(column => audit![column] as string | number) });
      if (inserted.rowsAffected !== 1) fail("audit_insert_failed");
      const size = await tx.execute("SELECT (SELECT page_count FROM pragma_page_count)*(SELECT page_size FROM pragma_page_size) AS bytes");
      if (integer(size.rows[0].bytes) >= HISTORY_STORAGE_LIMIT) fail("storage_cap");
    }
    await tx.commit();
    const applied = Boolean(old || options.apply), currentReserved = options.apply ? projected : state.reserved;
    return { id: ID, month: MONTH, status: old ? "already-applied" : options.apply ? "applied" : "eligible", currentReserved, grossReserved: currentReserved - (applied ? NET_DELTA : 0), rawEstimatedWrites: state.raw, legacyReserved: legacy, creditDelta: CREDIT_DELTA, bookkeepingCredits: BOOKKEEPING, cumulativeNetAdjustment: applied ? NET_DELTA : 0, projectedReserved: projected, projectedRemainingEstimatedWrites: HISTORY_WRITE_LIMIT - projected, projectedBackfillAfterMaintenanceReserve: Math.max(0, HISTORY_WRITE_LIMIT - projected - 500_000), storageBytesBefore: state.bytes, schemaSha256: state.schemaHash, evidenceSha256: evidenceHash, evidence, audit };
  } catch (error) {
    if (attemptedWrite && !(error instanceof Error && error.message.startsWith("daily_raw_budget_reconciliation_"))) fail("unknown_outcome_inspect_read_only_no_retry");
    throw error;
  } finally { tx.close(); }
}
