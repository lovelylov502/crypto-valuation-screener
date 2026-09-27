import { describe, expect, it } from "vitest";
import { revenueReading, REVENUE_OVERVIEW_URL } from "./revenueReading";
import { revenueTrend } from "./revenueTrend";
import { summarizeRevenueHistory } from "./revenueHistory";
import { protocolMultiple } from "./valuationMetrics";
import { sample } from "./testFixtures";
import { assembleScreener } from "./screener";
import { queryScreener } from "./screenerQuery";
import { defaultPreferences } from "./workspacePreferences";

const at = Date.parse("2026-09-27T12:00:00Z"), end = Date.parse("2026-09-26") / 1000;
function coin(days = 30) {
  const c = sample({ revenue30d: 205441, revenue24h: 9877, revenue1y: 3584326 });
  c.revenueHistory = summarizeRevenueHistory([{ slug: c.slug, name: "FWA" }], Array.from({ length: days }, (_, i) => [end - i * 86400, { FWA: 12068 }]), at, "https://api.llama.fi/example", new Map([[c.slug, c.fundamentals.revenue]]))[c.slug];
  return c;
}

describe("source amounts remain visible independently of valuation approval", () => {
  it("shows an unreviewed completed period without approving multiples or growth", () => {
    const c = coin();
    c.fundamentals = structuredClone(c.fundamentals);
    c.fundamentals.revenue.kind = "unknown";
    expect(revenueReading(c, 30)).toMatchObject({ amount: 362040, basis: "completed_utc", kindLabel: "집계 정의 미확인", end: "2026-09-26" });
    expect(protocolMultiple(c, 30)).toBeNull();
    expect(revenueTrend(c, 30).current).toBeNull();
  });
  it("shows the received 30-day total when component history is only nine days", () => {
    const c = coin(9);
    expect(revenueReading(c, 30)).toMatchObject({ amount: 205441, basis: "provider_total", source: REVENUE_OVERVIEW_URL, start: null, end: null });
    expect(protocolMultiple(c, 30)).toBeNull();
    expect(revenueTrend(c, 30).delta).toBeNull();
    expect(revenueReading(c, 1)).toMatchObject({ amount: 12068, basis: "completed_utc" });
  });
  it("labels a provider year as unverified and never annualizes it as 365 observed days", () => {
    const c = coin(9);
    expect(revenueReading(c, 365)).toMatchObject({ amount: 3584326, basis: "provider_total", basisLabel: "원천 1년 집계 · 365일 미확인" });
    expect(protocolMultiple(c, 365)).toBeNull();
    expect(revenueReading(c, 90).amount).toBeNull();
  });
  it("preserves explicit zero and losses while withholding changed-scope history", () => {
    const c = coin();
    c.revenueHistory!.definitionFingerprint = "old-scope";
    expect(revenueReading({ ...c, revenue30d: 0 }, 30).amount).toBe(0);
    expect(revenueReading({ ...c, revenue30d: -12 }, 30).amount).toBe(-12);
    expect(revenueReading({ ...c, revenue30d: null }, 30).amount).toBeNull();
  });
  it("sorts displayed source amounts but keeps unreviewed rows out of growth filters", () => {
    const unknown = coin(9);
    unknown.fundamentals = structuredClone(unknown.fundamentals);
    unknown.fundamentals.revenue.kind = "unknown";
    const data = assembleScreener([unknown, sample({ slug: "reviewed", revenue30d: 100, revenuePrev30d: 50 })], new Date(at).toISOString(), []);
    const prefs = { ...defaultPreferences(), sortKey: "revenue30d" as const, sortDir: "desc" as const };
    expect(queryScreener(data, prefs).coins.map(c => c.slug)).toEqual(["sample", "reviewed"]);
    expect(queryScreener(data, { ...prefs, growingOnly: true }).coins.map(c => c.slug)).toEqual(["reviewed"]);
  });
});
