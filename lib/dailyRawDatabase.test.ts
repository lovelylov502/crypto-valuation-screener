import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HISTORY_WRITE_LIMIT, HistoryBudgetExceeded } from "./historyDatabase";
import { DAILY_RAW_ACCOUNTING_VERSION, DailyRawPreflightBudgetExceeded, auditDailyRawReferences, copyDailyRaw, dailyRawCoverage, getDailyRawCheckpoint, getDailyRawRun, initializeDailyRaw, listDailyRawAssets, openDailyRawRun, readDailyRaw, upsertDailyRaw, type DailyRawAsset, type DailyRawMetric, type DailyRawPoint, type DailyRawSource } from "./dailyRawDatabase";

let db: Client;
const now = new Date("2026-10-19T00:00:00Z"), asset: DailyRawAsset = { slug: "alpha", identity: "gecko:alpha-token" };
const source = (metric: DailyRawMetric, key: string = metric, overrides: Partial<DailyRawSource> = {}): DailyRawSource => ({ key, metric, provider: metric === "revenue" || metric === "holders" || metric === "fees" ? "DefiLlama" : "CoinGecko", url: `https://example.test/${metric}`, observedAt: now.toISOString(), sha256: "a".repeat(64), archiveUrl: "https://example.test/archive", scope: "exact-alpha", definition: `${metric} USD`, basis: metric === "revenue" || metric === "holders" || metric === "fees" ? "utc_daily_total" : "utc_midnight", ...overrides });
const observed = (value: number | null, key = "revenue", state: "complete" | "partial" | "missing" | "conflict" = value === null ? "missing" : "complete") => ({ value, source: key, state });
async function write(points: DailyRawPoint[], sources = [source("revenue")], overrides: Partial<Parameters<typeof upsertDailyRaw>[1]> = {}) {
  return upsertDailyRaw(db, { runId: "run", asset, sources, points, now, ...overrides });
}
async function budget() { return Number((await db.execute("SELECT reserved FROM history_budget WHERE month='2026-10'")).rows[0]?.reserved ?? 0); }
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await openDailyRawRun(db, { id: "run", maxEstimatedWrites: 1_000_000, now }); });
afterEach(() => { vi.restoreAllMocks(); db.close(); });

it("keeps same-day observations, independent timestamps, zero, negative and missing distinct", async () => {
  const sources = [source("revenue"), source("price"), source("mcap"), source("fdv")];
  await write([
    { day: "2020-01-01", revenue: observed(0), price: { ...observed(2, "price"), at: "2020-01-01T23:59:59Z" }, mcap: { ...observed(20, "mcap"), at: "2020-01-01T00:00:00Z" }, fdv: observed(null, "fdv") },
    { day: "2020-01-02", revenue: observed(-7) },
  ], sources);
  const result = await readDailyRaw(db, { asset });
  expect(result?.points[0]).toMatchObject({ day: "2020-01-01", revenue: { value: 0, state: "zero" }, price: { value: 2, at: "2020-01-01T23:59:59Z" }, mcap: { value: 20, at: "2020-01-01T00:00:00Z" }, fdv: { value: null, state: "missing" }, holders: { value: null, state: "missing" } });
  expect(result?.points[1].revenue).toMatchObject({ value: -7, state: "negative" });
});

it("replays idempotently after an acknowledged checkpoint without additional budget", async () => {
  const points = [{ day: "2020-01-01", revenue: observed(3) }], checkpoint = { key: "alpha:raw", cursor: "2020-01-01", status: "complete" as const };
  await write(points, undefined, { checkpoint });
  const before = await budget();
  expect(await write(points, undefined, { checkpoint })).toMatchObject({ rowsWritten: 0, daysWritten: 0, estimatedWrites: 0 });
  expect(await budget()).toBe(before);
  expect(await getDailyRawCheckpoint(db, "run", checkpoint.key)).toMatchObject({ cursor: "2020-01-01", status: "complete", daysWritten: 1 });
});

it("preserves verified fields when new input is missing or only partial", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3), fdv: observed(50, "fdv") }], [source("revenue"), source("fdv")]);
  await write([{ day: "2020-01-01", revenue: observed(1, "r2", "partial"), fdv: observed(null, "fdv") }], [source("revenue", "r2", { sha256: "b".repeat(64) }), source("fdv")]);
  expect((await readDailyRaw(db, { asset }))?.points[0]).toMatchObject({ revenue: { value: 3, source: "revenue" }, fdv: { value: 50, source: "fdv" } });
});

it("records conflicting source values and semantic changes, and requires an explicit revision to resolve", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }]);
  const conflict = source("revenue", "r2", { scope: "different-components", sha256: "b".repeat(64) });
  await write([{ day: "2020-01-01", revenue: observed(4, "r2") }], [conflict]);
  expect((await readDailyRaw(db, { asset }))?.points[0].revenue).toMatchObject({ value: null, state: "conflict" });
  const before = await budget();
  await write([{ day: "2020-01-01", revenue: observed(4, "r2") }], [conflict]);
  expect(await budget()).toBe(before);
  expect((await db.execute("SELECT previous_value,next_value,kind FROM daily_raw_revisions")).rows[0]).toMatchObject({ previous_value: 3, next_value: 4, kind: "conflict" });
  const revision = source("revenue", "r3", { revisionOf: "revenue", sha256: "c".repeat(64) });
  await write([{ day: "2020-01-01", revenue: observed(5, "r3") }], [revision]);
  expect((await readDailyRaw(db, { asset }))?.points[0].revenue).toMatchObject({ value: 5, state: "positive", source: "r3" });
  expect((await readDailyRaw(db, { asset }))?.sources[0].revisionOf).toBe("revenue");
});

it("holds an equal amount when its source definition changes without a linked revision", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }]);
  await write([{ day: "2020-01-01", revenue: observed(3, "r2") }], [source("revenue", "r2", { definition: "different economic scope", sha256: "b".repeat(64) })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].revenue.state).toBe("conflict");
  expect((await db.execute("SELECT previous_value,next_value FROM daily_raw_revisions")).rows[0]).toMatchObject({ previous_value: 3, next_value: 3 });
});

