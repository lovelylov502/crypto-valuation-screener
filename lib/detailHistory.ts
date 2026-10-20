import type { DailyValuationCell, DailyValuationHistory, DailyValuationHistoryPoint } from "./dailyValuationRead";
import type { DailyRawStoredObservation } from "./dailyRawData";
import type { CapitalBasis } from "./valuationMetrics";

export const DETAIL_RANGES = ["7D", "1M", "3M", "YTD", "1Y", "MAX"] as const;
export type DetailRange = typeof DETAIL_RANGES[number];
export const HISTORY_PAGE_LIMIT = 1000;
export const HISTORY_MAX_PAGES = 32;
const DAY = 86_400_000;
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && date(Date.parse(value)) === value;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const isDetailHistoryPoint = (point: unknown): point is DetailHistoryPoint => record(point)
  && ["price", "mcap", "fdv", "fees", "revenue", "holders"].every(metric => {
    const cell = point[metric];
    return record(cell) && ["missing", "positive", "zero", "negative", "partial", "conflict"].includes(String(cell.state)) && typeof cell.source === "string"
      && (cell.value === null || typeof cell.value === "number" && Number.isFinite(cell.value)) && (cell.at === null || typeof cell.at === "string" && Number.isFinite(Date.parse(cell.at))) && (cell.reason === null || typeof cell.reason === "string");
  }) && ["pr", "phr"].every(metric => {
    const ratio = point[metric];
    return record(ratio) && (ratio.value === null || typeof ratio.value === "number" && Number.isFinite(ratio.value) && ratio.value > 0) && (ratio.reason === null || typeof ratio.reason === "string")
      && (ratio.financialDefinition === null || typeof ratio.financialDefinition === "string") && (ratio.value === null || !!ratio.financialDefinition);
  });

export type DetailHistoryPoint = DailyValuationHistoryPoint;
export type DetailHistoryData = DailyValuationHistory;

/** Display ranges contain completed UTC dates. The daily denominator is fixed. */
export function detailHistoryBounds(range: DetailRange, now = new Date()) {
  const to = date(now.getTime() - DAY), lastCompleted = Date.parse(to);
  const length = range === "7D" ? 7 : range === "1M" ? 30 : range === "3M" ? 90 : 365;
  const from = range === "MAX" ? "1900-01-01" : range === "YTD" ? `${to.slice(0, 4)}-01-01` : date(lastCompleted - (length - 1) * DAY);
  return { from, to };
}

export function detailHistoryUrl(slug: string, identity: string, capital: CapitalBasis, range: DetailRange, now: Date, after?: string, expectedRevision?: string) {
  const { from, to } = detailHistoryBounds(range, now);
  const params = new URLSearchParams({ slug, expectedIdentity: identity, capital, from, to, limit: String(HISTORY_PAGE_LIMIT) });
  if (after) params.set("after", after);
  if (expectedRevision) params.set("expectedRevision", expectedRevision);
  return `/api/history?${params}`;
}

