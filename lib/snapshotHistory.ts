import type { CoinScored, ScreenerResponse } from "./types";
import type { OpportunityTrack } from "./signals";
import { researchMultiple } from "./research";
import { revenueAmount, revenueBasis, historyMatches } from "./revenueHistory";
import { holderAmount, holderHistoryMatches } from "./valuationMetrics";
import { metricComparisonAllowed } from "./fundamentals";

export const HISTORY_STORAGE_KEY = "crypto-screener-history-v1";
export const REVIEW_BASELINE_KEY = "crypto-screener-review-baseline-v1";
export interface SnapshotCoin {
  metricDefinitions?: {revenue:string;holders:string;score:string};
  definition?: string;
  basis?: string;
  identity: string;
  price: number | null;
  mcap?: number | null;
  revenueMultiple?: number | null;
  score: number | null;
  phr: number | null;
  revenue30d: number | null;
  holder30d: number | null;
  tracks: OpportunityTrack[];
}
export interface Snapshot {
  schema: 1 | 2;
  at: string;
  scoreVersion: string;
  coins: Record<string, SnapshotCoin>;
}

function identity(coin: CoinScored) {
  return `${coin.identityStatus}:${coin.cmcId ?? ""}:${coin.geckoId ?? ""}:${coin.symbol ?? ""}`;
}
const observationBasis = (coin: CoinScored) => `${revenueBasis(coin)}:${coin.revenueHistory?.definitionFingerprint ?? "none"}:holder:${coin.holderHistory?.definitionFingerprint ?? "none"}:sales:${coin.sales?.id ?? "none"}:${coin.sales?.amountUsd ?? "none"}:${coin.sales?.status ?? "none"}`;
function metricDefinitions(coin:CoinScored):SnapshotCoin["metricDefinitions"] {
  const f=coin.fundamentals;if(!f.economicPolicy)return;
  const holders=JSON.stringify([f.holders.map(p=>[p.slug,p.definition,p.decision?.basis,p.decision?.disposition,p.decision?.kind,p.decision?.holderEligible,p.decision?.holderType,p.decision?.requiredFields,p.decision?.recipient,p.decision?.funding,p.decision?.temporal,p.decision?.comparabilityBoundary]),coin.holderHistory?.definitionFingerprint??null]);
  const revenue=JSON.stringify([f.revenue.fingerprint,revenueBasis(coin),coin.revenueHistory?.definitionFingerprint??null]);
  return {revenue,holders,score:JSON.stringify([revenue,f.fees.fingerprint,holders,coin.sales?.id??null,coin.sales?.amountUsd??null,coin.sales?.status??null])};
}
export function makeSnapshot(data: ScreenerResponse): Snapshot {
  return {
    schema: 2,
    at: data.updatedAt,
    scoreVersion: data.scoreVersion,
    coins: Object.fromEntries(
      data.coins.map((c) => [
        c.slug,
        {
          identity: identity(c),
          definition: c.fundamentals.fingerprint,
          ...(metricDefinitions(c)?{metricDefinitions:metricDefinitions(c)}:{}),
          basis: observationBasis(c),
          price: c.price,
          mcap: c.mcap,
          revenueMultiple: researchMultiple(c),
          score: c.valueScore,
          phr: c.multiples.phr,
          revenue30d: revenueAmount(c, 30),
          holder30d: holderAmount(c, 30),
          tracks: (["business", "holder", "transition"] as const).filter(
            (track) => c.opportunities[track],
          ),
        },
      ]),
    ),
  };
}

export function parseHistory(raw: string | null): Snapshot[] {
  try {
    const data: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(data) || data.length > 60) return [];
    return data
      .filter((s): s is Snapshot => {
        if (
          !s ||
          ![1, 2].includes(s.schema) ||
          !Number.isFinite(Date.parse(s.at)) ||
          typeof s.scoreVersion !== "string" ||
          !s.coins ||
          typeof s.coins !== "object" ||
          Array.isArray(s.coins)
        )
          return false;
        return Object.values(s.coins).every((v: unknown) => {
          if (!v || typeof v !== "object") return false;
          const c = v as SnapshotCoin;
          return (
            typeof c.identity === "string" &&
            (s.schema === 1 || (typeof c.definition === "string" && typeof c.basis === "string")) &&
            (c.metricDefinitions===undefined||!!c.metricDefinitions&&[c.metricDefinitions.revenue,c.metricDefinitions.holders,c.metricDefinitions.score].every(v=>typeof v==="string"))&&
            [c.price, c.score, c.phr, c.revenue30d, c.holder30d].every(
              (n) =>
                n === null || (typeof n === "number" && Number.isFinite(n)),
            ) &&
            [c.revenueMultiple, c.mcap].every(n => n === undefined || n === null || (typeof n === "number" && Number.isFinite(n))) &&
            Array.isArray(c.tracks) &&
            c.tracks.every((t) =>
              ["business", "holder", "transition"].includes(t),
            )
          );
        });
      })
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  } catch {
    return [];
  }
}

