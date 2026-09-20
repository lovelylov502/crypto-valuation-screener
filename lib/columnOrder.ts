import type { SortKey } from "./screenerColumns";

export const PERIOD_COLUMNS: Record<"pr" | "phr", SortKey[]> = {
  pr: ["pr1y", "pr90d", "pr", "pr7d"],
  phr: ["phr1y", "phr90d", "phr", "phr7d"],
};

/** Move one column, retaining every other column's relative order. */
export function reorderColumn(columns: SortKey[], from: SortKey, to: SortKey): SortKey[] {
  const start = columns.indexOf(from), end = columns.indexOf(to);
  if (start < 0 || end < 0 || start === end) return columns;
  const next = [...columns];
  next.splice(start, 1);
  next.splice(end, 0, from);
  return next;
}

/** Insert a newly selected period beside its metric without resetting custom order. */
export function addColumn(columns: SortKey[], key: SortKey): SortKey[] {
  if (columns.includes(key)) return columns;
  const family = Object.values(PERIOD_COLUMNS).find(keys => keys.includes(key));
  if (!family) return [...columns, key];
  const later = columns.findIndex(k => family.includes(k) && family.indexOf(k) > family.indexOf(key));
  const last = columns.findLastIndex(k => family.includes(k));
  const at = later >= 0 ? later : last >= 0 ? last + 1 : columns.length;
  return [...columns.slice(0, at), key, ...columns.slice(at)];
}

/** Explicit four-period action groups that metric at its first current position. */
export function showMetricPeriods(columns: SortKey[], metric: "pr" | "phr"): SortKey[] {
  const family = PERIOD_COLUMNS[metric];
  const first = columns.findIndex(k => family.includes(k));
  const at = first < 0 ? columns.length : first;
  const others = columns.filter(k => !family.includes(k));
  return [...others.slice(0, at), ...family, ...others.slice(at)];
}
