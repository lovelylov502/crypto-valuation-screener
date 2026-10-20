import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { collectRecentDailyFinancials, planRecentDailyFinancials, recentDailyFinancialCoverage } from "./dailyRecentFinancials";
import { initializeDailyRaw, openDailyRawRun, readDailyRaw, upsertDailyRaw } from "./dailyRawDatabase";
import { HISTORY_WRITE_LIMIT, HistoryBudgetExceeded } from "./historyDatabase";
import { contentHash, type SourceBundle, type SourceReceipt } from "./sourceBundle";
import type { PublishedSnapshot } from "./publicationTypes";
import type { CoinRaw } from "./types";
let db: Client;
const now = new Date("2026-10-20T12:00:00Z"), archive = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-test/source-bundle.json.gz";
const reference = { id: "data-test", rawBundleUrl: archive, rawBundleSha256: "b".repeat(64) } as PublishedSnapshot;
const members = [{ slug: "a-v1", name: "A V1", defillamaId: "1", parentProtocol: "parent#a" }, { slug: "a-v2", name: "A V2", defillamaId: "2", parentProtocol: "parent#a" }];
const coin = { slug: "parent#a", geckoId: "a-token", cmcId: null, identityStatus: "verified", capitalExclusionReason: null, mcap: 100 } as CoinRaw;
const snapshot = { updatedAt: "2026-10-20T10:00:00Z", coins: [coin] };
const time = (day: string) => Date.parse(day) / 1000;
function receipt(dataType: string, values: unknown[], observedAt = "2026-10-20T10:00:01Z"): SourceReceipt {
  const body = JSON.stringify({ protocols: members, totalDataChartBreakdown: values });
  return { url: `https://api.llama.fi/overview/fees?dataType=${dataType}&excludeTotalDataChartBreakdown=false`, requestedAt: observedAt, observedAt, status: 200, headers: {}, body, sha256: contentHash(body) };
}
function bundle(revenue = 147706, observedAt?: string): SourceBundle {
  return { schema: 1, asOf: snapshot.updatedAt, baseline: null, receipts: [receipt("dailyRevenue", [[time("2018-01-01"), { "A V1": 3, "A V2": 4 }], [time("2026-10-18"), { "A V1": 2, "A V2": 3 }], [time("2026-10-19"), { "A V1": revenue - 1, "A V2": 1 }], [time("2026-10-20"), { "A V1": 999, "A V2": 999 }]], observedAt), receipt("dailyHoldersRevenue", [[time("2026-10-19"), { "A V1": 0, "A V2": 0 }]], observedAt)] };
}
const collect = (changes: Partial<Parameters<typeof collectRecentDailyFinancials>[0]> = {}) => collectRecentDailyFinancials({ snapshot, bundle: bundle(), reference, now, ...changes });
const write = async (input: ReturnType<typeof collect>) => {
  const plan = await planRecentDailyFinancials(db, input);
  for (const item of plan.assets) await upsertDailyRaw(db, { runId: "run", ...item, minimumReserve: 500_000, now });
  return plan;
};
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await openDailyRawRun(db, { id: "run", maxEstimatedWrites: 50_000, now }); });
afterEach(() => { vi.restoreAllMocks(); db.close(); });
it("extracts only recent completed UTC flows with exact archived scope, genuine zero and no invented Fees/market/MAX dependency", async () => {
  const input = collect(); expect(input).toMatchObject({ targetDay: "2026-10-19", from: "2026-10-17", to: "2026-10-19" });
  expect(input.assets).toHaveLength(1); expect(input.assets[0].asset).toEqual({ slug: "parent#a", identity: "gecko:a-token" });
  expect(input.assets[0].points.map(point => point.day)).toEqual(["2026-10-18", "2026-10-19"]);
  expect(input.assets[0].points[1]).toMatchObject({ revenue: { value: 147706, state: "complete", at: null }, holders: { value: 0, state: "complete" } });
  expect(input.assets[0].points.every(point => !point.fees && !point.fdv && !point.mcap && !point.price)).toBe(true);
  expect(input.assets[0].sources.every(source => source.archiveUrl === archive && source.scope.includes("a-v1") && source.scope.includes("a-v2"))).toBe(true);
  await write(input); expect((await recentDailyFinancialCoverage(db, input)).holders).toMatchObject({ rows: 1, complete: 1, zero: 1 });
});
it("requires completion at the original receipt time as well as the snapshot and refuses an incomplete UTC day", () => {
  const input = collect({ bundle: bundle(147706, "2026-10-19T23:59:00Z") });
  expect(input.assets[0].points.map(point => point.day)).toEqual(["2026-10-18"]); expect(input.targetCoverage.revenue.rows).toBe(0);
  const older = collect({ snapshot: { ...snapshot, updatedAt: "2026-10-19T22:00:00Z" } });
  expect(older.targetDay).toBe("2026-10-18"); expect(older.assets[0].points.every(point => point.day <= "2026-10-18")).toBe(true);
});
it("keeps unknown/unverified/excluded identities out and never reuses an old token's cells", async () => {
  expect(collect({ snapshot: { ...snapshot, coins: [{ ...coin, identityStatus: "review" }] } }).assets).toEqual([]);
  expect(collect({ snapshot: { ...snapshot, coins: [{ ...coin, capitalExclusionReason: "issued liability" }] } }).assets).toEqual([]);
  await write(collect()); const changed = collect({ snapshot: { ...snapshot, coins: [{ ...coin, geckoId: "replacement" }] } });
  expect(changed.assets[0].asset.identity).toBe("gecko:replacement"); expect((await planRecentDailyFinancials(db, changed)).assets).toHaveLength(1);
  expect((await readDailyRaw(db, { asset: { slug: coin.slug, identity: "gecko:a-token" } }))!.points.at(-1)!.revenue.value).toBe(147706);
});
it("drops equal latest values before registering newer receipt-only sources, so replays and same-day publications cost zero", async () => {
  await write(collect()); const before = (await db.execute("SELECT reserved FROM history_budget")).rows;
  const sourceCount = (await db.execute("SELECT COUNT(*) n FROM daily_raw_sources")).rows[0].n;
  const plan = await write(collect({ bundle: bundle(147706, "2026-10-20T11:00:00Z"), reference: { ...reference, id: "later", rawBundleUrl: archive.replace("data-test", "data-later") } }));
  expect(plan.assets).toEqual([]); expect(plan.unchangedAssets).toBe(1); expect(plan.unchangedCells).toBe(3);
  expect((await db.execute("SELECT reserved FROM history_budget")).rows).toEqual(before);
  expect((await db.execute("SELECT COUNT(*) n FROM daily_raw_sources")).rows[0].n).toBe(sourceCount);
});
it("imports a real provider revision with its audit while retaining existing market cells", async () => {
  await write(collect()); const revision = (await db.execute("SELECT revision FROM daily_raw_asset_revisions")).rows[0].revision;
  await write(collect({ bundle: bundle(147707, "2026-10-20T11:00:00Z") }));
  const data = (await readDailyRaw(db, { asset: { slug: coin.slug, identity: "gecko:a-token" } }))!;
  expect(data.points.at(-1)!.revenue.value).toBe(147707); expect(data.points.at(-1)!.fdv.value).toBeNull();
  expect((await db.execute("SELECT kind FROM daily_raw_revisions")).rows[0].kind).toBe("revision");
  expect(Number((await db.execute("SELECT revision FROM daily_raw_asset_revisions")).rows[0].revision)).toBe(Number(revision) + 1);
});
it("preserves partial/negative/conflicting source states and fails modified original hashes", () => {
  const raw = bundle(); raw.receipts[0] = receipt("dailyRevenue", [[time("2026-10-19"), { "A V1": -5 }]]);
  expect(collect({ bundle: raw }).assets[0].points[0].revenue).toMatchObject({ value: -5, state: "partial" });
  raw.receipts[0] = receipt("dailyRevenue", [[time("2026-10-19"), { "A V1": -5, "A V2": 0 }]]);
  expect(collect({ bundle: raw }).assets[0].points[0].revenue).toMatchObject({ value: -5, state: "complete" });
  raw.receipts[0] = receipt("dailyRevenue", [[time("2026-10-19"), { "A V1": 2, "A V2": 0 }], [time("2026-10-19"), { "A V1": 3, "A V2": 0 }]]);
  expect(collect({ bundle: raw }).assets[0].points[0].revenue).toMatchObject({ value: null, state: "conflict" });
  raw.receipts[0].body += "changed"; expect(() => collect({ bundle: raw })).toThrow("integrity");
});
it("protects maintenance headroom on every raw patch before source/day/revision mutations", async () => {
  const input = collect({ recentDays: 1 }), plan = await planRecentDailyFinancials(db, input);
  await db.execute({ sql: "UPDATE history_budget SET reserved=?", args: [HISTORY_WRITE_LIMIT - 500_010] });
  await expect(upsertDailyRaw(db, { runId: "run", ...plan.assets[0], minimumReserve: 500_000, now })).rejects.toBeInstanceOf(HistoryBudgetExceeded);
  for (const table of ["daily_raw_assets", "daily_raw_sources", "daily_raw_days", "daily_raw_asset_revisions"]) expect((await db.execute(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n).toBe(0);
});