it("audits later revisions of the same provider series and ignores older receipts", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }], [source("revenue", "revenue", { observedAt: "2026-10-18T00:00:00Z" })]);
  await write([{ day: "2020-01-01", revenue: observed(4, "r2") }], [source("revenue", "r2", { sha256: "b".repeat(64) })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].revenue).toMatchObject({ value: 4, state: "positive", source: "r2" });
  expect((await db.execute("SELECT previous_value,next_value,kind FROM daily_raw_revisions")).rows[0]).toMatchObject({ previous_value: 3, next_value: 4, kind: "revision" });
  await write([{ day: "2020-01-01", revenue: observed(2, "older") }], [source("revenue", "older", { observedAt: "2026-10-17T00:00:00Z", sha256: "c".repeat(64) })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].revenue.value).toBe(4);
  await write([{ day: "2020-01-01", revenue: observed(5, "foreign") }], [source("revenue", "foreign", { provider: "Other", observedAt: "2026-10-19T01:00:00Z", sha256: "d".repeat(64) })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].revenue.state).toBe("conflict");
});

it("keeps an unresolved foreign-scope conflict when the original provider is collected again", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }], [source("revenue", "revenue", { observedAt: "2026-10-17T00:00:00Z" })]);
  await write([{ day: "2020-01-01", revenue: observed(4, "foreign") }], [source("revenue", "foreign", { scope: "foreign-components", observedAt: "2026-10-18T00:00:00Z", sha256: "b".repeat(64) })]);
  await write([{ day: "2020-01-01", revenue: observed(5, "fresh") }], [source("revenue", "fresh", { sha256: "c".repeat(64) })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].revenue.state).toBe("conflict");
  expect((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_revisions WHERE kind='conflict'")).rows[0].n).toBe(2);
});

it("revises a newer captured quote and retains a newer quote over stale provider timestamps", async () => {
  const basis = "captured_quote;actual_provider_timestamp";
  await write([{ day: "2020-01-01", price: { ...observed(2, "p1"), at: "2020-01-01T12:00:00Z" } }], [source("price", "p1", { basis, observedAt: "2020-01-01T12:00:01Z" })]);
  await write([{ day: "2020-01-01", price: { ...observed(3, "p2"), at: "2020-01-01T13:00:00Z" } }], [source("price", "p2", { basis, observedAt: "2020-01-01T13:00:01Z", sha256: "b".repeat(64) })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].price).toMatchObject({ value: 3, at: "2020-01-01T13:00:00Z" });
  expect((await db.execute("SELECT kind FROM daily_raw_revisions")).rows[0].kind).toBe("revision");
  await write([{ day: "2020-01-01", price: { ...observed(1, "stale"), at: "2020-01-01T11:00:00Z" } }], [source("price", "stale", { basis, observedAt: "2020-01-01T14:00:00Z", sha256: "c".repeat(64) })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].price.value).toBe(3);
});

it("revises verified captured quotes across canonical publication archives without changing their receipt URLs", async () => {
  const root = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/", basis = "captured_quote;actual_provider_timestamp";
  const first = source("price", "p1", { url: `${root}data-1-1-complete/data.json.gz`, basis, observedAt: "2020-01-01T12:00:01Z" });
  const later = source("price", "p2", { url: `${root}data-2-1-complete/data.json.gz`, basis, observedAt: "2020-01-01T13:00:01Z", sha256: "b".repeat(64) });
  await write([{ day: "2020-01-01", price: { ...observed(2, first.key), at: "2020-01-01T12:00:00Z" } }], [first]);
  await write([{ day: "2020-01-01", price: { ...observed(3, later.key), at: "2020-01-01T13:00:00Z" } }], [later]);
  const result = await readDailyRaw(db, { asset });
  expect(result?.points[0].price).toMatchObject({ value: 3, source: "p2" });
  expect(result?.sources[0].url).toBe(later.url);
  expect((await db.execute("SELECT previous_value,next_value,kind FROM daily_raw_revisions")).rows[0]).toMatchObject({ previous_value: 2, next_value: 3, kind: "revision" });
});

it("does not normalize foreign repositories or other archive assets into the captured quote series", async () => {
  const root = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/", basis = "captured_quote;actual_provider_timestamp";
  const candidates = ["https://github.com/other/repo/releases/download/data-2/data.json.gz", `${root}data-2/witness.json.gz`, `${root}data-2/data.json.gz?other=1`];
  for (const [i, url] of candidates.entries()) {
    const scoped = { slug: `asset-${i}`, identity: `gecko:asset-${i}` }, first = source("price", `old-${i}`, { url: `${root}data-1/data.json.gz`, basis, observedAt: "2020-01-01T12:00:01Z" }), later = source("price", `new-${i}`, { url, basis, observedAt: "2020-01-01T13:00:01Z", sha256: "b".repeat(64) });
    await write([{ day: "2020-01-01", price: { ...observed(2, first.key), at: "2020-01-01T12:00:00Z" } }], [first], { asset: scoped });
    await write([{ day: "2020-01-01", price: { ...observed(3, later.key), at: "2020-01-01T13:00:00Z" } }], [later], { asset: scoped });
    expect((await readDailyRaw(db, { asset: scoped }))?.points[0].price.state).toBe("conflict");
  }
});

it("finalizes captured market observations with approved verified closes and audits their replacement", async () => {
  const basis = "captured_quote;actual_provider_timestamp";
  await write([{ day: "2020-01-01", price: { ...observed(2, "p1"), at: "2020-01-01T12:00:00Z" }, fdv: { ...observed(20, "f1"), at: "2020-01-01T12:00:00Z" } }], [source("price", "p1", { basis }), source("fdv", "f1", { basis })]);
  await write([{ day: "2020-01-01", price: { ...observed(3, "csv"), at: "2020-01-02T00:00:00Z" }, fdv: { ...observed(30, "cm"), at: "2020-01-02T00:00:00Z" } }], [
    source("price", "csv", { url: "https://example.test/price.csv", definition: "verified CSV price column", basis: JSON.stringify({ format: "coingecko_web_csv", timestamp: { basis: "utc_day_close", verified: true } }) }),
    source("fdv", "cm", { provider: "CoinMetrics", scope: "verified chain identity", definition: "dated fully issued supply", basis: "utc_daily_close_verified_total_supply" }),
  ]);
  expect((await readDailyRaw(db, { asset }))?.points[0]).toMatchObject({ price: { value: 3, source: "csv" }, fdv: { value: 30, source: "cm" } });
  expect((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_revisions WHERE kind='revision'")).rows[0].n).toBe(2);
  await write([{ day: "2020-01-01", price: { ...observed(1, "late-intraday"), at: "2020-01-01T18:00:00Z" } }], [source("price", "late-intraday", { basis })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].price.value).toBe(3);
  await write([{ day: "2020-01-01", price: { ...observed(4, "unverified"), at: "2020-01-02T00:00:00Z" } }], [source("price", "unverified", { basis: "utc_day_close" })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].price.state).toBe("conflict");
});

it("requires explicit resolution of a pre-existing captured-quote conflict before adopting a close", async () => {
  const basis = "captured_quote;actual_provider_timestamp";
  await write([{ day: "2020-01-01", price: { ...observed(2, "p1"), at: "2020-01-01T12:00:00Z" } }], [source("price", "p1", { basis })]);
  await write([{ day: "2020-01-01", price: { ...observed(3, "p2"), at: "2020-01-01T13:00:00Z" } }], [source("price", "p2", { basis, scope: "unresolved-foreign-meaning" })]);
  await write([{ day: "2020-01-01", price: { ...observed(4, "csv"), at: "2020-01-02T00:00:00Z" } }], [source("price", "csv", { basis: JSON.stringify({ format: "coingecko_web_csv", timestamp: { basis: "utc_day_close", verified: true } }) })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].price.state).toBe("conflict");
});

it("accepts next-midnight UTC closes only with an explicit close convention", async () => {
  const point: DailyRawPoint = { day: "2020-01-01", price: { ...observed(2, "price"), at: "2020-01-02T00:00:00Z" } };
  await expect(write([point], [source("price")])).rejects.toThrow("timestamp");
  await write([point], [source("price", "price", { basis: "utc_day_close" })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].price.at).toBe("2020-01-02T00:00:00Z");
});

it("retains a partial daily total and records its later complete source", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3, "revenue", "partial") }]);
  expect((await readDailyRaw(db, { asset }))?.points[0].revenue.state).toBe("partial");
  await write([{ day: "2020-01-01", revenue: observed(4, "r2") }], [source("revenue", "r2", { sha256: "b".repeat(64) })]);
  expect((await readDailyRaw(db, { asset }))?.points[0].revenue).toMatchObject({ value: 4, state: "positive" });
  expect((await db.execute("SELECT kind FROM daily_raw_revisions")).rows[0].kind).toBe("completion");
});

