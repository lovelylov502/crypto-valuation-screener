import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client, type InStatement, type TransactionMode } from "@libsql/client";
import * as historyDatabase from "./historyDatabase";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "./dailyRawDatabase";
import { shiftValuationDay } from "./dailyValuation";
import { DAILY_COMPARISON_TIMEOUT_MS, DAILY_HISTORY_MAX_POINTS, DailyValuationIdentityChanged, DailyValuationRevisionChanged, readDailyComparisonBatch, readDailyValuationHistory, readMapHistoryBatch, type DailyValuationCoin } from "./dailyValuationRead";
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
async function correct(metric: DailyRawMetric, day: string, value: number) {
  const previous = source(metric), revised = { ...previous, key: `${previous.key}:correction`, revisionOf: previous.key, observedAt: "2026-10-20T12:00:01Z", sha256: "b".repeat(64) };
  await seed([{ day, [metric]: { value, source: revised.key, state: "complete", at: ["fdv", "mcap"].includes(metric) ? `${shiftValuationDay(day, 1)}T00:00:00Z` : null } }], undefined, [revised]);
}
const batch = (changes: Partial<Parameters<typeof readDailyComparisonBatch>[0]> = {}) => readDailyComparisonBatch({ coins: [coin], capital: "fdv", snapshot, db, now, ...changes });
const history = (changes: Partial<Parameters<typeof readDailyValuationHistory>[1]> = {}) => readDailyValuationHistory(db, { coin, capital: "fdv", snapshot, now, ...changes });
const sql = (statement: InStatement) => typeof statement === "string" ? statement : statement.sql;
const mapHistory = (changes: Partial<Parameters<typeof readMapHistoryBatch>[0]> = {}) => readMapHistoryBatch({ coins: [{ ...coin, revenue30d: 30 }], capital: "fdv", snapshot, db, ...changes });
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await openDailyRawRun(db, { id: "fixture", maxEstimatedWrites: 2_000_000, now }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); db.close(); });

it("maps all six exact historical dates with a complete 30-day denominator in a read-only transaction", async () => {
  await seed(points(395));
  const transaction = vi.spyOn(db, "transaction"), before = await db.execute("SELECT rows_written FROM daily_raw_runs");
  const result = (await mapHistory()).get(coin.slug)!;
  for (const days of [1, 7, 30, 90, 180, 365] as const) expect(result[days].point).toEqual({ date: shiftValuationDay(asOf, -days), pr: 395 - days, revenue: 30 });
  expect(transaction).toHaveBeenCalledWith("read");
  expect((await db.execute("SELECT rows_written FROM daily_raw_runs")).rows).toEqual(before.rows);
  expect((await mapHistory({ capital: "mcap" })).get(coin.slug)![30].point?.pr).toBe(730);
});

it("does not draw arrows for gaps, a changed current total, token replacement or excluded capital", async () => {
  const values = points(395); values.splice(355, 1); await seed(values);
  const history = (await mapHistory()).get(coin.slug)!;
  expect(history[30].point).toBeNull(); expect(history[1].point).not.toBeNull();
  expect((await mapHistory({ coins: [{ ...coin, revenue30d: 31 }] })).get(coin.slug)![1].point).toBeNull();
  expect((await mapHistory({ coins: [{ ...coin, geckoId: "replacement", revenue30d: 30 }] })).get(coin.slug)![1].point).toBeNull();
  expect((await mapHistory({ coins: [{ ...coin, capitalExclusionReason: "liability", revenue30d: 30 }] })).get(coin.slug)![1].point).toBeNull();
});

it("allows verified zero days in the window but rejects changed financial scope and missing exact capital", async () => {
  const values = points(395), changed = { ...source("revenue"), key: "changed-scope", scope: "another-product" };
  values[10].revenue = { value: 0, source: source("revenue").key, state: "complete", at: null };
  values[214].revenue!.source = changed.key;
  values[304].fdv = { value: null, state: "missing", source: "", at: null };
  await seed(values, undefined, [...metrics.map(metric => source(metric)), changed]);
  const result = (await mapHistory()).get(coin.slug)!;
  expect(result[365].point?.revenue).toBe(29);
  expect(result[180].point).toBeNull(); expect(result[90].point).toBeNull();
  expect(result[30].point).not.toBeNull();
});

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

