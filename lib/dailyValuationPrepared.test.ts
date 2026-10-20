import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "./dailyRawDatabase";
import { initializeDailyReadModels } from "./dailyReadModelDatabase";
import { prepareDailyValuationHistory, readCompactDailyHistory, readDailyHistoryVersion, readPreparedDailyComparisonBatch } from "./dailyValuationPrepared";
import { decodeCompactHistory, expandCompactHistory } from "./dailyValuationCompact";
import { DailyValuationRevisionChanged, readDailyValuationHistoryFull } from "./dailyValuationRead";
import { shiftValuationDay } from "./dailyValuation";
import type { DailyRawMetric, DailyRawPoint, DailyRawSource } from "./dailyRawData";
let db: Client;
const now = new Date("2026-10-20T12:00:00Z"), asOf = "2026-10-18", snapshot = { updatedAt: "2026-10-19T22:38:30.660Z", publication: { published: { id: "published-one" } } };
const coin = { slug: "parent#aave", geckoId: "aave", cmcId: null, identityStatus: "verified" as const, capitalExclusionReason: null }, asset = { slug: coin.slug, identity: "gecko:aave" };
const metrics = ["price", "mcap", "fdv", "fees", "revenue", "holders"] as const;
const source = (metric: DailyRawMetric, identity = asset.identity): DailyRawSource => ({ key: `${identity}:${metric}`, metric, provider: ["price", "mcap", "fdv"].includes(metric) ? "CoinGecko" : "DefiLlama", url: `https://example.test/${identity}/${metric}`, observedAt: now.toISOString(), sha256: "a".repeat(64), archiveUrl: "https://example.test/archive", scope: identity, definition: `${metric} USD`, basis: ["price", "mcap", "fdv"].includes(metric) ? "utc_day_close" : "completed_utc_day_flow" });
const points = (days = 366, first = shiftValuationDay(asOf, -days + 1), identity = asset.identity): DailyRawPoint[] => Array.from({ length: days }, (_, i) => {
  const day = shiftValuationDay(first, i);
  return { day, ...Object.fromEntries(metrics.map(metric => [metric, { value: metric === "fdv" ? (i + 1) * 365 : metric === "mcap" ? (i + 1) * 730 : metric === "price" ? (i + 1) / 3 : metric === "fees" ? 100_000 : metric === "holders" ? 2 : 1, state: "complete", source: `${identity}:${metric}`, at: ["price", "mcap", "fdv"].includes(metric) ? `${shiftValuationDay(day, 1)}T00:00:00Z` : null }])) } as DailyRawPoint;
});
async function seed(values = points(), target = asset, sources = metrics.map(metric => source(metric, target.identity))) {
  for (let i = 0; i < values.length; i += 1000) await upsertDailyRaw(db, { asset: target, sources, points: values.slice(i, i + 1000), runId: "test", now });
}
const prepare = (changes: Partial<Parameters<typeof prepareDailyValuationHistory>[1]> = {}) => prepareDailyValuationHistory(db, { coin, snapshot, runId: "test", now, ...changes });
const compact = (changes: Partial<Parameters<typeof readCompactDailyHistory>[1]> = {}) => readCompactDailyHistory(db, { coin, snapshot, now, ...changes });
const version = () => readDailyHistoryVersion(db, { coin, snapshot, now });
const summary = (changes: Partial<Parameters<typeof readPreparedDailyComparisonBatch>[0]> = {}) => readPreparedDailyComparisonBatch({ coins: [coin], snapshot, capital: "fdv", db, now, ...changes });
const sql = (statement: InStatement) => typeof statement === "string" ? statement : statement.sql;
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await initializeDailyReadModels(db); await openDailyRawRun(db, { id: "test", maxEstimatedWrites: 500_000, now }); });
afterEach(() => { vi.restoreAllMocks(); db.close(); });
it("prepares both exact numerators once, returns the full MAX in one compact response, and matches all legacy cells/ratios/sources", async () => {
  await seed(points(2209, "2020-01-01"));
  const result = await prepare(); expect(result).toMatchObject({ status: "prepared", changed: true, estimatedWrites: 5, points: 2209 });
  const envelope = (await compact())!; expect(Buffer.byteLength(JSON.stringify(envelope))).toBeLessThan(500_000);
  const decoded = await decodeCompactHistory(envelope);
  for (const capital of ["fdv", "mcap"] as const) {
    const expected = (await readDailyValuationHistoryFull(db, { coin, snapshot, capital, from: "1900-01-01", to: asOf, now }))!;
    const actual = expandCompactHistory(decoded, capital);
    expect(actual.points).toEqual(expected.points); expect(actual.sources).toEqual(expected.sources); expect(actual.nextCursor).toBeNull();
  }
  const reads = vi.spyOn(db, "execute"), mode = vi.fn();
  expect(await prepare()).toMatchObject({ status: "current", estimatedWrites: 0 });
  expect((await readDailyHistoryVersion(db, { coin, snapshot, now, onReadModel: mode }))!.rawRevision).toBe(envelope.rawRevision);
  await compact(); expect(mode).toHaveBeenCalledWith("prepared");
  expect(reads.mock.calls.every(call => /^SELECT/.test(sql(call[0])))).toBe(true);
  expect(reads.mock.calls.some(call => sql(call[0]).includes("FROM daily_raw_days"))).toBe(false);
});
it("reads 365-day summaries only from one metadata SELECT, excluding latest and retaining both capital results", async () => {
  await seed(); await prepare(); const execute = vi.spyOn(db, "execute");
  expect((await summary()).rows[coin.slug].pr).toEqual({ status: "ready", validDays: 365, latest: { date: asOf, value: 366 }, minimum: 1, median: 183, maximum: 365 });
  expect(execute).toHaveBeenCalledOnce(); const query = sql(execute.mock.calls[0][0]); expect(query).not.toContain("payload"); expect(query).not.toContain("daily_raw_days");
  expect((await summary({ capital: "mcap" })).rows[coin.slug].pr).toMatchObject({ status: "ready", latest: { value: 732 } });
});
it("distinguishes absent raw identity from unprepared/stale models and recomputes runtime freshness/current publication binding", async () => {
  await seed(); expect((await summary()).rows[coin.slug].pr).toMatchObject({ reason: "not_prepared" });
  expect((await summary({ coins: [{ ...coin, geckoId: "different" }] })).rows[coin.slug].pr).toMatchObject({ reason: "not_collected" });
  await prepare(); const original = (await compact())!;
  const newerPublication = { ...snapshot, publication: { published: { id: "published-two" } } };
  const reused = (await compact({ snapshot: newerPublication }))!;
  expect(reused.rawRevision).toBe(original.rawRevision); expect(reused.asset.snapshotId).toBe("published-two");
  expect(await prepare({ snapshot: newerPublication })).toMatchObject({ status: "current", estimatedWrites: 0 });
  expect((await summary({ snapshot: { ...snapshot, updatedAt: "2026-10-20T06:00:00Z" } })).rows[coin.slug].pr).toMatchObject({ reason: "not_prepared" });
  expect((await summary({ now: new Date("2026-10-22T00:00:00Z") })).rows[coin.slug].pr).toMatchObject({ reason: "stale_data", validDays: 365 });
});
it("rebuilds an advanced verified asOf without a raw write, retaining an explicit missing latest day", async () => {
  await seed(); await prepare();
  const before = await db.execute("SELECT revision FROM daily_raw_asset_revisions"), nextSnapshot = { updatedAt: "2026-10-20T06:00:00Z", publication: { published: { id: "next-utc-day" } } };
  expect((await summary({ snapshot: nextSnapshot })).rows[coin.slug].pr).toMatchObject({ reason: "not_prepared" });
  expect(await prepare({ snapshot: nextSnapshot })).toMatchObject({ status: "prepared", estimatedWrites: 5, points: 366 });
  expect((await db.execute("SELECT revision FROM daily_raw_asset_revisions")).rows).toEqual(before.rows);
  const result = await summary({ snapshot: nextSnapshot });
  expect(result.asOf).toBe("2026-10-19"); expect(result.rows[coin.slug].pr).toEqual({ status: "unavailable", validDays: 365, reason: "not_collected" });
  const data = (await compact({ snapshot: nextSnapshot }))!;
  expect(data.asOf).toBe("2026-10-19"); expect(expandCompactHistory(await decodeCompactHistory(data), "fdv").points.at(-1)!.day).toBe("2026-10-18");
});
it("preserves independent source times, missing FDV, zero/negative/partial/conflict flows and definition changes", async () => {
  const values = points(6, "2024-03-04"), foreign = { ...source("revenue"), key: "other-definition", scope: "different-products" };
  values[1].fdv!.value = 1687920736.48512; values[1].revenue!.value = 184635;
  values[2].fdv = { value: null, state: "missing", source: source("fdv").key };
  values[2].holders!.value = 0; values[3].holders!.value = -3; values[4].holders!.state = "partial";
  values[4].revenue!.source = foreign.key; values[5].revenue = { value: null, state: "conflict", source: source("revenue").key };
  await seed(values, asset, [...metrics.map(metric => source(metric)), foreign]); await prepare();
  const data = expandCompactHistory(await decodeCompactHistory((await compact())!), "fdv");
  expect(data.points[1].pr.value).toBe(25.046390846436676); expect(data.points[1].fdv.at).toBe("2024-03-06T00:00:00Z"); expect(data.points[1].revenue.at).toBeNull();
  expect(data.points[2].pr.value).toBeNull(); expect(data.points.slice(2, 5).map(point => point.holders.state)).toEqual(["zero", "negative", "partial"]);
  expect(data.points[4].pr.financialDefinition).not.toBe(data.points[3].pr.financialDefinition); expect(data.points[5].revenue.state).toBe("conflict");
});
it("holds malformed provenance and incomplete current UTC days without moving raw values to another date", async () => {
  const values = points(2, asOf); values[0].fdv!.at = null;
  await seed(values); await prepare(); const data = expandCompactHistory(await decodeCompactHistory((await compact())!), "fdv");
  expect(data.points).toHaveLength(1); expect(data.points[0].fdv.reason).toBe("invalid_timestamp"); expect(data.points[0].pr.value).toBeNull();
});
it("survives unrelated imports but refuses same-asset stale expectedRevision and uses a current raw fallback", async () => {
  await seed(); await prepare(); const first = (await compact())!;
  await seed(points(1, asOf, "gecko:beta"), { slug: "beta", identity: "gecko:beta" });
  expect((await compact({ expectedRevision: first.rawRevision }))!.rawRevision).toBe(first.rawRevision);
  const revised = { ...source("mcap"), key: "mcap-revised", revisionOf: source("mcap").key, observedAt: "2026-10-20T12:00:01Z" };
  await seed([{ day: asOf, mcap: { value: 5_000_000, state: "complete", source: revised.key, at: "2026-10-19T00:00:00Z" } }], asset, [revised]);
  await expect(compact({ expectedRevision: first.rawRevision })).rejects.toBeInstanceOf(DailyValuationRevisionChanged);
  expect((await summary()).rows[coin.slug].pr).toMatchObject({ reason: "not_prepared" });
  const mode = vi.fn(), latest = (await compact({ onReadModel: mode }))!;
  expect(mode).toHaveBeenCalledWith("raw-fallback"); expect(latest.rawRevision).toBe((await version())!.rawRevision);
  expect(expandCompactHistory(await decodeCompactHistory(latest), "mcap").points.at(-1)!.mcap.value).toBe(5_000_000);
});
it("rejects publication of a model if raw evidence changes after calculation, with no stale model write", async () => {
  await seed();
  const publish: NonNullable<Parameters<typeof prepareDailyValuationHistory>[1]["publish"]> = async candidate => {
    await seed([{ day: "2020-01-01" }]);
    const { writeDailyReadModel } = await import("./dailyReadModelDatabase"); return writeDailyReadModel(db, candidate);
  };
  await expect(prepare({ publish })).rejects.toThrow("raw_changed");
  expect((await db.execute("SELECT COUNT(*) n FROM daily_read_models")).rows[0].n).toBe(0);
});
it("keeps dry-run SELECT-only even before additive read-model migration", async () => {
  await seed(); await db.execute("DROP TABLE daily_read_models"); await db.execute("DROP TABLE daily_raw_asset_revisions");
  const execute = vi.spyOn(db, "execute"); expect(await prepare({ dryRun: true })).toMatchObject({ status: "dry-run", estimatedWrites: 5, points: 366 });
  expect(execute.mock.calls.every(call => /^SELECT/.test(sql(call[0])))).toBe(true);
  const stamp = (await version())!; expect((await compact({ expectedRevision: stamp.rawRevision }))!.rawRevision).toBe(stamp.rawRevision);
});
it("rejects corrupted compact SHA and malformed tuples rather than plotting unverified data", async () => {
  await seed(points(1)); await prepare(); const envelope = (await compact())!;
  await expect(decodeCompactHistory({ ...envelope, sha256: "f".repeat(64) })).rejects.toThrow("hash_mismatch");
  const corrupted = { ...envelope, payload: Buffer.from("not gzip").toString("base64") };
  await expect(decodeCompactHistory(corrupted)).rejects.toThrow();
  await db.execute("UPDATE daily_read_models SET metadata='{}'"); await expect(summary()).rejects.toThrow("metadata_hash_mismatch");
});
