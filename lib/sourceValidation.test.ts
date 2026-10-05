import { afterEach, expect, it, vi } from "vitest";
import { validateDirectoryRows, validateHistoryBreakdown, validateIdentityCensus, validateProtocolFinancialRows, validateSummaryHistory } from "./sourceValidation";
import { assessPipelineCandidate, captureDataPipeline, replayDataPipeline } from "./dataPipeline";
import { revenueReading } from "./revenueReading";
import type { SourceObservation } from "./types";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const at = "2026-10-05T03:00:00.000Z", now = Date.parse(at), day = Date.parse("2026-10-04") / 1000;
const url = "https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false";
const protocols = [{ slug: "one", name: "One" }, { slug: "two", name: "Two" }];

it("blocks missing, empty, malformed and duplicate required identity censuses", () => {
  for (const invalid of [undefined, [], [null], [{ name: "No ID" }], [{ slug: " " }], [{ slug: "one" }, { slug: "one" }]])
    expect(() => validateIdentityCensus(invalid, "slug")).toThrow("census");
  expect(() => validateIdentityCensus([{ id: "parent#one" }, { id: "parent#one" }], "id")).toThrow("duplicate");
  expect(validateIdentityCensus(protocols, "slug")).toEqual(protocols);
  expect(validateIdentityCensus([{ id: "parent#one" }], "id")).toEqual([{ id: "parent#one" }]);
});

it("marks malformed directory mcap/tvl while retaining valid zero and independent rows", () => {
  const observations: SourceObservation[] = [];
  expect(validateDirectoryRows([{ ...protocols[0], mcap: "2", tvl: 0 }, { ...protocols[1], mcap: null, tvl: 5 }], "slug", "https://api.llama.fi/protocols", observations))
    .toEqual([{ ...protocols[0], mcap: null, tvl: 0 }, { ...protocols[1], mcap: null, tvl: 5 }]);
  expect(observations).toMatchObject([{ reason: "schema_mismatch", sourceSlugs: ["one"] }]);
  expect(validateDirectoryRows([{ id: "parent#one", tvl: {} }], "id", "https://api.llama.fi/config", observations)[0].tvl).toBeNull();
  expect(observations[1].sourceSlugs).toEqual(["parent#one"]);
});

it("distinguishes malformed present financial fields from absent, null, zero and negative values", () => {
  const observations: SourceObservation[] = [];
  const raw = [{ ...protocols[0], total24h: 0, total7d: null, total30d: "123", total1y: -1 }, { ...protocols[1], total30d: 7 }];
  const rows = validateProtocolFinancialRows(raw, url, observations);
  expect(rows[0]).toMatchObject({ total24h: 0, total7d: null, total30d: null, total1y: -1 });
  expect(raw[0].total30d).toBe("123");
  expect(rows[1]).toEqual(raw[1]);
  expect(observations).toMatchObject([{ status: "withheld", reason: "schema_mismatch", sourceSlugs: ["one"] }]);
  expect(() => validateProtocolFinancialRows([{ slug: "one" }, { slug: "one" }], url, [])).toThrow("identity");
  expect(() => validateProtocolFinancialRows([{ total30d: 3 }], url, [])).toThrow("identity");
});

it("removes conflicting duplicate daily cells without overwriting independent cells or explicit zero", () => {
  const observations: SourceObservation[] = [];
  const chart = [[day, { One: 1, Two: 0 }], [day, { One: 999, Two: 0 }], [day, { One: 1 }], [day - 86400, { One: "3", Two: null }]];
  expect(validateHistoryBreakdown(protocols, chart, url, now, observations)).toEqual([[day - 86400, {}], [day, { Two: 0 }]]);
  expect(observations.map(s => [s.reason, s.sourceSlugs])).toEqual([["value_conflict", ["one"]], ["schema_mismatch", ["one"]]]);
  expect(() => validateHistoryBreakdown(protocols, [[day + 1, { One: 1 }]], url, now, [])).toThrow("point");
});

it("applies the same no-last-wins rule to exact-identity summaries", () => {
  const observations: SourceObservation[] = [];
  expect(validateSummaryHistory([[day, 1], [day, 999], [day, 1], [day - 86400, 0], [day - 2 * 86400, "4"]], url, ["one"], now, observations))
    .toEqual([[day - 86400, 0]]);
  expect(observations.map(s => s.reason)).toEqual(["value_conflict", "schema_mismatch"]);
});

function upstream(mode: "malformed" | "duplicate") {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  const one = { slug: "one", name: "One", id: "1", defillamaId: "1", methodology: { Revenue: "Protocol revenue" }, total24h: 1, total7d: 7, total30d: mode === "malformed" ? "12345" : 30 };
  const two = { slug: "two", name: "Two", id: "2", defillamaId: "2", methodology: { Revenue: "Protocol revenue" }, total24h: 2, total7d: 14, total30d: 60 };
  const list = [one, two];
  const chart = Array.from({ length: 30 }, (_, i) => [day - i * 86400, { ...(mode === "duplicate" ? { One: 1 } : {}), Two: 2 }]);
  if (mode === "duplicate") chart.push([day, { One: 999, Two: 2 }]);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const u = new URL(String(input));
    const body = u.hostname === "stablecoins.llama.fi" ? { peggedAssets: [{ gecko_id: "tether", symbol: "USDT" }] }
      : u.hostname.includes("coinmarketcap.com") ? { data: [{ id: 999, name: "Unrelated", symbol: "ZZZ", slug: "unrelated" }] }
      : u.pathname === "/protocols" ? list
      : u.pathname === "/config" ? { parentProtocols: [{ id: "parent#unrelated", name: "Unrelated Parent" }] }
      : u.pathname === "/summary/fees/one" ? { ...one, totalDataChart: mode === "duplicate" ? Array.from({ length: 30 }, (_, i) => [day - i * 86400, 1]) : [] }
      : u.searchParams.get("dataType") === "dailyRevenue" ? { protocols: list, totalDataChartBreakdown: chart }
      : { protocols: list.map(({ slug, name, defillamaId }) => ({ slug, name, defillamaId })), totalDataChartBreakdown: [] };
    return Response.json(body);
  }));
}

it.each(["malformed", "duplicate"] as const)("isolates %s upstream data and verifies identical offline replay", async mode => {
  upstream(mode);
  const result = await captureDataPipeline(null, at, async () => {});
  const one = result.data.coins.find(c => c.slug === "one")!, two = result.data.coins.find(c => c.slug === "two")!;
  expect(one.dataQuality?.issues).toContainEqual(expect.objectContaining({ scope: "revenue", code: mode === "malformed" ? "schema_mismatch" : "value_conflict" }));
  expect(one.revenueHistory?.periods[30].total).toBeNull();
  expect(one.revenue30d).toBe(mode === "malformed" ? null : 30);
  expect(two.dataQuality).toEqual({ state: "complete", issues: [] });
  expect(revenueReading(two, 30).amount).toBe(60);
  vi.stubGlobal("fetch", () => { throw new Error("Unexpected network"); });
  const replayed = await replayDataPipeline(JSON.parse(JSON.stringify(result.bundle)));
  expect(replayed).toEqual(result.data);
  expect(assessPipelineCandidate(result.data, result.bundle, null, at, at, replayed).errors).toEqual([]);
});
