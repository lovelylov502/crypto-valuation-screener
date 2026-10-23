import { afterEach, beforeEach, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { collectFdvRecovery, planFdvRecovery } from "./dailyRawFdvRecovery";
import { initializeDailyRaw, openDailyRawRun, readDailyRaw, upsertDailyRaw } from "./dailyRawDatabase";
import type { DailyRawSource } from "./dailyRawData";
import type { CollectedDailyRawAsset } from "./dailyRawCollection";

let db: Client;
const now = new Date("2026-10-23T00:00:00Z"), asset = { slug: "sample", identity: "gecko:sample" };
const fdv: DailyRawSource = { key: "fdv", metric: "fdv", provider: "CoinGecko", url: "https://example.test/quote", observedAt: now.toISOString(), sha256: "a".repeat(64), scope: "sample", definition: "reported_fdv", basis: "captured_quote;actual_provider_timestamp" };
const revenue: DailyRawSource = { ...fdv, key: "revenue", metric: "revenue", provider: "DefiLlama", definition: "revenue", basis: "completed_utc_day_flow" };
const candidate = (days: string[]): CollectedDailyRawAsset => ({ asset, sources: [fdv], points: days.map(day => ({ day, fdv: { value: 200, state: "complete", source: fdv.key, at: day + "T12:00:00Z" } })) });
const expected = (day: string) => ({ day, metric: "fdv" as const, value: null, state: 0, sourceKey: "", at: null });
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await openDailyRawRun(db, { id: "repair", maxEstimatedWrites: 50_000, now }); });
afterEach(() => db.close());

it("repairs only empty cells, preserving held FDV and independent financial amounts", async () => {
  await upsertDailyRaw(db, { runId: "repair", asset, sources: [fdv, revenue], points: [
    { day: "2026-10-18", fdv: { value: 180, state: "complete", source: "fdv", at: "2026-10-18T12:00:00Z" } },
    { day: "2026-10-19", fdv: { value: null, state: "conflict", source: "fdv" } },
    { day: "2026-10-20", revenue: { value: 50, state: "complete", source: "revenue" } },
  ], now });
  const plan = await planFdvRecovery(db, [candidate(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"])]);
  expect(plan).toMatchObject({ alreadyPresent: 1, held: 1 });
  expect(plan.assets[0].points.map(point => point.day)).toEqual(["2026-10-20", "2026-10-21"]);
  await upsertDailyRaw(db, { runId: "repair", ...plan.assets[0], expectedCells: plan.assets[0].points.map(point => expected(point.day)), now });
  const rows = await readDailyRaw(db, { asset, from: "2026-10-18", to: "2026-10-21" });
  expect(rows?.points.find(point => point.day === "2026-10-20")).toMatchObject({ fdv: { value: 200 }, revenue: { value: 50 } });
  expect(rows?.points.find(point => point.day === "2026-10-19")?.fdv.state).toBe("conflict");
  expect((await planFdvRecovery(db, [candidate(["2026-10-20", "2026-10-21"])])).assets).toEqual([]);
});
it("rejects a concurrent completion rather than replacing its FDV", async () => {
  const item = candidate(["2026-10-21"]), plan = await planFdvRecovery(db, [item]);
  await upsertDailyRaw(db, { runId: "repair", ...item, points: [{ day: "2026-10-21", fdv: { value: 300, state: "complete", source: "fdv", at: "2026-10-21T13:00:00Z" } }], now });
  await expect(upsertDailyRaw(db, { runId: "repair", ...plan.assets[0], expectedCells: [expected("2026-10-21")], now })).rejects.toThrow("expected cell changed");
  expect((await readDailyRaw(db, { asset, from: "2026-10-21", to: "2026-10-21" }))?.points[0].fdv.value).toBe(300);
});
it("never uses the old identity's existing FDV for a migrated token", async () => {
  const item = candidate(["2026-10-21"]);
  await upsertDailyRaw(db, { runId: "repair", ...item, asset: { ...asset, identity: "gecko:old-token" }, now });
  expect((await planFdvRecovery(db, [item])).assets[0].asset).toEqual(asset);
});
it("rejects unapproved archive URLs before connecting or downloading", async () => {
  await expect(collectFdvRecovery({ schema: 1, reference: {} as never, sources: [{ url: "https://example.test/data.json.gz", sha256: "a".repeat(64), bundleSha256: "b".repeat(64) }] }, ".")).rejects.toThrow("recovery_manifest");
});
