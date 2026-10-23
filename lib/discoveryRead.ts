import { currentCatalog } from "./tableRead";
import { queryTableCatalog } from "./tableCatalog";
import { readMapHistoryBatch } from "./dailyValuationRead";
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
    let history: Awaited<ReturnType<typeof readMapHistoryBatch>> | null = null;
    if (mode === "map" && entries.length) for (let attempt = 0; attempt < 2; attempt++) {
      try { history = await readMapHistoryBatch({ coins: entries.map(e => ({ ...e.binding, revenue30d: e.features.amounts.revenue[30]! })), capital: prefs.capital, snapshot: { updatedAt: catalog.metadata.updatedAt, publication } }); break; }
      catch (error) {
        const codes = new Set<string>();
        for (let cause: unknown = error, depth = 0; cause && typeof cause === "object" && depth < 5; depth++) {
          if ("code" in cause && /^[A-Z][A-Z0-9_]{1,63}$/.test(String(cause.code))) codes.add(String(cause.code));
          cause = "cause" in cause ? cause.cause : null;
        }
        if (attempt === 0 && [...codes].some(code => ["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"].includes(code))) continue;
        console.error("discovery_history_unavailable", { codes: [...codes], reason: error instanceof Error && /^daily_[a-z_]+$/.test(error.message) ? error.message : "history_read_failed" }); break;
      }
    }
    const rows: DiscoveryRow[] = entries.map(e => ({ ...e.row, cells: e.cells[prefs.capital], revenue30d: e.features.amounts.revenue[30], holders30d: e.features.amounts.holders[30],
      past: mode === "watchlist" ? {} : history?.get(e.row.slug) ?? Object.fromEntries(MAP_PERIODS.map(days => [days, { point: null, reason: "과거 자료를 불러오지 못했습니다. 다시 확인해 주세요.", revenue: null, revenueReason: "과거 자료를 불러오지 못했습니다. 다시 확인해 주세요." }])) }));
    value = { rows, historyStatus: mode === "watchlist" ? "not-requested" : history ? "ready" : "unavailable" };
    cache.set(key, { value, until: Date.now() + (value.historyStatus === "unavailable" ? 10000 : 60000) });
    while (cache.size > 16) cache.delete(cache.keys().next().value!);
  }
  return { schema: 1, publicationId: catalog.publicationId, snapshotSha256: catalog.snapshotSha256, updatedAt: catalog.metadata.updatedAt, capital: prefs.capital, asOf, page: at, pages, total: eligible.length, excluded: matched.length - eligible.length, ...value };
}
