import { buildScreener } from "@/lib/screener";
import { ScreenerClient } from "@/components/ScreenerClient";
import { MIN_MCAP_USD } from "@/lib/valuation";

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

  // 마이크로캡/토큰미발행 노이즈만 제외하고, 나머지는 스크리너에서 직접 필터링한다.
  const screenerCoins = data.coins.filter((c) => c.mcap !== null && c.mcap >= MIN_MCAP_USD);

  return (
    <main className="max-w-[1500px] mx-auto px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--color-muted)]">Crypto Valuation Research</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">크립토 밸류에이션 리서치</h1>
        <p className="text-[var(--color-muted)] mt-2 max-w-4xl text-sm leading-relaxed">
          <strong className="text-[var(--color-text)]">저평가·고평가 프리셋</strong>으로 빠르게 후보를 나누거나,
          점수·시총·TVL·P/HR·P/S 범위를 직접 좁혀 크립토를 비교합니다.
        </p>
      </header>

      <ScreenerClient
        coins={screenerCoins}
        categories={data.categories}
        updatedAt={data.updatedAt}
        fdvCoverage={data.fdvCoverage}
      />

      <footer className="mt-8 pt-5 border-t border-[var(--color-border)] text-xs text-[var(--color-muted)] leading-relaxed space-y-1.5">
        <p>
          <strong className="text-[var(--color-text)]">사용법.</strong> 저평가·고평가 프리셋으로 시작하거나,
          점수·시총·TVL·P/HR 범위를 직접 좁힌 뒤 열 제목을 눌러 정렬합니다.
        </p>
        <p>
          <strong className="text-amber-400">투자 조언이 아닙니다.</strong> 본 도구는 크립토 온체인 펀더멘털 기반의
          상대가치 리서치 도구이며, 토큰 이코노믹스·베스팅·법적 권리·내러티브는 별도 확인해야 합니다.
        </p>
      </footer>
    </main>
  );
}
