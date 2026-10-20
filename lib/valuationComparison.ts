import type { CapitalBasis } from "./valuationMetrics";

/** Page-level read model; never persisted into the source screener snapshot. */
export interface ValuationComparisonPage {
  schema: 1;
  capital: CapitalBasis;
  revenueDays: 1;
  asOf: string;
  baseline: { from: string; to: string; expectedDays: 365 };
  rows: Record<string, { pr: ValuationComparisonMetric; phr: ValuationComparisonMetric }>;
}
export type ComparisonUnavailableReason = "not_collected" | "not_prepared" | "missing_capital" | "missing_revenue" | "non_positive_revenue" | "definition_changed" | "stale_data";
export type ValuationComparisonMetric =
  | { status: "ready"; validDays: number; latest: { date: string; value: number }; minimum: number; median: number; maximum: number }
  | { status: "insufficient"; validDays: number }
  | { status: "unavailable"; validDays: number; reason: ComparisonUnavailableReason };
export type ComparisonReading = ValuationComparisonMetric | { status: "unconnected" } | { status: "invalid" } | { status: "loading" };

const day = 86_400_000;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const reasons: ComparisonUnavailableReason[] = ["not_collected", "not_prepared", "missing_capital", "missing_revenue", "non_positive_revenue", "definition_changed", "stale_data"];

/** Reject a different numerator/window or stale per-row dates instead of mixing calculations. */
export function comparisonEnvelopeValid(value: unknown, capital: CapitalBasis, now = Date.now()): value is ValuationComparisonPage {
  if (!record(value) || value.schema !== 1 || value.capital !== capital || value.revenueDays !== 1 || !date(value.asOf)
    || Date.parse(value.asOf) >= Math.floor(now / day) * day || !record(value.baseline) || !record(value.rows)) return false;
  const b = value.baseline;
  return b.expectedDays === 365 && date(b.from) && date(b.to)
    && Date.parse(b.to) === Date.parse(value.asOf) - day && Date.parse(b.from) === Date.parse(value.asOf) - 365 * day;
}

export function comparisonReading(value: unknown, capital: CapitalBasis, slug: string, metric: "pr" | "phr", now = Date.now()): ComparisonReading {
  if (value === undefined || value === null) return { status: "unconnected" };
  if (!comparisonEnvelopeValid(value, capital, now)) return { status: "invalid" };
  const row: unknown = Object.hasOwn(value.rows, slug) ? value.rows[slug] : undefined;
  const m: unknown = record(row) ? row[metric] : undefined;
  if (!record(m) || !Number.isInteger(m.validDays) || (m.validDays as number) < 0 || (m.validDays as number) > 365) return { status: "invalid" };
  if (m.status === "insufficient") return { status: "insufficient", validDays: m.validDays as number };
  if (m.status === "unavailable" && reasons.includes(m.reason as ComparisonUnavailableReason)) return m as ValuationComparisonMetric;
  if (Math.floor(now / day) * day - day - Date.parse(value.asOf) > day) return { status: "invalid" };
  if (m.status !== "ready" || m.validDays !== 365 || !record(m.latest) || m.latest.date !== value.asOf || !positive(m.latest.value)
    || !positive(m.minimum) || !positive(m.median) || !positive(m.maximum) || m.minimum > m.median || m.median > m.maximum) return { status: "invalid" };
  return m as ValuationComparisonMetric;
}

/** Both ends use the same median coordinate, including equal and flat ranges. */
export function comparisonGeometry(minimum: number, median: number, maximum: number, current: number) {
  const position = (value: number) => maximum === minimum ? value < median ? 0 : value > median ? 100 : 50
    : Math.max(0, Math.min(100, (value - minimum) / (maximum - minimum) * 100));
  const medianPosition = position(median), currentPosition = position(current);
  return { medianPosition, currentPosition, left: Math.min(medianPosition, currentPosition), width: Math.abs(currentPosition - medianPosition),
    tone: current < median ? "below" : current > median ? "above" : "equal",
    outside: current < minimum ? "below" : current > maximum ? "above" : null };
}
