import type { ScreenerResponse, CoinScored } from "./types";
import type { ScreenerPage } from "./screenerQuery";
import type { CapitalBasis } from "./valuationMetrics";
import type { SortKey } from "./screenerColumns";

export const TABLE_MODEL_VERSION = "table-catalog-v1";
export const TABLE_METRICS = ["pr24h", "pr7d", "pr", "pr90d", "pr1y", "phr24h", "phr7d", "phr", "phr90d", "phr1y"] as const;
export type TableMetric = typeof TABLE_METRICS[number];
export interface TableCell { value: number | null; basis: string; reason: string }
export interface TableRow {
  slug: string; identity: string; name: string; symbol: string | null; logo: string | null; category: string | null;
  mcap: number | null; fdv: number | null; identityStatus: CoinScored["identityStatus"]; hasIssues: boolean;
  cells: Record<TableMetric, TableCell>;
}
export type TableMetadata = Omit<ScreenerResponse, "coins" | "publication">;
export interface TablePage extends TableMetadata {
  schema: 1; view: "table"; modelVersion: typeof TABLE_MODEL_VERSION; publicationId: string; snapshotSha256: string;
  publication?: ScreenerResponse["publication"]; rows: TableRow[]; capital: CapitalBasis;
  pagination: ScreenerPage["pagination"]; coverage: ScreenerPage["coverage"]; visibleCoverage: ScreenerPage["visibleCoverage"]; universe: ScreenerPage["universe"];
  valuationComparison?: ScreenerPage["valuationComparison"];
  readModel?: "prepared" | "snapshot-fallback";
}
export interface TableDetail { schema: 1; publicationId: string; snapshotSha256: string; updatedAt: string; identity: string; coin: CoinScored; readModel: "prepared" | "snapshot-fallback" }
export const tableIdentity = (coin: Pick<CoinScored, "geckoId" | "cmcId">) => coin.geckoId ? `gecko:${coin.geckoId}` : coin.cmcId ? `cmc:${coin.cmcId}` : "unlinked";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const amount = (v: unknown) => v === null || typeof v === "number" && Number.isFinite(v);
export function assertTablePage(value: unknown, capital: CapitalBasis): asserts value is TablePage {
  if (!record(value) || value.schema !== 1 || value.view !== "table" || value.modelVersion !== TABLE_MODEL_VERSION || value.capital !== capital
    || typeof value.publicationId !== "string" || !value.publicationId || typeof value.snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.snapshotSha256)
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || Date.parse(value.updatedAt) > Date.now() + 300000
    || !record(value.publication) || !record(value.publication.published) || value.publication.published.id !== value.publicationId || value.publication.published.sha256 !== value.snapshotSha256 || value.publication.published.dataAt !== value.updatedAt
    || !record(value.pagination) || !record(value.coverage) || value.coverage.capital !== capital || !record(value.visibleCoverage) || !record(value.universe)
    || !Array.isArray(value.rows) || value.rows.length > 200 || !Array.isArray(value.categories) || !Array.isArray(value.sources)) throw Error("Invalid table response");
  const seen = new Set<string>();
  for (const row of value.rows) {
    if (!record(row) || typeof row.slug !== "string" || seen.has(row.slug) || typeof row.identity !== "string" || typeof row.name !== "string" || !amount(row.mcap) || !amount(row.fdv)
      || !["verified", "review", "ambiguous"].includes(String(row.identityStatus)) || typeof row.hasIssues !== "boolean" || !record(row.cells)
      || TABLE_METRICS.some(key => { const cell = (row.cells as Record<string, unknown>)[key]; return !record(cell) || !amount(cell.value) || typeof cell.basis !== "string" || typeof cell.reason !== "string"; })) throw Error("Invalid table row");
    seen.add(row.slug);
  }
}
export const tableCell = (row: TableRow, key: SortKey): TableCell | null => TABLE_METRICS.includes(key as TableMetric) ? row.cells[key as TableMetric] : null;
