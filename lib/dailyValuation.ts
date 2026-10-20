import { DAILY_RAW_METRICS, dailyRawHash, type DailyRawMetric, type DailyRawSource, type DailyRawStoredObservation, type DailyRawStoredPoint } from "./dailyRawData";
import type { CapitalBasis } from "./valuationMetrics";
import type { ComparisonUnavailableReason, ValuationComparisonMetric } from "./valuationComparison";

export const DAILY_VALUATION_VERSION = "daily-raw-same-day-v1";
const DAY = 86_400_000;
export const valuationDay = (time: number) => new Date(time).toISOString().slice(0, 10);
export const shiftValuationDay = (day: string, offset: number) => valuationDay(Date.parse(day) + offset * DAY);
export type DailyValuationReason = "ineligible_asset" | "incomplete_day" | "missing_capital" | "partial_capital" | "conflicting_capital" | "non_positive_capital" | "missing_revenue" | "partial_revenue" | "conflicting_revenue" | "non_positive_revenue" | "invalid_definition" | "invalid_timestamp" | "invalid_ratio";
export interface DailyValuationRatio { value: number | null; reason: DailyValuationReason | null; financialDefinition: string | null }
export interface DailyValuationCell extends DailyRawStoredObservation { reason: DailyValuationReason | null }
export type DailyValuationHistoryPoint = { day: string; pr: DailyValuationRatio; phr: DailyValuationRatio } & Record<DailyRawMetric, DailyValuationCell>;
export type DailyValuationDefinitions = Partial<Record<"revenue" | "holders", string>>;

/** The snapshot's captured UTC day determines the latest completed observation. */
export function dailyValuationAsOf(snapshot: { updatedAt: string }, now = new Date()) {
  const captured = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(captured) || !Number.isFinite(now.getTime())) throw Error("daily_valuation_invalid_snapshot_date");
  const yesterday = shiftValuationDay(valuationDay(now.getTime()), -1);
  const asOf = [shiftValuationDay(valuationDay(captured), -1), yesterday].sort()[0];
  const lagDays = Math.round((Date.parse(yesterday) - Date.parse(asOf)) / DAY);
  return { asOf, baseline: { from: shiftValuationDay(asOf, -365), to: shiftValuationDay(asOf, -1), expectedDays: 365 as const }, freshness: { lagDays, status: lagDays > 1 ? "stale" as const : "current" as const, reason: lagDays > 1 ? "stale_data" as const : null } };
}

/** Receipt URL/hash/time can change while the reported daily financial meaning stays the same. */
export function dailyFinancialDefinition(source: DailyRawSource | undefined): string | null {
  if (!source || !["revenue", "holders"].includes(source.metric) || !source.provider || !source.scope || !source.definition || !source.basis.startsWith("completed_utc_day_flow")) return null;
  return dailyRawHash([source.provider, source.scope, source.definition, source.basis]);
}

function stateReason(cell: DailyRawStoredObservation, capital: boolean): DailyValuationReason | null {
  if (cell.state === "missing") return capital ? "missing_capital" : "missing_revenue";
  if (cell.state === "partial") return capital ? "partial_capital" : "partial_revenue";
  if (cell.state === "conflict") return capital ? "conflicting_capital" : "conflicting_revenue";
  if (cell.state !== "positive" || cell.value === null || !Number.isFinite(cell.value) || cell.value <= 0) return capital ? "non_positive_capital" : "non_positive_revenue";
  return null;
}
function timestampValid(day: string, cell: DailyRawStoredObservation, source: DailyRawSource, capital: boolean) {
  if (!cell.at) return !capital;
  const at = Date.parse(cell.at), start = Date.parse(day), observed = Date.parse(source.observedAt);
  return Number.isFinite(at) && Number.isFinite(observed) && at >= start && at <= observed && at <= start + DAY
    && (at !== start + DAY || source.basis.includes("utc_day_close") || source.basis.includes("utc_daily_close"));
}

