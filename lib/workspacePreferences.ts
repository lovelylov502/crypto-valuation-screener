import { DEFAULT_VISIBLE_COLUMNS, SCREENER_COLUMNS, type SortKey } from "./screenerColumns";
import type { CapitalBasis } from "./valuationMetrics";
import { AVAILABILITY_LABELS, METRIC_WINDOWS, type AvailableMetric, type CoverageWindow } from "./metricCoverage";
import type { RevenueWindowDays } from "./revenueHistory";
import type { ReferenceMetric } from "./referenceMetrics";
export type UniverseView = "all" | "favorites" | "growth" | "holder" | "changes" | "issues";
export interface WorkspacePreferences {
  layoutVersion: 10;
  revenueSort: "amount" | "percent" | "delta";
  growingOnly: boolean; holderOnly: boolean;
  columns: SortKey[]; capital: CapitalBasis; view: UniverseView; search: string; category: string;
  panel: "filters" | "columns"; sidebarOpen: boolean;
  available: AvailableMetric; coverageWindow: CoverageWindow;
  minMcap: number; maxMcap: number; maxPr: number; maxPhr: number; rangeWindow: RevenueWindowDays;
  sourceMetric: ReferenceMetric; minSourceAmount: number | null;
  hideDilution: boolean; verifiedOnly: boolean; sortKey: SortKey; sortDir: "asc" | "desc";
}
export const WORKSPACE_KEY = "crypto-valuation-workspace-v7";
export const defaultPreferences = (): WorkspacePreferences => ({ layoutVersion: 10, revenueSort: "amount", growingOnly: false, holderOnly: false, columns: [...DEFAULT_VISIBLE_COLUMNS], capital: "mcap", view: "all", search: "", category: "", panel: "filters", sidebarOpen: false, available: "all", coverageWindow: "any", minMcap: 0, maxMcap: 0, maxPr: 0, maxPhr: 0, rangeWindow: 30, sourceMetric: "revenue", minSourceAmount: null, hideDilution: false, verifiedOnly: false, sortKey: "pr", sortDir: "asc" });

/** A hidden column must never remain the unexplained ordering of the table. */
export function withFixedColumns(p: WorkspacePreferences): WorkspacePreferences {
  const next = [...DEFAULT_VISIBLE_COLUMNS];
  const sortVisible = p.sortKey === "name" || next.includes(p.sortKey);
  return { ...p, columns: next, sortKey: sortVisible ? p.sortKey : "pr", sortDir: sortVisible ? p.sortDir : "asc" };
}

/** The removed sales filter is not a revenue filter and must not be renamed in place. */
export function workspaceMigrationNotice(raw: string | null): string | null {
  try {
    const p = JSON.parse(raw ?? "null");
    if (p?.columns?.includes("psSales") || p?.sortKey === "psSales" || p?.available === "sales" || p?.maxPs > 0) {
      return "P/S는 종목 상세로 옮겼습니다. 기존 P/S 열·필터·정렬을 정리하고 나머지 설정은 유지했습니다.";
    }
    if (p && p.layoutVersion !== 10) return "P/R·P/HR과 과거 비교를 고정 배치했습니다. 관심종목·필터·배수 기준은 유지하며, 없어진 열의 정렬은 P/R 30일로 바꿉니다.";
  } catch { /* Invalid storage is handled by parseWorkspace. */ }
  return null;
}
export function parseWorkspace(raw: string | null): WorkspacePreferences {
  const defaults = defaultPreferences();
  try {
    const p = JSON.parse(raw ?? "null");
    if (!p || typeof p !== "object" || Array.isArray(p)) return defaults;
    const keys = new Set<string>(SCREENER_COLUMNS.map(c => c.key));
    const finite = (k: string) => typeof p[k] === "number" && Number.isFinite(p[k]) && p[k] >= 0 ? p[k] : 0;
    const parsed: WorkspacePreferences = { ...defaults,
      revenueSort: ["percent", "delta"].includes(p.revenueSort) ? p.revenueSort : "amount",
      growingOnly: p.growingOnly === true || p.view === "growth", holderOnly: p.holderOnly === true || p.view === "holder",
      panel: "filters", sidebarOpen: false,
      capital: p.capital === "fdv" ? "fdv" : "mcap",
      view: ["all", "favorites", "issues"].includes(p.view) ? p.view : "all",
      search: typeof p.search === "string" ? p.search.slice(0, 200) : "",
      category: typeof p.category === "string" ? p.category.slice(0, 100) : "",
      available: p.available !== "sales" && Object.hasOwn(AVAILABILITY_LABELS,p.available) ? p.available : "all",
      coverageWindow: METRIC_WINDOWS.includes(p.coverageWindow) ? p.coverageWindow : "any",
      minMcap: finite("minMcap"), maxMcap: finite("maxMcap"), maxPr: finite("maxPr"), maxPhr: finite("maxPhr"),
      rangeWindow: METRIC_WINDOWS.includes(p.rangeWindow) ? p.rangeWindow : 30,
      sourceMetric: p.sourceMetric === "holders" ? "holders" : "revenue",
      minSourceAmount: typeof p.minSourceAmount === "number" && Number.isFinite(p.minSourceAmount) && p.minSourceAmount >= 0 ? p.minSourceAmount : null,
      hideDilution: p.hideDilution === true, verifiedOnly: p.verifiedOnly === true,
      sortKey: keys.has(p.sortKey) || p.sortKey === "name" ? p.sortKey : defaults.sortKey, sortDir: ["asc", "desc"].includes(p.sortDir) ? p.sortDir : defaults.sortDir };
    return withFixedColumns(parsed);
  } catch { return defaults; }
}
/** Reset filters without changing the user's comparison columns or capital basis. */
export function resetWorkspaceFilters(p: WorkspacePreferences): WorkspacePreferences {
  return withFixedColumns({ ...defaultPreferences(), capital: p.capital, sortKey: p.sortKey, sortDir: p.sortDir });
}
