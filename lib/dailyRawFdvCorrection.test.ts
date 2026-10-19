import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { applyFdvCorrections, fdvCorrectionError, readFdvCorrectionCandidates, type FdvCorrectionClaim } from "./dailyRawFdvCorrection";
import { getDailyRawRun, initializeDailyRaw, openDailyRawRun, readDailyRaw, upsertDailyRaw, type DailyRawSource } from "./dailyRawDatabase";
import { dailyRawSource } from "./dailyRawCollection";

let db: Client;
const asset = { slug: "alpha", identity: "gecko:alpha" }, now = new Date("2026-10-19T00:00:00Z"), day = "2026-10-11", at = `${day}T22:39:47.000Z`, observedAt = `${day}T22:40:20.574Z`;
const url = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-test/data.json.gz";
const source = (metric: DailyRawSource["metric"], extra: Partial<DailyRawSource> = {}) => dailyRawSource(asset.slug, { metric, provider: "CoinGecko", url, observedAt, sha256: "a".repeat(64), archiveUrl: url,
  scope: JSON.stringify(asset), definition: `provider_reported_${metric}_usd;verified_token_identity`, basis: "captured_quote;actual_provider_timestamp", ...extra });
const claim = (extra: Partial<FdvCorrectionClaim> = {}): FdvCorrectionClaim => ({ ...asset, day, value: 100, at, provider: "CoinGecko", observedAt, snapshotUrl: url, snapshotSha256: "a".repeat(64), reason: "primary_provider_bundle_unpinned", proofSha256: "b".repeat(64), ...extra });
async function seed() {
  const sources = [source("fdv"), source("price"), source("mcap"), source("revenue")];
  await upsertDailyRaw(db, { runId: "seed", asset, sources, points: [{ day, fdv: { value: 100, state: "complete", source: sources[0].key, at },
    price: { value: 2, state: "complete", source: sources[1].key, at }, mcap: { value: 50, state: "complete", source: sources[2].key, at }, revenue: { value: 7, state: "complete", source: sources[3].key } }], now });
  return sources[0];
}
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await openDailyRawRun(db, { id: "seed", maxEstimatedWrites: 10_000, now }); });
afterEach(() => { vi.restoreAllMocks(); db.close(); });

it("dry-run reads only SELECTs and requires the exact positive source/value/time tuple", async () => {
  await seed(); const execute = vi.spyOn(db, "execute");
  expect(await readFdvCorrectionCandidates(db, [claim()])).toHaveLength(1);
  for (const extra of [{ value: 101 }, { at: `${day}T22:39:48Z` }, { snapshotSha256: "c".repeat(64) }, { provider: "CoinMarketCap" }, { identity: "gecko:other" }, { observedAt: `${day}T22:40:21Z` }]) expect(await readFdvCorrectionCandidates(db, [claim(extra)])).toEqual([]);
  expect(execute.mock.calls.every(([statement]) => /^SELECT\b/.test((typeof statement === "string" ? statement : (statement as { sql: string }).sql).trim()))).toBe(true);
  execute.mockRestore(); expect(await getDailyRawRun(db, "correction")).toBeNull();
});

