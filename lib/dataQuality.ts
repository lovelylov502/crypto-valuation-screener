import type { CoinRaw, DataQualityIssue, DataQualityScope, SourceObservation } from "./types";
import type { RevenueHistory } from "./revenueHistory";

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const providerName = { gecko: "CoinGecko", cmc: "CoinMarketCap" } as const;
const requiredSourceUrls = new Set([
  "https://api.llama.fi/protocols", "https://api.llama.fi/config",
  "https://stablecoins.llama.fi/stablecoins?includePrices=true",
  ...["/overview/fees", "/overview/fees?dataType=dailyRevenue", "/overview/fees?dataType=dailyHoldersRevenue", "/overview/dexs"]
    .map(path => `https://api.llama.fi${path}${path.includes("?") ? "&" : "?"}excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`),
  ...["dailyRevenue", "dailyHoldersRevenue"]
    .map(metric => `https://api.llama.fi/overview/fees?dataType=${metric}&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false`),
]);

function sourceTarget(s: SourceObservation) {
  try {
    const url = new URL(s.url);
    if (url.hostname === "api.llama.fi" && /^\/summary\/fees\/[^/]+$/.test(url.pathname)) {
      const scope = ({ dailyRevenue: "revenue", dailyHoldersRevenue: "holders", dailyFees: "fees" } as const)[url.searchParams.get("dataType") as "dailyRevenue" | "dailyHoldersRevenue" | "dailyFees"];
      return scope ? { kind: "summary" as const, scope, slug: decodeURIComponent(url.pathname.split("/").at(-1)!) } : null;
    }
    if (url.hostname === "api.llama.fi" && ["/overview/fees","/overview/dexs"].includes(url.pathname) && s.status === "withheld" &&
      s.sourceSlugs?.length && ["schema_mismatch","value_conflict"].includes(s.reason ?? "")) {
      const scope = url.pathname === "/overview/dexs" ? "volume" as const : url.searchParams.get("dataType") === "dailyHoldersRevenue" ? "holders" as const
        : url.searchParams.get("dataType") === "dailyRevenue" ? "revenue" as const : "fees" as const;
      return {kind:"scoped" as const,scope};
    }
    if(url.hostname === "api.llama.fi" && ["/protocols","/config"].includes(url.pathname) && s.status === "withheld" && s.reason === "schema_mismatch" && s.sourceSlugs?.length) {
      return {kind:"scoped" as const,scope:"market" as const};
    }
    if (url.hostname === "pro-api.coinmarketcap.com" && url.pathname === "/public-api/v3/cryptocurrency/listings/latest") {
      if(s.status === "withheld" && s.reason === "schema_mismatch" && s.quoteIds?.length) return {kind:"market" as const,scope:"market" as const,vendor:"cmc" as const,ids:[...new Set(s.quoteIds)]};
      return { kind: "discovery" as const, scope: "market" as const };
    }
    const vendor = url.hostname === "api.coingecko.com" && url.pathname === "/api/v3/coins/markets" ? "gecko"
      : url.hostname === "pro-api.coinmarketcap.com" && url.pathname === "/public-api/v3/cryptocurrency/quotes/latest" ? "cmc" : null;
    if (vendor) {
      const ids = url.searchParams.get(vendor === "gecko" ? "ids" : "id")?.split(",").filter(Boolean) ?? [];
      if(s.quoteIds && !s.quoteIds.every(id=>ids.includes(id))) return null;
      if (ids.length) return { kind: "market" as const, scope: "market" as const, vendor: vendor as "gecko" | "cmc", ids: [...new Set(s.quoteIds ?? ids)] };
    }
  } catch { /* Invalid/unrecognized source evidence remains a global failure. */ }
  return null;
}

/** Endpoint classification only; publication additionally requires exact per-row accounting. */
export function sourceCanBeLocal(s: SourceObservation): boolean {
  return sourceTarget(s) !== null;
}

