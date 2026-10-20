import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client, type InStatement } from "@libsql/client";
import * as historyDatabase from "./historyDatabase";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "./dailyRawDatabase";
import { shiftValuationDay } from "./dailyValuation";
import { DAILY_COMPARISON_TIMEOUT_MS, DailyValuationIdentityChanged, DailyValuationRevisionChanged, readDailyComparisonBatch, readDailyValuationHistory, type DailyValuationCoin } from "./dailyValuationRead";
import type { DailyRawMetric, DailyRawPoint, DailyRawSource } from "./dailyRawData";

let db: Client;
const now = new Date("2026-10-20T12:00:00Z"), asOf = "2026-10-18", snapshot = { updatedAt: "2026-10-19T22:38:30.660Z", publication: { published: { id: "data-verified" } } };
const coin: DailyValuationCoin = { slug: "parent#alpha", geckoId: "alpha-token", cmcId: null, identityStatus: "verified", capitalExclusionReason: null };
const metrics = ["fdv", "mcap", "revenue", "holders"] as const;
const source = (metric: DailyRawMetric, identity = "gecko:alpha-token"): DailyRawSource => ({ key: `${identity}:${metric}`, metric, provider: ["fdv", "mcap"].includes(metric) ? "CoinGecko" : "DefiLlama", url: `https://example.test/${identity}/${metric}`, observedAt: now.toISOString(), sha256: "a".repeat(64), archiveUrl: "https://example.test/archive", scope: identity, definition: `${metric} USD`, basis: ["fdv", "mcap"].includes(metric) ? "utc_day_close" : "completed_utc_day_flow" });
function points(days = 366, first = shiftValuationDay(asOf, -days + 1), identity = "gecko:alpha-token"): DailyRawPoint[] {
  return Array.from({ length: days }, (_, index) => {
    const day = shiftValuationDay(first, index);
    return { day, ...Object.fromEntries(metrics.map(metric => [metric, { value: metric === "fdv" ? (index + 1) * 365 : metric === "mcap" ? (index + 1) * 730 : metric === "holders" ? 2 : 1, source: `${identity}:${metric}`, state: "complete", at: ["fdv", "mcap"].includes(metric) ? `${shiftValuationDay(day, 1)}T00:00:00Z` : null }])) } as DailyRawPoint;
  });
}
async function seed(values = points(), asset = { slug: coin.slug, identity: "gecko:alpha-token" }, sources = metrics.map(metric => source(metric, asset.identity))) {
  for (let index = 0; index < values.length; index += 1000) await upsertDailyRaw(db, { runId: "fixture", asset, sources, points: values.slice(index, index + 1000), now });
}
const batch = (changes: Partial<Parameters<typeof readDailyComparisonBatch>[0]> = {}) => readDailyComparisonBatch({ coins: [coin], capital: "fdv", snapshot, db, now, ...changes });
const history = (changes: Partial<Parameters<typeof readDailyValuationHistory>[1]> = {}) => readDailyValuationHistory(db, { coin, capital: "fdv", snapshot, now, ...changes });
const sql = (statement: InStatement) => typeof statement === "string" ? statement : statement.sql;
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await openDailyRawRun(db, { id: "fixture", maxEstimatedWrites: 2_000_000, now }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); db.close(); });

