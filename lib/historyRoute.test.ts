// Exercise the retained legacy reader against local fixtures only.
vi.mock("./dataDeliveryPolicy", async original => ({ ...await original<typeof import("./dataDeliveryPolicy")>(), HOSTED_DATABASE_ENABLED: true }));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { GET } from "../app/api/history/route";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw, type DailyRawSource } from "./dailyRawDatabase";
import { sample } from "./testFixtures";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), connect: vi.fn(), legacy: vi.fn() }));
vi.mock("./serverScreener", () => ({ getScreener: mocks.snapshot }));
vi.mock("./dailyValuationRead", async original => ({ ...await original<typeof import("./dailyValuationRead")>(), connectDailyValuationReader: mocks.connect }));
vi.mock("./historyDatabase", async original => ({ ...await original<typeof import("./historyDatabase")>(), queryHistory: mocks.legacy }));
const asset = { slug: "parent#a", identity: "gecko:a" }, now = "2026-03-06T12:00:00Z";
let db: Client, close: ReturnType<typeof vi.fn>;
const request = (params: Record<string, string> = {}) => new Request(`https://example.test/api/history?${new URLSearchParams({ slug: asset.slug, expectedIdentity: asset.identity, capital: "fdv", from: "2026-03-04", to: "2026-03-06", ...params })}`);
const source = (metric: DailyRawSource["metric"]): DailyRawSource => ({ key: metric, metric, provider: ["price", "mcap", "fdv"].includes(metric) ? "CoinGecko" : "DefiLlama", url: `https://example.test/${metric}`, sha256: "a".repeat(64), observedAt: "2026-03-06T10:00:00Z", archiveUrl: "https://example.test/archive", scope: "exact-selected-parent", definition: metric, basis: ["price", "mcap", "fdv"].includes(metric) ? "captured_quote;actual_provider_timestamp" : "completed_utc_day_flow;provider_reconstructed;original_dated_observations" });
async function seed(options: { identity?: string; fdv?: boolean } = {}) {
  const sources = (["price", "mcap", "fdv", "revenue", "holders", "fees"] as const).map(source);
  await upsertDailyRaw(db, { runId: "stage", asset: { ...asset, identity: options.identity ?? asset.identity }, sources, points: [
    ...["2026-03-04", "2026-03-05"].map((day, index) => ({ day,
      price: { value: index + 1, state: "complete" as const, source: "price", at: `${day}T14:23:00Z` },
      mcap: { value: 36500, state: "complete" as const, source: "mcap", at: `${day}T14:23:00Z` },
      ...(options.fdv === false ? {} : { fdv: { value: index ? 73000 : 365000, state: "complete" as const, source: "fdv", at: `${day}T14:23:00Z` } }),
      revenue: { value: index ? 20 : 2, state: "complete" as const, source: "revenue" }, holders: { value: index ? 5 : 1, state: "complete" as const, source: "holders" }, fees: { value: 9999, state: "complete" as const, source: "fees" },
    })),
    { day: "2026-03-06", price: { value: 999, state: "complete", source: "price", at: "2026-03-06T09:00:00Z" }, fdv: { value: 999999999, state: "complete", source: "fdv", at: "2026-03-06T09:00:00Z" } },
  ] });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now)); vi.stubEnv("TURSO_DATABASE_URL", "libsql://local-test.turso.io"); vi.stubEnv("TURSO_AUTH_TOKEN", "local-test-reader-only");
  db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await openDailyRawRun(db, { id: "stage", maxEstimatedWrites: 10000 });
  close = vi.fn(); const borrowed = new Proxy(db, { get(target, name, receiver) { if (name === "close") return close; const value = Reflect.get(target, name, receiver); return typeof value === "function" ? value.bind(target) : value; } });
  mocks.connect.mockReset().mockReturnValue(borrowed); mocks.snapshot.mockReset().mockResolvedValue({ updatedAt: now, publication: { published: { id: "verified-snapshot" } }, coins: [sample({ slug: asset.slug, geckoId: "a", cmcId: null, identityStatus: "verified", capitalExclusionReason: null })] }); mocks.legacy.mockReset();
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("reads raw March5 capital with March5 flows, excludes the unfinished date, and never substitutes current capital or Fees", async () => {
  await seed();
  const before = await db.execute("SELECT * FROM daily_raw_runs"), response = await GET(request()), result = await response.json();
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(result).toMatchObject({ schema: 2, calculationVersion: "daily-raw-same-day-v1", capital: "fdv", revenueDays: 1, asOf: "2026-03-05", asset: { ...asset, snapshotId: "verified-snapshot" } });
  expect(result.points.map((point: { day: string }) => point.day)).toEqual(["2026-03-04", "2026-03-05"]);
  expect(result.points[1]).toMatchObject({ fdv: { value: 73000, at: "2026-03-05T14:23:00Z" }, revenue: { value: 20 }, holders: { value: 5 }, fees: { value: 9999 }, pr: { value: 10, reason: null }, phr: { value: 40, reason: null } });
  expect((await db.execute("SELECT * FROM daily_raw_runs")).rows).toEqual(before.rows); expect(mocks.legacy).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
});

