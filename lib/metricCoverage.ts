import type { CoinRaw } from "./types";
import { salesMultiple, protocolMultiple, holderMultiple, type CapitalBasis } from "./valuationMetrics";
import type { RevenueWindowDays } from "./revenueHistory";
import { SCREENER_COLUMNS, type SortKey } from "./screenerColumns";

export const METRIC_WINDOWS = [1, 7, 30, 90, 365] as const;
export type CoverageWindow = RevenueWindowDays | "any";
export type AvailableMetric = "all" | "any" | "sales" | "revenue" | "holder" | "review" | "missing";
export const AVAILABILITY_LABELS: Record<AvailableMetric, string> = { all: "전체", any: "배수 산출 가능", sales: "P/S", revenue: "P/R", holder: "P/HR", review: "원천 자료 있음 · 배수 보류", missing: "해당 기간 원천 자료 없음" };
export function windowLabel(window: CoverageWindow): string { return window === "any" ? "확보된 기간 중 하나" : window === 1 ? "24시간" : window === 365 ? "1년" : `${window}일`; }

export function metricAvailable(c: CoinRaw, metric: "sales" | "revenue" | "holder", basis: CapitalBasis, window: CoverageWindow): boolean {
  if (metric === "sales") return salesMultiple(c, basis) !== null;
  return (window === "any" ? METRIC_WINDOWS : [window]).some(days => (metric === "revenue" ? protocolMultiple(c, days, basis) : holderMultiple(c, days, basis)) !== null);
}
/** Source presence includes reported zero and negative values. It never asserts positive earnings. */
export function hasSourceData(c: CoinRaw, window: CoverageWindow): boolean {
  if (c.sales) return true;
  const windows = window === "any" ? METRIC_WINDOWS : [window];
  return windows.some(days => {
    const raw = ({1:c.revenue24h,7:c.revenue7d,30:c.revenue30d,90:c.revenue90d,365:c.revenue1y})[days];
    const holders = days === 30 ? c.holderValue.rawCurrent30d : days === 365 ? c.holderValue.rawTtm : null;
    return raw != null || holders != null || (c.revenueHistory?.periods[days]?.reportedDays ?? 0) > 0 || (c.holderHistory?.periods[days]?.reportedDays ?? 0) > 0;
  });
}
export function matchesAvailability(c: CoinRaw, metric: AvailableMetric, basis: CapitalBasis, window: CoverageWindow, includeSales = true): boolean {
  if (metric === "all") return true;
  const any = () => (includeSales ? ["sales","revenue","holder"] as const : ["revenue","holder"] as const).some(m => metricAvailable(c,m,basis,window));
  if (metric === "any") return any();
  if (metric === "review") return hasSourceData(c,window) && !any();
  if (metric === "missing") return !hasSourceData(c,window) && !any();
  return metricAvailable(c,metric,basis,window);
}
export function metricCoverage(coins: CoinRaw[], basis: CapitalBasis, window: CoverageWindow, includeSales = true) {
  const count = (metric: AvailableMetric) => coins.filter(c => matchesAvailability(c,metric,basis,window,includeSales)).length;
  return { total: coins.length, sales:count("sales"), revenue:count("revenue"), holder:count("holder"), unique:count("any"), review:count("review"), missing:count("missing"), source:coins.filter(c => hasSourceData(c,window)).length };
}

export const METRIC_COLUMN_DAYS: Partial<Record<SortKey, RevenueWindowDays>> = { pr24h:1, pr:30, pr7d:7, pr90d:90, pr1y:365, phr24h:1, phr:30, phr7d:7, phr90d:90, phr1y:365 };
/** Count only the periods visible in the table, across the current filtered result. */
export function visibleMetricCoverage(coins: CoinRaw[], basis: CapitalBasis, columns: SortKey[]) {
  const metrics = columns.flatMap(key => {
    const days = METRIC_COLUMN_DAYS[key];
    return days ? [{ key, days, metric: key.startsWith("phr") ? "holder" as const : "revenue" as const, label: SCREENER_COLUMNS.find(c=>c.key===key)!.label }] : [];
  });
  return {
    total: coins.length,
    unique: coins.filter(c => metrics.some(m => metricAvailable(c,m.metric,basis,m.days))).length,
    metrics: metrics.map(m => ({ key:m.key, label:m.label, count:coins.filter(c => metricAvailable(c,m.metric,basis,m.days)).length })),
  };
}
/** Every unmatched source remains reviewable, including zero-valued children of a parent. */
export function definitionReviewQueue(coins: CoinRaw[]) {
  return coins.flatMap(c => {
    const components = [...c.fundamentals.revenue.components,...c.fundamentals.fees.components,...c.fundamentals.holders];
    const pending = [...new Set(components.filter(p => p.status !== "matched" || p.kind === "unknown" || p.kind === "mixed").map(p => p.slug))];
    return pending.length || c.sales?.status === "expired" ? [{slug:c.slug,sourcePresent:hasSourceData(c,"any"),components:pending,expiredSales:c.sales?.status === "expired"}] : [];
  });
}