function affectedRows(s: SourceObservation, coins: CoinRaw[]): CoinRaw[] {
  const target = sourceTarget(s);
  if (!target) return [];
  // Discovery attempts exact project-slug links across the whole directory. Its
  // outage is disclosed even where independently fetched current quotes survive.
  if (target.kind === "discovery") return coins;
  if (target.kind === "market") {
    const rows = coins.filter(c => marketRequests(c,target.vendor).some(q=>target.ids.includes(q.id)));
    return target.ids.every(id => rows.some(c => marketRequests(c,target.vendor).some(q=>q.id===id))) ? rows : [];
  }
  if (s.sourceSlugs?.length) {
    const rows = coins.filter(c => s.sourceSlugs!.some(slug => (c.sourceSlugs ?? [c.slug]).includes(slug)));
    return s.sourceSlugs.every(slug => rows.some(c => (c.sourceSlugs ?? [c.slug]).includes(slug))) ? rows : [];
  }
  if (target.kind === "scoped") return [];
  return coins.filter(c => (c.sourceSlugs ?? [c.slug]).includes(target.slug) || c.slug === `parent#${target.slug}` ||
    [c.revenueHistory, c.holderHistory].some(h => h?.source === s.url || h?.supplementalSources?.includes(s.url)));
}

function marketRequests(c:CoinRaw,vendor:"gecko"|"cmc") {
  const selected=c.marketSources?.[vendor];
  return [...(c.marketSources?.requests?.[vendor] ?? []),...(selected ? [selected] : [])];
}

function issueFor(s: SourceObservation): DataQualityIssue | null {
  const target = sourceTarget(s);
  if (!target || s.status === "ok") return null;
  return { scope: target.scope, code: s.reason ?? (target.kind === "discovery" ? "discovery_failed" : s.status === "error" ? "request_failed" : "source_withheld"), source: s.url,
    retryable: s.status === "error" && (s.httpStatus === undefined || s.httpStatus === 408 || s.httpStatus === 429 || s.httpStatus >= 500) };
}

function withholdHistory(history: RevenueHistory | null | undefined) {
  if (!history) return history;
  const withheld = (p: RevenueHistory["previous30"]) => ({ ...p, total: null });
  return { ...history,
    periods: Object.fromEntries(Object.entries(history.periods).map(([days, p]) => [days, withheld(p)])) as RevenueHistory["periods"],
    previous: history.previous && Object.fromEntries(Object.entries(history.previous).map(([days, p]) => [days, withheld(p)])) as RevenueHistory["previous"],
    previous30: withheld(history.previous30), weeks: history.weeks.map(withheld), peakDayShare7d: null,
  };
}

/** Preserve current independently observed amounts. Never borrow values from an older publication. */
export function annotateDataQuality(raw: CoinRaw[], observations: SourceObservation[]): CoinRaw[] {
  const issues = new Map(raw.map(c => [c.slug, [] as DataQualityIssue[]]));
  for (const s of observations) {
    const issue = issueFor(s);
    if (!issue) continue;
    for (const c of affectedRows(s, raw)) {
      const list = issues.get(c.slug)!;
      if (!list.some(p => p.scope === issue.scope && p.code === issue.code && p.source === issue.source)) list.push(issue);
    }
  }
  return raw.map(c => {
    const local = issues.get(c.slug)!;
    const conflict = (scope: DataQualityScope) => local.some(i => i.scope === scope && i.code === "value_conflict");
    const next = { ...c, revenueHistory: conflict("revenue") ? withholdHistory(c.revenueHistory) : c.revenueHistory,
      holderHistory: conflict("holders") ? withholdHistory(c.holderHistory) : c.holderHistory };
    const available = [next.price, next.mcap, next.fdv, next.tvl, next.fees7d, next.fees30d, next.fees1y, next.revenue24h, next.revenue7d, next.revenue30d,
      next.revenue90d, next.revenue1y, next.holderValue.rawCurrent30d, next.holderValue.rawTtm, next.volume30d, next.volumeAnnual,
      ...Object.values(next.revenueHistory?.periods ?? {}).map(p => p.total), ...Object.values(next.holderHistory?.periods ?? {}).map(p => p.total),
      ...Object.values(next.revenueSource?.periods ?? {}).map(p => p.total)].some(finite);
    return { ...next, dataQuality: { state: local.length ? available ? "partial" as const : "unavailable" as const : "complete" as const, issues: local } };
  });
}

