import { calculateDailyValuation, dailyFinancialDefinition, shiftValuationDay } from "./dailyValuation";
import type { DailyRawSource, DailyRawStoredPoint } from "./dailyRawData";
import type { CapitalBasis } from "./valuationMetrics";
import { MAP_PERIODS, type MapHistory, type MapPeriod } from "./discoveryTypes";

/** Zero daily revenue is valid in a complete window; absent, negative and partial days are not. */
export function completeRevenueWindow(points: ReadonlyMap<string, DailyRawStoredPoint>, end: string, sources: ReadonlyMap<string, DailyRawSource>) {
  let total = 0, definition: string | null = null;
  for (let i = 0; i < 30; i++) {
    const day = shiftValuationDay(end, -i), cell = points.get(day)?.revenue, source = cell && sources.get(cell.source);
    const currentDefinition = dailyFinancialDefinition(source);
    if (!cell || !["positive", "zero"].includes(cell.state) || cell.value === null || !Number.isFinite(cell.value) || cell.value < 0 || !source || !currentDefinition) return null;
    if (cell.at) {
      const at = Date.parse(cell.at), start = Date.parse(day);
      if (!Number.isFinite(at) || at < start || at > Date.parse(source.observedAt) || at > start + 86400000 || at === start + 86400000 && !/utc_day_close|utc_daily_close/.test(source.basis)) return null;
    }
    if (definition && definition !== currentDefinition) return null;
    definition = currentDefinition; total += cell.value;
  }
  return Number.isFinite(total) && total > 0 ? { total, definition } : null;
}

export function mapHistoricalPositions(options: { points: DailyRawStoredPoint[]; sources: DailyRawSource[]; asOf: string; capital: CapitalBasis; currentRevenue: number }) {
  const { asOf, capital, currentRevenue } = options;
  const points = new Map(options.points.map(p => [p.day, p])), sources = new Map(options.sources.map(s => [s.key, s]));
  const current = completeRevenueWindow(points, asOf, sources);
  return Object.fromEntries(MAP_PERIODS.map(days => {
    const date = shiftValuationDay(asOf, -days), raw = points.get(date), window = completeRevenueWindow(points, date, sources);
    const missing = (reason: string): [MapPeriod, MapHistory] => [days, { point: null, reason }];
    if (!current) return missing("현재 30일 원자료가 불완전해 과거와 연결하지 않습니다.");
    if (Math.abs(current.total - currentRevenue) > Math.max(1, currentRevenue) * 1e-8) return missing("공개본과 일별 원자료의 집계가 달라 연결을 보류합니다.");
    if (!raw || !window) return missing("당시의 연속 30일 수익 자료가 부족합니다.");
    if (window.definition !== current.definition) return missing("두 시점의 수익 집계 기준이 다릅니다.");
    const value = calculateDailyValuation({ point: raw, sources, capital, eligible: true, completedThrough: asOf })[capital];
    if (value.reason || value.value === null || value.value <= 0) return missing(`당시 ${capital === "fdv" ? "FDV를" : "유통 시총을"} 확인하지 못했습니다.`);
    const pr = value.value / (window.total * 365 / 30);
    return Number.isFinite(pr) && pr > 0 ? [days, { point: { date, pr, revenue: window.total }, reason: "" }] : missing("유효한 과거 배수를 계산하지 못했습니다.");
  })) as Record<MapPeriod, MapHistory>;
}
