import type { CoinRaw } from "./types";
import { businessRevenue } from "./fundamentals";
import { historyMatches, revenueAmount, type RevenueWindowDays } from "./revenueHistory";
import { fmtPct } from "./format";

export function growthLabel(trend: ReturnType<typeof revenueTrend>) {
  if (trend.fromZero) return "0에서 발생";
  if (trend.percent !== null) return fmtPct(trend.percent);
  if (trend.current === 0 && trend.previous === 0) return "0 유지";
  if (trend.previous !== null && trend.previous < 0) return "증가액 확인";
  return "비교 미확보";
}

/** Compare adjacent equal windows, with identical components and observation basis. */
export function revenueTrend(c: CoinRaw, days: RevenueWindowDays) {
  const valid = businessRevenue(c) && historyMatches(c);
  const current = valid ? revenueAmount(c, days) : null;
  const previous = !valid ? null : c.revenueHistory
    ? (c.revenueHistory.previous?.[days] ?? (days === 30 ? c.revenueHistory.previous30 : undefined))?.total ?? null
    : days === 7 ? c.revenuePrev7d ?? null : days === 30 ? c.revenuePrev30d : null;
  const delta = current !== null && previous !== null ? current - previous : null;
  return { current, previous, delta,
    percent: delta !== null && previous !== null && previous > 0 ? delta / previous * 100 : null,
    fromZero: previous === 0 && current !== null && current > 0,
  };
}
