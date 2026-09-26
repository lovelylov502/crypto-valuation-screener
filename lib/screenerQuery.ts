import type { ScreenerResponse } from "./types";
import { defaultPreferences, type WorkspacePreferences } from "./workspacePreferences";
import { compareTableValues, matchesRange } from "./screenerFilters";
import { holderAmount, holderMultiple, protocolMultiple } from "./valuationMetrics";
import { matchesAvailability, metricCoverage, visibleMetricCoverage } from "./metricCoverage";
import { sortValue } from "./screenerSort";
import { REVENUE_COLUMN_DAYS } from "./screenerColumns";
import { revenueTrend } from "./revenueTrend";

export interface ScreenerPage extends ScreenerResponse {
  pagination: { page: number; size: number; total: number; filtered: number; favorites: number };
  coverage: ReturnType<typeof metricCoverage>;
  visibleCoverage: ReturnType<typeof visibleMetricCoverage>;
  universe: { projects: number; linkedTokens: number; withRevenue: number; withHolder: number };
}

/** Filtering and sorting precede pagination, so search always sees the complete directory. */
export function queryScreener(data: ScreenerResponse, prefs: WorkspacePreferences = defaultPreferences(), favorites: string[] = [], page = 1, size = 100): ScreenerPage {
  const saved = new Set(favorites);
  const q = prefs.search.trim().toLocaleLowerCase();
  const rows = data.coins.filter(c => {
    if (q && !`${c.name} ${c.symbol ?? ""} ${c.slug}`.toLocaleLowerCase().includes(q)) return false;
    if (prefs.view === "favorites" && !saved.has(c.slug)) return false;
    if ((prefs.growingOnly || prefs.view === "growth") && !(revenueTrend(c, prefs.rangeWindow).delta! > 0)) return false;
    if ((prefs.holderOnly || prefs.view === "holder") && !(holderAmount(c, prefs.rangeWindow)! > 0)) return false;
    if (prefs.view === "issues" && !c.opportunities.dataIssues.length) return false;
    if (prefs.category && c.category !== prefs.category) return false;
    if (prefs.hideDilution && c.highDilution) return false;
    if (prefs.verifiedOnly && c.identityStatus !== "verified") return false;
    if (!matchesAvailability(c, prefs.available, prefs.capital, prefs.coverageWindow, false)) return false;
    return matchesRange(c.mcap, prefs.minMcap, prefs.maxMcap)
      && matchesRange(protocolMultiple(c, prefs.rangeWindow, prefs.capital), 0, prefs.maxPr)
      && matchesRange(holderMultiple(c, prefs.rangeWindow, prefs.capital), 0, prefs.maxPhr);
  });
  const days = REVENUE_COLUMN_DAYS[prefs.sortKey as keyof typeof REVENUE_COLUMN_DAYS];
  const value = (c: typeof rows[number]) => {
    if (!days) return sortValue(c, prefs.sortKey, prefs.capital);
    const trend = revenueTrend(c, days);
    return prefs.revenueSort === "percent" ? trend.percent : prefs.revenueSort === "delta" ? trend.delta : trend.current;
  };
  // Compute expensive semantic checks once per coin, not on every comparator call.
  const values = new Map(rows.map(c => [c.slug, value(c)]));
  rows.sort((a, b) => compareTableValues(values.get(a.slug) ?? null, values.get(b.slug) ?? null, prefs.sortDir)
    || (b.mcap ?? 0) - (a.mcap ?? 0) || a.slug.localeCompare(b.slug));
  const pageSize = [50, 100, 200].includes(size) ? size : 100;
  const currentPage = Math.max(1, Math.min(Number.isFinite(page) ? Math.trunc(page) : 1, Math.ceil(rows.length / pageSize) || 1));
  const coverage = metricCoverage(data.coins, prefs.capital, prefs.coverageWindow, false);
  const linked = data.coins.filter(c => c.identityStatus === "verified" && !c.capitalExclusionReason);
  const cmcGecko = new Map(linked.filter(c => c.cmcId && c.geckoId).map(c => [c.cmcId, c.geckoId]));
  const tokens = new Set(linked.flatMap(c => {
    const gecko = c.geckoId ?? cmcGecko.get(c.cmcId);
    return gecko ? [`gecko:${gecko}`] : c.cmcId ? [`cmc:${c.cmcId}`] : [];
  }));
  return { ...data, coins: rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    pagination: { page: currentPage, size: pageSize, total: data.coins.length, filtered: rows.length, favorites: data.coins.filter(c => saved.has(c.slug)).length },
    coverage, visibleCoverage: visibleMetricCoverage(rows, prefs.capital, prefs.columns),
    universe: { projects: data.coins.length, linkedTokens: tokens.size, withRevenue: coverage.revenue, withHolder: coverage.holder },
  };
}
