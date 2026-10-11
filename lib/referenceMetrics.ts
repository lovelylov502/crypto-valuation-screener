import type { CoinRaw } from "./types";
import { eligibleCapital } from "./capitalEligibility";
import { annualizedMultiple, REVENUE_WINDOWS, type RevenueWindowDays } from "./revenueHistory";
import { revenueReading } from "./revenueReading";
import { holderHistoryMatches, type CapitalBasis } from "./valuationMetrics";
import { hasDataQualityConflict } from "./dataQuality";
import { metricDecisionIssue, revenueLabel } from "./fundamentals";

export type ReferenceMetric = "revenue" | "holders";
const HOLDER_SOURCE = "https://api.llama.fi/overview/fees?dataType=dailyHoldersRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true";
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** One source reading supplies the displayed amount and the reference denominator. */
export function referenceReading(c: CoinRaw, metric: ReferenceMetric, days: RevenueWindowDays) {
  if (metric === "revenue") return revenueReading(c, days);
  const history = c.holderHistory, period = history?.periods[days];
  // Stored holder history covers the reviewed subset. Use it as the full source only when every component is included.
  const dated = c.holderValue.components.every(p => p.eligible) && holderHistoryMatches(c)
    && !hasDataQualityConflict(c, "holders") && period?.reportedDays === days && finite(period.total);
  const raw = days === 30 ? c.holderValue.rawCurrent30d : days === 365 ? c.holderValue.rawTtm : null;
  const amount = dated ? period!.total : finite(raw) ? raw : null;
  const basis = dated ? "completed_utc" : amount !== null ? "provider_total" : "missing";
  return { amount, basis, basisLabel: dated ? `${period!.end} UTC까지` : amount !== null
    ? days === 365 ? "원천 1년 집계 · 365일 미확인" : "제공처 기간 집계" : "기간 자료 미확보",
    kindLabel: "Holders Revenue 원천", source: history?.source ?? HOLDER_SOURCE,
    observedAt: history?.observedAt ?? c.freshness?.holders.observedAt ?? null,
    start: dated ? period!.start : null, end: dated ? period!.end : null };
}

/** Classification review never blocks arithmetic on a complete provider amount. */
export function referenceMultiple(c: CoinRaw, metric: ReferenceMetric, days: RevenueWindowDays = 30, basis: CapitalBasis = "mcap"): number | null {
  if (!eligibleCapital(c)) return null;
  const reading = referenceReading(c, metric, days);
  if (reading.basis === "provider_partial") return null;
  const value = annualizedMultiple(c[basis], reading.amount, days);
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

export function referenceReason(c: CoinRaw, metric: ReferenceMetric, days: RevenueWindowDays, basis: CapitalBasis = "mcap"): string {
  if (c.capitalExclusionReason) return "스테이블코인 · 배수 비적용";
  if (!eligibleCapital(c)) return "토큰 연결 확인 필요";
  if (!finite(c[basis]) || c[basis]! <= 0) return basis === "fdv" ? "FDV 미확인" : "유통 시총 미확인";
  const reading = referenceReading(c, metric, days);
  if (reading.basis === "provider_partial") return "일부 구성요소 집계 · 전체 배수 미산출";
  if (!finite(reading.amount)) return "기간별 원천 금액 없음";
  if (reading.amount <= 0) return "원천 금액 0 이하";
  if (referenceMultiple(c, metric, days, basis) === null) return "유한한 배수 산출 불가";
  return `원천 참고 배수 · ${reading.basisLabel} · ${days === 365 ? "원천 1년 금액" : `${days}일 연환산`}`;
}

export function referenceReview(c: CoinRaw, metric: ReferenceMetric): string {
  const issue = metricDecisionIssue(c, metric === "revenue" ? "Revenue" : "HoldersRevenue");
  if (issue) return issue;
  const parts = metric === "revenue" ? c.fundamentals.revenue.components : c.fundamentals.holders;
  if (!parts.length) return "분류 검토 자료 없음";
  if (parts.some(p => p.kind === "unknown" || p.kind === "mixed" || p.status !== "matched")) return "분류 확인 필요";
  return "분류 검토 완료";
}

export function referenceClassification(c: CoinRaw): string {
  return revenueLabel(c);
}

/** Request-time values are separate from the immutable reviewed scoring snapshot. */
export function referenceMultiples(c: CoinRaw, capital: CapitalBasis) {
  const values = (metric: ReferenceMetric) => Object.fromEntries(REVENUE_WINDOWS.map(days => [days, referenceMultiple(c, metric, days, capital)]));
  return { capital, revenue: values("revenue"), holders: values("holders") };
}
