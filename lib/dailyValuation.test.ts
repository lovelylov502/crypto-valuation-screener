import { expect, it } from "vitest";
import { DAILY_RAW_METRICS, type DailyRawMetric, type DailyRawSource, type DailyRawStoredPoint } from "./dailyRawData";
import { calculateDailyValuation, dailyComparisonMetric, dailyFinancialDefinition, dailyValuationAsOf, shiftValuationDay } from "./dailyValuation";

const asOf = "2026-10-18", observedAt = "2026-10-20T00:00:00Z";
const source = (metric: DailyRawMetric, changes: Partial<DailyRawSource> = {}): DailyRawSource => ({ key: metric, metric, provider: ["fdv", "mcap", "price"].includes(metric) ? "CoinGecko" : "DefiLlama", scope: "exact-alpha", definition: `${metric} USD`, basis: ["fdv", "mcap", "price"].includes(metric) ? "utc_day_close" : "completed_utc_day_flow;provider_reconstructed;original_dated_observations", url: `https://example.test/${metric}`, observedAt, sha256: "a".repeat(64), archiveUrl: "https://example.test/archive", ...changes });
const sources = new Map(DAILY_RAW_METRICS.map(metric => [metric, source(metric)]));
function point(day = asOf, cap = 36_500, revenue = 100): DailyRawStoredPoint {
  return { day, ...Object.fromEntries(DAILY_RAW_METRICS.map(metric => [metric, { value: metric === "revenue" ? revenue : metric === "holders" ? revenue * 2 : cap, state: "positive", source: metric, at: ["fdv", "mcap", "price"].includes(metric) ? `${shiftValuationDay(day, 1)}T00:00:00Z` : null }])) } as DailyRawStoredPoint;
}
const calculate = (value: DailyRawStoredPoint, overrides: Partial<Parameters<typeof calculateDailyValuation>[0]> = {}) => calculateDailyValuation({ point: value, sources, capital: "fdv", eligible: true, completedThrough: asOf, ...overrides });
function year() { return Array.from({ length: 366 }, (_, index) => calculate(point(shiftValuationDay(asOf, index - 365), (index + 1) * 365, 1))); }

it("uses same-date capital and one-day Revenue/Holders Revenue, ignoring Fees", () => {
  const raw = point(); raw.fees.value = 9_999_999;
  expect(calculate(raw)).toMatchObject({ pr: { value: 1, reason: null }, phr: { value: 0.5, reason: null }, revenue: { value: 100, at: null, reason: null } });
  expect(calculate(raw, { capital: "mcap" }).pr.value).toBe(1);
  const aave = point("2024-03-05", 1_687_920_736.48512, 184_635);
  expect(calculate(aave).pr.value).toBe(25.046390846436676);
  expect(calculate(aave).fdv.at).toBe("2024-03-06T00:00:00Z");
});

it.each(["missing", "partial", "conflict", "zero", "negative"] as const)("preserves %s financial cells without creating a ratio", state => {
  const raw = point(); raw.revenue = { ...raw.revenue, state, value: state === "missing" || state === "conflict" ? null : state === "zero" ? 0 : -1 };
  const calculated = calculate(raw);
  expect(calculated.pr.value).toBeNull(); expect(calculated.revenue).toMatchObject(raw.revenue);
  expect(calculated.phr.value).toBe(0.5);
});

it("holds ineligible/current-day capital and never substitutes market cap for missing FDV", () => {
  const raw = point(); raw.fdv = { ...raw.fdv, value: null, state: "missing" };
  expect(calculate(raw).pr).toMatchObject({ value: null, reason: "missing_capital" });
  expect(calculate(raw, { capital: "mcap" }).pr.value).toBe(1);
  expect(calculate(point(), { eligible: false }).pr.reason).toBe("ineligible_asset");
  expect(calculate(point("2026-10-19")).pr.reason).toBe("incomplete_day");
});

it("requires actual market timestamps, permits dated flows without time, and keeps confirmed market zero", () => {
  const raw = point(); raw.fdv.at = null;
  expect(calculate(raw).pr.reason).toBe("invalid_timestamp"); expect(calculate(raw).fdv.reason).toBe("invalid_timestamp");
  raw.fdv = { ...raw.mcap, source: "fdv", value: 0, state: "zero" };
  expect(calculate(raw).fdv).toMatchObject({ value: 0, state: "zero", reason: null });
  expect(calculate(raw).pr.reason).toBe("non_positive_capital");
});

it("rejects unverified timestamps, foreign metric references, and undated/period financial definitions", () => {
  const unverified = new Map(sources); unverified.set("fdv", source("fdv", { basis: "timestamp_semantics_unverified" }));
  expect(calculate(point(), { sources: unverified }).pr.reason).toBe("invalid_definition");
  unverified.set("fdv", source("mcap", { key: "fdv" })); expect(calculate(point(), { sources: unverified }).pr.reason).toBe("invalid_definition");
  unverified.set("fdv", source("fdv")); unverified.set("revenue", source("revenue", { basis: "trailing_30_days" }));
  expect(calculate(point(), { sources: unverified }).pr.reason).toBe("invalid_definition");
  expect(calculate(point(), { sources: unverified }).revenue.reason).toBe("invalid_definition");
  const raw = point(); raw.fdv.at = "2026-10-20T00:00:00Z";
  expect(calculate(raw).pr.reason).toBe("invalid_timestamp");
});