/** Only exact, fully accounted local failures may cross the publication boundary. */
export function scopedSourceErrors(observations: SourceObservation[], coins: CoinRaw[]): string[] {
  const errors: string[] = [];
  for (const s of observations) {
    if (!["ok", "error", "withheld"].includes(s.status) || !Number.isFinite(Date.parse(s.observedAt)) ||
      (s.reason !== undefined && !["scope_mismatch", "value_conflict", "request_budget", "schema_mismatch"].includes(s.reason)) ||
      (s.quoteIds !== undefined && (s.status !== "withheld" || s.reason !== "schema_mismatch" || !Array.isArray(s.quoteIds) || !s.quoteIds.length || s.quoteIds.some(id=>typeof id !== "string" || !id))) ||
      (s.sourceSlugs !== undefined && (!Array.isArray(s.sourceSlugs) || !s.sourceSlugs.length || s.sourceSlugs.some(slug => typeof slug !== "string" || !slug)))) {
      errors.push(`invalid_source_observation:${s.url}`);
      continue;
    }
    if (s.status === "ok") continue;
    // Required sources still block publication, but known transport failures can
    // retry. A malformed HTTP 200 response remains a validation failure.
    if (s.status === "error" && (s.reason === undefined || s.reason==="request_budget") && requiredSourceUrls.has(s.url) &&
      (s.httpStatus === undefined || s.httpStatus >= 400)) {
      errors.push(`source_request_failed:${s.httpStatus ?? "network"}:${s.url}`);
      continue;
    }
    const target = sourceTarget(s), issue = issueFor(s), rows = affectedRows(s, coins);
    let accounted = !!issue && rows.length > 0 && rows.every(c => c.dataQuality?.issues.some(i => i.source === s.url && i.scope === issue.scope && i.code === issue.code));
    if (target?.kind === "market") accounted &&= rows.every(c => {
      if(s.status === "withheld" && s.reason === "schema_mismatch" && s.quoteIds?.length) return marketRequests(c,target.vendor).some(q=>target.ids.includes(q.id));
      const q = c.marketSources?.[target.vendor];
      const failed=marketRequests(c,target.vendor).filter(lookup=>target.ids.includes(lookup.id));
      const retained=(["mcap", "price", "fdv"] as const).some(field => c.marketSources?.[field] === providerName[target.vendor]);
      return failed.length > 0 && failed.every(lookup=>lookup.status === "error" && lookup.available.length === 0 && !lookup.positive?.length) &&
        (!retained || (!!q && !target.ids.includes(q.id) && q.status === "received"));
    });
    if (!accounted) errors.push(`unaccounted_source_${s.status}:${s.url}`);
  }
  for (const c of coins) for (const vendor of ["gecko", "cmc"] as const) for (const q of marketRequests(c,vendor)) if (q.status === "error" &&
    !observations.some(s => { const t = sourceTarget(s); return s.status === "error" && t?.kind === "market" && t.vendor === vendor && t.ids.includes(q.id); })) {
    errors.push(`unaccounted_market_failure:${c.slug}:${vendor}`);
  }
  return [...new Set(errors)];
}

export function dataQualitySummary(coins: CoinRaw[]) {
  return { affectedProjects: coins.filter(c => c.dataQuality?.issues.length).length,
    issueCount: coins.reduce((n, c) => n + (c.dataQuality?.issues.length ?? 0), 0) };
}

export function hasDataQualityConflict(coin: Pick<CoinRaw, "dataQuality">, scope: DataQualityScope): boolean {
  return coin.dataQuality?.issues.some(i => i.scope === scope && i.code === "value_conflict") ?? false;
}

export const DATA_QUALITY_SCOPE_LABELS: Record<DataQualityScope, string> = { market: "시세", revenue: "수익", holders: "홀더 환원", fees: "수수료", volume: "거래량" };
export function dataQualityReason(issue: DataQualityIssue): string {
  const label = DATA_QUALITY_SCOPE_LABELS[issue.scope];
  const reason = issue.code === "value_conflict" ? "원천 금액 충돌 · 해당 이력 계산 보류"
    : issue.code === "schema_mismatch" ? "원천 값 형식 오류 · 해당 값 보류"
    : issue.code === "discovery_failed" ? "시장 자산 목록 조회 실패 · 연결 범위 확인 필요"
    : issue.code === "scope_mismatch" ? "원천 집계 범위 불일치 · 이력 보완 보류"
    : issue.code === "request_budget" ? "추가 이력 조회 대기"
    : issue.code === "request_failed" ? "원천 조회 실패" : "원천 확인 필요";
  return `${label} · ${reason}`;
}
