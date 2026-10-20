import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), comparisons: vi.fn() }));
vi.mock("./serverScreener", () => ({ getScreener: mocks.snapshot }));
vi.mock("./dailyValuationRead", () => ({ readDailyComparisonBatch: mocks.comparisons }));
import { GET } from "../app/api/screener/route";
import { assembleScreener } from "./screener";
import { queryScreener } from "./screenerQuery";
import { sample } from "./testFixtures";
import { parseWorkspace } from "./workspacePreferences";
import type { ScreenerResponse } from "./types";

let data: ScreenerResponse;
const at = "2026-10-19T22:38:30.660Z";
function freeze(value: any) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function request(query: Record<string, string> = {}) { return new Request(`https://fixture.test/api/screener?${new URLSearchParams(query)}`); }
beforeEach(() => {
  data = freeze(assembleScreener(Array.from({ length: 201 }, (_, index) => sample({ slug: `token-${index}`, geckoId: `exact-${index}`, mcap: 1_000_000 + index })), at, []));
  mocks.snapshot.mockReset().mockResolvedValue(data);
  mocks.comparisons.mockReset().mockImplementation(async ({ coins, capital }) => ({ schema: 1, capital, revenueDays: 1, asOf: "2026-10-18", baseline: { from: "2025-10-18", to: "2026-10-17", expectedDays: 365 }, rows: Object.fromEntries(coins.map((coin: any) => [coin.slug, { pr: { status: "insufficient", validDays: 22 }, phr: { status: "unavailable", validDays: 0, reason: "missing_revenue" } }])) }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("decorates only the selected page in one batch, keeping immutable coin/reference/proof fields intact", async () => {
  const prefs = JSON.stringify({ capital: "fdv" }), original = JSON.stringify(data), expected = queryScreener(data, parseWorkspace(prefs), [], 1, 200);
  const response = await GET(request({ prefs, size: "200" })), body = await response.json();
  expect(response.status).toBe(200); expect(mocks.comparisons).toHaveBeenCalledOnce();
  expect(mocks.comparisons).toHaveBeenCalledWith({ coins: expected.coins, capital: "fdv", snapshot: data });
  expect(Object.keys(body.valuationComparison.rows)).toHaveLength(200);
  const { valuationComparison, ...base } = body;
  expect(base).toEqual(JSON.parse(JSON.stringify(expected))); expect(JSON.stringify(data)).toBe(original);
  expect(data).not.toHaveProperty("valuationComparison");
});

it("uses pagination/filter preferences before the one optional history read", async () => {
  const prefs = JSON.stringify({ capital: "mcap", search: "token-1" }), expected = queryScreener(data, parseWorkspace(prefs), [], 2, 50);
  const body = await (await GET(request({ prefs, size: "50", page: "2" }))).json();
  expect(mocks.comparisons).toHaveBeenCalledWith({ coins: expected.coins, capital: "mcap", snapshot: data });
  expect(body.pagination).toEqual(expected.pagination); expect(body.referenceMultiples).toEqual(expected.referenceMultiples);
});

it("omits unavailable history and logs no connection/SQL details while returning the complete original list", async () => {
  mocks.comparisons.mockRejectedValue(Error("sensitive credential SQL text"));
  const expected = queryScreener(data), response = await GET(request()), body = await response.json();
  expect(response.status).toBe(200); expect(body).toEqual(JSON.parse(JSON.stringify(expected)));
  expect(body).not.toHaveProperty("valuationComparison"); expect(JSON.stringify(body)).not.toContain("sensitive");
  expect(console.error).toHaveBeenCalledWith("daily_valuation_summary_unavailable");
  expect(console.error).toHaveBeenCalledTimes(1);
});

it("keeps list data available when the bounded reader reports its deadline", async () => {
  vi.useFakeTimers(); mocks.comparisons.mockImplementation(() => new Promise((_resolve, reject) => setTimeout(() => reject(Error("daily_valuation_deadline_exceeded")), 8000)));
  const pending = GET(request()); await vi.advanceTimersByTimeAsync(8000);
  const response = await pending, body = await response.json();
  expect(response.status).toBe(200); expect(body).toEqual(JSON.parse(JSON.stringify(queryScreener(data))));
  expect(body).not.toHaveProperty("valuationComparison"); expect(console.error).toHaveBeenCalledWith("daily_valuation_summary_unavailable");
});

it("falls back to the original list if optional decoration exceeds the existing response byte budget", async () => {
  mocks.comparisons.mockResolvedValue({ unexpected: "x".repeat(8_000_001) });
  const response = await GET(request()), body = await response.json();
  expect(response.status).toBe(200); expect(body).toEqual(JSON.parse(JSON.stringify(queryScreener(data))));
  expect(body).not.toHaveProperty("valuationComparison");
});

it.each(["prefs", "favorites"])("retains the existing oversized %s HTTP 400 before either source read", async field => {
  const response = await GET(request({ [field]: "x".repeat(field === "prefs" ? 10001 : 30001) }));
  expect(response.status).toBe(400); expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.comparisons).not.toHaveBeenCalled();
});
