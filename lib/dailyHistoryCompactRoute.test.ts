// Exercise the retained legacy reader against local fixtures only.
vi.mock("./dataDeliveryPolicy", async original => ({ ...await original<typeof import("./dataDeliveryPolicy")>(), HOSTED_DATABASE_ENABLED: true }));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client, type InStatement } from "@libsql/client";
const mocks = vi.hoisted(() => ({ context: vi.fn(), snapshot: vi.fn(), connect: vi.fn() }));
vi.mock("./tableRead", () => ({ getTableCoinContext: mocks.context }));
vi.mock("./serverScreener", () => ({ getScreener: mocks.snapshot }));
vi.mock("./dailyValuationRead", async original => ({ ...await original<typeof import("./dailyValuationRead")>(), connectDailyValuationReader: mocks.connect }));
import { GET } from "../app/api/history/route";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "./dailyRawDatabase";
import { initializeDailyReadModels } from "./dailyReadModelDatabase";
import { prepareDailyValuationHistory } from "./dailyValuationPrepared";
import { decodeCompactHistory, expandCompactHistory } from "./dailyValuationCompact";
import { shiftValuationDay } from "./dailyValuation";
import type { DailyRawPoint, DailyRawSource } from "./dailyRawData";
let db: Client, close: () => void;
const now = new Date("2026-10-20T12:00:00Z"), asOf = "2026-10-18", coin = { slug: "parent#alpha", geckoId: "alpha", cmcId: null, identityStatus: "verified" as const, capitalExclusionReason: null }, asset = { slug: coin.slug, identity: "gecko:alpha" }, snapshot = { updatedAt: "2026-10-19T22:38:30Z", publication: { published: { id: "current-verified" } } };
const sources: DailyRawSource[] = (["fdv", "revenue"] as const).map(metric => ({ key: metric, metric, provider: metric === "fdv" ? "CoinGecko" : "DefiLlama", url: `https://example.test/${metric}`, observedAt: now.toISOString(), sha256: "a".repeat(64), scope: "alpha", definition: `${metric} USD`, basis: metric === "fdv" ? "utc_day_close" : "completed_utc_day_flow" }));
const request = (values: Record<string, string> = {}) => new Request(`https://fixture.test/api/history?${new URLSearchParams({ slug: coin.slug, expectedIdentity: asset.identity, ...values })}`);
const sql = (statement: InStatement) => typeof statement === "string" ? statement : statement.sql;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.stubEnv("TURSO_DATABASE_URL", "libsql://fixture.turso.io"); vi.stubEnv("TURSO_AUTH_TOKEN", "fixture");
  db = createClient({ url: ":memory:" }); close = db.close.bind(db); vi.spyOn(db, "close").mockImplementation(() => {});
  await initializeDailyRaw(db); await initializeDailyReadModels(db); await openDailyRawRun(db, { id: "fixture", maxEstimatedWrites: 100_000, now });
  const points: DailyRawPoint[] = Array.from({ length: 2209 }, (_, index) => { const day = shiftValuationDay(asOf, index - 2208); return { day, fdv: { value: (index + 1) * 365, state: "complete", source: "fdv", at: `${shiftValuationDay(day, 1)}T00:00:00Z` }, revenue: { value: 1, state: "complete", source: "revenue" } }; });
  for (let i = 0; i < points.length; i += 1000) await upsertDailyRaw(db, { runId: "fixture", asset, sources, points: points.slice(i, i + 1000), now });
  await prepareDailyValuationHistory(db, { coin, snapshot, runId: "fixture", now });
  mocks.context.mockReset().mockResolvedValue({ coin, snapshot }); mocks.snapshot.mockReset().mockRejectedValue(Error("unexpected full snapshot")); mocks.connect.mockReset().mockReturnValue(db);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); close(); });
it("uses the cheap current binding and metadata-only version read with a prepared path header", async () => {
  const execute = vi.spyOn(db, "execute"), response = await GET(request({ format: "version" })), body = await response.json();
  expect(response.status).toBe(200); expect(response.headers.get("X-Tovenit-Read-Model")).toBe("prepared"); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(body).toMatchObject({ schema: 3, asset: { slug: coin.slug, identity: asset.identity, snapshotId: "current-verified" }, asOf }); expect(body).not.toHaveProperty("payload");
  expect(mocks.context).toHaveBeenCalledOnce(); expect(mocks.snapshot).not.toHaveBeenCalled(); expect(db.close).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledOnce(); expect(sql(execute.mock.calls[0][0])).not.toMatch(/payload|daily_raw_days/);
});
it("delivers all 2209 dates and both numerators in one compact body under 500KB with a pinned version", async () => {
  const version = await (await GET(request({ format: "version" }))).json();
  const response = await GET(request({ format: "compact", expectedRevision: version.rawRevision, from: "2026-10-17", to: asOf })), text = await response.text(), body = JSON.parse(text);
  expect(response.status).toBe(200); expect(response.headers.get("X-Tovenit-Read-Model")).toBe("prepared"); expect(Buffer.byteLength(text)).toBeLessThan(500_000);
  const data = await decodeCompactHistory(body), fdv = expandCompactHistory(data, "fdv"), mcap = expandCompactHistory(data, "mcap");
  expect(fdv.points).toHaveLength(2209); expect(fdv.nextCursor).toBeNull(); expect(fdv.points.at(-1)!.pr.value).toBe(2209); expect(mcap.points.at(-1)!.pr.value).toBeNull();
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
it("returns 409 on an outdated expected revision and keeps binding/current publication fences", async () => {
  const old = await (await GET(request({ format: "version" }))).json();
  await upsertDailyRaw(db, { runId: "fixture", asset, sources: [], points: [{ day: "1900-01-01" }], now });
  expect((await GET(request({ format: "compact", expectedRevision: old.rawRevision }))).status).toBe(409);
  mocks.context.mockResolvedValue({ coin: { ...coin, geckoId: "replacement" }, snapshot });
  expect((await GET(request({ format: "version" }))).status).toBe(409);
});
it("labels a missing/dirty prepared blob as raw-fallback and returns current verified cells without writes", async () => {
  await db.execute("DELETE FROM daily_read_models");
  const transaction = vi.spyOn(db, "transaction"), response = await GET(request({ format: "compact" }));
  expect(response.status).toBe(200); expect(response.headers.get("X-Tovenit-Read-Model")).toBe("raw-fallback");
  expect(expandCompactHistory(await decodeCompactHistory(await response.json()), "fdv").points).toHaveLength(2209);
  expect(transaction.mock.calls.every(call => (call as unknown as [string])[0] === "read")).toBe(true);
});
it.each([{ format: "other" }, { format: "version", limit: "1000" }, { format: "compact", after: "2020-01-01" }, { format: "compact", days: "30" }] as Record<string, string>[])("rejects unsupported compact conditions before any data read: %j", async query => {
  expect((await GET(request(query))).status).toBe(400); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
});
