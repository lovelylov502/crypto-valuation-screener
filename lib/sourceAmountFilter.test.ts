import { describe, expect, it } from "vitest";
import { sample } from "./testFixtures";
import { assembleScreener } from "./screener";
import { queryScreener } from "./screenerQuery";
import { defaultPreferences, parseWorkspace, resetWorkspaceFilters } from "./workspacePreferences";
import type { CoinRaw } from "./types";

const at = "2026-10-11T11:00:00Z";
const source = (seven: number | null, thirty: number | null): NonNullable<CoinRaw["revenueSource"]> => ({
  url: "https://api.llama.fi/overview/fees", observedAt: at,
  periods: { 7: { total: seven, reported: seven === null ? 0 : 1, expected: 1 }, 30: { total: thirty, reported: thirty === null ? 0 : 1, expected: 1 } },
});
const coin = (slug: string, seven: number | null, thirty = seven) => sample({
  slug, revenueHistory: null, holderHistory: null, revenue7d: seven, revenue30d: thirty, revenue1y: null,
  revenueSource: source(seven, thirty), holderSource: source(null, null),
});
const data = (coins: CoinRaw[]) => assembleScreener(coins, at, []);
const prefs = { ...defaultPreferences(), rangeWindow: 7 as const, minSourceAmount: 100000 };
const slugs = (page: ReturnType<typeof queryScreener>) => page.coins.map(c => c.slug);

describe("source amount filters", () => {
  it("excludes the exact threshold, smaller and missing amounts without annualizing", () => {
    const rows = data([coin("equal", 100000), coin("above", 100001), coin("below", 99999), coin("zero", 0), coin("negative", -1), coin("missing", null)]);
    expect(slugs(queryScreener(rows, prefs))).toEqual(["above"]);
    expect(queryScreener(rows, { ...prefs, minSourceAmount: null }).pagination.filtered).toBe(6);
    expect(new Set(slugs(queryScreener(rows, { ...prefs, minSourceAmount: 0 })))).toEqual(new Set(["equal", "above", "below"]));
  });
  it("changes the amount window along with the common ratio window", () => {
    const rows = data([coin("monthly", 50000, 150000)]);
    expect(slugs(queryScreener(rows, prefs))).toEqual([]);
    expect(slugs(queryScreener(rows, { ...prefs, rangeWindow: 30 }))).toEqual(["monthly"]);
  });
  it("uses full raw holders revenue independently of reviewed subsets, capital and token linking", () => {
    const c = coin("unreviewed", 80000);
    c.holderSource = source(120000, 200000);
    c.holderValue.eligibleRunRate = null;
    c.holderValue.rawCurrent30d = 1000;
    c.mcap = null; c.fdv = null; c.identityStatus = "review";
    const rows = data([c]);
    expect(slugs(queryScreener(rows, prefs))).toEqual([]);
    expect(slugs(queryScreener(rows, { ...prefs, sourceMetric: "holders" }))).toEqual(["unreviewed"]);
  });
  it("combines raw amount and multiple limits before pagination", () => {
    const above = Array.from({ length: 51 }, (_, i) => ({ ...coin(`above-${i}`, 120000), mcap: 1000000 }));
    const rows = data([...above, { ...coin("expensive", 120000), mcap: 1000000000 }, { ...coin("small", 1000), mcap: 1000 }]);
    const filtered = { ...prefs, maxPr: 10 };
    const first = queryScreener(rows, filtered, [], 1, 50), second = queryScreener(rows, filtered, [], 2, 50);
    expect(first.pagination.filtered).toBe(51);
    expect(first.coins).toHaveLength(50); expect(second.coins).toHaveLength(1);
    expect(new Set([...slugs(first), ...slugs(second)])).toEqual(new Set(above.map(c => c.slug)));
  });
});

describe("source amount preference persistence", () => {
  it("keeps legacy filters with the fixed columns while defaulting the new condition to inactive", () => {
    const saved = { columns: ["price", "pr7d"], capital: "fdv", maxPr: 10, rangeWindow: 7, search: "WLFI" };
    expect(parseWorkspace(JSON.stringify(saved))).toMatchObject({ ...saved, columns: defaultPreferences().columns, sourceMetric: "revenue", minSourceAmount: null });
    for (const value of [-1, "100000", null]) expect(parseWorkspace(JSON.stringify({ minSourceAmount: value, sourceMetric: "unknown" }))).toMatchObject({ minSourceAmount: null, sourceMetric: "revenue" });
    expect(parseWorkspace('{"minSourceAmount":1e999}').minSourceAmount).toBeNull();
  });
  it("persists zero, fractional and positive thresholds with the selected source and period", () => {
    for (const amount of [0, 0.25, 100000]) {
      const saved = { ...prefs, minSourceAmount: amount, sourceMetric: "holders" as const };
      expect(parseWorkspace(JSON.stringify(saved))).toEqual(saved);
    }
  });
  it("resets the amount condition and common period while retaining comparison settings", () => {
    const saved = { ...prefs, sourceMetric: "holders" as const, capital: "fdv" as const, columns: ["price", "phr7d"] as const, sortKey: "phr7d" as const };
    const parsed = parseWorkspace(JSON.stringify(saved));
    expect(resetWorkspaceFilters(parsed)).toMatchObject({ minSourceAmount: null, sourceMetric: "revenue", rangeWindow: 30, maxPr: 0, columns: parsed.columns, capital: "fdv", sortKey: "phr7d" });
  });
});
