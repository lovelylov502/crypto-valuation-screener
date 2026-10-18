import { createHash } from "node:crypto";
import { annualizedMultiple, REVENUE_WINDOWS } from "./revenueHistory";
import { sameHistoryIdentity } from "./completeHistorySource";
import { sameParentScope } from "./parentHistorySource";
import { eligibleCapital } from "./capitalEligibility";
import type { CoinRaw } from "./types";
import type { SourceBundle, SourceReceipt } from "./sourceBundle";

export const HISTORY_VERSION = "daily-reference-v1";
export const DAY_MS = 86_400_000;
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const shiftDay = (day: string, days: number) => utcDay(Date.parse(day) + days * DAY_MS);
export const historyHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): number | null => finite(n) && n > 0 ? n : null;
export type FlowState = "complete" | "partial" | "missing" | "conflict";
export interface FlowPoint { value: number | null; state: FlowState; source: string; scope: string }
export interface FundamentalDay { day: string; revenue: FlowPoint; holders: FlowPoint }
export interface MarketDay {
  day: string; price: number | null; mcap: number | null; fdv: number | null;
  marketAt: string; fdvAt: string | null; marketSource: string; fdvSource: string | null;
  basis: "utc_midnight" | "captured_quote";
  identity?: string;
}
export const historyIdentity=(coin:Pick<CoinRaw,"geckoId"|"cmcId">)=>coin.geckoId?`gecko:${coin.geckoId}`:coin.cmcId?`cmc:${coin.cmcId}`:"unlinked";
export interface ValuationDay {
  day: string; days: number; revenue: number | null; holders: number | null;
  revenueDays: number; holderDays: number; prMcap: number | null; prFdv: number | null;
  phrMcap: number | null; phrFdv: number | null; revenueReason: string | null; holderReason: string | null;
}
export interface HistorySource { id: string; url: string; observedAt: string; archiveUrl: string; sha256: string }
type Row = Record<string, unknown>;
const blank = (): FlowPoint => ({ value: null, state: "missing", source: "", scope: "" });
const different = (a: number, b: number) => Math.abs(a - b) > Math.max(1, Math.abs(a), Math.abs(b)) * 1e-8;