it("avoids intermediate annualization overflow and excludes nonfinite final ratios", () => {
  expect(calculate(point(asOf, 1e308, 1e308)).pr.value).toBe(1 / 365);
  expect(calculate(point(asOf, 1e308, Number.MIN_VALUE)).pr).toMatchObject({ value: null, reason: "invalid_ratio" });
});

it("derives asOf from captured UTC day minus one, bounds future capture, and permits only one completed-day lag", () => {
  const snapshot = { updatedAt: "2026-10-19T22:38:30.660Z" };
  expect(dailyValuationAsOf(snapshot, new Date("2026-10-20T12:00:00Z"))).toMatchObject({ asOf, baseline: { from: "2025-10-18", to: "2026-10-17", expectedDays: 365 }, freshness: { lagDays: 1, status: "current", reason: null } });
  expect(dailyValuationAsOf(snapshot, new Date("2026-10-21T00:00:00Z")).freshness).toEqual({ lagDays: 2, status: "stale", reason: "stale_data" });
  expect(dailyValuationAsOf({ updatedAt: "2026-10-25T00:00:00Z" }, new Date("2026-10-20T00:00:00Z")).asOf).toBe("2026-10-19");
});

it("takes min/median/max of all 365 distinct prior daily ratios, excluding the current point", () => {
  const values = year(); values.at(-1)!.pr.value = 99_999;
  expect(dailyComparisonMetric([...values, values[0]], "pr", asOf, false)).toEqual({ status: "ready", validDays: 365, latest: { date: asOf, value: 99_999 }, minimum: 1, median: 183, maximum: 365 });
  expect(dailyComparisonMetric(values.slice(1), "pr", asOf, false)).toEqual({ status: "insufficient", validDays: 364, latest: { date: asOf, value: 99_999 } });
  expect(dailyComparisonMetric(values.slice(0, -1), "pr", asOf, false)).toEqual({ status: "unavailable", validDays: 365, reason: "not_collected" });
  expect(dailyComparisonMetric(values, "pr", asOf, true)).toEqual({ status: "unavailable", validDays: 365, reason: "stale_data" });
});

it("retains a valid same-day latest ratio with no prior year but never substitutes an older, zero or missing latest value", () => {
  const latest = calculate(point(asOf, 36500, 100));
  expect(dailyComparisonMetric([latest], "pr", asOf, false)).toEqual({ status: "insufficient", validDays: 0, latest: { date: asOf, value: 1 } });
  expect(dailyComparisonMetric([calculate(point(shiftValuationDay(asOf, -1)))], "pr", asOf, false)).toEqual({ status: "unavailable", validDays: 1, reason: "not_collected" });
  const zero = point(asOf); zero.revenue = { ...zero.revenue, value: 0, state: "zero" };
  expect(dailyComparisonMetric([calculate(zero)], "pr", asOf, false)).toEqual({ status: "unavailable", validDays: 0, reason: "non_positive_revenue" });
  const missing = point(asOf); missing.fdv = { ...missing.fdv, value: null, state: "missing" };
  expect(dailyComparisonMetric([calculate(missing)], "pr", asOf, false)).toEqual({ status: "unavailable", validDays: 0, reason: "missing_capital" });
  expect(dailyComparisonMetric([latest], "pr", asOf, true)).toEqual({ status: "unavailable", validDays: 0, reason: "stale_data" });
});

it.each(["scope", "definition", "basis", "provider"] as const)("rejects a mixed financial %s while retaining dated historical values", field => {
  const values = year(), different = new Map(sources), previous = source("revenue");
  different.set("revenue", { ...previous, [field]: `${previous[field]};changed` });
  values[100] = calculate(point(values[100].day, 365, 1), { sources: different });
  expect(values[100].pr.value).toBe(1);
  expect(dailyComparisonMetric(values, "pr", asOf, false)).toEqual({ status: "unavailable", validDays: 364, reason: "definition_changed" });
});

it("keeps financial meaning stable across receipts and approved capital provider/basis changes", () => {
  expect(dailyFinancialDefinition(source("revenue"))).toBe(dailyFinancialDefinition(source("revenue", { url: "https://other.test/summary", sha256: "b".repeat(64), observedAt: "2026-10-20T12:00:00Z" })));
  const alternate = new Map(sources); alternate.set("fdv", source("fdv", { provider: "CoinMetrics", basis: "utc_daily_close_verified_total_supply", definition: "reviewed fully-issued total supply" }));
  const values = year(); values[100] = calculate(point(values[100].day, 101 * 365, 1), { sources: alternate });
  expect(dailyComparisonMetric(values, "pr", asOf, false).status).toBe("ready");
});