export class DetailHistoryError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Follow every advancing cursor, including MAX; refuse silently truncated or mismatched data. */
export async function loadDetailHistory(options: {
  slug: string; identity: string; range: DetailRange; capital: CapitalBasis; signal: AbortSignal;
  now?: Date; fetcher?: typeof fetch; onPage?: (count: number) => void;
}): Promise<DetailHistoryData> {
  const { slug, identity, range, capital, signal, now = new Date(), fetcher = fetch, onPage } = options;
  const bounds = detailHistoryBounds(range, now);
  let data: DetailHistoryData | null = null, after: string | undefined;
  const points = new Map<string, DetailHistoryPoint>(), sources = new Map<string, DetailHistoryData["sources"][number]>();
  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    signal.throwIfAborted();
    const response = await fetcher(detailHistoryUrl(slug, identity, capital, range, now, after, data?.rawRevision), { signal, headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new DetailHistoryError(response.status, response.status === 404 ? "저장된 종목 이력이 없습니다." : response.status === 409 ? "이력 기준이 갱신되었습니다. 다시 불러와 주세요." : "이력을 불러오지 못했습니다.");
    const result = await response.json() as DetailHistoryData;
    if (!result.asset || result.asset.slug !== slug || result.asset.identity !== identity)
      throw new DetailHistoryError(409, "현재 토큰과 이력의 연결을 갱신 중입니다.");
    if (result.schema !== 2 || result.capital !== capital || result.revenueDays !== 1 || !validDate(result.asOf) || result.asOf >= date(Date.now()) || typeof result.rawRevision !== "string" || !result.rawRevision
      || !Array.isArray(result.points)
      || !Array.isArray(result.sources) || result.points.length > HISTORY_PAGE_LIMIT
      || result.points.some((point, index) => !isDetailHistoryPoint(point) || !validDate(point.day) || point.day < bounds.from || point.day > result.asOf || point.day > bounds.to
        || !!after && point.day <= after || index > 0 && point.day <= result.points[index - 1].day)
      || result.nextCursor !== null && !validDate(result.nextCursor)) throw new DetailHistoryError(502, "이력 응답을 확인할 수 없습니다.");
    data ??= result;
    if (result.calculationVersion !== data.calculationVersion || result.asset.snapshotId !== data.asset.snapshotId || result.rawRevision !== data.rawRevision || result.asOf !== data.asOf)
      throw new DetailHistoryError(502, "이력 기준이 갱신되었습니다. 다시 불러와 주세요.");
    for (const point of result.points) points.set(point.day, point);
    for (const source of result.sources) {
      const old = sources.get(source.key);
      if (old && JSON.stringify(old) !== JSON.stringify(source)) throw new DetailHistoryError(502, "이력 원천이 갱신되었습니다. 다시 불러와 주세요.");
      sources.set(source.key, source);
    }
    onPage?.(points.size);
    if (result.nextCursor === null) {
      signal.throwIfAborted();
      return { ...data, points: [...points.values()].sort((a, b) => a.day.localeCompare(b.day)), sources: [...sources.values()], nextCursor: null };
    }
    if (!result.points.length || result.nextCursor !== result.points.at(-1)!.day || after && result.nextCursor <= after)
      throw new DetailHistoryError(502, "이력 페이지를 이어서 불러올 수 없습니다.");
    after = result.nextCursor;
  }
  throw new DetailHistoryError(502, "조회할 이력이 많아 한 번에 불러오지 못했습니다.");
}

export interface DetailChartPoint {
  day: string; time: number; price: number | null; mcap: number | null; fdv: number | null; pr: number | null; phr: number | null;
  prDefinition: string | null; phrDefinition: string | null;
}
export type DetailSeriesKey = "price" | "mcap" | "fdv" | "pr" | "phr";
const value = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
const marketValue = (cell: DailyValuationCell) => cell.reason === null && ["positive", "zero"].includes(cell.state) && typeof cell.value === "number" && Number.isFinite(cell.value) && cell.value >= 0 ? cell.value : null;

/** Project the reader's same-day calculation and independent confirmed cells. */
export function detailChartPoints(points: DetailHistoryPoint[]): DetailChartPoint[] {
  return points.map(point => ({ day: point.day, time: Date.parse(point.day), price: marketValue(point.price), mcap: marketValue(point.mcap), fdv: marketValue(point.fdv),
    pr: point.pr.reason === null ? value(point.pr.value) : null, phr: point.phr.reason === null ? value(point.phr.value) : null, prDefinition: point.pr.financialDefinition, phrDefinition: point.phr.financialDefinition }));
}

/** A missing UTC date or null observation breaks the line instead of bridging the gap. */
export function detailSeriesSegments(points: DetailChartPoint[], key: DetailSeriesKey): DetailChartPoint[][] {
  const segments: DetailChartPoint[][] = [];
  let segment: DetailChartPoint[] = [];
  for (const point of points) {
    const previous = segment.at(-1), definition = key === "pr" ? "prDefinition" : key === "phr" ? "phrDefinition" : null;
    if (point[key] === null || previous && (point.time - previous.time !== DAY || definition && point[definition] !== previous[definition])) {
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
  return reason === "missing_capital" ? "해당 날짜의 자본 값 미확인" : reason === "missing_revenue" ? "해당 날짜의 수익 미확인"
    : reason === "conflicting_capital" ? "자본 원천 충돌" : reason === "conflicting_revenue" ? "수익 원천 충돌"
      : reason === "partial_capital" ? "자본 값 부분 자료" : reason === "partial_revenue" ? "수익 부분 자료"
        : reason === "invalid_definition" ? "집계 기준 확인 필요" : reason === "invalid_timestamp" ? "관측 시각 확인 필요"
          : reason === "non_positive_capital" ? "해당 날짜의 자본 값 0 이하" : reason === "non_positive_revenue" ? "해당 날짜의 수익 0 이하"
            : reason === "incomplete_day" ? "완료되지 않은 UTC 날짜" : reason === "ineligible_asset" ? "토큰 연결 확인 필요" : "해당 날짜의 배수 미확인";
}

export function detailObservationState(cell: DailyRawStoredObservation): string {
  return cell.state === "partial" ? "부분 자료" : cell.state === "conflict" ? "원천 충돌" : cell.state === "missing" ? "미확인" : cell.state === "zero" ? "확인값 0" : cell.state === "negative" ? "확인값 음수" : "reason" in cell && cell.reason ? "기준 확인 필요" : "확인값";
}