it("requires the exact requested numerator and leaves missing FDV blank instead of falling back to market cap", async () => {
  await seed({ fdv: false });
  const fdv = await (await GET(request())).json(), mcap = await (await GET(request({ capital: "mcap" }))).json();
  expect(fdv.points[1]).toMatchObject({ fdv: { value: null, state: "missing" }, mcap: { value: 36500 }, pr: { value: null, reason: "missing_capital" } });
  expect(mcap.points[1]).toMatchObject({ pr: { value: 5, reason: null }, phr: { value: 20, reason: null } });
});

it("binds cursor pages to the same revision and returns409 if raw data changes", async () => {
  await seed(); const first = await (await GET(request({ limit: "1" }))).json(); expect(first.nextCursor).toBe("2026-03-04");
  const next = await GET(request({ limit: "1", after: first.nextCursor, expectedRevision: first.rawRevision }));
  expect(next.status).toBe(200); expect((await next.json()).points[0].day).toBe("2026-03-05");
  const revision = { ...source("revenue"), key: "revenue-revised", observedAt: "2026-03-06T11:00:00Z" };
  await upsertDailyRaw(db, { runId: "stage", asset, sources: [revision], points: [{ day: "2026-03-05", revenue: { value: 21, state: "complete", source: revision.key } }] });
  const changed = await GET(request({ after: first.nextCursor, expectedRevision: first.rawRevision })); expect(changed.status).toBe(409); expect(await changed.text()).toContain("갱신");
});

it("rejects a changed or unverified token before opening the reader and never reads another identity's raw rows", async () => {
  await seed({ identity: "gecko:old-token" });
  expect((await GET(request({ expectedIdentity: "gecko:old-token" }))).status).toBe(409); expect(mocks.connect).not.toHaveBeenCalled();
  expect((await GET(request())).status).toBe(404); expect(mocks.legacy).not.toHaveBeenCalled();
  mocks.connect.mockClear(); mocks.snapshot.mockResolvedValueOnce({ updatedAt: now, coins: [sample({ slug: asset.slug, geckoId: "a", identityStatus: "ambiguous" })] });
  expect((await GET(request())).status).toBe(409); expect(mocks.connect).not.toHaveBeenCalled();
});

const invalidRequests: Record<string, string>[] = [{ expectedIdentity: "" }, { days: "30" }, { from: "2026-02-29" }, { after: "bad" }, { capital: "auto" }, { limit: "1001" }, { to: "2026-03-07" }];
it.each(invalidRequests)("validates daily query conditions before any store lookup: %j", async params => {
  expect((await GET(request(params))).status).toBe(400); expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
});

it("does not expose credentials or internal store failures in errors", async () => {
  vi.stubEnv("TURSO_AUTH_TOKEN", ""); expect((await GET(request())).status).toBe(503); expect(mocks.connect).not.toHaveBeenCalled();
  vi.stubEnv("TURSO_AUTH_TOKEN", "local-test-reader-only"); mocks.connect.mockImplementationOnce(() => { throw Error("sensitive local-test-reader-only details"); });
  const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/sensitive|local-test-reader-only|TURSO/);
});
