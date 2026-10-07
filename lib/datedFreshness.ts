import type { CoinRaw, ScreenerResponse } from "./types";

export const UTC_DAY_MS = 86_400_000;
export const completedUtcDate = (now: number) => new Date(Math.floor(now / UTC_DAY_MS) * UTC_DAY_MS - UTC_DAY_MS).toISOString().slice(0, 10);
export type FreshnessState = "current" | "pending" | "insufficient" | "unknown" | "unsupported" | "conflict";
export interface DatedFreshness {
  state: FreshnessState; targetDate: string; latestCompleteDate: string | null;
  scope: string; definition: string; components: { id: string; latestDate: string | null; targetPresent: boolean }[];
  missingRecentDates: string[];
  /** 730 exact complete-day flags, four per hex digit, oldest first. No financial values. */
  coverage: { start: string; end: string; bits: string } | null;
  sources: string[]; observedAt: string;
  coverageBasis?: "components" | "exact_parent";
}
export interface FreshnessSummary {
  targetDate: string; assessedTargetDate: string | null; unassessed: boolean;
  projects: number; current: number; pending: number; insufficient: number; unknown: number; unsupported: number; conflict: number;
}
const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
export function summarizeDatedFreshness(scope: string, definition: string, end: number, daily: ReadonlyMap<number, number>,
  components: { id: string; days: ReadonlySet<number> }[], source: string, asOf: string): DatedFreshness {
  const start = end - 729 * 86400;
  let bits = "";
  for (let i = 0; i < 730; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4 && i + j < 730; j++) if (daily.has(start + (i + j) * 86400)) nibble |= 1 << j;
    bits += nibble.toString(16);
  }
  const expected = !daily.has(end) && daily.has(end - 86400);
  const dates = [...daily.keys()].filter(d => d <= end).sort((a, b) => a - b);
  return { state: daily.has(end) ? "current" : expected ? "pending" : dates.length ? "insufficient" : "unknown",
    targetDate: iso(end), latestCompleteDate: dates.length ? iso(dates.at(-1)!) : null, scope, definition,
    components: components.map(c => ({ id: c.id, latestDate: c.days.size ? iso(Math.max(...c.days)) : null, targetPresent: c.days.has(end) })).sort((a,b) => a.id.localeCompare(b.id)),
    missingRecentDates: Array.from({ length: 30 }, (_, i) => end - i * 86400).filter(d => !daily.has(d)).map(iso).sort(),
    coverage: { start: iso(start), end: iso(end), bits }, sources: [source], observedAt: asOf,coverageBasis:"components" };
}
export function dateIsComplete(f: DatedFreshness, date: string): boolean {
  if (!f.coverage) return false;
  const i = (Date.parse(date) - Date.parse(f.coverage.start)) / UTC_DAY_MS;
  return Number.isInteger(i) && i >= 0 && i < 730 && !!(parseInt(f.coverage.bits[Math.floor(i / 4)], 16) & 1 << i % 4);
}
export const freshnessIdentity = (f: DatedFreshness) => JSON.stringify([f.scope, f.definition, f.components.map(c => c.id)]);

/** Applied after collection-only issues. Economic approval never gates this accounting. */
export function annotateFreshness(coins: CoinRaw[], asOf: string): CoinRaw[] {
  return coins.map(c => ({ ...c, freshness: Object.fromEntries((["revenue", "holders"] as const).map(metric => {
    const f = metric === "revenue" ? c.revenueHistory?.freshness : c.rawHolderFreshness;
    const hasSource = metric === "revenue" ? c.revenueSource?.periods !== undefined : c.holderValue.components.length > 0;
    const base: DatedFreshness = f ?? { state: hasSource ? "unknown" : "unsupported", targetDate: completedUtcDate(Date.parse(asOf)), latestCompleteDate: null,
      scope: c.slug, definition: metric === "revenue" ? c.fundamentals.revenue.fingerprint : "unknown", components: [], missingRecentDates: [], coverage: null,
      sources: metric === "revenue" && c.revenueSource ? [c.revenueSource.url] : [], observedAt: asOf };
    const conflict = c.dataQuality?.issues.some(i => i.scope === metric && ["scope_mismatch", "value_conflict", "schema_mismatch"].includes(i.code));
    const definitionConflict = f && (metric === "revenue" ? f.definition !== c.fundamentals.revenue.fingerprint : c.rawHolderDefinition !== undefined&&f.definition!==c.rawHolderDefinition);
    return [metric, conflict || definitionConflict ? { ...base, state: "conflict" as const } : base];
  })) as NonNullable<CoinRaw["freshness"]> }));
}
export function freshnessSummary(coins: CoinRaw[], asOf: string): FreshnessSummary {
  const result: FreshnessSummary = { targetDate: completedUtcDate(Date.parse(asOf)), assessedTargetDate: completedUtcDate(Date.parse(asOf)), unassessed: false,
    projects: coins.length, current: 0, pending: 0, insufficient: 0, unknown: 0, unsupported: 0, conflict: 0 };
  for (const c of coins) for (const f of Object.values(c.freshness ?? {})) result[f.state]++;
  return result;
}
export function publicFreshness(summary: FreshnessSummary | undefined, now: number): FreshnessSummary | undefined {
  if (!summary) return undefined;
  const targetDate = completedUtcDate(now);
  const unassessed=targetDate!==summary.assessedTargetDate;
  return { ...summary, targetDate, unassessed, ...(unassessed?{current:0,pending:0,insufficient:0,conflict:0,unknown:summary.current+summary.pending+summary.insufficient+summary.conflict+summary.unknown}:{}) };
}
export function freshnessAccountingErrors(data: ScreenerResponse): string[] {
  if (data.pipeline?.schema !== 2) return [];
  const errors: string[] = [];
  if (!data.freshness || JSON.stringify(data.freshness) !== JSON.stringify(freshnessSummary(data.coins, data.updatedAt))) errors.push("freshness_summary_mismatch");
  for (const c of data.coins) for (const metric of ["revenue", "holders"] as const) {
    const f = c.freshness?.[metric];
    if (!f || !["current","pending","insufficient","unknown","unsupported","conflict"].includes(f.state) || f.targetDate !== completedUtcDate(Date.parse(data.updatedAt)) ||
      !Array.isArray(f.components) || new Set(f.components.map(p => p.id)).size !== f.components.length ||
      (f.coverage && (!/^[a-f0-9]{183}$/.test(f.coverage.bits) || Date.parse(f.coverage.end) - Date.parse(f.coverage.start) !== 729 * UTC_DAY_MS)) ||
      (f.state === "current" && (!dateIsComplete(f, f.targetDate) || f.latestCompleteDate !== f.targetDate)) ||
      (f.state === "pending" && (dateIsComplete(f, f.targetDate) || !dateIsComplete(f, new Date(Date.parse(f.targetDate) - UTC_DAY_MS).toISOString().slice(0,10))))) errors.push(`freshness_invalid:${c.slug}:${metric}`);
  }
  return errors;
}
export function freshnessReason(f: DatedFreshness) {
  return ({ current: "목표 완료일 확인", pending: "최신 완료일 도착 대기", insufficient: "최신 완료일 이력 부족", unknown: "일별 관측 미확인", unsupported: "일별 집계 대상 없음", conflict: "범위·정의·금액 확인 필요" })[f.state];
}
