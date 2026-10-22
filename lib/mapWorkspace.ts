import { MAP_PERIODS, positive, type DiscoveryRow, type MapPeriod } from "./discoveryTypes";
import { parseWorkspace, type WorkspacePreferences } from "./workspacePreferences";

export const MAP_WORKSPACE_KEY = "tovenit-map-workspace-v1";
export interface MapFilters {
  capital: "mcap" | "fdv"; period: MapPeriod;
  minMcap: number; maxMcap: number; revenueGrowing: boolean; prFalling: boolean;
  prLimit: boolean; maxPr: number;
}
export interface MapCondition { name: string; filters: MapFilters; inherited: WorkspacePreferences | null }
export interface MapWorkspace { filters: MapFilters; inherited: WorkspacePreferences | null; saved: MapCondition[]; selected: string }
export const defaultMapFilters = (): MapFilters => ({ capital: "mcap", period: 30, minMcap: 0, maxMcap: 0, revenueGrowing: false, prFalling: false, prLimit: false, maxPr: 30 });
export const defaultMapWorkspace = (): MapWorkspace => ({ filters: defaultMapFilters(), inherited: null, saved: [], selected: "" });

function parseFilters(value: unknown): MapFilters {
  const p = (value && typeof value === "object" ? value : {}) as Partial<MapFilters>;
  const finite = (n: unknown, fallback = 0) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : fallback;
  const minMcap = finite(p.minMcap), maxMcap = finite(p.maxMcap);
  return { capital: p.capital === "fdv" ? "fdv" : "mcap", period: MAP_PERIODS.includes(p.period!) ? p.period! : 30,
    minMcap, maxMcap: maxMcap ? Math.max(minMcap, maxMcap) : 0,
    revenueGrowing: p.revenueGrowing === true, prFalling: p.prFalling === true, prLimit: p.prLimit === true, maxPr: finite(p.maxPr, 30) };
}
export function parseMapWorkspace(raw: string | null): MapWorkspace {
  try {
    const p = JSON.parse(raw ?? "null");
    if (!p || typeof p !== "object" || Array.isArray(p)) return defaultMapWorkspace();
    const inherited = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? parseWorkspace(JSON.stringify(v)) : null;
    const names = new Set<string>();
    const saved: MapCondition[] = [];
    for (const item of Array.isArray(p.saved) ? p.saved : []) {
      if (!item || typeof item.name !== "string") continue;
      const name = item.name.trim().slice(0, 60);
      if (!name || names.has(name)) continue;
      names.add(name);
      saved.push({ name, filters: parseFilters(item.filters), inherited: inherited(item.inherited) });
    }
    return { filters: parseFilters(p.filters), inherited: inherited(p.inherited), saved, selected: saved.some(s => s.name === p.selected) ? p.selected : "" };
  } catch { return defaultMapWorkspace(); }
}
export function mapFiltersFromTable(prefs: WorkspacePreferences): MapFilters {
  return { ...defaultMapFilters(), capital: prefs.capital, minMcap: prefs.minMcap, maxMcap: prefs.maxMcap, prLimit: prefs.rangeWindow === 30 && prefs.maxPr > 0, maxPr: prefs.rangeWindow === 30 && prefs.maxPr > 0 ? prefs.maxPr : 30 };
}
export function matchesMapFilters(row: DiscoveryRow, filters: MapFilters): boolean {
  if ((filters.minMcap > 0 || filters.maxMcap > 0) && (!positive(row.mcap) || row.mcap < filters.minMcap || filters.maxMcap > 0 && row.mcap > filters.maxMcap)) return false;
  const past = row.past[filters.period]?.point, currentPr = row.cells.pr.value;
  if (filters.revenueGrowing && (!past || !positive(row.revenue30d) || row.revenue30d <= past.revenue)) return false;
  if (filters.prFalling && (!past || !positive(currentPr) || currentPr >= past.pr)) return false;
  return !filters.prLimit || !positive(filters.maxPr) || positive(currentPr) && currentPr <= filters.maxPr;
}
export function mapFilterCount(filters: MapFilters) {
  return [filters.minMcap > 0 || filters.maxMcap > 0, filters.revenueGrowing, filters.prFalling, filters.prLimit && filters.maxPr > 0].filter(Boolean).length;
}

export interface MapHitPoint { slug: string; x: number; y: number; px: number; py: number; hasPast: boolean }
/** Current points win over crossing arrows; a small hysteresis prevents flicker between nearby coins. */
export function nearestMapPoint<T extends MapHitPoint>(points: T[], x: number, y: number, active: string | null = null, radius = 20): T | undefined {
  let found: T | undefined, distance = radius;
  for (const point of points) {
    const d = Math.hypot(point.x - x, point.y - y);
    if (d <= distance) { found = point; distance = d; }
  }
  const previous = points.find(p => p.slug === active);
  if (previous && found) {
    const d = Math.hypot(previous.x - x, previous.y - y);
    if (d <= radius && d <= distance + 2) return previous;
  }
  if (found) return found;
  distance = 5;
  for (const point of points) {
    if (!point.hasPast) continue;
    const dx = point.x - point.px, dy = point.y - point.py, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - point.px) * dx + (y - point.py) * dy) / length)) : 1;
    const d = Math.hypot(x - point.px - t * dx, y - point.py - t * dy);
    if (d < distance) { distance = d; found = point; }
  }
  return found;
}
export function mapNamePosition(point: MapHitPoint, points: MapHitPoint[], labelWidth: number, width: number, height: number) {
  const h = 24, gap = 13, w = Math.min(labelWidth, width - 24);
  const candidates = [{ x: point.x + gap, y: point.y - h - 3 }, { x: point.x - w - gap, y: point.y - h - 3 }, { x: point.x + gap, y: point.y + 6 }, { x: point.x - w - gap, y: point.y + 6 }];
  return candidates.map(p => ({ x: Math.max(8, Math.min(width - w - 8, p.x)), y: Math.max(4, Math.min(height - h - 8, p.y)) }))
    .map(p => ({ ...p, score: points.filter(other => other.slug !== point.slug && other.x > p.x - 5 && other.x < p.x + w + 5 && other.y > p.y - 5 && other.y < p.y + h + 5).length }))
    .sort((a, b) => a.score - b.score)[0];
}
