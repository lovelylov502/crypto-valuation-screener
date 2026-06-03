import type { CoinRaw, CoinScored, ValueLabel } from "./types";

// 좀비(매출 미미) 임계값: 연 매출/수수료 둘 다 이 값 미만이면 P/F·P/S 비교 신뢰 불가
export const MIN_ACTIVITY_USD = 100_000;

// 최소 시총 게이트: 이 미만이면 멀티플(특히 Mcap/TVL)이 데이터 결함으로 왜곡되므로
// 점수를 산출하지 않고 판단보류 처리 (토큰 미발행/마이크로캡 노이즈 제거)
export const MIN_MCAP_USD = 1_000_000;

// 섹터 표본이 이보다 적으면 전체 시장 풀로 fallback
const MIN_SECTOR_SAMPLE = 5;

// 종합 점수 가중치 (결측 지표는 제외 후 재정규화)
// P/HR(홀더 귀속 수익 = 크립토 PER)을 최고 가중. P/F·Mcap/TVL은 화면엔 숨기지만
// 데이터가 풍부해 holder revenue 없는 토큰의 점수를 받쳐준다.
const WEIGHTS = {
  phr: 0.28,
  pf: 0.18,
  ps: 0.18,
  mcapTvl: 0.16,
  growth: 0.12,
  dilution: 0.08,
} as const;

const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

// 멀티플(낮을수록 쌈) → 섹터 내 "싼 정도" 백분위(0~100, 높을수록 쌈)
// 값이 가장 작으면 100에 가까움
function inversePercentile(value: number, sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n <= 1) return 50;
  let greater = 0;
  for (const v of sortedAsc) if (v > value) greater++;
  return (greater / (n - 1)) * 100;
}

function computeMultiples(c: CoinRaw): CoinScored["multiples"] {
  const pos = (x: number | null) => (x !== null && x > 0 ? x : null);
  const mcap = pos(c.mcap);
  const fees = pos(c.feesAnnual);
  const rev = pos(c.revenueAnnual);
  const hr = pos(c.holderRevenueAnnual);
  const tvl = pos(c.tvl);
  const fdv = pos(c.fdv);

  return {
    pf: mcap !== null && fees !== null ? mcap / fees : null,
    ps: mcap !== null && rev !== null ? mcap / rev : null,
    phr: mcap !== null && hr !== null ? mcap / hr : null,
    mcapTvl: mcap !== null && tvl !== null ? mcap / tvl : null,
    fdvTvl: fdv !== null && tvl !== null ? fdv / tvl : null,
    dilution: fdv !== null && mcap !== null ? fdv / mcap : null,
  };
}

// fees 30일 모멘텀(%) → 0~100. 0%=50(중립), +100%=100, -100%=0
function growthToScore(change: number | null): number | null {
  if (change === null) return null;
  return clamp(50 + change * 0.5, 0, 100);
}

// 희석(fdv/mcap) → 0~100. 1배(완전유통)=100, 클수록 미래 공급 압력으로 감점
function dilutionToScore(dilution: number | null): number | null {
  if (dilution === null || dilution <= 0) return null;
  return clamp(100 - (dilution - 1) * 33.3, 0, 100);
}

function labelFor(score: number | null, hasValueMultiple: boolean): ValueLabel {
  if (score === null || !hasValueMultiple) return "판단보류";
  if (score >= 80) return "저평가";
  if (score >= 60) return "다소 저평가";
  if (score >= 40) return "적정";
  if (score >= 20) return "다소 고평가";
  return "고평가";
}

// 섹터별 멀티플 분포(유효·활동성 통과 코인만)에서 백분위 산출용 정렬 배열 빌드
type Pool = { pf: number[]; ps: number[]; phr: number[]; mcapTvl: number[] };
type SortedPools = {
  byCategory: Map<string, Pool>;
  global: Pool;
};

function buildPools(
  rows: { coin: CoinRaw; m: CoinScored["multiples"]; lowActivity: boolean; insufficientScale: boolean }[],
): SortedPools {
  const empty = (): Pool => ({ pf: [], ps: [], phr: [], mcapTvl: [] });
  const byCategory = new Map<string, Pool>();
  const global = empty();

  for (const { coin, m, lowActivity, insufficientScale } of rows) {
    // 마이크로캡은 분포 자체를 왜곡하므로 모든 풀에서 제외
    if (insufficientScale) continue;
    const cat = coin.category ?? "기타";
    if (!byCategory.has(cat)) byCategory.set(cat, empty());
    const bucket = byCategory.get(cat)!;
    // 현금흐름 멀티플(P/F·P/S·P/HR)은 활동성 좀비를 분포에서 제외 (왜곡 방지). Mcap/TVL은 활동성 무관.
    if (!lowActivity) {
      if (m.pf !== null) { bucket.pf.push(m.pf); global.pf.push(m.pf); }
      if (m.ps !== null) { bucket.ps.push(m.ps); global.ps.push(m.ps); }
      if (m.phr !== null) { bucket.phr.push(m.phr); global.phr.push(m.phr); }
    }
    if (m.mcapTvl !== null) { bucket.mcapTvl.push(m.mcapTvl); global.mcapTvl.push(m.mcapTvl); }
  }

  const sortPool = (b: Pool) => {
    b.pf.sort((a, z) => a - z);
    b.ps.sort((a, z) => a - z);
    b.phr.sort((a, z) => a - z);
    b.mcapTvl.sort((a, z) => a - z);
  };
  for (const b of byCategory.values()) sortPool(b);
  sortPool(global);

  return { byCategory, global };
}

