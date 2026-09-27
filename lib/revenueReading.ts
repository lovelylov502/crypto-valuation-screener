import type { CoinRaw } from "./types";
import { historyMatches, type RevenueWindowDays } from "./revenueHistory";
import { revenueLabel, sourceDefinitionsChanged } from "./fundamentals";

export const REVENUE_OVERVIEW_URL = "https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true";

/** Source display is independent of approval to calculate multiples or growth. */
export function revenueReading(c: CoinRaw, days: RevenueWindowDays) {
  const history = c.revenueHistory;
  const period = history?.periods[days];
  const dated = historyMatches(c) && period?.total != null;
  const raw = ({ 1: c.revenue24h, 7: c.revenue7d, 30: c.revenue30d, 90: null, 365: c.revenue1y })[days];
  const sourcePeriod = days === 90 ? undefined : c.revenueSource?.periods?.[days];
  const partial = !dated && raw == null && sourcePeriod?.total != null && sourcePeriod.reported < sourcePeriod.expected;
  const amount = dated ? period!.total : typeof raw === "number" && Number.isFinite(raw) ? raw : partial ? sourcePeriod!.total : null;
  const basis = dated ? "completed_utc" : partial ? "provider_partial" : amount !== null ? "provider_total" : "missing";
  const basisLabel = dated ? `${period!.end} UTC까지` : amount !== null
    ? partial ? `부분 집계 · ${sourcePeriod!.reported}/${sourcePeriod!.expected}개 구성요소` : days === 365 ? "원천 1년 집계 · 365일 미확인" : "제공처 기간 집계"
    : "기간 자료 미확보";
  const kindLabel = sourceDefinitionsChanged(c) ? "정의 변경 · 검토 필요" : revenueLabel(c);
  return { amount, basis, basisLabel, kindLabel,
    source: dated ? history!.source : c.revenueSource?.url ?? REVENUE_OVERVIEW_URL,
    observedAt: dated ? history!.observedAt : c.revenueSource?.observedAt ?? null,
    start: dated ? period!.start : null, end: dated ? period!.end : null,
  };
}
