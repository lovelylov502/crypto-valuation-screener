import { buildScreener } from "@/lib/screener";
import { CryptoDashboardClient } from "@/components/CryptoDashboardClient";

export const revalidate = 1800; // 30분

export default async function Home() {
  let data;
  try {
    data = await buildScreener();
  } catch {
    return (
      <main className="max-w-2xl mx-auto p-10">
        <h1 className="text-xl font-bold">데이터를 불러오지 못했습니다</h1>
        <p className="text-[var(--color-muted)] mt-2 text-sm">
          DefiLlama/CoinGecko API 응답에 일시적 문제가 있을 수 있습니다. 잠시 후 새로고침해 주세요.
        </p>
      </main>
    );
  }

  // 점수가 산출된 코인만 스크리너에 노출 (마이크로캡/데이터부족은 제외)
  const scored = data.coins.filter((c) => c.valueScore !== null);

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">크립토 밸류에이션 스크리너</h1>
        <p className="text-[var(--color-muted)] mt-1.5 text-sm leading-relaxed max-w-3xl">
          가격이 아니라 <strong className="text-[var(--color-text)]">펀더멘털</strong>(수수료·매출·예치자산)로
          코인의 저평가/고평가를 가늠합니다. 각 멀티플을{" "}
          <strong className="text-[var(--color-text)]">같은 섹터 안에서 백분위로 정규화</strong>한 뒤
          가중 평균해 <strong className="text-[var(--color-text)]">0~100 종합 점수</strong>(높을수록 저평가)로 표시합니다.
          데이터: DefiLlama · CoinGecko.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-muted)]">
          <span><strong className="text-emerald-400">80+</strong> 저평가</span>
          <span><strong>40~60</strong> 적정</span>
          <span><strong className="text-red-400">~20</strong> 고평가</span>
          <span className="text-amber-400">⚠ 신뢰도 낮음(약신호)</span>
        </div>
      </header>

      <CryptoDashboardClient
        coins={scored}
        categories={data.categories}
        updatedAt={data.updatedAt}
        fdvCoverage={data.fdvCoverage}
        onchain={data.onchain}
      />

      <footer className="mt-8 pt-5 border-t border-[var(--color-border)] text-xs text-[var(--color-muted)] leading-relaxed space-y-1.5">
        <p>
          <strong className="text-[var(--color-text)]">방법론.</strong> P/F=시총/연수수료, P/S=시총/연매출,
          Mcap/TVL=시총/예치자산. 연율화는 최근 1년 값(없으면 30일×12.17). 매출이 연 $100K 미만이면 P/F·P/S 비교에서
          제외(좀비), 시총 $1M 미만은 점수 미산출. 섹터 표본이 5개 미만이면 전체 시장 분포로 보정.
        </p>
        <p>
          <strong className="text-amber-400">투자 조언이 아닙니다.</strong> 본 점수는 온체인 펀더멘털 기반의
          상대적 참고 지표일 뿐이며, 토큰 이코노믹스·베스팅·내러티브·리스크를 반영하지 않습니다. CEX·체인·브릿지처럼
          TVL이 가치와 직결되지 않는 섹터는 Mcap/TVL 신호를 신뢰하지 마세요.
        </p>
      </footer>
    </main>
  );
}