it("returns a coherent summary during an unrelated asset write, without caching it under the changed hint", async () => {
  await seed(); const execute = db.execute.bind(db); let changed = false;
  vi.spyOn(db, "execute").mockImplementation(async statement => {
    const result = await execute(statement);
    if (!changed && sql(statement).includes("CROSS JOIN daily_raw_days")) {
      changed = true;
      await seed(points(1, asOf, "gecko:beta"), { slug: "beta", identity: "gecko:beta" });
    }
    return result;
  });
  expect((await batch()).rows[coin.slug].pr).toMatchObject({ status: "ready", latest: { value: 366 } });
  vi.restoreAllMocks(); const retried = vi.spyOn(db, "execute");
  await batch(); await batch();
  expect(retried.mock.calls.filter(call => sql(call[0]).includes("CROSS JOIN daily_raw_days"))).toHaveLength(1);
});

it("rereads the entire requested summary page whenever any coin is cold or an all-warm page becomes dirty", async () => {
  const beta = { ...coin, slug: "beta", geckoId: "beta" };
  await seed(); await seed(points(366, undefined, "gecko:beta"), { slug: beta.slug, identity: "gecko:beta" });
  await batch();
  const execute = db.execute.bind(db), page = { coins: [coin, beta] }, queries: InStatement[] = [];
  let hints = 0, changeOnWarmRecheck = false;
  vi.spyOn(db, "execute").mockImplementation(async statement => {
    if (sql(statement).startsWith("SELECT id,estimated_writes") && changeOnWarmRecheck && ++hints === 2) {
      changeOnWarmRecheck = false; await correct("fdv", asOf, 999 * 365);
    }
    if (sql(statement).includes("CROSS JOIN daily_raw_days")) queries.push(statement);
    return execute(statement);
  });
  await batch(page); // Alpha is warm, beta is cold: both must come from this SELECT.
  changeOnWarmRecheck = true;
  const changed = await batch(page);
  expect(changed.rows[coin.slug].pr).toMatchObject({ status: "ready", latest: { value: 999 } });
  expect(changed.rows.beta.pr).toMatchObject({ status: "ready", latest: { value: 366 } });
  expect(queries).toHaveLength(2);
  for (const statement of queries) {
    expect(typeof statement).not.toBe("string");
    if (typeof statement !== "string") expect(JSON.parse(String((statement.args as unknown[])[0]))).toEqual([{ slug: coin.slug, identity: "gecko:alpha-token" }, { slug: beta.slug, identity: "gecko:beta" }]);
  }
});

