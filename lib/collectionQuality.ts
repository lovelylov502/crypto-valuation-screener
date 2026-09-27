import type { CoinRaw, ScreenerResponse } from "./types";
import { revenueReading } from "./revenueReading";
import { REVENUE_WINDOWS } from "./revenueHistory";

/** Availability and financial validity are separate contracts. */
export function collectionErrors(coins: CoinRaw[]): string[] {
  const errors: string[] = [], projects = new Set<string>(), components = new Set<string>();
  for (const c of coins) {
    if (projects.has(c.slug)) errors.push(`${c.slug}: duplicate project`);
    projects.add(c.slug);
    for (const slug of c.sourceSlugs ?? []) {
      if (components.has(slug)) errors.push(`${slug}: duplicate source membership`);
      components.add(slug);
    }
    if (c.marketSources) {
      if (c.geckoId && c.marketSources.gecko?.id !== c.geckoId) errors.push(`${c.slug}: unaccounted Gecko ID`);
      for (const lookup of [c.marketSources.gecko, c.marketSources.cmc]) if (lookup?.status === "received") {
        for (const field of lookup.available) if (c[field] === null) errors.push(`${c.slug}: dropped ${field}`);
      }
      for (const field of ["mcap", "price", "fdv"] as const) if ((c[field] !== null) !== (c.marketSources[field] !== null)) errors.push(`${c.slug}: ${field} source mismatch`);
    }
    for (const days of [1, 7, 30, 365] as const) {
      const raw = ({ 1: c.revenue24h, 7: c.revenue7d, 30: c.revenue30d, 365: c.revenue1y })[days];
      if ((raw != null || c.revenueSource?.periods?.[days]?.total != null) && revenueReading(c, days).amount === null) errors.push(`${c.slug}: hidden ${days}d revenue`);
    }
  }
  return errors;
}

export function marketDataReason(c: CoinRaw, field: "mcap" | "fdv" | "price") {
  if (c[field] !== null) return c.marketSources?.[field] ?? "출처 미확인";
  const lookups = [c.marketSources?.gecko, c.marketSources?.cmc].filter(v => v != null);
  if (lookups.some(v => v.status === "error")) return "시세 조회 실패 · 재수집 필요";
  if (lookups.some(v => v.status === "identity_mismatch")) return "시장 자산 식별정보 불일치";
  if (lookups.some(v => v.status === "received")) return "제공처 응답에 해당 금액 없음";
  return lookups.length ? "자산 ID 조회 완료 · 제공처 응답 없음" : "시장 자산 ID 미확인";
}

export function collectionCoverage(coins: CoinRaw[]): NonNullable<ScreenerResponse["collection"]> {
  const quotes = (vendor: "gecko" | "cmc") => {
    const lookups = new Map(coins.flatMap(c => c.marketSources?.[vendor] ? [[c.marketSources[vendor]!.id, c.marketSources[vendor]!] as const] : []));
    return { requested: lookups.size, received: [...lookups.values()].filter(v => v.status === "received" || v.status === "identity_mismatch").length,
      notReturned: [...lookups.values()].filter(v => v.status === "not_returned").length, failed: [...lookups.values()].filter(v => v.status === "error").length };
  };
  const readings = coins.map(c => revenueReading(c, 30));
  return {
    projects: coins.length, sourceSlugs: new Set(coins.flatMap(c => c.sourceSlugs ?? [c.slug])).size, errors: collectionErrors(coins).length,
    gecko: quotes("gecko"), cmc: quotes("cmc"),
    marketCap: coins.filter(c => c.mcap !== null).length, price: coins.filter(c => c.price !== null).length, fdv: coins.filter(c => c.fdv !== null).length,
    sourceRevenue30d: coins.filter(c => c.revenue30d !== null || c.revenueSource?.periods?.[30]?.total != null).length,
    displayedRevenue30d: readings.filter(r => r.amount !== null).length, partialRevenue30d: readings.filter(r => r.basis === "provider_partial").length,
  };
}

export function collectionState(data: Pick<ScreenerResponse, "coins" | "updatedAt">) {
  return { schema: 1 as const, at: data.updatedAt, coins: Object.fromEntries(data.coins.map(c => [c.slug, {
    sourceSlugs: c.sourceSlugs ?? [c.slug], identity: `${c.geckoId ?? ""}:${c.cmcId ?? ""}`,
    mcap: c.mcap, price: c.price, fdv: c.fdv,
    revenue: REVENUE_WINDOWS.map(days => revenueReading(c, days).amount),
    revenueDays: REVENUE_WINDOWS.map(days => c.revenueHistory?.periods[days]?.reportedDays ?? 0),
    holderDays: REVENUE_WINDOWS.map(days => c.holderHistory?.periods[days]?.reportedDays ?? 0),
    reviewed: c.fundamentals.revenue.components.filter(p => p.status === "matched").map(p => p.slug),
  }])) };
}
type CollectionState = ReturnType<typeof collectionState>;

/** A loss is retained for review even when HTTP and schema checks pass. No previous value is relabeled current. */
export function collectionRegressions(previous: CollectionState, next: CollectionState) {
  const changes: { slug: string; issue: string }[] = [];
  const represented = new Set(Object.values(next.coins).flatMap(c => c.sourceSlugs));
  for (const [slug, old] of Object.entries(previous.coins)) {
    const current = next.coins[slug];
    if (!current) {
      if (old.sourceSlugs.some(s => !represented.has(s))) changes.push({ slug, issue: "project_removed" });
      continue;
    }
    if (old.identity !== current.identity) changes.push({ slug, issue: "identity_changed" });
    for (const field of ["mcap", "price", "fdv"] as const) if (old[field] !== null && current[field] === null) changes.push({ slug, issue: `${field}_lost` });
    REVENUE_WINDOWS.forEach((days, i) => {
      if (old.revenue[i] !== null && current.revenue[i] === null) changes.push({ slug, issue: `revenue_${days}d_lost` });
      if (old.revenueDays[i] === days && current.revenueDays[i] < days) changes.push({ slug, issue: `revenue_${days}d_history_lost` });
      if (old.holderDays[i] === days && current.holderDays[i] < days) changes.push({ slug, issue: `holder_${days}d_history_lost` });
    });
    if (old.reviewed.some(s => !current.reviewed.includes(s))) changes.push({ slug, issue: "definition_review_lost" });
  }
  return changes;
}