it("counts rows in one bulk INSERT, not the SQL statement count", async () => {
  const before = await budget();
  const result = await write([1, 2, 3, 4, 5].map(day => ({ day: `2020-01-0${day}`, revenue: observed(day) })));
  // Three indexed metadata rows count twice; five days, one asset revision and four bookkeeping/safety credits count once.
  expect(result).toMatchObject({ rowsWritten: 10, daysWritten: 5, estimatedWrites: 16 });
  expect(await budget() - before).toBe(16);
});

it("counts deduplicated receipts and every row from a batched source import", async () => {
  const sources = Array.from({ length: 100 }, (_, i) => source("revenue", `receipt-${i}`));
  const result = await write(sources.map((receipt, i) => ({ day: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), revenue: observed(i, receipt.key) })), sources);
  expect((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_receipts")).rows[0].n).toBe(1);
  expect((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_sources")).rows[0].n).toBe(100);
  expect(result).toMatchObject({ rowsWritten: 204, daysWritten: 100, estimatedWrites: 309 });
});

it("keeps old run reservations and accounting unchanged when resuming after the weighted migration", async () => {
  const legacy = createClient({ url: ":memory:" });
  try {
    await legacy.batch([
      "CREATE TABLE history_budget(month TEXT PRIMARY KEY,reserved INTEGER NOT NULL CHECK(reserved<=8000000)) WITHOUT ROWID",
      "CREATE TABLE daily_raw_runs(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,max_estimated_writes INTEGER NOT NULL CHECK(max_estimated_writes<=8000000),estimated_writes INTEGER NOT NULL DEFAULT 0,rows_written INTEGER NOT NULL DEFAULT 0,days_written INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID",
      "INSERT INTO history_budget VALUES('2026-10',1234)",
      "INSERT INTO daily_raw_runs(id,started_at,max_estimated_writes,estimated_writes,rows_written) VALUES('legacy','2026-10-19T00:00:00Z',1000,8,2)",
    ], "write");
    await initializeDailyRaw(legacy);
    expect(await openDailyRawRun(legacy, { id: "legacy", maxEstimatedWrites: 1_000, now })).toMatchObject({ estimatedWrites: 8, rowsWritten: 2, accountingVersion: "raw-double-v1" });
    expect((await legacy.execute("SELECT reserved FROM history_budget")).rows[0].reserved).toBe(1234);
    const result = await upsertDailyRaw(legacy, { runId: "legacy", asset, sources: [source("revenue")], points: [1, 2, 3, 4, 5].map(day => ({ day: `2020-01-0${day}`, revenue: observed(day) })), now });
    expect(result).toMatchObject({ rowsWritten: 10, estimatedWrites: 24 });
    expect((await getDailyRawRun(legacy, "legacy"))?.estimatedWrites).toBe(32);
    expect((await openDailyRawRun(legacy, { id: "weighted", maxEstimatedWrites: 1_000, now })).accountingVersion).toBe(DAILY_RAW_ACCOUNTING_VERSION);
    await expect(legacy.execute("UPDATE daily_raw_runs SET accounting_version='raw-double-v1' WHERE id='weighted'")).rejects.toThrow("immutable");
  } finally { legacy.close(); }
});

it("bounds weighted conflict witnesses before writes and counts their indexed audit rows", async () => {
  const sources = [source("revenue"), source("revenue", "r2", { sha256: "b".repeat(64) }), source("revenue", "r3", { sha256: "c".repeat(64) })];
  const points: DailyRawPoint[] = [{ day: "2020-01-01", revenue: { ...observed(null, "revenue", "conflict"), witnesses: [observed(3), observed(4, "r2"), observed(5, "r3")] } }];
  await openDailyRawRun(db, { id: "bounded", maxEstimatedWrites: 8, now });
  let required = 0;
  try { await write(points, sources, { runId: "bounded" }); }
  catch (error) { expect(error).toBeInstanceOf(DailyRawPreflightBudgetExceeded); required = (error as DailyRawPreflightBudgetExceeded).requiredEstimatedWrites; }
  expect((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_sources")).rows[0].n).toBe(0);
  const result = await write(points, sources);
  // asset + three receipts + three sources + two audit rows are nine indexed rows.
  expect(result).toMatchObject({ rowsWritten: 12, daysWritten: 1, estimatedWrites: 24 });
  expect(required).toBeGreaterThanOrEqual(result.estimatedWrites);
  expect((await auditDailyRawReferences(db)).ok).toBe(true);
});

it("tracks one charged asset revision per changed batch, preserving replays, checkpoints and failed preflights", async () => {
  const points = [{ day: "2020-01-01", revenue: observed(3) }];
  await write(points);
  const revision = async () => Number((await db.execute("SELECT revision FROM daily_raw_asset_revisions")).rows[0].revision);
  expect(await revision()).toBe(1);
  await write(points); await write([], [], { checkpoint: { key: "only-checkpoint", cursor: "complete" } });
  expect(await revision()).toBe(1);
  await write([{ day: "2020-01-02", revenue: observed(5) }, { day: "2020-01-03", revenue: observed(7) }]);
  expect(await revision()).toBe(2);
  await db.execute({ sql: "UPDATE history_budget SET reserved=? WHERE month='2026-10'", args: [HISTORY_WRITE_LIMIT - 1] });
  await expect(write([{ day: "2020-01-04", revenue: observed(9) }])).rejects.toBeInstanceOf(HistoryBudgetExceeded);
  expect(await revision()).toBe(2); expect((await readDailyRaw(db, { asset }))?.points).toHaveLength(3);
});

it("rolls back source references, daily rows and checkpoints if the shared monthly budget is exceeded", async () => {
  await db.execute({ sql: "UPDATE history_budget SET reserved=? WHERE month='2026-10'", args: [HISTORY_WRITE_LIMIT - 1] });
  await expect(write([{ day: "2020-01-01", revenue: observed(3) }], undefined, { checkpoint: { key: "a", cursor: "2020-01-01" } })).rejects.toBeInstanceOf(HistoryBudgetExceeded);
  for (const table of ["daily_raw_assets", "daily_raw_sources", "daily_raw_receipts", "daily_raw_days", "daily_raw_checkpoints", "daily_raw_asset_revisions"]) expect((await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n).toBe(0);
  expect(await budget()).toBe(HISTORY_WRITE_LIMIT - 1);
  expect((await db.execute("SELECT estimated_writes FROM daily_raw_runs")).rows[0].estimated_writes).toBe(5);
});

it("enforces a caller's cumulative run ceiling atomically and cannot raise it on resume", async () => {
  await openDailyRawRun(db, { id: "small", maxEstimatedWrites: 12, now });
  const before = await budget();
  await expect(write([{ day: "2020-01-01", revenue: observed(3) }], undefined, { runId: "small" })).rejects.toThrow("daily_raw_run_write_budget");
  expect(await budget()).toBe(before);
  expect((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_sources")).rows[0].n).toBe(0);
  await expect(openDailyRawRun(db, { id: "small", maxEstimatedWrites: 100, now })).rejects.toThrow("immutable");
});

it("rejects insufficient quota using reads only, including before a new run is inserted", async () => {
  await db.execute({ sql: "UPDATE history_budget SET reserved=? WHERE month='2026-10'", args: [HISTORY_WRITE_LIMIT - 1] });
  const sql: string[] = [], transaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation(async () => {
    const tx = await transaction("write"), batch = tx.batch.bind(tx), execute = tx.execute.bind(tx);
    vi.spyOn(tx, "batch").mockImplementation(async statements => { sql.push(...statements.map(statement => typeof statement === "string" ? statement : statement.sql)); return batch(statements); });
    vi.spyOn(tx, "execute").mockImplementation(async statement => { sql.push(typeof statement === "string" ? statement : statement.sql); return execute(statement); });
    return tx;
  });
  await expect(write([{ day: "2020-01-01", revenue: observed(3) }])).rejects.toThrow("remain unused");
  await expect(openDailyRawRun(db, { id: "new-run", maxEstimatedWrites: 1_000, now })).rejects.toThrow("preflight");
  expect(sql.filter(statement => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(statement))).toEqual([]);
  expect((await auditDailyRawReferences(db)).ok).toBe(true);
});

it("allows an unchanged replay after both run and monthly allowances have been exhausted", async () => {
  const points = [{ day: "2020-01-01", revenue: observed(3) }], checkpoint = { key: "a", cursor: "2020-01-01", status: "complete" as const };
  await write(points, undefined, { checkpoint });
  await db.batch(["UPDATE daily_raw_runs SET estimated_writes=max_estimated_writes", { sql: "UPDATE history_budget SET reserved=? WHERE month='2026-10'", args: [HISTORY_WRITE_LIMIT] }], "write");
  const previous = await getDailyRawRun(db, "run");
  expect(await write(points, undefined, { checkpoint })).toMatchObject({ estimatedWrites: 0, rowsWritten: 0, daysWritten: 0 });
  expect(await getDailyRawRun(db, "run")).toEqual(previous);
  expect(await budget()).toBe(HISTORY_WRITE_LIMIT);
});

it("reuses the preflight source and asset snapshot without redundant database operations", async () => {
  const points = [{ day: "2020-01-01", revenue: observed(3) }];
  await write(points);
  const operations: string[][] = [], transaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation(async () => {
    const tx = await transaction("write"), batch = tx.batch.bind(tx), execute = tx.execute.bind(tx);
    vi.spyOn(tx, "batch").mockImplementation(async statements => { operations.push(statements.map(statement => typeof statement === "string" ? statement : statement.sql)); return batch(statements); });
    vi.spyOn(tx, "execute").mockImplementation(async statement => { operations.push([typeof statement === "string" ? statement : statement.sql]); return execute(statement); });
    return tx;
  });
  expect(await write(points)).toMatchObject({ rowsWritten: 0, estimatedWrites: 0 });
  expect(operations).toHaveLength(2);
  expect(operations.flat().every(sql => /^(?:SELECT|PRAGMA)\b/.test(sql))).toBe(true);
});

it("applies a reviewed correction only while the expected source, amount, state and time still match", async () => {
  const at = "2020-01-01T12:00:00Z", point = { day: "2020-01-01", fdv: { ...observed(30, "fdv"), at } };
  await write([point], [source("fdv")]);
  const expected = { day: point.day, metric: "fdv" as const, sourceKey: "fdv", value: 30, state: 1, at };
  const correction = { ...observed(null, "held", "conflict"), at }, proposed = source("fdv", "held", { revisionOf: "fdv", sha256: "b".repeat(64) });
  for (const changed of [{ value: 31 }, { sourceKey: "another" }, { state: 4 }, { at: null }]) {
    const before = await budget();
    await expect(write([{ day: point.day, fdv: correction }], [proposed], { expectedCells: [{ ...expected, ...changed }] })).rejects.toThrow("expected cell changed");
    expect(await budget()).toBe(before);
    expect((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_sources WHERE source_key='held'")).rows[0].n).toBe(0);
  }
  await write([{ day: point.day, fdv: correction }], [proposed], { expectedCells: [expected] });
  expect((await readDailyRaw(db, { asset }))?.points[0].fdv).toMatchObject({ value: null, state: "conflict", source: "held", at });
  expect((await auditDailyRawReferences(db)).ok).toBe(true);
});

it("rejects a stale reviewed correction before any mutation after a newer provider revision", async () => {
  const day = "2020-01-01", at = "2020-01-01T12:00:00Z";
  await write([{ day, fdv: { ...observed(30, "fdv"), at } }], [source("fdv")]);
  await write([{ day, fdv: { ...observed(40, "newer"), at } }], [source("fdv", "newer", { revisionOf: "fdv", sha256: "c".repeat(64) })]);
  const commands: string[] = [], transaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation(async () => {
    const tx = await transaction("write"), batch = tx.batch.bind(tx), execute = tx.execute.bind(tx);
    vi.spyOn(tx, "batch").mockImplementation(async statements => { commands.push(...statements.map(statement => typeof statement === "string" ? statement : statement.sql)); return batch(statements); });
    vi.spyOn(tx, "execute").mockImplementation(async statement => { commands.push(typeof statement === "string" ? statement : statement.sql); return execute(statement); });
    return tx;
  });
  await expect(write([{ day, fdv: { ...observed(null, "held", "conflict"), at } }], [source("fdv", "held", { revisionOf: "fdv", sha256: "b".repeat(64) })], { expectedCells: [{ day, metric: "fdv", sourceKey: "fdv", value: 30, state: 1, at }] })).rejects.toThrow("expected cell changed");
  expect(commands.every(sql => /^(?:SELECT|PRAGMA)\b/.test(sql))).toBe(true);
  expect((await readDailyRaw(db, { asset }))?.points[0].fdv).toMatchObject({ value: 40, state: "positive", source: "newer" });
});

it("checks revision-copy headroom before attempting an audit-row INSERT", async () => {
  const sources = [source("revenue"), source("revenue", "r2", { sha256: "b".repeat(64) })];
  await write([{ day: "2020-01-01", revenue: { ...observed(null, "revenue", "conflict"), witnesses: [observed(3), observed(4, "r2")] } }], sources);
  const destination = createClient({ url: ":memory:" });
  try {
    await initializeDailyRaw(destination);
    await openDailyRawRun(destination, { id: "prepare", maxEstimatedWrites: 1_000, now });
    await upsertDailyRaw(destination, { runId: "prepare", asset, sources, points: [{ day: "2020-01-01", revenue: observed(null, "revenue", "conflict") }], now });
    const sql: string[] = [], transaction = destination.transaction.bind(destination);
    vi.spyOn(destination, "transaction").mockImplementation(async () => {
      const tx = await transaction("write"), batch = tx.batch.bind(tx), execute = tx.execute.bind(tx);
      vi.spyOn(tx, "batch").mockImplementation(async statements => { sql.push(...statements.map(statement => typeof statement === "string" ? statement : statement.sql)); return batch(statements); });
      vi.spyOn(tx, "execute").mockImplementation(async statement => { sql.push(typeof statement === "string" ? statement : statement.sql); return execute(statement); });
      return tx;
    });
    await expect(copyDailyRaw(db, destination, { runId: "copy", stagingId: "d".repeat(64), maxEstimatedWrites: 21, now })).rejects.toThrow("preflight");
    expect(sql.filter(statement => /^INSERT INTO daily_raw_revisions\b/i.test(statement))).toEqual([]);
    expect((await destination.execute("SELECT COUNT(*) AS n FROM daily_raw_revisions")).rows[0].n).toBe(0);
    expect((await auditDailyRawReferences(destination)).ok).toBe(true);
  } finally { destination.close(); }
});

it("allows a fresh local staging store to exceed cloud counters while retaining its explicit run allowance", async () => {
  const local = createClient({ url: ":memory:" });
  try {
    await initializeDailyRaw(local, { unmeteredLocal: true });
    await openDailyRawRun(local, { id: "local", maxEstimatedWrites: 10_000_000, now });
    await local.batch(["UPDATE daily_raw_runs SET estimated_writes=8000001", "UPDATE history_budget SET reserved=8000001"], "write");
    const result = await upsertDailyRaw(local, { runId: "local", asset, sources: [source("revenue")], points: [{ day: "2020-01-01", revenue: observed(3) }], now });
    expect(result.daysWritten).toBe(1);
    expect((await getDailyRawRun(local, "local"))!.estimatedWrites).toBeGreaterThan(HISTORY_WRITE_LIMIT);
    expect((await auditDailyRawReferences(local)).ok).toBe(true);
    await expect(openDailyRawRun(db, { id: "too-large", maxEstimatedWrites: 10_000_000, now })).rejects.toThrow("allowance");
  } finally { local.close(); }
});

it("rejects unmetered mode for remote clients before any query and requires a fresh local schema", async () => {
  const remote = { protocol: "http", execute: vi.fn(), batch: vi.fn() } as unknown as Client;
  await expect(initializeDailyRaw(remote, { unmeteredLocal: true })).rejects.toThrow("local file");
  expect(remote.execute).not.toHaveBeenCalled(); expect(remote.batch).not.toHaveBeenCalled();
  await expect(initializeDailyRaw(db, { unmeteredLocal: true })).rejects.toThrow("fresh local database");
});

it("rolls back all new evidence if the transaction would cross the storage limit", async () => {
  const transaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation(async () => {
    const tx = await transaction("write"), batch = tx.batch.bind(tx);
    vi.spyOn(tx, "batch").mockImplementation(async statements => {
      const results = await batch(statements), index = statements.findIndex(statement => statement === "PRAGMA page_count");
      if (index >= 0) results[index] = { ...results[index], rows: [{ ...results[index].rows[0], 0: 4_000_000_000 }] };
      return results;
    });
    return tx;
  });
  const before = await budget();
  await expect(write([{ day: "2020-01-01", revenue: observed(3) }])).rejects.toThrow("history_storage_budget");
  expect(await budget()).toBe(before);
  expect((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_sources")).rows[0].n).toBe(0);
});

it("does not splice a replacement token into the old token's dates or reuse its source key", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }]);
  const replacement = { slug: asset.slug, identity: "gecko:replacement" };
  await expect(write([{ day: "2020-01-02", revenue: observed(4) }], undefined, { asset: replacement })).rejects.toThrow("source key");
  await write([{ day: "2020-01-02", revenue: observed(4, "new-revenue") }], [source("revenue", "new-revenue")], { asset: replacement });
  expect((await readDailyRaw(db, { asset }))?.points.map(point => point.day)).toEqual(["2020-01-01"]);
  expect((await readDailyRaw(db, { asset: replacement }))?.points.map(point => point.day)).toEqual(["2020-01-02"]);
  await expect(db.execute("UPDATE daily_raw_assets SET identity='gecko:wrong'")).rejects.toThrow("immutable");
});

it("rejects an unregistered or wrong metric source and any unfinished complete daily flow", async () => {
  await expect(write([{ day: "2020-01-01", revenue: observed(3, "missing") }])).rejects.toThrow("source");
  await expect(write([{ day: "2020-01-01", price: observed(3) }])).rejects.toThrow("source");
  await expect(write([{ day: "2026-10-19", revenue: observed(3) }])).rejects.toThrow("Incomplete");
  expect((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_sources")).rows[0].n).toBe(0);
});

it("does not retry a transaction with an unknown commit outcome", async () => {
  const create = db.transaction.bind(db);
  const transaction = vi.spyOn(db, "transaction").mockImplementation(async () => {
    const tx = await create("write"), commit = tx.commit.bind(tx);
    vi.spyOn(tx, "commit").mockImplementationOnce(async () => { await commit(); throw Error("connection lost at commit"); });
    return tx;
  });
  const points = [{ day: "2020-01-01", revenue: observed(3) }], checkpoint = { key: "source", cursor: "2020-01-01" };
  await expect(write(points, undefined, { checkpoint })).rejects.toThrow("connection lost at commit");
  expect(transaction).toHaveBeenCalledTimes(1);
  transaction.mockRestore();
  expect((await getDailyRawCheckpoint(db, "run", "source"))?.cursor).toBe("2020-01-01");
  const before = await budget();
  expect((await write(points, undefined, { checkpoint })).estimatedWrites).toBe(0);
  expect(await budget()).toBe(before);
});

it("restores a file-backed checkpoint and resumes a staged copy without rewriting committed dates", async () => {
  const path = join(tmpdir(), `daily-raw-${randomUUID()}.sqlite`), url = pathToFileURL(path).href;
  try {
    // Native libsql keeps Windows file handles until the worker exits, so isolate this restore proof.
    const script = `
      import assert from 'node:assert/strict';
      import {createClient} from '@libsql/client';
      const {initializeDailyRaw,openDailyRawRun,upsertDailyRaw,copyDailyRaw,getDailyRawCheckpoint,getDailyRawRun,readDailyRaw}=await import(${JSON.stringify(new URL("./dailyRawDatabase.ts", import.meta.url).href)});
      const asset=${JSON.stringify(asset)}, source=${JSON.stringify(source("revenue"))}, now=new Date(${JSON.stringify(now.toISOString())});
      const stage=createClient({url:':memory:'});
      await initializeDailyRaw(stage);await openDailyRawRun(stage,{id:'stage',maxEstimatedWrites:1000,now});
      await upsertDailyRaw(stage,{runId:'stage',asset,sources:[source],points:[1,2,3].map(day=>({day:'2020-01-0'+day,revenue:{value:day,state:'complete',source:'revenue'}})),now});
      let restored=createClient({url:process.env.DAILY_RAW_TEST_DB});
      await initializeDailyRaw(restored);
      const options={runId:'copy',stagingId:'d'.repeat(64),maxEstimatedWrites:1000,batchSize:1,now};let batches=0;
      await assert.rejects(copyDailyRaw(stage,restored,{...options,onBatch:()=>{if(++batches===1)throw Error('process interrupted');}}),/interrupted/);
      assert.equal((await getDailyRawCheckpoint(restored,'copy','copy:alpha:gecko:alpha-token')).cursor,'2020-01-01');
      assert.equal((await getDailyRawCheckpoint(restored,'copy','copy:alpha:gecko:alpha-token')).status,'running');
      restored.close();restored=createClient({url:process.env.DAILY_RAW_TEST_DB});
      assert.equal((await copyDailyRaw(stage,restored,options)).daysWritten,2);
      assert.deepEqual((await readDailyRaw(restored,{asset})).points.map(point=>point.revenue.value),[1,2,3]);
      const previous=await getDailyRawRun(restored,'copy');const replay=await copyDailyRaw(stage,restored,options);
      assert.equal(replay.assetsSkipped,1);assert.equal(replay.estimatedWrites,0);assert.equal(replay.rowsWritten,0);
      assert.deepEqual(await getDailyRawRun(restored,'copy'),previous);
      await assert.rejects(copyDailyRaw(stage,restored,{...options,stagingId:'e'.repeat(64)}),/staging changed/);
      restored.close();stage.close();process.stdout.write('restored');
    `;
    expect(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd(), env: { ...process.env, DAILY_RAW_TEST_DB: url }, encoding: "utf8" })).toBe("restored");
  } finally {
    for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) unlinkSync(file);
  }
});

it("remaps integer IDs during copy and preserves the two witnesses of a stored conflict", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }]);
  await write([{ day: "2020-01-01", revenue: observed(4, "r2") }], [source("revenue", "r2", { sha256: "b".repeat(64) })]);
  const destination = createClient({ url: ":memory:" });
  try {
    await initializeDailyRaw(destination);
    await openDailyRawRun(destination, { id: "existing", maxEstimatedWrites: 1_000, now });
    await upsertDailyRaw(destination, { runId: "existing", asset: { slug: "other", identity: "gecko:other-token" }, sources: [source("revenue", "other-r")], points: [{ day: "2020-01-01", revenue: observed(8, "other-r") }], now });
    await copyDailyRaw(db, destination, { runId: "copy", stagingId: "d".repeat(64), maxEstimatedWrites: 1_000, now });
    expect((await readDailyRaw(destination, { asset }))?.assetId).toBe(2);
    expect((await readDailyRaw(destination, { asset }))?.points[0].revenue.state).toBe("conflict");
    expect((await destination.execute("SELECT e.previous_value,e.next_value,p.source_key AS previous_key,n.source_key AS next_key FROM daily_raw_revisions e JOIN daily_raw_sources p ON p.id=e.previous_source JOIN daily_raw_sources n ON n.id=e.next_source")).rows[0]).toMatchObject({ previous_value: 3, next_value: 4, previous_key: "revenue", next_key: "r2" });
    expect((await listDailyRawAssets(destination)).map(row => row.identity).sort()).toEqual(["gecko:alpha-token", "gecko:other-token"]);
  } finally { destination.close(); }
});

it("copies a stage without revisions using only data-page transactions and commits final completion with the data", async () => {
  await write([1, 2, 3].map(day => ({ day: `2020-01-0${day}`, revenue: observed(day) })));
  const destination = createClient({ url: ":memory:" });
  try {
    await initializeDailyRaw(destination);
    const transaction = vi.spyOn(destination, "transaction"), progress: { daysWritten: number; complete: boolean }[] = [];
    const result = await copyDailyRaw(db, destination, { runId: "copy", stagingId: "d".repeat(64), maxEstimatedWrites: 1_000, batchSize: 1, now, onBatch: batch => { progress.push(batch); } });
    expect(result).toMatchObject({ assetsCompleted: 1, daysWritten: 3, accountingVersion: DAILY_RAW_ACCOUNTING_VERSION });
    expect(transaction).toHaveBeenCalledTimes(5); // open run, staging checkpoint, three data pages
    expect(progress.map(batch => [batch.daysWritten, batch.complete])).toEqual([[1, false], [1, false], [1, true]]);
    expect(await getDailyRawCheckpoint(destination, "copy", "copy:alpha:gecko:alpha-token")).toMatchObject({ status: "complete", cursor: "2020-01-03" });
  } finally { destination.close(); }
});

it("resumes after the final data commit even when its completion callback was interrupted", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }]);
  const destination = createClient({ url: ":memory:" }), options = { runId: "copy", stagingId: "d".repeat(64), maxEstimatedWrites: 1_000, now };
  try {
    await initializeDailyRaw(destination);
    await expect(copyDailyRaw(db, destination, { ...options, onBatch: batch => { if (batch.complete) throw Error("process interrupted after final commit"); } })).rejects.toThrow("interrupted");
    expect(await getDailyRawCheckpoint(destination, "copy", "copy:alpha:gecko:alpha-token")).toMatchObject({ status: "complete", cursor: "2020-01-01" });
    const before = await getDailyRawRun(destination, "copy");
    expect(await copyDailyRaw(db, destination, options)).toMatchObject({ assetsSkipped: 1, daysWritten: 0, rowsWritten: 0, estimatedWrites: 0, pendingAssets: 0 });
    expect(await getDailyRawRun(destination, "copy")).toEqual(before);
  } finally { destination.close(); }
});