// 섹터 표본이 충분하면 섹터, 아니면 전체 풀 선택
function poolFor(
  pools: SortedPools,
  category: string | null,
  key: "pf" | "ps" | "phr" | "mcapTvl",
): number[] {
  const cat = category ?? "기타";
  const sec = pools.byCategory.get(cat)?.[key] ?? [];
  return sec.length >= MIN_SECTOR_SAMPLE ? sec : pools.global[key];
}

function weightedScore(
  parts: { value: number | null; weight: number }[],
): number | null {
  let sum = 0;
  let wsum = 0;
  for (const { value, weight } of parts) {
    if (value === null) continue;
    sum += value * weight;
    wsum += weight;
  }
  if (wsum === 0) return null;
  return sum / wsum;
}

/**
 * 코인 배열에 멀티플·섹터 백분위·종합 점수를 부여한다.
 * 종합 valueScore: 0~100, 높을수록 저평가.
 */
export function scoreCoins(coins: CoinRaw[]): CoinScored[] {
  // 1차: 멀티플 + 활동성 + 규모 게이트
  const staged = coins.map((coin) => {
    const m = computeMultiples(coin);
    const fees = coin.feesAnnual ?? 0;
    const rev = coin.revenueAnnual ?? 0;
    const lowActivity = fees < MIN_ACTIVITY_USD && rev < MIN_ACTIVITY_USD;
    const insufficientScale = coin.mcap === null || coin.mcap < MIN_MCAP_USD;
    return { coin, m, lowActivity, insufficientScale };
  });

  // 2차: 섹터 분포 풀
  const pools = buildPools(staged);

  // 3차: 백분위 + 종합 점수
  return staged.map(({ coin, m, lowActivity, insufficientScale }): CoinScored => {
    // 마이크로캡/토큰미발행: 멀티플은 참고용으로 채우되 점수는 판단보류
    if (insufficientScale) {
      return {
        ...coin,
        multiples: m,
        sectorPercentiles: { pf: null, ps: null, phr: null, mcapTvl: null },
        growthScore: null,
        valueScore: null,
        label: "판단보류",
        confidence: 0,
        lowActivity,
      };
    }

    const pctPf =
      m.pf !== null && !lowActivity
        ? inversePercentile(m.pf, poolFor(pools, coin.category, "pf"))
        : null;
    const pctPs =
      m.ps !== null && !lowActivity
        ? inversePercentile(m.ps, poolFor(pools, coin.category, "ps"))
        : null;
    const pctPhr =
      m.phr !== null && !lowActivity
        ? inversePercentile(m.phr, poolFor(pools, coin.category, "phr"))
        : null;
    const pctMcapTvl =
      m.mcapTvl !== null
        ? inversePercentile(m.mcapTvl, poolFor(pools, coin.category, "mcapTvl"))
        : null;

    const growthScore = growthToScore(coin.feesChange30dover30d);
    const dilutionScore = dilutionToScore(m.dilution);

    const valueMultipleCount =
      (pctPf !== null ? 1 : 0) +
      (pctPs !== null ? 1 : 0) +
      (pctPhr !== null ? 1 : 0) +
      (pctMcapTvl !== null ? 1 : 0);
    const hasValueMultiple = valueMultipleCount > 0;

    // 밸류 멀티플(P/HR·P/F·P/S·Mcap/TVL)이 하나도 없으면 성장성/희석만으론 점수 의미 없음 → 판단보류
    const valueScore = hasValueMultiple
      ? weightedScore([
          { value: pctPhr, weight: WEIGHTS.phr },
          { value: pctPf, weight: WEIGHTS.pf },
          { value: pctPs, weight: WEIGHTS.ps },
          { value: pctMcapTvl, weight: WEIGHTS.mcapTvl },
          { value: growthScore, weight: WEIGHTS.growth },
          { value: dilutionScore, weight: WEIGHTS.dilution },
        ])
      : null;

    // 신뢰도: 밸류 멀티플 가용성 + 활동성 (4개 중 몇 개 산출됐나)
    let confidence = valueMultipleCount / 4;
    if (lowActivity) confidence *= 0.5;
    confidence = clamp(confidence, 0, 1);

    return {
      ...coin,
      multiples: m,
      sectorPercentiles: { pf: pctPf, ps: pctPs, phr: pctPhr, mcapTvl: pctMcapTvl },
      growthScore,
      valueScore: valueScore === null ? null : Math.round(valueScore),
      label: labelFor(valueScore, hasValueMultiple),
      confidence: Math.round(confidence * 100) / 100,
      lowActivity,
    };
  });
}
