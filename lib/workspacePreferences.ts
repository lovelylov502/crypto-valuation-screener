import { DEFAULT_VISIBLE_COLUMNS, SCREENER_COLUMNS, type SortKey } from "./screenerColumns";
import type { CapitalBasis } from "./valuationMetrics";
export type UniverseView = "all" | "favorites" | "growth" | "holder" | "changes" | "issues";
export interface WorkspacePreferences {
  columns: SortKey[]; capital: CapitalBasis; view: UniverseView; search: string; category: string;
  panel: "filters" | "columns"; sidebarOpen: boolean;
  available: "all" | "sales" | "revenue" | "holder";
  minMcap: number; maxMcap: number; maxPs: number; maxPhr: number;
  hideDilution: boolean; verifiedOnly: boolean; sortKey: SortKey; sortDir: "asc" | "desc";
}
export const WORKSPACE_KEY = "crypto-valuation-workspace-v7";
export const defaultPreferences = (): WorkspacePreferences => ({ columns: [...DEFAULT_VISIBLE_COLUMNS], capital: "mcap", view: "all", search: "", category: "", panel: "columns", sidebarOpen: true, available: "all", minMcap: 0, maxMcap: 0, maxPs: 0, maxPhr: 0, hideDilution: false, verifiedOnly: false, sortKey: "mcap", sortDir: "desc" });
export function parseWorkspace(raw: string | null): WorkspacePreferences {
  const defaults = defaultPreferences();
  try {
    const p = JSON.parse(raw ?? "null");
    if (!p || typeof p !== "object" || Array.isArray(p)) return defaults;
    const keys = new Set<string>(SCREENER_COLUMNS.map(c => c.key));
    const columns = Array.isArray(p.columns) ? [...new Set<SortKey>(p.columns.filter((k: unknown) => typeof k === "string" && keys.has(k)))] : [];
    const finite = (k: string) => typeof p[k] === "number" && Number.isFinite(p[k]) && p[k] >= 0 ? p[k] : 0;
    return { ...defaults, columns: columns.length ? columns : defaults.columns,
      panel: p.panel === "filters" ? "filters" : "columns", sidebarOpen: p.sidebarOpen !== false,
      capital: p.capital === "fdv" ? "fdv" : "mcap",
      view: ["all", "favorites", "growth", "holder", "changes", "issues"].includes(p.view) ? p.view : "all",
      search: typeof p.search === "string" ? p.search.slice(0, 200) : "",
      category: typeof p.category === "string" ? p.category.slice(0, 100) : "",
      available: ["all", "sales", "revenue", "holder"].includes(p.available) ? p.available : "all",
      minMcap: finite("minMcap"), maxMcap: finite("maxMcap"), maxPs: finite("maxPs"), maxPhr: finite("maxPhr"),
      hideDilution: p.hideDilution === true, verifiedOnly: p.verifiedOnly === true,
      sortKey: keys.has(p.sortKey) || p.sortKey === "name" ? p.sortKey : "mcap", sortDir: p.sortDir === "asc" ? "asc" : "desc" };
  } catch { return defaults; }
}
/** Reset filters without changing the user's comparison columns or capital basis. */
export function resetWorkspaceFilters(p: WorkspacePreferences): WorkspacePreferences {
  return { ...defaultPreferences(), columns: p.columns, capital: p.capital, sortKey: p.sortKey, sortDir: p.sortDir, panel: p.panel, sidebarOpen: p.sidebarOpen };
}