it("finishes a preexisting running checkpoint whose last data page was already committed", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }]);
  const destination = createClient({ url: ":memory:" }), options = { runId: "copy", stagingId: "d".repeat(64), maxEstimatedWrites: 1_000, now };
  try {
    await initializeDailyRaw(destination);
    await copyDailyRaw(db, destination, options);
    await destination.execute("UPDATE daily_raw_checkpoints SET status='running' WHERE checkpoint_key='copy:alpha:gecko:alpha-token'");
    expect(await copyDailyRaw(db, destination, options)).toMatchObject({ assetsCompleted: 1, daysWritten: 0, estimatedWrites: 5, pendingAssets: 0 });
    expect(await getDailyRawCheckpoint(destination, "copy", "copy:alpha:gecko:alpha-token")).toMatchObject({ status: "complete" });
  } finally { destination.close(); }
});

it("retains explicit source predecessors and revision evidence on the full copy path", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }]);
  await write([{ day: "2020-01-01", revenue: observed(4, "r2") }], [source("revenue", "r2", { revisionOf: "revenue", sha256: "b".repeat(64) })]);
  const destination = createClient({ url: ":memory:" });
  try {
    await initializeDailyRaw(destination);
    await copyDailyRaw(db, destination, { runId: "copy", stagingId: "d".repeat(64), maxEstimatedWrites: 1_000, now });
    expect((await readDailyRaw(destination, { asset }))?.points[0].revenue).toMatchObject({ value: 4, source: "r2" });
    expect((await destination.execute("SELECT s.source_key,p.source_key AS previous FROM daily_raw_sources s JOIN daily_raw_sources p ON p.id=s.revision_of")).rows[0]).toMatchObject({ source_key: "r2", previous: "revenue" });
    expect((await destination.execute("SELECT previous_value,next_value,kind FROM daily_raw_revisions")).rows[0]).toMatchObject({ previous_value: 3, next_value: 4, kind: "revision" });
    expect((await auditDailyRawReferences(destination)).ok).toBe(true);
  } finally { destination.close(); }
});

