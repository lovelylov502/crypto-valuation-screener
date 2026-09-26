import { fetchCoins } from "./sources";
import { SCORE_VERSION, scoreCoins } from "./valuation";
import type { CoinRaw, MarketDataFreshness, ScreenerResponse, SourceObservation } from "./types";
import { fundamentalErrors } from "./fundamentalContract";

export function filterScreenableCoins<T extends { mcap: number | null }>(
  coins: T[],
): T[] {
  return coins;
}

export function summarizeMarketDataFreshness<
  T extends { marketDataUpdatedAt: string | null },
>(coins: T[]): MarketDataFreshness {
  const timestamps = coins
    .map((coin) => Date.parse(coin.marketDataUpdatedAt ?? ""))
    .filter((timestamp) => Number.isFinite(timestamp));

  return {
    source: "CoinMarketCap",
    oldestAt:
      timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null,
    newestAt:
      timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null,
    timestampedCoinCount: timestamps.length,
  };
}

// 데이터 수집 → 점수화 → 응답 페이로드 조립 (route와 page 서버컴포넌트가 공유)
export async function buildScreener(): Promise<ScreenerResponse> {
  const sources: SourceObservation[] = [];
  const raw = await fetchCoins(sources);
  return assembleScreener(raw, new Date().toISOString(), sources);
}

export function assembleScreener(raw: CoinRaw[], updatedAt: string, sources: SourceObservation[]): ScreenerResponse {
  // Preserve the entire directory. Page responses at the transport boundary, never by valuation eligibility.
  const coins = filterScreenableCoins(scoreCoins(raw, updatedAt));
  if (coins.length === 0) throw new Error("스크리닝 가능한 데이터 없음");
  for (const coin of coins) {
    const errors = fundamentalErrors(coin);
    if (errors.length) throw new Error(`Fundamental contract: ${coin.slug}: ${errors.join(", ")}`);
  }

  const categories = Array.from(
    new Set(coins.map((c) => c.category).filter((c): c is string => !!c)),
  ).sort();

  const fdvCoverage = coins.filter((c) => c.fdv !== null).length;
  const cmcCoverage = coins.filter((c) => c.cmcId !== null).length;
  const verifiedIdentityCount = coins.filter(
    (c) => c.identityStatus === "verified",
  ).length;
  const discoveryCandidateCount = coins.filter(
    (c) => c.status === "발굴 후보",
  ).length;

  // 기본 정렬: 발견 점수 내림차순, 필수 게이트 실패 건은 뒤로.
  coins.sort((a, b) => (b.valueScore ?? -1) - (a.valueScore ?? -1));

  return {
    coins,
    categories,
    updatedAt,
    marketDataFreshness: summarizeMarketDataFreshness(coins),
    fdvCoverage,
    cmcCoverage,
    verifiedIdentityCount,
    discoveryCandidateCount,
    scoreVersion: SCORE_VERSION,
    sources,
  };
}
