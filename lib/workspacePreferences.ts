import { DEFAULT_VISIBLE_COLUMNS, SCREENER_COLUMNS, type SortKey } from "./screenerColumns";
import type { CapitalBasis } from "./valuationMetrics";
import { AVAILABILITY_LABELS, METRIC_WINDOWS, type AvailableMetric, type CoverageWindow } from "./metricCoverage";
import type { RevenueWindowDays } from "./revenueHistory";
export type UniverseView = "all" | "favorites" | "growth" | "holder" | "changes" | "issues";
export interface WorkspacePreferences {
  columns: SortKey[]; capital: CapitalBasis; view: UniverseView; search: string; category: string;
  panel: "filters" | "columns"; sidebarOpen: boolean;
  available: AvailableMetric; coverageWindow: CoverageWindow;
  minMcap: number; maxMcap: number; maxPr: number; maxPhr: number; rangeWindow: RevenueWindowDays;
  hideDilution: boolean; verifiedOnly: boolean; sortKey: SortKey; sortDir: "asc" | "desc";
}
export const WORKSPACE_KEY = "crypto-valuation-workspace-v7";
export const defaultPreferences = (): WorkspacePreferences => ({ columns: [...DEFAULT_VISIBLE_COLUMNS], capital: "mcap", view: "all", search: "", category: "", panel: "columns", sidebarOpen: false, available: "all", coverageWindow: "any", minMcap: 0, maxMcap: 0, maxPr: 0, maxPhr: 0, rangeWindow: 30, hideDilution: false, verifiedOnly: false, sortKey: "mcap", sortDir: "desc" });

/** A hidden column must never remain the unexplained ordering of the table. */
export function withVisibleColumns(p: WorkspacePreferences, columns: SortKey[]): WorkspacePreferences {
  const next = columns.length ? columns : [...DEFAULT_VISIBLE_COLUMNS];
  const sortVisible = p.sortKey === "name" || next.includes(p.sortKey);
  return { ...p, columns: next, sortKey: sortVisible ? p.sortKey : next.includes("mcap") ? "mcap" : "name", sortDir: sortVisible ? p.sortDir : next.includes("mcap") ? "desc" : "asc" };
}

/** The removed sales filter is not a revenue filter and must not be renamed in place. */
export function workspaceMigrationNotice(raw: string | null): string | null {
  try {
    const p = JSON.parse(raw ?? "null");
    if (p?.columns?.includes("psSales") || p?.sortKey === "psSales" || p?.available === "sales" || p?.maxPs > 0) {
      return "P/S는 종목 상세로 옮겼습니다. 기존 P/S 열·필터·정렬을 정리하고 나머지 설정은 유지했습니다.";
    }
  } catch { /* Invalid storage is handled by parseWorkspace. */ }
  return null;
}
export function parseWorkspace(raw: string | null): WorkspacePreferences {
  const defaults = defaultPreferences();
  try {
    const p = JSON.parse(raw ?? "null");
    if (!p || typeof p !== "object" || Array.isArray(p)) return defaults;
    const keys = new Set<string>(SCREENER_COLUMNS.map(c => c.key));
    const columns = Array.isArray(p.columns) ? [...new Set<SortKey>(p.columns.filter((k: unknown) => typeof k === "string" && keys.has(k)))] : [];
    const finite = (k: string) => typeof p[k] === "number" && Number.isFinite(p[k]) && p[k] >= 0 ? p[k] : 0;
    const parsed: WorkspacePreferences = { ...defaults, columns: columns.length ? columns : defaults.columns,
      panel: p.panel === "filters" ? "filters" : "columns", sidebarOpen: false,
      capital: p.capital === "fdv" ? "fdv" : "mcap",
      view: ["all", "favorites", "growth", "holder", "changes", "issues"].includes(p.view) ? p.view : "all",
      search: typeof p.search === "string" ? p.search.slice(0, 200) : "",
      category: typeof p.category === "string" ? p.category.slice(0, 100) : "",
      available: p.available !== "sales" && Object.hasOwn(AVAILABILITY_LABELS,p.available) ? p.available : "all",
      coverageWindow: METRIC_WINDOWS.includes(p.coverageWindow) ? p.coverageWindow : "any",
      minMcap: finite("minMcap"), maxMcap: finite("maxMcap"), maxPr: finite("maxPr"), maxPhr: finite("maxPhr"),
      rangeWindow: METRIC_WINDOWS.includes(p.rangeWindow) ? p.rangeWindow : 30,
      hideDilution: p.hideDilution === true, verifiedOnly: p.verifiedOnly === true,
      sortKey: keys.has(p.sortKey) || p.sortKey === "name" ? p.sortKey : "mcap", sortDir: p.sortDir === "asc" ? "asc" : "desc" };
    return withVisibleColumns(parsed, parsed.columns);
  } catch { return defaults; }
}
/** Reset filters without changing the user's comparison columns or capital basis. */
export function resetWorkspaceFilters(p: WorkspacePreferences): WorkspacePreferences {
  return { ...defaultPreferences(), columns: p.columns, capital: p.capital, sortKey: p.sortKey, sortDir: p.sortDir, panel: p.panel, sidebarOpen: p.sidebarOpen };
}