it("keeps clean assets on the atomic data/completion fast path when another staged asset has audit history", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }]);
  await write([{ day: "2020-01-01", revenue: observed(4, "r2") }], [source("revenue", "r2", { sha256: "b".repeat(64) })]);
  const clean = { slug: "beta", identity: "gecko:beta" };
  await write([{ day: "2020-01-01", revenue: observed(8, "beta-r") }], [source("revenue", "beta-r")], { asset: clean });
  const destination = createClient({ url: ":memory:" });
  try {
    await initializeDailyRaw(destination);
    const transactions = vi.spyOn(destination, "transaction"), events: { slug: string; days: number; complete: boolean }[] = [];
    const result = await copyDailyRaw(db, destination, { runId: "copy", stagingId: "d".repeat(64), maxEstimatedWrites: 1_000, now, onBatch: async progress => {
      events.push({ slug: progress.asset.slug, days: progress.daysWritten, complete: progress.complete });
      if (progress.asset.slug === clean.slug && progress.daysWritten) expect(await getDailyRawCheckpoint(destination, "copy", "copy:beta:gecko:beta")).toMatchObject({ status: "complete", cursor: "2020-01-01" });
    } });
    expect(result).toMatchObject({ assetsCompleted: 2, daysWritten: 2, pendingAssets: 0 });
    expect(transactions).toHaveBeenCalledTimes(7); // run, staging, clean data; audited source, data, audit, completion
    expect(events).toEqual([{ slug: "beta", days: 1, complete: true }, { slug: "alpha", days: 1, complete: false }, { slug: "alpha", days: 0, complete: true }]);
    expect((await destination.execute("SELECT COUNT(*) AS n FROM daily_raw_revisions")).rows[0].n).toBe(1);
    expect((await readDailyRaw(destination, { asset: clean }))?.points[0].revenue.value).toBe(8);
    expect((await auditDailyRawReferences(destination)).ok).toBe(true);
  } finally { destination.close(); }
});

