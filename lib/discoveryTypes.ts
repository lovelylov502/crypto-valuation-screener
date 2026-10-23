import type { TableRow } from "./tableDto";
import type { CapitalBasis } from "./valuationMetrics";

export const MAP_PERIODS = [1, 7, 30, 90, 180, 365] as const;
export type MapPeriod = typeof MAP_PERIODS[number];
export interface MapPosition { date: string; pr: number; revenue: number }
export interface MapRevenue { date: string; value: number }
export interface MapHistory { point: MapPosition | null; reason: string; revenue?: MapRevenue | null; revenueReason?: string }
export interface DiscoveryRow extends TableRow {
  revenue30d: number | null;
  holders30d: number | null;
  past: Partial<Record<MapPeriod, MapHistory>>;
}
export interface DiscoveryPage {
  schema: 1; publicationId: string; snapshotSha256: string; updatedAt: string; asOf: string;
  capital: CapitalBasis; rows: DiscoveryRow[]; page: number; pages: number; total: number; excluded: number;
  historyStatus: "ready" | "unavailable" | "not-requested";
}
export const mapDate = (day: string, offset: number) => new Date(Date.parse(day) + offset * 86400000).toISOString().slice(0, 10);
export const periodName = (days: MapPeriod) => days === 365 ? "1년 전" : `${days}일 전`;
export const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export function assertDiscoveryPage(value: unknown, capital: CapitalBasis): asserts value is DiscoveryPage {
  const p = value as DiscoveryPage | null;
  if (!p || p.schema !== 1 || p.capital !== capital || !p.publicationId || !/^[a-f0-9]{64}$/.test(p.snapshotSha256)
    || !Number.isFinite(Date.parse(p.updatedAt)) || !/^\d{4}-\d{2}-\d{2}$/.test(p.asOf) || !Array.isArray(p.rows) || p.rows.length > 200
    || !Number.isInteger(p.page) || !Number.isInteger(p.pages) || p.page < 1 || p.pages < p.page || !Number.isInteger(p.total)
    || p.rows.some(r => !r.slug || !r.identity || !r.name || !r.cells || !r.past || Object.values(r.past).some(h => h?.point && (!positive(h.point.pr) || !positive(h.point.revenue)) || h?.revenue && (!Number.isFinite(h.revenue.value) || h.revenue.value < 0 || !Number.isFinite(Date.parse(h.revenue.date)))))) throw Error("조회 결과 형식을 확인하지 못했습니다.");
}
