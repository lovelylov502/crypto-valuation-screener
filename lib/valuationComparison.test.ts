import { describe, expect, it } from "vitest";
import { comparisonEnvelopeValid, comparisonGeometry, comparisonReading, type ValuationComparisonMetric, type ValuationComparisonPage } from "./valuationComparison";

const now = Date.parse("2026-10-20T12:00:00Z");
const ready: ValuationComparisonMetric = { status: "ready", validDays: 365, latest: { date: "2026-10-19", value: 5 }, minimum: 3, median: 15, maximum: 30 };
const page = (): ValuationComparisonPage => ({ schema: 1, capital: "fdv", revenueDays: 1, asOf: "2026-10-19", baseline: { from: "2025-10-19", to: "2026-10-18", expectedDays: 365 }, rows: { sample: { pr: ready, phr: { status: "unavailable", validDays: 300, reason: "non_positive_revenue" } } } });
const read = (value: unknown, metric: "pr" | "phr" = "pr") => comparisonReading(value, "fdv", "sample", metric, now);
const withMetric = (metric: unknown) => ({ ...page(), rows: { sample: { ...page().rows.sample, pr: metric } } });

describe("daily valuation comparison boundary", () => {
  it("accepts a completed date and its preceding 365-day baseline independently for each metric", () => {
    expect(comparisonEnvelopeValid(page(), "fdv", now)).toBe(true);
    expect(read(page())).toEqual(ready);
    expect(read(page(), "phr")).toEqual({ status: "unavailable", validDays: 300, reason: "non_positive_revenue" });
  });
  it("distinguishes an unconnected API, missing rows, short coverage and zero revenue", () => {
    expect(read(undefined)).toEqual({ status: "unconnected" });
    expect(read({ ...page(), rows: {} })).toEqual({ status: "invalid" });
    expect(read(withMetric({ status: "insufficient", validDays: 22 }))).toEqual({ status: "insufficient", validDays: 22 });
    expect(read(withMetric({ status: "unavailable", validDays: 0, reason: "not_collected" }))).toEqual({ status: "unavailable", validDays: 0, reason: "not_collected" });
    expect(read(withMetric({ status: "unavailable", validDays: 0, reason: "not_prepared" }))).toEqual({ status: "unavailable", validDays: 0, reason: "not_prepared" });
    expect(read(withMetric({ ...ready, latest: { date: page().asOf, value: 0 } }))).toEqual({ status: "invalid" });
  });
  it("rejects a different capital basis or revenue window instead of relabeling it", () => {
    expect(comparisonReading(page(), "mcap", "sample", "pr", now)).toEqual({ status: "invalid" });
    expect(read({ ...page(), revenueDays: 30 })).toEqual({ status: "invalid" });
    expect(read({ ...page(), schema: 2 })).toEqual({ status: "invalid" });
  });
  it("excludes the current point from the baseline and rejects incomplete or mismatched UTC dates", () => {
    expect(read({ ...page(), baseline: { ...page().baseline, to: page().asOf } })).toEqual({ status: "invalid" });
    expect(read({ ...page(), baseline: { ...page().baseline, from: "2025-10-20" } })).toEqual({ status: "invalid" });
    expect(read({ ...page(), asOf: "2026-10-20" })).toEqual({ status: "invalid" });
    expect(read({ ...page(), asOf: "2026-02-30" })).toEqual({ status: "invalid" });
    expect(read(withMetric({ ...ready, latest: { date: "2026-10-18", value: 5 } }))).toEqual({ status: "invalid" });
  });
  it("rejects corrupt coverage, ranges and amounts rather than drawing a misleading signal", () => {
    for (const metric of [
      { ...ready, validDays: 366 }, { ...ready, validDays: 0 }, { ...ready, validDays: 22.5 },
      { ...ready, validDays: 364 },
      { ...ready, minimum: 16 }, { ...ready, maximum: 14 }, { ...ready, median: NaN },
      { ...ready, minimum: -1 }, { ...ready, maximum: Infinity },
      { ...ready, latest: { date: page().asOf, value: "5" } },
      { status: "unavailable", validDays: 0, reason: "unknown" },
    ]) expect(read(withMetric(metric))).toEqual({ status: "invalid" });
  });
  it("rejects forged ready values older than one completed UTC day while accepting explicit stale_data", () => {
    const later = Date.parse("2026-10-22T12:00:00Z");
    expect(comparisonReading(page(), "fdv", "sample", "pr", later)).toEqual({ status: "invalid" });
    expect(comparisonReading(withMetric({ status: "unavailable", validDays: 365, reason: "stale_data" }), "fdv", "sample", "pr", later)).toEqual({ status: "unavailable", validDays: 365, reason: "stale_data" });
  });
});

describe("median-anchored comparison rail", () => {
  it("joins a below-median segment to the same median coordinate without a gap", () => {
    const g = comparisonGeometry(0.1, 0.9, 2.4, 0.27);
    expect(g.tone).toBe("below");
    expect(g.left).toBe(g.currentPosition);
    expect(g.left + g.width).toBeCloseTo(g.medianPosition, 12);
    expect(g.medianPosition).toBeCloseTo(34.7826087);
  });
  it("starts an above-median segment at the median rather than at the minimum", () => {
    const g = comparisonGeometry(0.4, 1, 1.8, 1.2);
    expect(g.tone).toBe("above");
    expect(g.left).toBe(g.medianPosition);
    expect(g.left + g.width).toBeCloseTo(g.currentPosition, 12);
  });
  it("retains a small real deviation without exaggerating it or adding a dot", () => {
    const g = comparisonGeometry(0.6, 1.5, 2.8, 1.47);
    expect(g.width).toBeCloseTo(1.36363636);
    expect(g.left + g.width).toBeCloseTo(g.medianPosition, 12);
    expect(comparisonGeometry(0.6, 1.5, 2.8, 1.5)).toMatchObject({ width: 0, tone: "equal" });
  });
  it("caps out-of-range observations and reports them explicitly", () => {
    expect(comparisonGeometry(3, 15, 30, 2)).toMatchObject({ currentPosition: 0, outside: "below", tone: "below" });
    expect(comparisonGeometry(3, 15, 30, 40)).toMatchObject({ currentPosition: 100, outside: "above", tone: "above" });
    expect(comparisonGeometry(5, 5, 5, 5)).toMatchObject({ medianPosition: 50, currentPosition: 50, width: 0, tone: "equal", outside: null });
    expect(comparisonGeometry(5, 5, 5, 4)).toMatchObject({ medianPosition: 50, currentPosition: 0, left: 0, width: 50, outside: "below" });
  });
});