it("skips empty registry placeholders and creates no remote run when the entire staging registry is empty", async () => {
  await write([], [], { asset: { slug: "placeholder", identity: "defillama:placeholder" } });
  const destination = createClient({ url: ":memory:" }), options = { runId: "copy", stagingId: "d".repeat(64), maxEstimatedWrites: 1_000, now };
  try {
    await initializeDailyRaw(destination);
    expect(await copyDailyRaw(db, destination, options)).toMatchObject({ emptyAssetsSkipped: 1, assetsCompleted: 0, pendingAssets: 0, rowsWritten: 0, estimatedWrites: 0 });
    expect(await getDailyRawRun(destination, "copy")).toBeNull();
    await write([{ day: "2020-01-01", revenue: observed(3) }]);
    expect(await copyDailyRaw(db, destination, options)).toMatchObject({ emptyAssetsSkipped: 1, assetsCompleted: 1, pendingAssets: 0 });
    expect((await listDailyRawAssets(destination)).map(row => row.slug)).toEqual([asset.slug]);
    expect(await getDailyRawCheckpoint(destination, "copy", "copy:placeholder:defillama:placeholder")).toBeNull();
  } finally { destination.close(); }
});

it("enforces exact source references at the SQL boundary even when SQLite foreign keys are disabled", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }]);
  await db.execute("PRAGMA foreign_keys=OFF");
  const id = (await db.execute("SELECT id FROM daily_raw_sources")).rows[0].id;
  await expect(db.execute({ sql: "UPDATE daily_raw_days SET price=2,price_state=1,price_source=?", args: [id] })).rejects.toThrow("source_mismatch");
  await expect(db.execute("UPDATE daily_raw_days SET revenue=NULL,revenue_state=1")).rejects.toThrow("CHECK");
});