const kstDay = (iso: string) =>
  new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
export function appendSnapshot(
  history: Snapshot[],
  next: Snapshot,
): Snapshot[] {
  const latest = history.at(-1);
  if (latest && Date.parse(latest.at) >= Date.parse(next.at)) return history;
  const cutoff = Date.parse(next.at) - 60 * 86_400_000;
  return [
    ...history.filter(
      (s) => kstDay(s.at) !== kstDay(next.at) && Date.parse(s.at) > cutoff,
    ),
    next,
  ].slice(-60);
}

export interface SnapshotChange {
  revenueComparable?:boolean;
  state: "first" | "new" | "rules_changed" | "identity_changed" | "definition_changed" | "comparable";
  added: OpportunityTrack[];
  scoreDelta: number | null;
  phrDelta: number | null;
  multipleDelta: number | null;
  revenueDelta: number | null;
  holderDelta: number | null;
  meaningful: boolean;
}
export function compareSnapshot(
  coin: CoinScored,
  baseline: Snapshot | null,
  version: string,
): SnapshotChange {
  const empty: SnapshotChange = {
    state: "first",
    added: [],
    scoreDelta: null,
    phrDelta: null,
    multipleDelta: null,
    revenueDelta: null,
    holderDelta: null,
    meaningful: false,
  };
  if (!baseline) return empty;
  if (baseline.schema !== 2 || baseline.scoreVersion !== version)
    return { ...empty, state: "rules_changed" };
  const previous = Object.hasOwn(baseline.coins, coin.slug)
    ? baseline.coins[coin.slug]
    : undefined;
  if (!previous) return { ...empty, state: "new", meaningful: true };
  if (previous.identity !== identity(coin))
    return { ...empty, state: "identity_changed" };
  const currentMetrics=metricDefinitions(coin),scoped=!!currentMetrics&&!!previous.metricDefinitions;
  if (!scoped&&(!historyMatches(coin) || (coin.holderHistory && !holderHistoryMatches(coin)) || previous.definition !== coin.fundamentals.fingerprint || previous.basis !== observationBasis(coin)))
    return { ...empty, state: "definition_changed" };
  const revenueComparable=!scoped||previous.metricDefinitions!.revenue===currentMetrics!.revenue&&historyMatches(coin)&&metricComparisonAllowed(coin,"Revenue",30);
  const holderComparable=!scoped||previous.metricDefinitions!.holders===currentMetrics!.holders&&(!coin.holderHistory||holderHistoryMatches(coin));
  const scoreComparable=!scoped||previous.metricDefinitions!.score===currentMetrics!.score&&revenueComparable&&holderComparable;
  const delta = (a: number | null, b: number | null) =>
    a !== null && b !== null ? a - b : null;
  const added = (["business", "holder", "transition"] as const).filter(
    (t) => (t==="holder"?holderComparable:scoreComparable)&&coin.opportunities[t] && !previous.tracks.includes(t),
  );
  const scoreDelta = scoreComparable?delta(coin.valueScore, previous.score):null;
  const phrDelta = holderComparable?delta(coin.multiples.phr, previous.phr):null;
  const revenueDelta = revenueComparable?delta(revenueAmount(coin, 30), previous.revenue30d):null;
  const holderDelta = holderComparable?delta(
    holderAmount(coin, 30),
    previous.holder30d,
  ):null;
  // Change filter suppresses quote noise; all exact deltas remain available in the detail.
  const materialFlow = (d: number | null, prev: number | null) =>
    d !== null &&
    prev !== null &&
    Math.abs(d) >= Math.max(100, Math.abs(prev) * 0.05);
  const removed = previous.tracks.some((t) => (t==="holder"?holderComparable:scoreComparable)&&!coin.opportunities[t]);
  return {
    state: "comparable",
    ...(scoped?{revenueComparable}:{}),
    added,
    scoreDelta,
    phrDelta,
    multipleDelta: revenueComparable?delta(researchMultiple(coin), previous.revenueMultiple ?? null):null,
    revenueDelta,
    holderDelta,
    meaningful:
      added.length > 0 ||
      removed ||
      materialFlow(revenueDelta, previous.revenue30d) ||
      materialFlow(holderDelta, previous.holder30d),
  };
}
