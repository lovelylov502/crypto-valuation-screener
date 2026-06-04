import type { CoinRaw, CoinScored, ValueLabel } from "./types";

// 좀비(매출 미미) 임계값: 연 매출/수수료 둘 다 이 값 미만이면 P/F·P/S 비교 신뢰 불가
export const MIN_ACTIVITY_USD = 100_000;

// 최소 시총 게이트: 이 미만이면 멀티플(특히 Mcap/TVL)이 데이터 결함으로 왜곡되므로
// 점수를 산출하지 않고 판단보류 처리 (토큰 미발행/마이크로캡 노이즈 제거)
export const MIN_MCAP_USD = 1_000_000;

// 섹터 표본이 이보다 적으면 전체 시장 풀로 fallback
const MIN_SECTOR_SAMPLE = 5;

// 밸류 멀티플 가중치 (결측 지표는 제외 후 재정규화).
// holder revenue(크립토 P/E) 최우선. fees는 supply-side(LP·검증자) 몫까지 포함하는
// 가장 거친 지표라 최저 가중 — Token Terminal·Artemis 수익 위계 기준.
// ※ 성장(모멘텀)·희석은 밸류 팩터가 아니므로 여기 넣지 않고 산출 후 ±보정으로만 반영.
const WEIGHTS = {
  phr: 0.4,
  ps: 0.25,
  mcapTvl: 0.2,
  pf: 0.15,
} as const;

// 밸류 점수 산출 후 적용하는 보조축 보정 한도(각 ±5점, 합 ±10).
const MAX_ADJ = 5;

// 밸류 라벨을 붙이려면 밸류 멀티플이 최소 이 개수 이상 있어야 한다(단일 신호 과신 방지).
const MIN_VALUE_MULTIPLES = 2;

// 현금흐름 멀티플(P/F·P/S·P/HR) 분포 상한. holder revenue 등이 일시적으로 거의 0이 되면
// 멀티플이 수만 배로 튀어 섹터 분포 꼬리를 왜곡 → 이 값 초과는 분포에서 제외(본인은 최저 백분위).
const MULTIPLE_CAP = 1000;

// 고희석 경고 임계: FDV/Mcap이 이 값 초과(= MC/FDV<0.3, 유통량 30% 미만)면 태그.
const DILUTION_WARN = 1 / 0.3;

// Mcap/TVL이 가치의 선행지표로 유효한 섹터(예치자산=사업 규모). 그 외(체인·브릿지·CEX·
// 런치패드 등 TVL이 가치와 무관)는 Mcap/TVL을 점수에서 제외 → 가중이 P/HR·P/S·P/F로 재분배.
const MCAP_TVL_SECTORS = new Set<string>([
  "Dexs",
  "Lending",
  "Yield",
  "Derivatives",
  "Liquid Staking",
  "Farm",
  "CDP",
  "Yield Aggregator",
  "Algo-Stables",
  "Staking Pool",
  "Liquidity Manager",
  "Synthetics",
  "Options",
  "Options Vault",
  "Leveraged Farming",
  "Liquid Restaking",
  "Restaking",
  "Insurance",
  "NFT Lending",
  "RWA Lending",
  "Basis Trading",
  "Reserve Currency",
  "Risk Curators",
  "Uncollateralized Lending",
]);

const isMcapTvlSector = (category: string | null): boolean =>
  category !== null && MCAP_TVL_SECTORS.has(category);

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
    // 현금흐름 멀티플(P/F·P/S·P/HR)은 활동성 좀비를 분포에서 제외(왜곡 방지) + 극단값 클리핑.
    if (!lowActivity) {
      if (m.pf !== null && m.pf <= MULTIPLE_CAP) { bucket.pf.push(m.pf); global.pf.push(m.pf); }
      if (m.ps !== null && m.ps <= MULTIPLE_CAP) { bucket.ps.push(m.ps); global.ps.push(m.ps); }
      if (m.phr !== null && m.phr <= MULTIPLE_CAP) { bucket.phr.push(m.phr); global.phr.push(m.phr); }
    }
    // Mcap/TVL은 활동성 무관하되, TVL이 가치 선행지표인 섹터에서만 분포에 포함.
    if (m.mcapTvl !== null && isMcapTvlSector(coin.category)) {
      bucket.mcapTvl.push(m.mcapTvl);
      global.mcapTvl.push(m.mcapTvl);
    }
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
    // 신선도 게이트: 연율값은 있어도 최근 30일 현금흐름이 전부 없으면 멈춘(stale) 프로토콜
    const stale =
      (coin.fees30d ?? 0) <= 0 &&
      (coin.revenue30d ?? 0) <= 0 &&
      (coin.holderRevenue30d ?? 0) <= 0;
    const lowActivity =
      (fees < MIN_ACTIVITY_USD && rev < MIN_ACTIVITY_USD) || stale;
    const insufficientScale = coin.mcap === null || coin.mcap < MIN_MCAP_USD;
    return { coin, m, lowActivity, insufficientScale };
  });

  // 2차: 섹터 분포 풀
  const pools = buildPools(staged);

  // 3차: 백분위 + 종합 점수
  return staged.map(({ coin, m, lowActivity, insufficientScale }): CoinScored => {
    const highDilution = m.dilution !== null && m.dilution > DILUTION_WARN;

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
        highDilution,
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
    // Mcap/TVL은 TVL이 가치 선행지표인 화이트리스트 섹터에서만 점수에 반영
    const pctMcapTvl =
      m.mcapTvl !== null && isMcapTvlSector(coin.category)
        ? inversePercentile(m.mcapTvl, poolFor(pools, coin.category, "mcapTvl"))
        : null;

    const growthScore = growthToScore(coin.feesChange30dover30d);
    const dilutionScore = dilutionToScore(m.dilution);

    const valueMultipleCount =
      (pctPf !== null ? 1 : 0) +
      (pctPs !== null ? 1 : 0) +
      (pctPhr !== null ? 1 : 0) +
      (pctMcapTvl !== null ? 1 : 0);
    // 밸류 멀티플이 MIN_VALUE_MULTIPLES개 미만이면 단일 신호 과신 위험 → 판단보류
    const hasValueMultiple = valueMultipleCount >= MIN_VALUE_MULTIPLES;

    // 1) 순수 밸류 멀티플 가중 평균(결측 재정규화) — 모멘텀/희석은 제외
    const baseScore = hasValueMultiple
      ? weightedScore([
          { value: pctPhr, weight: WEIGHTS.phr },
          { value: pctPs, weight: WEIGHTS.ps },
          { value: pctMcapTvl, weight: WEIGHTS.mcapTvl },
          { value: pctPf, weight: WEIGHTS.pf },
        ])
      : null;

    // 2) 성장(모멘텀)·희석은 밸류 팩터가 아니므로 산출 후 약한 ±보정으로만 반영
    //    (중립 50 기준, 각 ±MAX_ADJ). 밸류 점수 오염 방지.
    const adj = (s: number | null) => (s === null ? 0 : ((s - 50) / 50) * MAX_ADJ);
    const valueScore =
      baseScore === null
        ? null
        : clamp(baseScore + adj(growthScore) + adj(dilutionScore), 0, 100);

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
      highDilution,
    };
  });
}