it("keeps very large capital observations as REAL values without unsafe integer decoding", async () => {
  const value = 2 ** 60;
  await write([{ day: "2020-01-01", fdv: observed(value, "fdv") }], [source("fdv")]);
  expect((await readDailyRaw(db, { asset }))?.points[0].fdv.value).toBe(value);
  expect((await db.execute("SELECT typeof(fdv) AS kind FROM daily_raw_days")).rows[0].kind).toBe("real");
});

it("pauses a copy between chunks and resumes it under asset and time limits", async () => {
  await write([1, 2, 3].map(day => ({ day: `2020-01-0${day}`, revenue: observed(day) })));
  await write([{ day: "2020-01-01", revenue: observed(8, "beta-r") }], [source("revenue", "beta-r")], { asset: { slug: "beta", identity: "gecko:beta" } });
  const destination = createClient({ url: ":memory:" });
  try {
    await initializeDailyRaw(destination);
    const options = { runId: "copy", stagingId: "d".repeat(64), maxEstimatedWrites: 1_000, batchSize: 1, maxAssets: 1, now };
    let hasTime = true;
    const paused = await copyDailyRaw(db, destination, { ...options, hasTime: () => hasTime, onBatch: progress => { if (progress.daysWritten) hasTime = false; } });
    expect(paused).toMatchObject({ stopped: true, pendingAssets: 2, daysWritten: 1 });
    const resumed = await copyDailyRaw(db, destination, options);
    expect(resumed).toMatchObject({ stopped: true, pendingAssets: 1, daysWritten: 2, assetsCompleted: 1 });
    const finished = await copyDailyRaw(db, destination, options);
    expect(finished).toMatchObject({ stopped: false, pendingAssets: 0, daysWritten: 1, assetsCompleted: 1, assetsSkipped: 1 });
  } finally { destination.close(); }
});

