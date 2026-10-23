import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { captureMissingDailyFdv, initializeDailyRaw, openDailyRawRun, readDailyRaw, upsertDailyRaw, type DailyRawSource } from "./dailyRawDatabase";
import { calculateDailyValuation } from "./dailyValuation";

let db: Client;
const now = new Date("2026-10-23T13:00:00Z");
const entry = (slug: string, day = "2026-10-23") => {
  const source: DailyRawSource = { key: `fdv-${slug}`, metric: "fdv", provider: "CoinGecko", url: "https://example.test/quote", observedAt: now.toISOString(), sha256: "a".repeat(64), scope: slug, definition: "provider_reported_fdv_usd;verified_token_identity", basis: "captured_quote;actual_provider_timestamp" };
  return { asset: { slug, identity: `gecko:${slug}` }, day, source, fdv: { value: 200, state: "complete" as const, source: source.key, at: day + "T12:00:00Z" } };
};
const capture = (entries: ReturnType<typeof entry>[], overrides: Partial<Parameters<typeof captureMissingDailyFdv>[1]> = {}) => captureMissingDailyFdv(db, { runId: "capture", entries, checkpoint: { key: "chunk", cursor: JSON.stringify(entries.map(e => [e.asset, e.day])), status: "complete" }, now, ...overrides });
const budget = async () => Number((await db.execute("SELECT reserved FROM history_budget WHERE month='2026-10'")).rows[0]?.reserved ?? 0);
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await openDailyRawRun(db, { id: "capture", maxEstimatedWrites: 50_000, now }); });
afterEach(() => { vi.restoreAllMocks(); db.close(); });

