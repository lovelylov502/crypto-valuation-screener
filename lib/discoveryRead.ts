import { currentCatalog } from "./tableRead";
import { queryTableCatalog } from "./tableCatalog";
import { currentArtifactSet, readArtifact, type MapArtifact } from "./readArtifacts";
import { dailyValuationAsOf } from "./dailyValuation";
import { MAP_PERIODS, positive, type DiscoveryPage, type DiscoveryRow } from "./discoveryTypes";
import type { WorkspacePreferences } from "./workspacePreferences";

const cache = new Map<string, { until: number; value: Pick<DiscoveryPage, "rows" | "historyStatus"> }>();
export async function readDiscovery(prefs: WorkspacePreferences, favorites: string[], page: number, mode: "map" | "watchlist"): Promise<DiscoveryPage> {
  const { catalog, publication } = await currentCatalog();
  const chosen = new Set<string>();
  // Reuse the table's exact predicate, including source-amount filters, across every result page.
  for (let p = 1; ; p++) { const part = queryTableCatalog(catalog, prefs, favorites, p, 200); part.rows.forEach(r => chosen.add(r.slug)); if (p * 200 >= part.pagination.filtered) break; }
  const matched = catalog.entries.filter(e => chosen.has(e.row.slug));
  const eligible = mode === "map" ? matched.filter(e => positive(e.cells[prefs.capital].pr.value) && positive(e.features.amounts.revenue[30])) : matched;
  const pages = Math.max(1, Math.ceil(eligible.length / 200)), at = Math.min(pages, Math.max(1, Math.trunc(page) || 1));
  const entries = eligible.slice((at - 1) * 200, at * 200), asOf = dailyValuationAsOf(catalog.metadata).asOf;
  const key = JSON.stringify([catalog.publicationId, catalog.snapshotSha256, asOf, mode, prefs.capital, entries.map(e => e.row.slug)]), cached = cache.get(key);
  let value = cached && cached.until > Date.now() ? cached.value : null;
  if (!value) {
    let history: MapArtifact | null = null;
    if (mode === "map" && entries.length) try {
      const set = await currentArtifactSet();
      if (set.catalog.publicationId !== catalog.publicationId || set.catalog.snapshotSha256 !== catalog.snapshotSha256) throw Error("map_publication_changed");
      history = await readArtifact<MapArtifact>(set.manifest, "map.json.gz");
    } catch { console.error("discovery_history_unavailable", { reason: "prepared_map_unavailable" }); }
    const rows: DiscoveryRow[] = entries.map(e => ({ ...e.row, cells: e.cells[prefs.capital], revenue30d: e.features.amounts.revenue[30], holders30d: e.features.amounts.holders[30],
      past: mode === "watchlist" ? {} : history?.[e.row.slug]?.[prefs.capital] ?? Object.fromEntries(MAP_PERIODS.map(days => [days, { point: null, reason: history ? "확인된 과거 원자료가 없습니다." : "과거 자료를 준비 중입니다.", revenue: null, revenueReason: history ? "확인된 과거 원자료가 없습니다." : "과거 자료를 준비 중입니다." }])) }));
    value = { rows, historyStatus: mode === "watchlist" ? "not-requested" : history ? "ready" : "unavailable" };
    cache.set(key, { value, until: Date.now() + (value.historyStatus === "unavailable" ? 10000 : 60000) });
    while (cache.size > 16) cache.delete(cache.keys().next().value!);
  }
  return { schema: 1, publicationId: catalog.publicationId, snapshotSha256: catalog.snapshotSha256, updatedAt: catalog.metadata.updatedAt, capital: prefs.capital, asOf, page: at, pages, total: eligible.length, excluded: matched.length - eligible.length, ...value };
}