it("preserves both original witnesses of a precombined conflict and replays it without extra writes", async () => {
  const points: DailyRawPoint[] = [{ day: "2020-01-01", revenue: { ...observed(null, "revenue", "conflict"), witnesses: [observed(3), observed(4, "r2")] } }];
  const sources = [source("revenue"), source("revenue", "r2", { sha256: "b".repeat(64) })];
  await write(points, sources);
  expect((await db.execute("SELECT previous_value,next_value,kind FROM daily_raw_revisions")).rows[0]).toMatchObject({ previous_value: 3, next_value: 4, kind: "conflict" });
  expect((await readDailyRaw(db, { asset }))?.points[0].revenue.state).toBe("conflict");
  const before = await budget();
  expect((await write(points, sources)).estimatedWrites).toBe(0);
  expect(await budget()).toBe(before);
});

it("summarizes complete daily evidence independently of partial and conflicted amounts", async () => {
  await write([
    { day: "2020-01-01", revenue: observed(0) }, { day: "2020-01-02", revenue: observed(-2) },
    { day: "2020-01-03", revenue: observed(10) }, { day: "2020-01-04", revenue: observed(99, "revenue", "partial") },
    { day: "2020-01-05", revenue: observed(null, "revenue", "conflict") }, { day: "2020-01-06" },
  ]);
  const coverage = await dailyRawCoverage(db, asset);
  expect(coverage).toMatchObject({ assets: 1, days: 6, sources: 1, receipts: 1, revisions: 0 });
  expect(coverage.metrics.revenue).toEqual({ positiveDays: 1, zeroDays: 1, negativeDays: 1, partialDays: 1, conflictDays: 1, missingDays: 1, firstObservedDay: "2020-01-01", lastObservedDay: "2020-01-04", firstVerifiedDay: "2020-01-01", lastVerifiedDay: "2020-01-03", minValue: -2, maxValue: 10 });
  expect(coverage.metrics.fdv).toMatchObject({ missingDays: 6, positiveDays: 0, firstVerifiedDay: null, minValue: null });
  expect(coverage.storageBytes).toBeGreaterThan(0);
  expect((await dailyRawCoverage(db, { slug: "missing", identity: "gecko:missing" })).days).toBe(0);
});

it("prioritizes usable histories and verified FDV ahead of alphabetical all-zero histories", async () => {
  for (const [slug, days, fdv, revenue] of [["alpha", 3, null, 0], ["beta", 1, 100, 1], ["gamma", 2, 100, 1], ["zeta", 4, null, 1]] as const) {
    const sources = [source("revenue", `${slug}-r`), source("fdv", `${slug}-f`)];
    await write(Array.from({ length: days }, (_, i) => ({ day: `2020-01-0${i + 1}`, revenue: observed(revenue, `${slug}-r`), fdv: observed(fdv, `${slug}-f`) })), sources, { asset: { slug, identity: `gecko:${slug}` } });
  }
  const result = await listDailyRawAssets(db);
  expect(result.map(row => row.slug)).toEqual(["gamma", "beta", "zeta", "alpha"]);
  expect(result[0]).toMatchObject({ usableDays: 2, fdvDays: 2, flowDays: 2, positiveFlowDays: 2, marketDays: 2 });
});

it("detects a corrupted receipt and metric ownership with a read-only reference audit", async () => {
  await write([{ day: "2020-01-01", revenue: observed(3) }]);
  expect((await auditDailyRawReferences(db)).ok).toBe(true);
  await db.execute("PRAGMA foreign_keys=OFF");
  await db.batch(["DROP TRIGGER daily_raw_days_sources_update", "DROP TRIGGER daily_raw_source_immutable", "UPDATE daily_raw_days SET revenue_source=999", "UPDATE daily_raw_sources SET receipt_id=999"], "write");
  expect(await auditDailyRawReferences(db)).toMatchObject({ ok: false, orphanSourceReceipts: 1, mismatchedDayReferences: 1 });
});