it("writes an explicit null/conflict revision, preserves independent cells and originals, and replays with zero writes", async () => {
  const old = await seed(), candidates = await readFdvCorrectionCandidates(db, [claim()]);
  const receipts = Number((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_receipts")).rows[0].n);
  const first = await applyFdvCorrections(db, candidates, { runId: "correction", maxEstimatedWrites: 1000, now });
  expect(first.daysWritten).toBe(1); expect(first.estimatedWrites).toBeGreaterThan(5);
  const result = await readDailyRaw(db, { asset });
  expect(result?.points[0]).toMatchObject({ fdv: { value: null, state: "conflict", at }, price: { value: 2 }, mcap: { value: 50 }, revenue: { value: 7 } });
  const revised = result!.sources.find(s => s.metric === "fdv")!;
  expect(revised).toMatchObject({ url: old.url, observedAt: old.observedAt, sha256: old.sha256, archiveUrl: old.archiveUrl, revisionOf: old.key });
  expect(revised.basis).toContain(`fdv_proof_sha256=${claim().proofSha256}`);
  expect((await db.execute("SELECT previous_value,next_value,kind FROM daily_raw_revisions WHERE metric='fdv'")).rows[0]).toMatchObject({ previous_value: 100, next_value: null, kind: "revision" });
  expect(Number((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_receipts")).rows[0].n)).toBe(receipts);
  const before = await getDailyRawRun(db, "correction");
  expect(await applyFdvCorrections(db, await readFdvCorrectionCandidates(db, [claim()]), { runId: "correction", maxEstimatedWrites: 1000, now })).toMatchObject({ daysWritten: 0, rowsWritten: 0, estimatedWrites: 0 });
  expect(await getDailyRawRun(db, "correction")).toEqual(before);
});

it("never selects a verified Coin Metrics close, even with equal values and snapshot receipt metadata", async () => {
  const cm = source("fdv", { provider: "CoinMetrics", basis: "utc_daily_close_verified_total_supply", observedAt: now.toISOString() });
  await upsertDailyRaw(db, { runId: "seed", asset, sources: [cm], points: [{ day, fdv: { value: 100, state: "complete", source: cm.key, at: "2026-10-12T00:00:00Z" } }], now });
  expect(await readFdvCorrectionCandidates(db, [claim({ provider: "CoinMetrics", at: "2026-10-12T00:00:00Z", observedAt: now.toISOString() })])).toEqual([]);
});

it("fails atomically if a newer verified close replaces the selected cell before correction", async () => {
  await seed(); await openDailyRawRun(db, { id: "correction", maxEstimatedWrites: 1000, now });
  const candidates = await readFdvCorrectionCandidates(db, [claim()]), cm = source("fdv", { provider: "CoinMetrics", basis: "utc_daily_close_verified_total_supply", observedAt: now.toISOString() });
  await upsertDailyRaw(db, { runId: "seed", asset, sources: [cm], points: [{ day, fdv: { value: 101, state: "complete", source: cm.key, at: "2026-10-12T00:00:00Z" } }], now });
  const before = await getDailyRawRun(db, "correction"), sourceCount = Number((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_sources")).rows[0].n);
  await expect(applyFdvCorrections(db, candidates, { runId: "correction", maxEstimatedWrites: 1000, now })).rejects.toThrow(/expected cell changed/);
  expect((await readDailyRaw(db, { asset }))?.points[0].fdv).toMatchObject({ value: 101, state: "positive", source: cm.key });
  expect(await getDailyRawRun(db, "correction")).toEqual(before); expect(Number((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_sources")).rows[0].n)).toBe(sourceCount);
});

it("rejects insufficient or oversized allowances before creating a correction run", async () => {
  await seed(); const candidates = await readFdvCorrectionCandidates(db, [claim()]);
  await expect(applyFdvCorrections(db, candidates, { runId: "correction", maxEstimatedWrites: 8, now })).rejects.toThrow(/allowance_preflight/);
  await expect(applyFdvCorrections(db, candidates, { runId: "correction", maxEstimatedWrites: 50_001, now })).rejects.toThrow(/run_and_allowance/);
  expect(await getDailyRawRun(db, "correction")).toBeNull(); expect((await readDailyRaw(db, { asset }))?.points[0].fdv.value).toBe(100);
});

it("keeps an old-schema dry run read-only and migrates accounting only for nonempty explicit apply", async () => {
  await seed();
  await db.execute("DROP TRIGGER daily_raw_run_accounting_immutable"); await db.execute("ALTER TABLE daily_raw_runs DROP COLUMN accounting_version");
  const budget = Number((await db.execute("SELECT reserved FROM history_budget WHERE month='2026-10'")).rows[0].reserved);
  const beforeColumns = await db.execute("PRAGMA table_info(daily_raw_runs)"); expect(beforeColumns.rows.some(row => row.name === "accounting_version")).toBe(false);
  let failure: unknown; try { await openDailyRawRun(db, { id: "failed-old-schema", maxEstimatedWrites: 1000, now }); } catch (error) { failure = error; }
  expect(fdvCorrectionError(failure)).toMatchObject({ reason: "daily_raw_fdv_correction_schema_accounting_column_missing" });
  expect(await getDailyRawRun(db, "failed-old-schema")).toBeNull(); expect(Number((await db.execute("SELECT reserved FROM history_budget WHERE month='2026-10'")).rows[0].reserved)).toBe(budget);
  const execute = vi.spyOn(db, "execute"), candidates = await readFdvCorrectionCandidates(db, [claim()]);
  expect(candidates).toHaveLength(1); expect(execute.mock.calls.every(([statement]) => /^SELECT\b/.test((typeof statement === "string" ? statement : (statement as { sql: string }).sql).trim()))).toBe(true); execute.mockRestore();
  expect((await db.execute("PRAGMA table_info(daily_raw_runs)")).rows.some(row => row.name === "accounting_version")).toBe(false);
  expect(await applyFdvCorrections(db, candidates, { runId: "correction", maxEstimatedWrites: 1000, now })).toMatchObject({ daysWritten: 1 });
  expect((await db.execute("PRAGMA table_info(daily_raw_runs)")).rows.some(row => row.name === "accounting_version")).toBe(true);
  expect((await getDailyRawRun(db, "seed"))?.accountingVersion).toBe("raw-double-v1"); expect((await getDailyRawRun(db, "correction"))?.accountingVersion).toBe("raw-table-weights-v1");
  expect((await readDailyRaw(db, { asset }))?.points[0].fdv).toMatchObject({ value: null, state: "conflict" });
});

it("prints structural failure codes without exposing SQL messages, URLs or credentials", () => {
  const error = Object.assign(new Error("SQLITE_ERROR: table daily_raw_runs has no column named accounting_version; libsql://private.turso.io?authToken=SECRET"), { code: "SQLITE_ERROR" });
  expect(fdvCorrectionError(error)).toEqual({ reason: "daily_raw_fdv_correction_schema_accounting_column_missing", databaseCodes: ["SQLITE_ERROR"] });
  expect(JSON.stringify(fdvCorrectionError(error))).not.toMatch(/SECRET|private|libsql|authToken/);
  expect(fdvCorrectionError(Error("Daily raw expected cell changed"))).toMatchObject({ reason: "daily_raw_fdv_correction_expected_cell_changed" });
});
