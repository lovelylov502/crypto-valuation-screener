import { buildScreener } from "@/lib/screener";
import { CryptoDashboardClient } from "@/components/CryptoDashboardClient";
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

  // 워크벤치는 점수 산출 코인뿐 아니라 데이터 부족 후보도 보여줘야 한다.
  // 단, 마이크로캡/토큰미발행 노이즈는 기본 화면에서 제외한다.
  const workbenchCoins = data.coins.filter((c) => c.mcap !== null && c.mcap >= MIN_MCAP_USD);

  return (
    <main className="max-w-[1500px] mx-auto px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--color-muted)]">Token Value Capture Workbench</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">토큰 가치포획 워크벤치</h1>
        <p className="text-[var(--color-muted)] mt-2 max-w-4xl text-sm leading-relaxed">
          프로토콜이 돈을 벌 때 그 가치가 <strong className="text-[var(--color-text)]">토큰 가격으로 실제 연결되는지</strong>를 봅니다.
          숫자표보다 먼저 <strong className="text-[var(--color-text)]">판단 버킷 · 한줄 논지 · 근거 · 리스크 · 다음 질문</strong>을 제공합니다.
        </p>
      </header>

      <CryptoDashboardClient
        coins={workbenchCoins}
        categories={data.categories}
        updatedAt={data.updatedAt}
        fdvCoverage={data.fdvCoverage}
        onchain={data.onchain}
      />

      <footer className="mt-8 pt-5 border-t border-[var(--color-border)] text-xs text-[var(--color-muted)] leading-relaxed space-y-1.5">
        <p>
          <strong className="text-[var(--color-text)]">사용법.</strong> `의사결정`에서 후보와 질문을 먼저 보고,
          필요할 때 `가치포획 맵`과 `원자료`로 내려가 멀티플을 확인합니다. 모르는 것은 감점이 아니라 리서치 질문으로 남깁니다.
        </p>
        <p>
          <strong className="text-amber-400">투자 조언이 아닙니다.</strong> 본 워크벤치는 온체인 펀더멘털 기반의
          리서치 우선순위 도구이며, 토큰 이코노믹스·베스팅·법적 권리·내러티브 검증은 별도 확인해야 합니다.
        </p>
      </footer>
    </main>
  );
}
