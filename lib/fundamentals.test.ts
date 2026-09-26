import { describe, it, expect } from "vitest";
import registry from "./fundamentalDefinitions.json";
import { aggregateDefinitions, combineFundamentals, definitionReviewed } from "./fundamentalSource";
import { aggregateOverviewByGroup } from "./sources";
import { aggregateHolderValueByGroup, emptyHolderValueSummary } from "./holderValue";
import { type RevenueKind, type FeeKind, type MetricDefinition, revenueLabel, multipleLabel } from "./fundamentals";
import { sample } from "./testFixtures";
import { scoreCoins } from "./valuation";
import { researchMultiple, revenueGrowing } from "./research";
import { revenueAmount, summarizeRevenueHistory } from "./revenueHistory";
import { assembleScreener } from "./screener";
import { makeSnapshot, compareSnapshot, parseHistory } from "./snapshotHistory";
import { isScreenerResponse } from "./screenerRefresh";
import { fundamentalErrors } from "./fundamentalContract";

const at = "2026-09-19T14:10:36.924Z";
type Row = Record<string, unknown>;
const row = (slug: keyof typeof registry, values: Row = {}): Row => ({ slug, name: slug, methodology: structuredClone(registry[slug].methodology), ...values });
function definitions(rows: Row[], group: (slug: string) => string = () => "parent") {
  return combineFundamentals(aggregateDefinitions(rows, group, "Revenue").get("parent") as MetricDefinition<RevenueKind>, aggregateDefinitions(rows, group, "Fees").get("parent") as MetricDefinition<FeeKind>, rows.filter(r => r.doublecounted !== true));
}
function venice() {
  const rows = [row("venice", { total30d: 797709, total60dto30d: 638001, total1y: 5260000 })];
  return sample({ slug: "venice", mcap: 1373926026.95808, fdv: 2301877330.33, marketDataUpdatedAt: at,
    fundamentals: definitions(rows), revenue30d: 797709, revenuePrev30d: 638001, fees30d: 797709, feesPrev30d: 638001,
    holderValue: aggregateHolderValueByGroup(rows, () => "parent", definitionReviewed).get("parent")!,
  });
}

