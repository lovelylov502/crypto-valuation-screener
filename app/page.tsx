import { buildScreener } from "@/lib/screener";
import { ScreenerClient } from "@/components/ScreenerClient";

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
          DefiLlama/CoinMarketCap/CoinGecko 공개 API 응답에 일시적 문제가 있을 수 있습니다. 잠시 후 새로고침해 주세요.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-[1500px] mx-auto px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--color-muted)]">Crypto Valuation Research</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">크립토 밸류에이션 리서치</h1>
        <p className="text-[var(--color-muted)] mt-2 max-w-4xl text-sm leading-relaxed">
          토큰에 귀속되는 현금흐름은 개선되지만 가격에는 아직 충분히 반영되지 않은
          <strong className="text-[var(--color-text)]"> 재발견 전 후보</strong>를 찾습니다.
        </p>
      </header>

      <section className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="발견 점수 구성">
        {[
          ["가치 30", "적격 최근 30일 P/HR 중심"],
          ["개선 25", "적격 component 최근·직전 30일"],
          ["미발견 25", "60일 섹터 대비 가격 괴리"],
          ["품질 20", "적격 가치귀속·희석·유동성·완성도"],
        ].map(([title, description]) => (
          <div key={title} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2.5">
            <strong className="text-sm">{title}</strong>
            <span className="ml-2 text-xs text-[var(--color-muted)]">{description}</span>
          </div>
        ))}
      </section>

      <ScreenerClient
        coins={data.coins}
        categories={data.categories}
        updatedAt={data.updatedAt}
        marketDataFreshness={data.marketDataFreshness}
        fdvCoverage={data.fdvCoverage}
        cmcCoverage={data.cmcCoverage}
        verifiedIdentityCount={data.verifiedIdentityCount}
        discoveryCandidateCount={data.discoveryCandidateCount}
        scoreVersion={data.scoreVersion}
      />

      <footer className="mt-8 pt-5 border-t border-[var(--color-border)] text-xs text-[var(--color-muted)] leading-relaxed space-y-1.5">
        <p>
          <strong className="text-[var(--color-text)]">사용법.</strong> 발굴 후보·65+·데이터 보류 프리셋으로 시작한 뒤
          4축 점수와 게이트 사유를 확인하고, 원하는 열을 골라 정렬합니다.
        </p>
        <p>
          <strong className="text-amber-400">투자 조언이 아닙니다.</strong> 본 도구는 크립토 온체인 펀더멘털 기반의
          후보 탐색 도구이며, 언락 일정·법적 권리·내러티브와 원자료는 별도 확인해야 합니다.
        </p>
        <p>발견 점수는 미래 초과수익률 백테스트가 축적되기 전의 실험적 탐색 모델입니다.</p>
      </footer>
    </main>
  );
}
