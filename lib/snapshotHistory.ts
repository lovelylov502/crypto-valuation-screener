import type { CoinScored, ScreenerResponse } from "./types";
import type { OpportunityTrack } from "./signals";

export const HISTORY_STORAGE_KEY = "crypto-screener-history-v1";
export interface SnapshotCoin {
  identity: string;
  price: number | null;
  score: number | null;
  phr: number | null;
  revenue30d: number | null;
  holder30d: number | null;
  tracks: OpportunityTrack[];
}
export interface Snapshot {
  schema: 1;
  at: string;
  scoreVersion: string;
  coins: Record<string, SnapshotCoin>;
}

function identity(coin: CoinScored) {
  return `${coin.identityStatus}:${coin.cmcId ?? ""}:${coin.geckoId ?? ""}:${coin.symbol ?? ""}`;
}
export function makeSnapshot(data: ScreenerResponse): Snapshot {
  return {
    schema: 1,
    at: data.updatedAt,
    scoreVersion: data.scoreVersion,
    coins: Object.fromEntries(
      data.coins.map((c) => [
        c.slug,
        {
          identity: identity(c),
          price: c.price,
          score: c.valueScore,
          phr: c.multiples.phr,
          revenue30d: c.revenue30d,
          holder30d: c.holderValue.eligibleCurrent30d,
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
          s.schema !== 1 ||
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
            [c.price, c.score, c.phr, c.revenue30d, c.holder30d].every(
              (n) =>
                n === null || (typeof n === "number" && Number.isFinite(n)),
            ) &&
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
  state: "first" | "new" | "rules_changed" | "identity_changed" | "comparable";
  added: OpportunityTrack[];
  scoreDelta: number | null;
  phrDelta: number | null;
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
    revenueDelta: null,
    holderDelta: null,
    meaningful: false,
  };
  if (!baseline) return empty;
  if (baseline.scoreVersion !== version)
    return { ...empty, state: "rules_changed" };
  const previous = Object.hasOwn(baseline.coins, coin.slug)
    ? baseline.coins[coin.slug]
    : undefined;
  if (!previous) return { ...empty, state: "new", meaningful: true };
  if (previous.identity !== identity(coin))
    return { ...empty, state: "identity_changed" };
  const delta = (a: number | null, b: number | null) =>
    a !== null && b !== null ? a - b : null;
  const added = (["business", "holder", "transition"] as const).filter(
    (t) => coin.opportunities[t] && !previous.tracks.includes(t),
  );
  const scoreDelta = delta(coin.valueScore, previous.score);
  const phrDelta = delta(coin.multiples.phr, previous.phr);
  const revenueDelta = delta(coin.revenue30d, previous.revenue30d);
  const holderDelta = delta(
    coin.holderValue.eligibleCurrent30d,
    previous.holder30d,
  );
  // Change filter suppresses quote noise; all exact deltas remain available in the detail.
  const materialFlow = (d: number | null, prev: number | null) =>
    d !== null &&
    prev !== null &&
    Math.abs(d) >= Math.max(100, Math.abs(prev) * 0.05);
  const removed = previous.tracks.some((t) => !coin.opportunities[t]);
  return {
    state: "comparable",
    added,
    scoreDelta,
    phrDelta,
    revenueDelta,
    holderDelta,
    meaningful:
      added.length > 0 ||
      removed ||
      Math.abs(scoreDelta ?? 0) >= 3 ||
      materialFlow(revenueDelta, previous.revenue30d) ||
      materialFlow(holderDelta, previous.holder30d),
  };
}