describe("economic scope regression", () => {
  it("binds AERO's conditional voter distribution to reviewed adapter definitions", () => {
    const rows = [row("aerodrome-v1", { total30d: 100 }), row("aerodrome-slipstream", { total30d: 200 }), row("aero-lite", { total30d: 0 })];
    expect(definitions(rows).revenue.kind).toBe("protocol_revenue");
    expect(definitions(rows).holderShareReviewed).toBe(false);
    const holder = aggregateHolderValueByGroup(rows, () => "parent", definitionReviewed).get("parent")!;
    expect(holder.eligibleCurrent30d).toBe(300);
    expect(holder.components.filter(c => c.eligible).every(c => c.economicType === "ve_voter_locker_distribution")).toBe(true);
    expect(definitionReviewed(row("aerodrome-v1", { methodology: { ...registry["aerodrome-v1"].methodology, HoldersRevenue: "New recipient" } }))).toBe(false);
  });
  it("preserves VVV's burn denominator without sales, fee growth, share or duplicate scoring", () => {
    const [c] = scoreCoins([venice()], at);
    expect(c.fundamentals.revenue.kind).toBe("holder_return");
    expect(c.fundamentals.fees.kind).toBe("holder_return");
    expect([revenueLabel(c), multipleLabel(c)].join(" ")).not.toContain("매출");
    expect(researchMultiple(c)).toBeCloseTo(141.56218, 4);
    expect(c.opportunities.business).toBe(false);
    expect(revenueGrowing(c)).toBe(false);
    expect(c.opportunities.holder).toBe(true);
    expect(c.valueCapture.eligibleHolderValueShare).toBeNull();
    expect(c.valueCapture.shareBasis).toBeNull();
    expect(c.multiples.pf).toBeNull();
    expect(c.sectorPercentiles.revenueMultiple).toBeNull();
    expect(c.scoreAxes.improvement).toBeCloseTo((50 + 25.03256264488614 / 2) / 10, 1);
    expect(c.valueCapture.score).toBeLessThan(70);
    expect(fundamentalErrors(c)).toEqual([]);
  });
  it("allows real 100% distribution only with reviewed denominator coverage", () => {
    const raw = sample({ revenue30d: 100, holderValue: { eligibleCurrent30d: 100 } });
    const [reviewed, unreviewed] = scoreCoins([raw, { ...raw, fundamentals: { ...raw.fundamentals, holderShareReviewed: false } }], at);
    expect(reviewed.valueCapture.eligibleHolderValueShare).toBe(1);
    expect(unreviewed.valueCapture.eligibleHolderValueShare).toBeNull();
    const rows = [row("overtime", { total30d: 89861, total60dto30d: 80000 })];
    const [actual] = scoreCoins([sample({ fundamentals: definitions(rows), revenue30d: 89861, holderValue: aggregateHolderValueByGroup(rows, () => "parent", definitionReviewed).get("parent")! })], at);
    expect(actual.fundamentals.holderShareReviewed).toBe(true);
    expect(actual.valueCapture.eligibleHolderValueShare).toBe(1);
  });
  it("holds new, missing and changed definitions even when their wording looks like sales", () => {
    const changed = row("venice", { methodology: { ...registry.venice.methodology, Revenue: "All business sales and subscriptions" } });
    for (const rows of [[changed], [{ slug: "new", methodology: { Revenue: "All sales revenue", Fees: "All user fees" } }], [row("venice", { methodology: {} })]]) {
      const f = definitions(rows);
      const [c] = scoreCoins([sample({ fundamentals: f, holderValue: emptyHolderValueSummary() })], at);
      expect(f.revenue.kind).toBe("unknown");
      expect(researchMultiple(c)).toBeNull();
      expect(c.opportunities.business).toBe(false);
      expect(c.valueScore).toBeNull();
    }
    expect(aggregateHolderValueByGroup([changed], () => "parent", definitionReviewed).get("parent")?.components[0].eligible).toBe(false);
    expect(definitionReviewed(row("overtime", { methodology: { ...registry.overtime.methodology, SupplySideRevenue: "New external recipient" } }))).toBe(false);
  });
  it("quarantines mixed or incomplete parents, including unknown zero contributors", () => {
    expect(definitions([row("venice"), row("aave-v2")]).revenue.kind).toBe("mixed");
    expect(definitions([row("venice"), { slug: "unknown", total30d: 0 }]).revenue.kind).toBe("unknown");
    expect(definitions([row("venice"), row("venice")]).revenue.kind).toBe("unknown");
    expect(definitions([row("venice"), { slug: "unknown", doublecounted: true }]).revenue.kind).toBe("holder_return");
  });
  it("holds promotion when just one independent source already reports a changed definition", () => {
    const raw = venice();
    raw.fundamentals.fees.components[0].status = "changed";
    const [c] = scoreCoins([raw], at);
    expect(researchMultiple(c)).toBeNull();
    expect(c.multiples.phr).toBeNull();
    expect(c.opportunities.holder).toBe(false);
    expect(c.valueCapture.score).toBeNull();
    expect(c.valueScore).toBeNull();
  });
  it("withholds all cashflow multiples and capture promotion for ambiguous token ownership", () => {
    const [c] = scoreCoins([sample({ identityStatus: "ambiguous" })], at);
    expect([c.multiples.pf, c.multiples.revenueMultiple, c.multiples.phr]).toEqual([null, null, null]);
    expect(c.valueCapture.score).toBeNull();
    expect(c.valueCapture.eligibleHolderValueShare).toBeNull();
  });
  it("preserves losses, missing components and raw zero without inventing annual history", () => {
    const a = aggregateOverviewByGroup([{ slug: "a", total30d: 100, total1y: 1000 }, { slug: "b", total30d: -40, total1y: 200 }], () => "parent").get("parent")!;
    expect(a.d30).toBe(60);
    expect(a.annual).toBe(60 * 365 / 30);
    expect(revenueAmount(sample({ revenue1y: 1200 }), 365)).toBeNull();
    const h = aggregateHolderValueByGroup([row("venice", { total30d: 100 }), row("aave-v2")], () => "parent").get("parent")!;
    expect(h.rawCurrent30d).toBeNull();
    expect(h.components).toHaveLength(2);
    expect(h.rawTtm).toBeNull();
  });
  it("withholds comparisons across independently fetched definition changes", () => {
    const raw = venice();
    const end = Math.floor(Date.parse(at) / 86400000) * 86400 - 86400;
    const chart = Array.from({ length: 365 }, (_, i) => [end - i * 86400, { venice: 100 }]);
    const history = summarizeRevenueHistory([{ slug: "venice", name: "venice" }], chart, Date.parse(at), "fixture", new Map([["venice", raw.fundamentals.revenue]])).venice;
    const [valid, changed] = scoreCoins([{ ...raw, revenueHistory: history }, { ...raw, revenueHistory: { ...history, definitionFingerprint: "changed" } }], at);
    expect(researchMultiple(valid, 365)).not.toBeNull();
    expect(researchMultiple(changed)).toBeNull();
    expect(changed.opportunities.revenue.state).toBe("unknown");
    expect(changed.opportunities.dataIssues.join(" ")).toContain("정의 불일치");
    const s = makeSnapshot(assembleScreener([valid], at, []));
    expect(compareSnapshot(changed, s, s.scoreVersion).state).toBe("definition_changed");
    const mismatched = makeSnapshot(assembleScreener([changed], at, []));
    expect(compareSnapshot(valid, mismatched, s.scoreVersion).state).toBe("definition_changed");
  });
  it("preserves old records but refuses their comparisons and malformed API payloads", () => {
    const data = assembleScreener([venice()], at, []), c = data.coins[0], s = makeSnapshot(data);
    expect(isScreenerResponse(data)).toBe(true);
    expect(isScreenerResponse({ ...data, scoreVersion: "research-v5-ps-revenue" })).toBe(false);
    const falseShare = { ...c, valueCapture: { ...c.valueCapture, eligibleHolderValueShare: 1 } };
    expect(isScreenerResponse({ ...data, coins: [falseShare] })).toBe(false);
    expect(compareSnapshot({ ...c, fundamentals: { ...c.fundamentals, fingerprint: "d".repeat(64) } }, s, data.scoreVersion).state).toBe("definition_changed");
    const old = { ...s, schema: 1, scoreVersion: "research-v5-ps-revenue" };
    expect(parseHistory(JSON.stringify([old]))).toHaveLength(1);
    expect(compareSnapshot(c, parseHistory(JSON.stringify([old]))[0], data.scoreVersion).state).toBe("rules_changed");
  });
});
