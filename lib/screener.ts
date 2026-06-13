import { fetchOnchainDashboard } from "./onchain";
import { fetchCoins } from "./sources";
import { scoreCoins } from "./valuation";
import type { ScreenerResponse } from "./types";

// 데이터 수집 → 점수화 → 응답 페이로드 조립 (route와 page 서버컴포넌트가 공유)
export async function buildScreener(): Promise<ScreenerResponse> {
  const [raw, onchain] = await Promise.all([
    fetchCoins(),
    fetchOnchainDashboard(),
  ]);
  const coins = scoreCoins(raw);

  const categories = Array.from(
    new Set(coins.map((c) => c.category).filter((c): c is string => !!c)),
  ).sort();

  const fdvCoverage = coins.filter((c) => c.fdv !== null).length;

  // 기본 정렬: 종합점수 내림차순(저평가 우선), 점수 없는 건 뒤로
  coins.sort((a, b) => (b.valueScore ?? -1) - (a.valueScore ?? -1));

  return {
    coins,
    categories,
    updatedAt: new Date().toISOString(),
    fdvCoverage,
    onchain,
  };
}