/** All charts and comparison summaries use this same daily calculation. */
export function calculateDailyValuation(options: {
  point: DailyRawStoredPoint; sources: ReadonlyMap<string, DailyRawSource>; capital: CapitalBasis; eligible: boolean;
  completedThrough: string; definitions?: DailyValuationDefinitions;
}): DailyValuationHistoryPoint {
  const { point, sources, capital, eligible, completedThrough, definitions } = options;
  const calculate = (metric: "revenue" | "holders"): DailyValuationRatio => {
    const capitalCell = point[capital], flow = point[metric], capitalSource = sources.get(capitalCell.source), financialSource = sources.get(flow.source);
    const definition = dailyFinancialDefinition(financialSource), unavailable = (reason: DailyValuationReason): DailyValuationRatio => ({ value: null, reason, financialDefinition: definition });
    if (!eligible) return unavailable("ineligible_asset");
    if (point.day > completedThrough) return unavailable("incomplete_day");
    const capitalReason = stateReason(capitalCell, true); if (capitalReason) return unavailable(capitalReason);
    const revenueReason = stateReason(flow, false); if (revenueReason) return unavailable(revenueReason);
    if (!capitalSource || capitalSource.metric !== capital || !financialSource || financialSource.metric !== metric || !definition || capitalSource.basis.includes("timestamp_semantics_unverified") || capitalSource.basis.includes('"verified":false') || definitions?.[metric] && definitions[metric] !== definition) return unavailable("invalid_definition");
    if (!timestampValid(point.day, capitalCell, capitalSource, true) || !timestampValid(point.day, flow, financialSource, false)) return unavailable("invalid_timestamp");
    const value = capitalCell.value! / flow.value! / 365;
    return Number.isFinite(value) && value > 0 ? { value, reason: null, financialDefinition: definition } : unavailable("invalid_ratio");
  };
  const cells = Object.fromEntries(DAILY_RAW_METRICS.map(metric => {
    const stored = point[metric], source = sources.get(stored.source), market = ["price", "mcap", "fdv"].includes(metric);
    let reason = point.day > completedThrough ? "incomplete_day" as const : market && stored.state === "zero" ? null : stateReason(stored, market);
    if (!reason && (!source || source.metric !== metric || !market && !source.basis.startsWith("completed_utc_day_flow") || market && (source.basis.includes("timestamp_semantics_unverified") || source.basis.includes('"verified":false')))) reason = "invalid_definition";
    if (!reason && source && !timestampValid(point.day, stored, source, market)) reason = "invalid_timestamp";
    return [metric, { ...stored, reason }];
  })) as Record<DailyRawMetric, DailyValuationCell>;
  return { day: point.day, ...cells, pr: calculate("revenue"), phr: calculate("holders") };
}

export function dailyComparisonMetric(points: DailyValuationHistoryPoint[], metric: "pr" | "phr", asOf: string, stale: boolean): ValuationComparisonMetric {
  const byDay = new Map(points.map(point => [point.day, point])), latest = byDay.get(asOf)?.[metric];
  const from = shiftValuationDay(asOf, -365), baseline = [...byDay.values()].filter(point => point.day >= from && point.day < asOf);
  const valid = baseline.map(point => point[metric]).filter(ratio => ratio.value !== null && ratio.reason === null);
  const definitions = new Set(valid.map(ratio => ratio.financialDefinition));
  if (latest?.financialDefinition) definitions.add(latest.financialDefinition);
  const validDays = definitions.size > 1 ? valid.filter(ratio => ratio.financialDefinition === latest?.financialDefinition).length : valid.length;
  const unavailable = (reason: ComparisonUnavailableReason): ValuationComparisonMetric => ({ status: "unavailable", validDays, reason });
  if (stale) return unavailable("stale_data");
  if (definitions.size > 1 || baseline.some(point => point[metric].reason === "invalid_definition")) return unavailable("definition_changed");
  if (!latest) return unavailable("not_collected");
  if (latest.value === null) {
    const reason = latest.reason;
    return unavailable(reason === "invalid_definition" ? "definition_changed" : reason === "non_positive_revenue" ? reason
      : reason?.includes("capital") || reason === "ineligible_asset" ? "missing_capital" : "missing_revenue");
  }
  if (validDays !== 365) return { status: "insufficient", validDays, latest: { date: asOf, value: latest.value } };
  const values = valid.map(ratio => ratio.value!).sort((a, b) => a - b);
  return { status: "ready", validDays, latest: { date: asOf, value: latest.value }, minimum: values[0], median: values[182], maximum: values[364] };
}
