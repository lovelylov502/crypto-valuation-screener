import type { CoinScored, ScreenerResponse } from "./types";
import type { PublishedSnapshot, PublicationJournal } from "./publicationTypes";
import { TABLE_METRICS, TABLE_MODEL_VERSION, tableIdentity, type TableMetadata, type TableRow, type TablePage } from "./tableDto";
import { referenceMultiple, referenceReading, referenceReason } from "./referenceMetrics";
import { METRIC_WINDOWS, METRIC_COLUMN_DAYS, hasSourceData, type CoverageWindow } from "./metricCoverage";
import { sortValue } from "./screenerSort";
import { SCREENER_COLUMNS, REVENUE_COLUMN_DAYS, type SortKey } from "./screenerColumns";
import { revenueTrend } from "./revenueTrend";
import { compareTableValues, matchesRange } from "./screenerFilters";
import type { WorkspacePreferences } from "./workspacePreferences";
import type { CapitalBasis } from "./valuationMetrics";
import { canonicalReadModelJSON } from "./dailyReadModelDatabase";
import { contentHash } from "./sourceBundle";

export const TABLE_CATALOG_NAMESPACE = "table-catalog-v1", TABLE_DETAIL_NAMESPACE = "table-detail-v1";
type WindowMap<T> = Record<1 | 7 | 30 | 90 | 365, T>;
interface Features {
  highDilution: boolean; issues: boolean; source: Record<CoverageWindow, boolean>;
  amounts: { revenue: WindowMap<number | null>; holders: WindowMap<number | null> }; trends: WindowMap<ReturnType<typeof revenueTrend>>;
  sales: Record<CapitalBasis, number | null>; sorts: { common: Partial<Record<SortKey, number | string | null>>; fdv: Partial<Record<SortKey, number | string | null>> };
  linkedToken: string | null;
}
export interface TableEntry { row: Omit<TableRow, "cells">; binding: Pick<CoinScored, "slug" | "geckoId" | "cmcId" | "identityStatus" | "capitalExclusionReason">; cells: Record<CapitalBasis, TableRow["cells"]>; features: Features; detail: { shard: string; hash: string } }
export interface TableCatalog { schema: 1; version: typeof TABLE_MODEL_VERSION; publicationId: string; snapshotSha256: string; metadata: TableMetadata; entries: TableEntry[] }
export interface TableShard { schema: 1; coins: CoinScored[] }
export const tableHash = (value: unknown) => contentHash(canonicalReadModelJSON(value));
export const coinIdentity = tableIdentity;
export function buildTableCatalog(data: ScreenerResponse, ref: PublishedSnapshot) {
  if (data.updatedAt !== ref.dataAt || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error("table_catalog_snapshot_mismatch");
  const coins = [...data.coins].sort((a, b) => a.slug.localeCompare(b.slug)), details = new Map<string, { shard: string; hash: string }>(), shards = new Map<string, TableShard>();
  const linked = coins.filter(coin => coin.identityStatus === "verified" && !coin.capitalExclusionReason), linkedSet = new Set(linked), cmcGecko = new Map(linked.filter(coin => coin.cmcId && coin.geckoId).map(coin => [coin.cmcId, coin.geckoId]));
  for (let start = 0; start < coins.length; start += 100) {
    const shard: TableShard = { schema: 1, coins: coins.slice(start, start + 100) }, hash = tableHash(shard); shards.set(hash, shard);
    for (const coin of shard.coins) details.set(coin.slug, { shard: hash, hash: tableHash(coin) });
  }
  const entries: TableEntry[] = coins.map(coin => {
    const cells = Object.fromEntries((["mcap", "fdv"] as const).map(capital => [capital, Object.fromEntries(TABLE_METRICS.map(key => {
      const metric = key.startsWith("phr") ? "holders" : "revenue", days = METRIC_COLUMN_DAYS[key]!;
      return [key, { value: referenceMultiple(coin, metric, days, capital), basis: referenceReading(coin, metric, days).basis, reason: referenceReason(coin, metric, days, capital) }];
    }))])) as TableEntry["cells"];
    const amounts = Object.fromEntries((["revenue", "holders"] as const).map(metric => [metric, Object.fromEntries(METRIC_WINDOWS.map(days => [days, referenceReading(coin, metric, days).amount]))])) as Features["amounts"];
    const sortKeys = [...new Set<SortKey>(["name", ...SCREENER_COLUMNS.map(c => c.key)])], common = Object.fromEntries(sortKeys.map(key => [key, sortValue(coin, key, "mcap")])) as Features["sorts"]["common"];
    const sorts: Features["sorts"] = { common, fdv: Object.fromEntries(sortKeys.flatMap(key => { const value = sortValue(coin, key, "fdv"); return value === common[key] ? [] : [[key, value]]; })) };
    const gecko = coin.geckoId ?? cmcGecko.get(coin.cmcId), linkedToken = !linkedSet.has(coin) ? null : gecko ? `gecko:${gecko}` : coin.cmcId ? `cmc:${coin.cmcId}` : null;
    return { row: { slug: coin.slug, identity: coinIdentity(coin), name: coin.name, symbol: coin.symbol, logo: coin.logo, category: coin.category, mcap: coin.mcap, fdv: coin.fdv, identityStatus: coin.identityStatus, hasIssues: !!coin.dataQuality?.issues.length }, binding: { slug: coin.slug, geckoId: coin.geckoId, cmcId: coin.cmcId, identityStatus: coin.identityStatus, capitalExclusionReason: coin.capitalExclusionReason ?? null }, cells,
      features: { highDilution: coin.highDilution, issues: !!coin.opportunities.dataIssues.length, source: Object.fromEntries((["any", ...METRIC_WINDOWS] as const).map(window => [window, hasSourceData(coin, window)])) as Features["source"], amounts, trends: Object.fromEntries(METRIC_WINDOWS.map(days => [days, revenueTrend(coin, days)])) as Features["trends"], sales: { mcap: sortValue(coin, "psSales", "mcap") as number | null, fdv: sortValue(coin, "psSales", "fdv") as number | null }, sorts, linkedToken }, detail: details.get(coin.slug)! };
  });
  const { coins: _coins, publication: _publication, ...metadata } = data;
  const catalog: TableCatalog = { schema: 1, version: TABLE_MODEL_VERSION, publicationId: ref.id, snapshotSha256: ref.sha256, metadata, entries };
  return { catalog, shards };
}
function available(entry: TableEntry, capital: CapitalBasis, window: CoverageWindow) {
  const keys = (window === "any" ? TABLE_METRICS : TABLE_METRICS.filter(key => METRIC_COLUMN_DAYS[key] === window)), cells = entry.cells[capital];
  const revenue = keys.some(key => !key.startsWith("phr") && cells[key].value !== null), holder = keys.some(key => key.startsWith("phr") && cells[key].value !== null), unique = revenue || holder, source = entry.features.source[window];
  return { sales: entry.features.sales[capital] !== null, revenue, holder, unique, source, review: source && !unique, missing: !source && !unique };
}
const matches = (entry: TableEntry, metric: WorkspacePreferences["available"], capital: CapitalBasis, window: CoverageWindow) => metric === "all" || available(entry, capital, window)[metric === "any" ? "unique" : metric];
const ratioKey = (metric: "pr" | "phr", days: number) => `${metric}${days === 1 ? "24h" : days === 30 ? "" : days === 365 ? "1y" : `${days}d`}` as keyof TableRow["cells"];
export function queryTableCatalog(catalog: TableCatalog, prefs: WorkspacePreferences, favorites: string[] = [], page = 1, size = 100, publication?: PublicationJournal): TablePage {
  const saved = new Set(favorites), q = prefs.search.trim().toLocaleLowerCase();
  const rows = catalog.entries.filter(entry => {
    const { row: c, features: f, cells } = entry;
    return (!q || `${c.name} ${c.symbol ?? ""} ${c.slug}`.toLocaleLowerCase().includes(q)) && (prefs.view !== "favorites" || saved.has(c.slug))
      && (!(prefs.growingOnly || prefs.view === "growth") || f.trends[prefs.rangeWindow].delta! > 0)
      && (!(prefs.holderOnly || prefs.view === "holder") || f.amounts.holders[prefs.rangeWindow]! > 0)
      && (prefs.minSourceAmount === null || f.amounts[prefs.sourceMetric][prefs.rangeWindow] !== null && f.amounts[prefs.sourceMetric][prefs.rangeWindow]! > prefs.minSourceAmount)
      && (prefs.view !== "issues" || f.issues) && (!prefs.category || c.category === prefs.category) && (!prefs.hideDilution || !f.highDilution) && (!prefs.verifiedOnly || c.identityStatus === "verified")
      && matches(entry, prefs.available, prefs.capital, prefs.coverageWindow) && matchesRange(c.mcap, prefs.minMcap, prefs.maxMcap)
      && matchesRange(cells[prefs.capital][ratioKey("pr", prefs.rangeWindow)].value, 0, prefs.maxPr) && matchesRange(cells[prefs.capital][ratioKey("phr", prefs.rangeWindow)].value, 0, prefs.maxPhr);
  });
  const revenueDays = REVENUE_COLUMN_DAYS[prefs.sortKey as keyof typeof REVENUE_COLUMN_DAYS];
  const value = (entry: TableEntry) => revenueDays ? prefs.revenueSort === "percent" ? entry.features.trends[revenueDays].percent : prefs.revenueSort === "delta" ? entry.features.trends[revenueDays].delta : entry.features.amounts.revenue[revenueDays] : (prefs.capital === "fdv" && Object.hasOwn(entry.features.sorts.fdv, prefs.sortKey) ? entry.features.sorts.fdv[prefs.sortKey] : entry.features.sorts.common[prefs.sortKey]) ?? null;
  rows.sort((a, b) => compareTableValues(value(a), value(b), prefs.sortDir) || (b.row.mcap ?? 0) - (a.row.mcap ?? 0) || a.row.slug.localeCompare(b.row.slug));
  const pageSize = [50, 100, 200].includes(size) ? size : 100, currentPage = Math.max(1, Math.min(Number.isFinite(page) ? Math.trunc(page) : 1, Math.ceil(rows.length / pageSize) || 1));
  const counts = { total: catalog.entries.length, sales: 0, revenue: 0, holder: 0, unique: 0, review: 0, missing: 0, source: 0 };
  for (const entry of catalog.entries) for (const [key, present] of Object.entries(available(entry, prefs.capital, prefs.coverageWindow))) if (present) counts[key as keyof typeof counts]++;
  const metrics = prefs.columns.flatMap(key => METRIC_COLUMN_DAYS[key] ? [{ key, label: SCREENER_COLUMNS.find(c => c.key === key)!.label, count: rows.filter(entry => entry.cells[prefs.capital][key as keyof TableRow["cells"]]?.value !== null).length }] : []);
  const tokens = new Set(catalog.entries.flatMap(entry => entry.features.linkedToken ? [entry.features.linkedToken] : []));
  return { ...catalog.metadata, schema: 1, view: "table", modelVersion: TABLE_MODEL_VERSION, publicationId: catalog.publicationId, snapshotSha256: catalog.snapshotSha256, ...(publication ? { publication } : {}), capital: prefs.capital,
    rows: rows.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(entry => ({ ...entry.row, cells: entry.cells[prefs.capital] })),
    pagination: { page: currentPage, size: pageSize, total: catalog.entries.length, filtered: rows.length, favorites: catalog.entries.filter(entry => saved.has(entry.row.slug)).length }, coverage: { ...counts, capital: prefs.capital, window: prefs.coverageWindow },
    visibleCoverage: { total: rows.length, unique: rows.filter(entry => prefs.columns.some(key => entry.cells[prefs.capital][key as keyof TableRow["cells"]]?.value != null)).length, metrics }, universe: { projects: catalog.entries.length, linkedTokens: tokens.size, withRevenue: counts.revenue, withHolder: counts.holder } };
}
