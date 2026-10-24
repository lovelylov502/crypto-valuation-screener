import { afterEach, beforeEach, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { captureMissingLocalMarket } from "./dailyRawMarketCapture";
import { initializeDailyRaw, openDailyRawRun, readDailyRaw, upsertDailyRaw } from "./dailyRawDatabase";
import type { DailyRawSource } from "./dailyRawData";

let db: Client;
const now = new Date("2026-10-24T00:00:00Z"), day = "2026-10-23", at = day + "T12:00:00Z", asset = { slug: "sample", identity: "gecko:sample" };
const source = (metric: DailyRawSource["metric"]): DailyRawSource => ({ key: metric, metric, provider: "CoinGecko", url: "https://example.test/quote", observedAt: now.toISOString(), sha256: "a".repeat(64), scope: "sample", definition: metric, basis: "captured_quote;actual_provider_timestamp" });
const price = source("price"), mcap = source("mcap"), revenue = source("revenue");
const candidate = { asset, sources: [price, mcap], points: [{ day, price: { value: 2, state: "complete" as const, source: price.key, at }, mcap: { value: 200, state: "complete" as const, source: mcap.key, at } }] };
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db, { unmeteredLocal: true }); await openDailyRawRun(db, { id: "local", maxEstimatedWrites: 50_000, now }); });
afterEach(() => db.close());
it("fills only missing quotes, preserves held market data and revenue, and is idempotent", async () => {
  await upsertDailyRaw(db, { runId: "local", asset, sources: [mcap, revenue], points: [{ day, mcap: { value: null, state: "conflict", source: mcap.key, at }, revenue: { value: 25, state: "complete", source: revenue.key } }], now });
  expect(await captureMissingLocalMarket(db, [candidate], "local", now)).toBe(1);
  expect(await captureMissingLocalMarket(db, [candidate], "local", now)).toBe(0);
  const result = await readDailyRaw(db, { asset, from: day, to: day });
  expect(result?.points[0]).toMatchObject({ price: { value: 2, at }, mcap: { state: "conflict" }, revenue: { value: 25 } });
});
it("never reuses the previous token identity or fills an untimed quote", async () => {
  await upsertDailyRaw(db, { runId: "local", asset: { ...asset, identity: "gecko:old" }, sources: [{ ...mcap, key: "old-mcap" }], points: [{ day, mcap: { ...candidate.points[0].mcap, source: "old-mcap" } }], now });
  expect(await captureMissingLocalMarket(db, [{ ...candidate, points: [{ day, price: { ...candidate.points[0].price, at: null }, mcap: candidate.points[0].mcap }] }], "local", now)).toBe(1);
  expect((await readDailyRaw(db, { asset, from: day, to: day }))?.points[0]).toMatchObject({ price: { value: null }, mcap: { value: 200 } });
});
it("rejects a hosted client before any SQL", async () => {
  await expect(captureMissingLocalMarket({ protocol: "https" } as Client, [candidate], "local", now)).rejects.toThrow("local_database_required");
});