/** Full dated source history, independent of economic review. No pre-launch zero filling. */
export function extractFundamentals(bundle: SourceBundle, archiveUrl: string) {
  const result = new Map<string, Map<string, FundamentalDay>>();
  const sources = new Map<string, HistorySource>();
  const lastDay = shiftDay(utcDay(Date.parse(bundle.asOf)), -1);
  const register = (r: SourceReceipt) => {
    const id = historyHash([r.url, r.observedAt, r.sha256]);
    sources.set(id, { id, url: r.url, observedAt: r.observedAt, archiveUrl, sha256: r.sha256 });
    return id;
  };
  const read = (r: SourceReceipt): Row | null => {
    if (r.status !== 200 || r.error) return null;
    try { return JSON.parse(r.body) as Row; } catch { return null; }
  };
  for (const [metric, dataType] of [["revenue", "dailyRevenue"], ["holders", "dailyHoldersRevenue"]] as const) {
    const receipt = bundle.receipts.find(r => r.status === 200 && new URL(r.url).pathname === "/overview/fees"
      && new URL(r.url).searchParams.get("dataType") === dataType && new URL(r.url).searchParams.get("excludeTotalDataChartBreakdown") === "false");
    if (!receipt) continue;
    const overview = read(receipt);
    if (!Array.isArray(overview?.protocols) || !Array.isArray(overview.totalDataChartBreakdown)) continue;
    const source = register(receipt), protocols = overview.protocols as Row[];
    const counts = new Map<string, number>();
    for (const p of protocols) counts.set(String(p.name), (counts.get(String(p.name)) ?? 0) + 1);
    const groups = new Map<string, Row[]>();
    for (const p of protocols) if (typeof p.slug === "string" && typeof p.name === "string" && p.doublecounted !== true) {
      const key = String(p.parentProtocol ?? p.slug);
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const rows = new Map<string, Row>(), conflicts = new Set<string>();
    for (const point of overview.totalDataChartBreakdown) {
      if (!Array.isArray(point) || !finite(point[0]) || point[0] % 86400 !== 0 || !point[1] || typeof point[1] !== "object" || Array.isArray(point[1])) continue;
      const day = utcDay(point[0] * 1000);
      if (day > lastDay) continue;
      if (rows.has(day) && JSON.stringify(rows.get(day)) !== JSON.stringify(point[1])) conflicts.add(day);
      rows.set(day, point[1] as Row);
    }
    const summaries = bundle.receipts.filter(r => r.status === 200 && new URL(r.url).pathname.startsWith("/summary/fees/") && new URL(r.url).searchParams.get("dataType") === dataType)
      .map(r => ({ receipt: r, data: read(r) })).filter((r): r is {receipt: SourceReceipt; data: Row} => !!r.data);
    for (const [key, members] of groups) {
      const scope = historyHash(members.map(p => [p.slug, p.defillamaId, p.methodology]).sort());
      const series = new Map<string, FlowPoint>();
      const unique = members.every(p => counts.get(String(p.name)) === 1);
      for (const [day, values] of rows) {
        const amounts = members.map(p => values[String(p.name)]);
        const available = amounts.filter(finite);
        if (!available.length) continue;
        series.set(day, { value: unique ? available.reduce((a, b) => a + b, 0) : null,
          state: !unique || conflicts.has(day) ? "conflict" : available.length === members.length ? "complete" : "partial", source, scope });
      }
      // Prefer only an exact parent total, or the exact single component. No partial child sum is promoted.
      const summary = summaries.find(({data}) => key.startsWith("parent#") ? sameParentScope(key, members, data) : members.length === 1 && sameHistoryIdentity(members[0], data));
      if (summary && Array.isArray(summary.data.totalDataChart)) {
        const id = register(summary.receipt), seen = new Map<string, number>();
        for (const point of summary.data.totalDataChart) {
          if (!Array.isArray(point) || !finite(point[0]) || point[0] % 86400 !== 0 || !finite(point[1])) continue;
          const day = utcDay(point[0] * 1000);
          if (day > lastDay) continue;
          const old = series.get(day), duplicate = seen.get(day);
          const conflict = old?.state === "conflict" || old?.state === "complete" && old.value !== null && different(old.value, point[1])
            || duplicate !== undefined && different(duplicate, point[1]);
          seen.set(day, point[1]);
          series.set(day, { value: conflict ? null : point[1], state: conflict ? "conflict" : "complete", source: id, scope });
        }
      }
      const target = result.get(key) ?? new Map<string, FundamentalDay>();
      for (const [day, point] of series) {
        const row = target.get(day) ?? { day, revenue: blank(), holders: blank() };
        row[metric] = point; target.set(day, row);
      }
      result.set(key, target);
    }
  }
  return { series: new Map([...result].map(([key, rows]) => [key, [...rows.values()].sort((a,b) => a.day.localeCompare(b.day))])), sources: [...sources.values()] };
}

/** CoinGecko daily points are at UTC midnight. Intraday tail points are never daily closes. */
export function parseMarketChart(data: unknown, source: string, now: number): MarketDay[] {
  const body = data as { prices?: unknown; market_caps?: unknown };
  if (!Array.isArray(body?.prices) || !Array.isArray(body.market_caps)) throw Error("Invalid historical market response");
  const points = (values: unknown[]) => {
    const map = new Map<number, number | null>();
    for (const p of values) if (Array.isArray(p) && finite(p[0]) && p[0] % DAY_MS === 0 && p[0] <= now) {
      const value = positive(p[1]);
      map.set(p[0], map.has(p[0]) && map.get(p[0]) !== value ? null : value);
    }
    return map;
  };
  const prices = points(body.prices), caps = points(body.market_caps);
  return [...new Set([...prices.keys(), ...caps.keys()])].sort((a,b) => a-b).map(t => ({
    day: utcDay(t), price: prices.get(t) ?? null, mcap: caps.get(t) ?? null, fdv: null,
    marketAt: new Date(t).toISOString(), fdvAt: null, marketSource: source, fdvSource: null, basis: "utc_midnight",
  }));
}

/** Archived quotes retain their actual time and identity; never recast a current quote as a past day. */
export function snapshotMarket(coin: CoinRaw, current: CoinRaw, source: string, asOf: string): MarketDay | null {
  if (!eligibleCapital(coin) || !eligibleCapital(current) || !coin.marketDataUpdatedAt) return null;
  // updatedAt/asOf is collection START, while provider requests finish later.
  // Use the captured response receipt time to validate the quote timestamp.
  const provider=coin.marketSources?.price === "CoinGecko" ? coin.marketSources.gecko : coin.marketSources?.price === "CoinMarketCap" ? coin.marketSources.cmc : null;
  const t = Date.parse(coin.marketDataUpdatedAt), captured = Date.parse(provider?.observedAt ?? asOf);
  if (!Number.isFinite(t) || !Number.isFinite(captured) || t > captured || captured - t > 12 * 3600_000) return null;
  const same = (provider: string | null | undefined) => provider === "CoinGecko"
    ? !!coin.geckoId && coin.geckoId === current.geckoId
    : provider === "CoinMarketCap" && !!coin.cmcId && coin.cmcId === current.cmcId
      && ["source-id", "contract", "retained"].includes(current.cmcIdentity?.basis ?? "")
      && !(coin.geckoId && current.geckoId && coin.geckoId !== current.geckoId);
  const price = same(coin.marketSources?.price) ? positive(coin.price) : null;
  // The legacy snapshot timestamps its preferred price provider only. Do not
  // assign that timestamp to a fallback provider's capital observation.
  const timed = (provider: string | null | undefined) => same(provider) && provider === coin.marketSources?.price;
  const mcap = timed(coin.marketSources?.mcap) ? positive(coin.mcap) : null;
  let fdv = timed(coin.marketSources?.fdv) ? positive(coin.fdv) : null;
  if (mcap && fdv && fdv < mcap * .95) fdv = null;
  if (!price && !mcap && !fdv) return null;
  return { day: utcDay(t), price, mcap, fdv, marketAt: coin.marketDataUpdatedAt, fdvAt: fdv ? coin.marketDataUpdatedAt : null,
    marketSource: source, fdvSource: fdv ? source : null, basis: "captured_quote", identity:historyIdentity(current) };
}

export function mergeMarket(old: MarketDay | undefined, next: MarketDay): MarketDay {
  if (!old) return next;
  if(old.identity!==next.identity)return next;
  // Midnight historical quotes take precedence; missing FDV is never inferred from supply or market cap.
  const preferNext = next.basis === "utc_midnight" && old.basis !== "utc_midnight" || next.basis === old.basis && next.marketAt >= old.marketAt;
  const market = preferNext && (next.mcap !== null || next.price !== null) ? next : old;
  const fdv = next.fdv !== null && (!old.fdvAt || next.fdvAt! >= old.fdvAt) ? next : old;
  return { ...market, fdv: fdv.fdv, fdvAt: fdv.fdvAt, fdvSource: fdv.fdvSource };
}

/** Date D uses that day's quote and complete revenue dates ending D-1: never look ahead into D. */
export function calculateDailyValuations(fundamentals: FundamentalDay[], markets: MarketDay[], eligible: boolean): ValuationDay[] {
  const flows = new Map(fundamentals.map(p => [p.day, p]));
  const dates=[...flows.keys(),...markets.map(p=>p.day)].sort();
  if(!dates.length)return [];
  const start=Math.floor(Date.parse(dates[0])/DAY_MS)-365,end=Math.floor(Date.parse(dates.at(-1)!)/DAY_MS);
  const prefix=(metric:"revenue"|"holders")=>{
    const sums=[0],counts=[0],conflicts=[0],boundaries=[0];let lastScope="";
    for(let d=start;d<=end;d++){
      const point=flows.get(utcDay(d*DAY_MS))?.[metric],complete=point?.state==="complete"&&finite(point.value);
      sums.push(sums.at(-1)!+(complete?point.value!:0));counts.push(counts.at(-1)!+Number(complete));
      conflicts.push(conflicts.at(-1)!+Number(point?.state==="conflict"));
      boundaries.push(boundaries.at(-1)!+Number(!!lastScope&&!!point?.scope&&lastScope!==point.scope));
      if(point?.scope)lastScope=point.scope;
    }
    return {sums,counts,conflicts,boundaries};
  };
  const prefixes={revenue:prefix("revenue"),holders:prefix("holders")};
  const result: ValuationDay[] = [];
  for (const market of markets) for (const days of REVENUE_WINDOWS) {
    const total = (metric: "revenue" | "holders") => {
      const hi=Math.floor(Date.parse(market.day)/DAY_MS)-start,lo=hi-days,p=prefixes[metric];
      const sum=p.sums[hi]-p.sums[lo],count=p.counts[hi]-p.counts[lo],conflict=p.conflicts[hi]>p.conflicts[lo];
      const changed=p.boundaries[hi]>p.boundaries[lo+1],complete=count===days&&!conflict&&!changed;
      return { value: complete ? sum : null, count, reason: conflict ? "source_conflict" : changed ? "scope_changed" : !complete ? "incomplete_window" : sum <= 0 ? "nonpositive_denominator" : null };
    };
    const r = total("revenue"), h = total("holders");
    const ratio = (capital: number | null, amount: number | null) => {
      const n = eligible ? annualizedMultiple(capital, amount, days) : null;
      return finite(n) && n > 0 ? n : null;
    };
    result.push({ day: market.day, days, revenue: r.value, holders: h.value, revenueDays: r.count, holderDays: h.count,
      prMcap: ratio(market.mcap, r.value), prFdv: ratio(market.fdv, r.value), phrMcap: ratio(market.mcap, h.value), phrFdv: ratio(market.fdv, h.value),
      revenueReason: eligible ? r.reason : "unverified_token", holderReason: eligible ? h.reason : "unverified_token" });
  }
  return result;
}
