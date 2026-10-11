import { describe, expect, it } from "vitest";
import { sample } from "./testFixtures";
import { referenceMultiple, referenceReading, referenceReason, referenceReview } from "./referenceMetrics";
import { protocolMultiple, holderScope } from "./valuationMetrics";
import { summarizeRevenueHistory } from "./revenueHistory";
import { assembleScreener } from "./screener";
import { queryScreener } from "./screenerQuery";
import { defaultPreferences, parseWorkspace } from "./workspacePreferences";
import { DEFAULT_VISIBLE_COLUMNS } from "./screenerColumns";
import { apiArchiveErrors } from "../scripts/audit-coverage";

const at = Date.parse("2026-10-11T04:42:52Z"), end = Date.parse("2026-10-10") / 1000;
function historyCoin(count = 30) {
  const c = sample({ mcap: 205716090.64628443, revenue30d: 634189 });
  c.revenueHistory = summarizeRevenueHistory([{ slug: c.slug, name: "Kamino" }],
    Array.from({ length: count }, (_, i) => [end - i * 86400, { Kamino: 100 }]), at,
    "https://api.llama.fi/summary/fees/kamino?dataType=dailyRevenue", new Map([[c.slug, c.fundamentals.revenue]]))[c.slug];
  return c;
}

describe("source reference multiples", () => {
  it("uses the displayed daily sum for unknown Revenue while keeping reviewed scoring withheld", () => {
    const c = historyCoin();
    c.fundamentals = structuredClone(c.fundamentals);
    c.fundamentals.revenue.kind = "unknown";
    expect(referenceReading(c, "revenue", 30).amount).toBe(3000);
    expect(referenceMultiple(c, "revenue", 30)).toBeCloseTo(c.mcap! / 36500);
    expect(protocolMultiple(c, 30)).toBeNull();
  });
  it("keeps the provider's 30-day reference available across a missing latest UTC day", () => {
    const c = historyCoin(29);
    expect(c.revenueHistory!.periods[30].total).toBeNull();
    expect(referenceReading(c, "revenue", 30)).toMatchObject({ amount: 634189, basis: "provider_total", start: null, end: null });
    expect(referenceMultiple(c, "revenue", 30)).toBeCloseTo(26.6610928823, 8);
    expect(referenceReason(c, "revenue", 30)).toContain("제공처");
    expect(protocolMultiple(c, 30)).toBeNull();
  });
  it("does not require a business-revenue classification or a classification approval", () => {
    const c = sample();
    c.fundamentals = structuredClone(c.fundamentals);
    c.fundamentals.revenue.kind = "holder_return";
    c.fundamentals.revenue.components = [{ slug: "changed", kind: "unknown", definition: "Updated definition", status: "changed", reviewedAt: null, source: "https://defillama.com" }];
    expect(referenceMultiple(c, "revenue")).toBeCloseTo(100000000 / 7300000);
    expect(referenceReview(c, "revenue")).toContain("재검토");
    expect(protocolMultiple(c)).toBeNull();
  });
  it("labels the provider year as a reference without claiming a complete TTM", () => {
    const c = historyCoin(29);
    expect(referenceMultiple(c, "revenue", 365)).toBeCloseTo(c.mcap! / c.revenue1y!);
    expect(referenceReading(c, "revenue", 365).basisLabel).toBe("원천 1년 집계 · 365일 미확인");
    expect(protocolMultiple(c, 365)).toBeNull();
  });
  it("keeps partial provider groups visible but excludes them from the whole-project ratio", () => {
    const c = sample({ revenue30d: null, revenueSource: { url: "https://api.llama.fi/overview/fees", observedAt: new Date(at).toISOString(), periods: { 30: { total: 50, reported: 1, expected: 2 } } } });
    expect(referenceReading(c, "revenue", 30)).toMatchObject({ amount: 50, basis: "provider_partial" });
    expect(referenceMultiple(c, "revenue")).toBeNull();
  });
  it("does not substitute another numerator or manufacture a token identity", () => {
    for (const c of [sample({ identityStatus: "review" }), sample({ capitalExclusionReason: "stablecoin" }), sample({ mcap: null })]) {
      expect(referenceMultiple(c, "revenue")).toBeNull();
    }
    const c = sample({ fdv: null });
    expect(referenceMultiple(c, "revenue", 30, "fdv")).toBeNull();
    expect(referenceMultiple(c, "revenue", 30, "mcap")).not.toBeNull();
  });
  it("never turns zero, negative or absent source amounts into a ratio", () => {
    for (const value of [0, -1, null, NaN, Infinity]) expect(referenceMultiple(sample({ revenue30d: value }), "revenue")).toBeNull();
  });
  it("uses the full raw holder amount and never presents a reviewed subset as the full source", () => {
    const c = sample({ holderValue: { rawCurrent30d: 500, eligibleCurrent30d: 100 } });
    c.holderValue.components = [{ slug: "excluded", name: "Excluded source", economicType: "unclear_other", eligible: false, reason: "Unreviewed", current30d: 400, previous30d: 400, ttm: 4000 }];
    c.holderHistory!.definitionFingerprint = holderScope(c);
    expect(referenceReading(c, "holders", 30)).toMatchObject({ amount: 500, basis: "provider_total" });
    expect(referenceMultiple(c, "holders")).toBeCloseTo(100000000 / (500 * 365 / 30));
    expect(referenceMultiple(c, "holders", 7)).toBeNull();
  });
  it("uses the same raw ratios for API values, sorting, filters and coverage", () => {
    const a = sample({ slug: "a", revenue30d: 1000000 }), b = sample({ slug: "b", revenue30d: 500000 });
    a.fundamentals = structuredClone(a.fundamentals);
    a.fundamentals.revenue.kind = "unknown";
    const data = assembleScreener([b, a], new Date(at).toISOString(), []);
    const page = queryScreener(data, { ...defaultPreferences(), available: "revenue", coverageWindow: 30, maxPr: 10 });
    expect(page.coins.map(c => c.slug)).toEqual(["a"]);
    expect(page.coverage.revenue).toBe(2);
    expect(page.referenceMultiples.a.revenue[30]).toBeCloseTo(100000000 / (1000000 * 365 / 30));
    expect(page.coins[0].multiples.pr).toBeNull();
  });
  it("adds review status to the previous default columns while preserving custom order and filters", () => {
    const previous = DEFAULT_VISIBLE_COLUMNS.filter(k => k !== "revenueReview");
    expect(parseWorkspace(JSON.stringify({ ...defaultPreferences(), columns: previous })).columns).toEqual(DEFAULT_VISIBLE_COLUMNS);
    expect(parseWorkspace(JSON.stringify({ ...defaultPreferences(), columns: ["pr", "price"], capital: "fdv", maxPr: 20 })).columns).toEqual(["pr", "price"]);
  });
  it("validates source-reference values separately without weakening archive checks", () => {
    const data = assembleScreener([sample()], new Date(at).toISOString(), []);
    const page = queryScreener(data);
    expect(apiArchiveErrors(page, data.coins, data)).toEqual([]);
    page.referenceMultiples.sample.revenue[30] = 1;
    expect(apiArchiveErrors(page, data.coins, data)).toContain("source_reference_values_changed");
    page.coins[0] = { ...page.coins[0], mcap: 1 };
    expect(apiArchiveErrors(page, page.coins, data)).toContain("published bytes changed:sample");
  });
});