it("keeps the full-range content token across unrelated writes and cursor sizes in read-only transactions", async () => {
  await seed(points(1002, "2020-01-01"));
  const transaction = db.transaction.bind(db), modes: (TransactionMode | undefined)[] = [], statements: InStatement[] = [];
  vi.spyOn(db, "transaction").mockImplementation(async (mode?: TransactionMode) => {
    modes.push(mode); const tx = await transaction(mode), execute = tx.execute.bind(tx);
    vi.spyOn(tx, "execute").mockImplementation(async statement => { statements.push(statement); return execute(statement); });
    return tx;
  });
  const first = (await history({ limit: 1000 }))!;
  vi.restoreAllMocks();
  await seed(points(1, asOf, "gecko:beta"), { slug: "beta", identity: "gecko:beta" });
  const last = (await history({ after: first.nextCursor!, limit: 1, expectedRevision: first.rawRevision }))!;
  expect(last.rawRevision).toBe(first.rawRevision); expect(last.points).toHaveLength(1); expect(last.points[0].day).toBe("2022-09-27");
  expect(modes).toEqual(["read"]); expect(statements.every(statement => /^SELECT\b/.test(sql(statement)))).toBe(true);
  const seek = statements.find(statement => sql(statement).includes("LEFT JOIN daily_raw_days"))!;
  const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql(seek)}`, args: typeof seek === "string" ? [] : seek.args });
  expect(plan.rows.map(row => String(row.detail)).join("\n")).toMatch(/SEARCH d USING PRIMARY KEY.*asset_id=\? AND day>\? AND day<\?/);
});

it.each(["fdv", "mcap", "revenue"] as const)("rejects a continuation after a scoped %s correction, including a non-selected visible metric", async metric => {
  await seed(points(3, "2020-01-01"));
  const first = (await history({ from: "2020-01-01", to: "2020-01-03", limit: 1 }))!;
  await correct(metric, "2020-01-03", 1_000_000);
  await expect(history({ from: "2020-01-01", to: "2020-01-03", after: first.nextCursor!, expectedRevision: first.rawRevision })).rejects.toBeInstanceOf(DailyValuationRevisionChanged);
  expect((await history({ from: "2020-01-01", to: "2020-01-03" }))!.rawRevision).not.toBe(first.rawRevision);
});

it("retains a scoped token when the same asset changes outside the requested range", async () => {
  await seed(points(3, "2020-01-01"));
  const scope = { from: "2020-01-01", to: "2020-01-02", limit: 1 }, first = (await history(scope))!;
  await correct("fdv", "2020-01-03", 1_000_000);
  const last = (await history({ ...scope, after: first.nextCursor!, expectedRevision: first.rawRevision }))!;
  expect(last.rawRevision).toBe(first.rawRevision); expect(last.points[0].day).toBe("2020-01-02");
});

it("binds the cached hint inside the read transaction, so a later correction cannot hide behind an outside hint", async () => {
  await seed(points(2, "2020-01-01"));
  const execute = db.execute.bind(db); let changed = false;
  vi.spyOn(db, "execute").mockImplementation(async statement => {
    const result = await execute(statement);
    if (!changed && sql(statement).startsWith("SELECT id,estimated_writes")) { changed = true; await correct("fdv", "2020-01-02", 7300); }
    return result;
  });
  const first = (await history())!;
  expect(first.points[1].pr.value).toBe(20);
  vi.restoreAllMocks(); const transaction = vi.spyOn(db, "transaction");
  expect((await history({ expectedRevision: first.rawRevision }))!.rawRevision).toBe(first.rawRevision);
  expect(transaction).not.toHaveBeenCalled();
});

it("does not label old content with a newer hint committed after its read transaction", async () => {
  await seed(points(2, "2020-01-01"));
  const transaction = db.transaction.bind(db); let changed = false;
  vi.spyOn(db, "transaction").mockImplementation(async (mode?: TransactionMode) => {
    const tx = await transaction(mode);
    if (mode === "read") {
      const commit = tx.commit.bind(tx);
      vi.spyOn(tx, "commit").mockImplementation(async () => {
        await commit();
        if (!changed) { changed = true; await correct("fdv", "2020-01-02", 7300); }
      });
    }
    return tx;
  });
  const first = (await history())!;
  expect(first.points[1].pr.value).toBe(2);
  await expect(history({ expectedRevision: first.rawRevision })).rejects.toBeInstanceOf(DailyValuationRevisionChanged);
  expect((await history())!.points[1].pr.value).toBe(20);
});

it("rejects more than 32000 dates before loading sources or retaining a full snapshot", async () => {
  await seed(points(1, "1900-01-01"));
  await db.execute({ sql: `WITH RECURSIVE dates(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM dates WHERE n<?) INSERT OR IGNORE INTO daily_raw_days(asset_id,day) SELECT (SELECT id FROM daily_raw_assets WHERE slug=?),date('1900-01-01','+'||n||' days') FROM dates`, args: [DAILY_HISTORY_MAX_POINTS, coin.slug] });
  const transaction = db.transaction.bind(db), statements: InStatement[] = [];
  vi.spyOn(db, "transaction").mockImplementation(async (mode?: TransactionMode) => {
    const tx = await transaction(mode), execute = tx.execute.bind(tx);
    vi.spyOn(tx, "execute").mockImplementation(async statement => { statements.push(statement); return execute(statement); });
    return tx;
  });
  await expect(history()).rejects.toThrow("daily_valuation_history_range_too_large");
  expect(statements.some(statement => sql(statement).includes("LIMIT 32001"))).toBe(true);
  expect(statements.some(statement => sql(statement).startsWith("SELECT s.*"))).toBe(false);
});

it("includes source text in the byte-bounded detail cache rather than retaining an oversized source payload", async () => {
  await seed(points(1, asOf));
  const byteLength = Buffer.byteLength.bind(Buffer), sized: string[] = [];
  vi.spyOn(Buffer, "byteLength").mockImplementation((value, encoding) => {
    if (typeof value === "string" && value.startsWith('{"revision":') && value.includes('"sources":')) { sized.push(value); return 33 * 1024 * 1024; }
    return byteLength(value, encoding);
  });
  const transaction = vi.spyOn(db, "transaction");
  const first = (await history())!, second = (await history())!;
  expect(second.rawRevision).toBe(first.rawRevision); expect(transaction).toHaveBeenCalledTimes(2);
  expect(sized).toHaveLength(2); expect(sized[0]).toContain('"definition":"fdv USD"'); expect(sized[0]).toContain('"scope":"gecko:alpha-token"');
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