it("captures multiple identities with one shared receipt, correct accounting and zero-cost replay", async () => {
  const entries = [entry("alpha"), entry("beta")], before = await budget();
  expect(await capture(entries)).toMatchObject({ daysWritten: 2, estimatedWrites: 19, rowsWritten: 11 });
  expect(await budget() - before).toBe(19);
  expect(Number((await db.execute("SELECT COUNT(*) n FROM daily_raw_receipts")).rows[0].n)).toBe(1);
  expect(Number((await db.execute("SELECT COUNT(*) n FROM daily_raw_sources")).rows[0].n)).toBe(2);
  expect((await readDailyRaw(db, { asset: entries[1].asset }))?.points[0].fdv).toMatchObject({ value: 200, state: "positive", at: "2026-10-23T12:00:00Z" });
  await db.execute("UPDATE history_budget SET reserved=8000000");
  expect(await capture(entries)).toEqual({ daysWritten: 0, estimatedWrites: 0, rowsWritten: 0 });
  expect(await budget()).toBe(8_000_000);
});
it("fills an empty FDV while preserving every independent financial observation", async () => {
  const item = entry("alpha", "2026-10-22"), revenue: DailyRawSource = { ...item.source, key: "revenue", metric: "revenue", provider: "DefiLlama", basis: "completed_utc_day_flow" };
  await upsertDailyRaw(db, { runId: "capture", asset: item.asset, sources: [revenue], points: [{ day: item.day, revenue: { value: 50, state: "complete", source: revenue.key }, holders: undefined }], now });
  const before = (await readDailyRaw(db, { asset: item.asset }))!.points[0];
  await capture([item, entry("new-token")]);
  const after = (await readDailyRaw(db, { asset: item.asset }))!.points[0];
  for (const metric of ["price", "mcap", "fees", "revenue", "holders"] as const) expect(after[metric]).toEqual(before[metric]);
  expect(after.fdv.value).toBe(200);
});
it("stores today's genuine market observation without exposing an unfinished daily valuation", async () => {
  const item = entry("alpha"); await capture([item]);
  const history = (await readDailyRaw(db, { asset: item.asset }))!;
  const point = calculateDailyValuation({ point: history.points[0], sources: new Map(history.sources.map(source => [source.key, source])), capital: "fdv", eligible: true, completedThrough: "2026-10-22" });
  expect(point.fdv.value).toBe(200); expect(point.fdv.reason).toBe("incomplete_day");
  expect(point.pr.value).toBeNull(); expect(point.pr.reason).toBe("incomplete_day");
});
it("rejects a held or concurrently completed cell before mutating any other identity", async () => {
  const item = entry("alpha");
  await upsertDailyRaw(db, { runId: "capture", asset: item.asset, sources: [item.source], points: [{ day: item.day, fdv: { value: null, state: "conflict", source: item.source.key, at: item.fdv.at } }], now });
  const before = await budget();
  await expect(capture([item, entry("beta")])).rejects.toThrow("expected cell changed");
  expect(await readDailyRaw(db, { asset: entry("beta").asset })).toBeNull();
  expect((await readDailyRaw(db, { asset: item.asset }))?.points[0].fdv.state).toBe("conflict");
  expect(await budget()).toBe(before);
});
it("refuses monthly and run ceilings before creating metadata or consuming a reservation", async () => {
  await db.execute("UPDATE history_budget SET reserved=7999999");
  await expect(capture([entry("alpha")])).rejects.toThrow("monthly_write_budget_preflight");
  expect(Number((await db.execute("SELECT COUNT(*) n FROM daily_raw_assets")).rows[0].n)).toBe(0);
  expect(await budget()).toBe(7_999_999);
  await db.execute("UPDATE history_budget SET reserved=5");
  await openDailyRawRun(db, { id: "small", maxEstimatedWrites: 8, now });
  const before = await budget();
  await expect(capture([entry("alpha")], { runId: "small" })).rejects.toThrow("run_write_budget_preflight");
  expect(await budget()).toBe(before);
});
it("never reuses an immutable source key for another asset or different original", async () => {
  const alpha = entry("alpha"); await capture([alpha]);
  const beta = entry("beta"), before = await budget();
  await expect(capture([{ ...beta, source: alpha.source, fdv: { ...beta.fdv, source: alpha.source.key } }])).rejects.toThrow("source key was reused");
  await expect(capture([{ ...alpha, source: { ...alpha.source, sha256: "b".repeat(64) } }])).rejects.toThrow("source key was reused");
  expect(await budget()).toBe(before);
});
it("bounds batches and rejects future dates, wrong metrics and duplicate target cells", async () => {
  const a = entry("alpha");
  await expect(capture([a, { ...a, asset: { identity: a.asset.identity, slug: a.asset.slug } }])).rejects.toThrow("Duplicate");
  await expect(capture([entry("alpha", "2026-10-24")])).rejects.toThrow("Future");
  await expect(capture([{ ...a, source: { ...a.source, metric: "mcap" } }])).rejects.toThrow("verified positive");
  await expect(capture(Array.from({ length: 301 }, (_, i) => entry(`a${i}`)))).rejects.toThrow("batch");
  expect(Number((await db.execute("SELECT COUNT(*) n FROM daily_raw_assets")).rows[0].n)).toBe(0);
});
it("keeps transport requests bounded for a full 300-identity batch", async () => {
  const original = db.transaction.bind(db); let requests = 0;
  vi.spyOn(db, "transaction").mockImplementation(async () => {
    const tx = await original(), batch = tx.batch.bind(tx), execute = tx.execute.bind(tx);
    vi.spyOn(tx, "batch").mockImplementation(async statements => { requests++; return batch(statements); });
    vi.spyOn(tx, "execute").mockImplementation(async statement => { requests++; return execute(statement); });
    return tx;
  });
  const result = await capture(Array.from({ length: 300 }, (_, i) => entry(`token-${i}`)));
  expect(result.daysWritten).toBe(300); expect(requests).toBeLessThanOrEqual(12);
  expect(Number((await db.execute("SELECT COUNT(*) n FROM daily_raw_days WHERE fdv_state=1")).rows[0].n)).toBe(300);
});
