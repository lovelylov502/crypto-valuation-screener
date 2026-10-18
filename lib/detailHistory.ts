import type { FundamentalDay, HistorySource, MarketDay, ValuationDay } from "./dailyHistory";
import type { RevenueWindowDays } from "./revenueHistory";
import type { CapitalBasis } from "./valuationMetrics";

export const DETAIL_RANGES = ["7D", "1M", "3M", "YTD", "1Y", "MAX"] as const;
export type DetailRange = typeof DETAIL_RANGES[number];
export const HISTORY_PAGE_LIMIT = 1000;
export const HISTORY_MAX_PAGES = 32;
const DAY = 86_400_000;
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && date(Date.parse(value)) === value;

export interface DetailHistoryPoint extends MarketDay {
  valuation: ValuationDay | null;
  valuationState: string;
}
export interface DetailHistoryData {
  schema: number;
  calculationVersion: string;
  asset: Record<string, unknown>;
  days: RevenueWindowDays;
  convention: string;
  points: DetailHistoryPoint[];
  fundamentals: FundamentalDay[];
  sources: HistorySource[];
  nextCursor: string | null;
}

/** Chart range controls dates only; `days` remains the independent revenue denominator. */
export function detailHistoryBounds(range: DetailRange, now = new Date()) {
  const to = date(now.getTime()), today = Date.parse(to);
  const length = range === "7D" ? 7 : range === "1M" ? 30 : range === "3M" ? 90 : 365;
  const from = range === "MAX" ? "2000-01-01" : range === "YTD" ? `${to.slice(0, 4)}-01-01` : date(today - (length - 1) * DAY);
  return { from, to };
}

export function detailHistoryUrl(slug: string, range: DetailRange, days: RevenueWindowDays, now: Date, after?: string) {
  const { from, to } = detailHistoryBounds(range, now);
  const params = new URLSearchParams({ slug, days: String(days), range: range === "YTD" ? "ytd" : "all", from, to, limit: String(HISTORY_PAGE_LIMIT) });
  if (after) params.set("after", after);
  return `/api/history?${params}`;
}

export class DetailHistoryError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Follow every advancing cursor, including MAX; refuse silently truncated or mismatched data. */
export async function loadDetailHistory(options: {
  slug: string; identity: string; range: DetailRange; days: RevenueWindowDays; signal: AbortSignal;
  now?: Date; fetcher?: typeof fetch; onPage?: (count: number) => void;
}): Promise<DetailHistoryData> {
  const { slug, identity, range, days, signal, now = new Date(), fetcher = fetch, onPage } = options;
  const bounds = detailHistoryBounds(range, now);
  let data: DetailHistoryData | null = null, after: string | undefined;
  const points = new Map<string, DetailHistoryPoint>(), flows = new Map<string, FundamentalDay>(), sources = new Map<string, HistorySource>();
  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    signal.throwIfAborted();
    const response = await fetcher(detailHistoryUrl(slug, range, days, now, after), { signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new DetailHistoryError(response.status, response.status === 404 ? "저장된 종목 이력이 없습니다." : "이력을 불러오지 못했습니다.");
    const result = await response.json() as DetailHistoryData;
    if (!result.asset || result.asset.slug !== slug || result.asset.identity !== identity)
      throw new DetailHistoryError(409, "현재 토큰과 이력의 연결을 갱신 중입니다.");
    if (result.schema !== 1 || result.days !== days || !Array.isArray(result.points) || !Array.isArray(result.fundamentals)
      || !Array.isArray(result.sources) || result.points.length > HISTORY_PAGE_LIMIT
      || result.points.some((point, index) => !validDate(point.day) || point.day < bounds.from || point.day > bounds.to
        || !!after && point.day <= after || index > 0 && point.day <= result.points[index - 1].day)
      || result.nextCursor !== null && !validDate(result.nextCursor)) throw new DetailHistoryError(502, "이력 응답을 확인할 수 없습니다.");
    data ??= result;
    if (result.calculationVersion !== data.calculationVersion || result.asset.snapshotId !== data.asset.snapshotId)
      throw new DetailHistoryError(502, "이력 기준이 갱신되었습니다. 다시 불러와 주세요.");
    for (const point of result.points) points.set(point.day, point);
    for (const point of result.fundamentals) flows.set(point.day, point);
    for (const source of result.sources) sources.set(source.id, source);
    onPage?.(points.size);
    if (result.nextCursor === null) {
      signal.throwIfAborted();
      return { ...data, points: [...points.values()].sort((a, b) => a.day.localeCompare(b.day)),
        fundamentals: [...flows.values()].sort((a, b) => a.day.localeCompare(b.day)), sources: [...sources.values()], nextCursor: null };
    }
    if (!result.points.length || result.nextCursor !== result.points.at(-1)!.day || after && result.nextCursor <= after)
      throw new DetailHistoryError(502, "이력 페이지를 이어서 불러올 수 없습니다.");
    after = result.nextCursor;
  }
  throw new DetailHistoryError(502, "조회할 이력이 많아 한 번에 불러오지 못했습니다.");
}

export interface DetailChartPoint {
  day: string; time: number; price: number | null; mcap: number | null; fdv: number | null; pr: number | null; phr: number | null;
}
export type DetailSeriesKey = "price" | "mcap" | "fdv" | "pr" | "phr";
const value = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;

/** Only project stored observations and stored multiples. Never infer FDV or calculate a missing ratio. */
export function detailChartPoints(points: DetailHistoryPoint[], capital: CapitalBasis, updating = false): DetailChartPoint[] {
  return points.map(point => {
    const valuation = !updating && point.valuationState === "ready" ? point.valuation : null;
    return { day: point.day, time: Date.parse(point.day), price: value(point.price), mcap: value(point.mcap), fdv: value(point.fdv),
      pr: value(valuation?.[capital === "fdv" ? "prFdv" : "prMcap"]), phr: value(valuation?.[capital === "fdv" ? "phrFdv" : "phrMcap"]) };
  });
}

/** A missing UTC date or null observation breaks the line instead of bridging the gap. */
export function detailSeriesSegments(points: DetailChartPoint[], key: DetailSeriesKey): DetailChartPoint[][] {
  const segments: DetailChartPoint[][] = [];
  let segment: DetailChartPoint[] = [];
  for (const point of points) {
    if (point[key] === null || segment.length && point.time - segment.at(-1)!.time !== DAY) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (point[key] !== null) segment.push(point);
  }
  if (segment.length) segments.push(segment);
  return segments;
}

export function detailChartDomain(range: DetailRange, points: DetailChartPoint[], now: Date): [number, number] {
  const bounds = detailHistoryBounds(range, now);
  const start = range === "MAX" && points.length ? points[0].time : Date.parse(bounds.from);
  const end = range === "MAX" && points.length ? points.at(-1)!.time : Date.parse(bounds.to);
  return start === end ? [start - DAY / 2, end + DAY / 2] : [start, end];
}

export function detailHistoryReason(reason: string | null | undefined): string {
  return reason === "incomplete_window" ? "완료된 수익 기간 부족" : reason === "source_conflict" ? "원천 자료 충돌"
    : reason === "scope_changed" ? "집계 범위 변경" : reason === "nonpositive_denominator" ? "원천 금액 0 이하"
      : reason === "unverified_token" ? "토큰 연결 확인 필요" : "해당 날짜의 배수 미확인";
}
