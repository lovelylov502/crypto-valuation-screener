/** All windows end on the same completed UTC day. Missing days never become zero. */
export type RevenueWindowDays = 7 | 30 | 90 | 365;
export interface RevenuePeriod {
  days: number;
  start: string;
  end: string;
  total: number | null;
  reportedDays: number;
}
export interface RevenueHistory {
  definitionFingerprint?: string;
  periods: Record<RevenueWindowDays, RevenuePeriod>;
  previous30: RevenuePeriod;
  weeks: RevenuePeriod[];
  source: string;
  observedAt: string;
}
type Protocol = { slug?: unknown; name?: unknown; parentProtocol?: unknown; doublecounted?: unknown };
const DAY = 86400;
const date = (timestamp: number) => new Date(timestamp * 1000).toISOString().slice(0, 10);

export function annualizedMultiple(mcap: number | null | undefined, revenue: number | null | undefined, days: number): number | null {
  if (mcap == null || revenue == null || !Number.isFinite(mcap) || !Number.isFinite(revenue) || mcap <= 0 || revenue <= 0 || !Number.isFinite(days) || days <= 0) return null;
  return mcap / (revenue * 365 / days);
}

export function revenueAmount(c: { revenueHistory?: RevenueHistory | null; revenue7d?: number | null; revenue90d?: number | null; revenue30d: number | null; revenue1y: number | null }, days: RevenueWindowDays): number | null {
  if (c.revenueHistory) return c.revenueHistory.periods[days].total;
  // Provider total1y can be a partial year. Only dated 365/365 observations are TTM.
  return ({ 7: c.revenue7d, 30: c.revenue30d, 90: c.revenue90d, 365: null })[days] ?? null;
}

export function historyMatches(c: { fundamentals?: { revenue: { fingerprint: string } }; revenueHistory?: RevenueHistory | null }): boolean {
  return !c.revenueHistory || (!!c.fundamentals && c.revenueHistory.definitionFingerprint === c.fundamentals.revenue.fingerprint);
}
export function revenueBasis(c: { revenueHistory?: RevenueHistory | null }): string {
  return c.revenueHistory ? "completed_utc" : "provider_rolling";
}

export function summarizeRevenueHistory(
  protocols: Protocol[], chart: unknown[], now: number, source: string, fingerprints: ReadonlyMap<string, { fingerprint: string }> = new Map(), identityUniverse: Protocol[] = protocols,
): Record<string, RevenueHistory> {
  const end = Math.floor(now / 1000 / DAY) * DAY - DAY;
  const groups = new Map<string, string[]>();
  const nameCounts = new Map<string, number>();
  for (const p of identityUniverse) {
    if (typeof p.name === "string") nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  }
  for (const p of protocols) {
    if (typeof p.slug !== "string" || typeof p.name !== "string" || p.doublecounted === true) continue;
    const key = typeof p.parentProtocol === "string" ? p.parentProtocol : p.slug;
    groups.set(key, [...(groups.get(key) ?? []), p.name]);
  }
  const rows = new Map<number, Record<string, unknown>>();
  for (const row of chart) {
    if (!Array.isArray(row) || typeof row[0] !== "number" || !row[1] || typeof row[1] !== "object" || Array.isArray(row[1])) continue;
    if (row[0] <= end && row[0] > end - 365 * DAY) rows.set(row[0], row[1]);
  }
  const output: Record<string, RevenueHistory> = {};
  for (const [key, names] of groups) {
    const daily = new Map<number, number>();
    if (names.every(name => nameCounts.get(name) === 1)) {
      for (const [timestamp, values] of rows) {
        const amounts = names.map(name => values[name]);
        if (amounts.every((n): n is number => typeof n === "number" && Number.isFinite(n)))
          daily.set(timestamp, amounts.reduce((sum, n) => sum + n, 0));
      }
    }
    const period = (days: number, offset = 0): RevenuePeriod => {
      const last = end - offset * DAY;
      let total = 0, reportedDays = 0;
      for (let i = 0; i < days; i++) {
        const value = daily.get(last - i * DAY);
        if (value !== undefined) { total += value; reportedDays++; }
      }
      return { days, start: date(last - (days - 1) * DAY), end: date(last), total: reportedDays === days ? total : null, reportedDays };
    };
    output[key] = {
      definitionFingerprint: fingerprints.get(key)?.fingerprint,
      periods: { 7: period(7), 30: period(30), 90: period(90), 365: period(365) },
      previous30: period(30, 30),
      weeks: Array.from({ length: 13 }, (_, i) => period(7, (12 - i) * 7)),
      source, observedAt: new Date(now).toISOString(),
    };
  }
  return output;
}