it("seeks exact identities and the 366-day range, returning a read-only 365-day distribution", async () => {
  await seed(); const execute = vi.spyOn(db, "execute"), result = await batch();
  expect(result.rows[coin.slug].pr).toEqual({ status: "ready", validDays: 365, latest: { date: asOf, value: 366 }, minimum: 1, median: 183, maximum: 365 });
  expect(result.rows[coin.slug].phr).toMatchObject({ status: "ready", validDays: 365, latest: { date: asOf, value: 183 } });
  expect(execute.mock.calls.every(call => /^SELECT\b/.test(sql(call[0])))).toBe(true);
  const seek = execute.mock.calls.map(call => call[0]).find(statement => sql(statement).includes("CROSS JOIN daily_raw_days"))! as InStatement;
  const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql(seek)}`, args: typeof seek === "string" ? [] : seek.args });
  const details = plan.rows.map(row => String(row.detail)).join("\n");
  expect(details).toMatch(/SEARCH a USING (COVERING )?INDEX.*slug=\? AND identity=\?/);
  expect(details).toMatch(/SEARCH d USING PRIMARY KEY.*asset_id=\? AND day>\? AND day<\?/);
  expect(details).not.toMatch(/SCAN d\b/);
});

it("shares summaries by identity/capital/asOf/revision, without returning mutable cached objects", async () => {
  await seed(); const execute = vi.spyOn(db, "execute"), first = await batch();
  const firstMetric = first.rows[coin.slug].pr; if (firstMetric.status === "ready") firstMetric.latest.value = 999;
  const warm = await batch();
  expect(warm.rows[coin.slug].pr).toMatchObject({ status: "ready", latest: { value: 366 } });
  expect(execute.mock.calls.filter(call => sql(call[0]).includes("CROSS JOIN daily_raw_days"))).toHaveLength(1);
  const cap = await batch({ capital: "mcap" }); expect(cap.rows[coin.slug].pr).toMatchObject({ status: "ready", latest: { value: 732 } });
  await db.execute("UPDATE daily_raw_runs SET rows_written=rows_written+1 WHERE id='fixture'");
  await batch(); expect(execute.mock.calls.filter(call => sql(call[0]).includes("CROSS JOIN daily_raw_days"))).toHaveLength(3);
});

it("never splices a previous token identity into the current slug", async () => {
  await seed();
  const current = { ...coin, geckoId: "replacement" };
  expect((await batch({ coins: [current] })).rows[coin.slug].pr).toEqual({ status: "unavailable", validDays: 0, reason: "not_collected" });
  expect(await history({ coin: current })).toBeNull();
  await expect(history({ expectedIdentity: "gecko:replacement" })).rejects.toBeInstanceOf(DailyValuationIdentityChanged);
  const replacement = points(1, asOf, "gecko:replacement"); replacement[0].fdv!.value = 730;
  await seed(replacement, { slug: coin.slug, identity: "gecko:replacement" });
  expect((await history({ coin: current }))!.points[0].pr.value).toBe(2);
});

it("requires the exact asOf observation and separately holds non-positive holders, excluded capital and stale data", async () => {
  const values = points(); values.at(-1)!.holders!.value = 0;
  await seed(values);
  expect((await batch()).rows[coin.slug].phr).toEqual({ status: "unavailable", validDays: 365, reason: "non_positive_revenue" });
  expect((await batch({ coins: [{ ...coin, capitalExclusionReason: "issued liability" }] })).rows[coin.slug].pr).toEqual({ status: "unavailable", validDays: 0, reason: "missing_capital" });
  expect((await batch({ now: new Date("2026-10-21T00:00:00Z") })).rows[coin.slug].pr).toEqual({ status: "unavailable", validDays: 365, reason: "stale_data" });
  const older = { ...snapshot, updatedAt: "2026-10-18T23:59:00Z" };
  expect((await batch({ snapshot: older })).asOf).toBe("2026-10-17");
});

it("holds a mixed financial distribution while retaining the historical daily ratio and source", async () => {
  const values = points(), changed = source("revenue"); changed.key += ":different"; changed.scope += ":other-products";
  values[100].revenue!.source = changed.key;
  await seed(values, undefined, [...metrics.map(metric => source(metric)), changed]);
  expect((await batch()).rows[coin.slug].pr).toEqual({ status: "unavailable", validDays: 364, reason: "definition_changed" });
  const detail = (await history())!;
  expect(detail.points[100].pr.value).toBe(101); expect(detail.points[100].pr.financialDefinition).not.toBe(detail.points[101].pr.financialDefinition);
  expect(detail.sources.some(item => item.key === changed.key && item.scope === changed.scope)).toBe(true);
});

it("paginates MAX beyond one thousand dates, keeping independent source times and one revision", async () => {
  await seed(points(1002, "2020-01-01"));
  const first = (await history({ limit: 1000 }))!;
  expect(first).toMatchObject({ schema: 2, revenueDays: 1, asset: { slug: coin.slug, identity: "gecko:alpha-token", snapshotId: "data-verified" }, asOf });
  expect(first.points).toHaveLength(1000); expect(first.nextCursor).toBe(first.points.at(-1)!.day);
  expect(first.points[0].fdv.at).toBe("2020-01-02T00:00:00Z"); expect(first.points[0].revenue.at).toBeNull();
  const last = (await history({ after: first.nextCursor!, expectedRevision: first.rawRevision }))!;
  expect(last.rawRevision).toBe(first.rawRevision); expect(last.points).toHaveLength(2); expect(last.nextCursor).toBeNull();
  await expect(history({ expectedRevision: "f".repeat(64) })).rejects.toBeInstanceOf(DailyValuationRevisionChanged);
});

it("clamps incomplete captured days and returns a shaped empty stale interval", async () => {
  await seed(points(2, asOf));
  const detail = (await history({ to: "2026-10-20" }))!;
  expect(detail.points.map(point => point.day)).toEqual([asOf]);
  const empty = (await history({ from: "2026-10-19", to: "2026-10-20" }))!;
  expect(empty.points).toEqual([]); expect(empty.asOf).toBe(asOf); expect(empty.nextCursor).toBeNull();
  await expect(history({ from: "2026-10-19", to: "2026-10-18" })).rejects.toThrow("invalid_range");
});

it("rejects a revision change during the batch and does not cache its partial read", async () => {
  await seed(); const execute = db.execute.bind(db); let changed = false;
  vi.spyOn(db, "execute").mockImplementation(async statement => {
    const result = await execute(statement);
    if (!changed && sql(statement).includes("CROSS JOIN daily_raw_days")) { changed = true; await execute("UPDATE daily_raw_runs SET rows_written=rows_written+1 WHERE id='fixture'"); }
    return result;
  });
  await expect(batch()).rejects.toBeInstanceOf(DailyValuationRevisionChanged);
  vi.restoreAllMocks(); const retried = vi.spyOn(db, "execute"); await batch();
  expect(retried.mock.calls.some(call => sql(call[0]).includes("CROSS JOIN daily_raw_days"))).toBe(true);
});

it("bounds an owned hung reader to eight seconds and closes it", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const hung = { execute: vi.fn(() => new Promise<never>(() => {})), close: vi.fn() };
  vi.spyOn(historyDatabase, "connectHistory").mockReturnValue(hung as unknown as Client);
  vi.stubEnv("TURSO_DATABASE_URL", "libsql://fixture.turso.io");
  const checked = expect(readDailyComparisonBatch({ coins: [coin], capital: "fdv", snapshot, now })).rejects.toThrow("daily_valuation_deadline_exceeded");
  await vi.advanceTimersByTimeAsync(DAILY_COMPARISON_TIMEOUT_MS); await checked;
  expect(hung.close).toHaveBeenCalledOnce(); expect(hung.execute).toHaveBeenCalledOnce();
});

it("rejects an oversized page before any database operation", async () => {
  const execute = vi.spyOn(db, "execute");
  await expect(batch({ coins: Array.from({ length: 201 }, (_, index) => ({ ...coin, slug: `token-${index}` })) })).rejects.toThrow("invalid_page");
  expect(execute).not.toHaveBeenCalled();
});
