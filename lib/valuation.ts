import type {
  CandidateStatus,
  CoinRaw,
  CoinScored,
  ConfidenceGrade,
  ScoreAxes,
  ScoreGates,
  ValueCapture,
} from "./types";

export const MIN_ACTIVITY_USD = 100_000;
export const MIN_MCAP_USD = 1_000_000;
export const MIN_SECTOR_SAMPLE = 8;
export const NEW_PROJECT_DAYS = 90;
export const SCORE_VERSION = "rediscovery-v3-holder-classifier";

const MULTIPLE_CAP = 1000;
const DILUTION_WARN = 1 / 0.3;
const MARKET_FRESH_HOURS = 12;

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

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const points = (score: number | null, maximum: number) =>
  score === null ? 0 : (clamp(score, 0, 100) / 100) * maximum;
const isPositive = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

const isMcapTvlSector = (category: string | null): boolean =>
  category !== null && MCAP_TVL_SECTORS.has(category);

function percentChange(current: number | null, previous: number | null): number | null {
  if (!isPositive(current) || !isPositive(previous)) return null;
  return ((current - previous) / previous) * 100;
}

// 변화율을 이상치에 덜 민감한 0~100 점수로 변환한다. 0%=50, ±100%=0/100.
function trendScore(change: number | null): number | null {
  if (change === null) return null;
  return clamp(50 + clamp(change, -100, 100) * 0.5, 0, 100);
}

function dilutionScore(dilution: number | null): number | null {
  if (!isPositive(dilution)) return null;
  return clamp(100 - (dilution - 1) * 33.3, 0, 100);
}

function inversePercentile(value: number, sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n <= 1) return 50;
  let greater = 0;
  for (const peer of sortedAsc) if (peer > value) greater++;
  return (greater / (n - 1)) * 100;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function computeMultiples(c: CoinRaw): CoinScored["multiples"] {
  const mcap = isPositive(c.mcap) ? c.mcap : null;
  const fees = isPositive(c.feesAnnual) ? c.feesAnnual : null;
  const revenue = isPositive(c.revenueAnnual) ? c.revenueAnnual : null;
  const holderValue = isPositive(c.holderValue.eligibleRunRate)
    ? c.holderValue.eligibleRunRate
    : null;
  const tvl = isPositive(c.tvl) ? c.tvl : null;
  const fdv = isPositive(c.fdv) ? c.fdv : null;

  return {
    pf: mcap !== null && fees !== null ? mcap / fees : null,
    ps: mcap !== null && revenue !== null ? mcap / revenue : null,
    phr: mcap !== null && holderValue !== null ? mcap / holderValue : null,
    mcapTvl: mcap !== null && tvl !== null ? mcap / tvl : null,
    fdvTvl: fdv !== null && tvl !== null ? fdv / tvl : null,
    dilution: fdv !== null && mcap !== null ? fdv / mcap : null,
  };
}

function computeEligibleHolderValueShare(c: CoinRaw): number | null {
  if (!isPositive(c.holderValue.eligibleRunRate)) return null;
  const denominator = isPositive(c.revenueAnnual)
    ? c.revenueAnnual
    : isPositive(c.feesAnnual)
      ? c.feesAnnual
      : null;
  if (denominator === null) return null;
  return clamp(c.holderValue.eligibleRunRate / denominator, 0, 1);
}

function computeValueCapture({
  coin,
  pctPhr,
  pctPs,
  dilution,
  lowActivity,
}: {
  coin: CoinRaw;
  pctPhr: number | null;
  pctPs: number | null;
  dilution: number | null;
  lowActivity: boolean;
}): ValueCapture {
  const eligibleHolderValueShare = computeEligibleHolderValueShare(coin);
  const hasEligibleCapture =
    (coin.holderValue.eligibleRunRate ?? 0) >= MIN_ACTIVITY_USD &&
    (coin.holderValue.eligibleCurrent30d ?? 0) > 0;
  const hasRevenueOrFees =
    (coin.revenueAnnual ?? 0) >= MIN_ACTIVITY_USD ||
    (coin.feesAnnual ?? 0) >= MIN_ACTIVITY_USD;
  const signals: string[] = [];
  const risks: string[] = [];

  if (coin.identityStatus !== "verified") risks.push(coin.identityReason);
  if (hasEligibleCapture) signals.push("적격 holder value 실측");
  else if (hasRevenueOrFees) {
    signals.push("매출/수수료 실측");
    risks.push(coin.holderValue.phrUnavailableReason ?? "적격 holder value 없음");
  } else {
    risks.push("현금흐름 불명확");
  }
  if (coin.holderValue.warning) risks.push(coin.holderValue.warning);
  if (pctPhr !== null && pctPhr >= 70) signals.push("P/HR 섹터 상위");
  if (pctPs !== null && pctPs >= 70) signals.push("P/S 섹터 상위");
  if (lowActivity) risks.push("저활동/신선도 낮음");
  if (dilution !== null && dilution > DILUTION_WARN) risks.push("고희석");

  let score: number | null = null;
  let label: ValueCapture["label"] =
    (coin.holderValue.rawCurrent30d ?? 0) > 0 ||
    (coin.holderValue.rawTtm ?? 0) > 0
      ? "판단보류"
      : "포획 불명확";
  const dilutionComponent = dilutionScore(dilution) ?? 0;

  if (hasEligibleCapture) {
    score = Math.round(clamp(
      35 +
        (eligibleHolderValueShare ?? 0) * 35 +
        ((pctPhr ?? 0) / 100) * 20 +
        (dilutionComponent / 100) * 10,
      0,
      100,
    ));
    label = score >= 70 ? "강한 가치포획" : "가치포획 후보";
  }

  return { score, label, eligibleHolderValueShare, signals, risks };
}

interface Staged {
  coin: CoinRaw;
  multiples: CoinScored["multiples"];
  lowActivity: boolean;
  insufficientScale: boolean;
}

type Pool = { pf: number[]; ps: number[]; phr: number[]; mcapTvl: number[] };

function buildPools(rows: Staged[]): Map<string, Pool> {
  const pools = new Map<string, Pool>();
  const getPool = (category: string) => {
    const existing = pools.get(category);
    if (existing) return existing;
    const created: Pool = { pf: [], ps: [], phr: [], mcapTvl: [] };
    pools.set(category, created);
    return created;
  };

  for (const { coin, multiples, lowActivity, insufficientScale } of rows) {
    if (
      insufficientScale ||
      lowActivity ||
      coin.identityStatus !== "verified" ||
      !coin.category
    ) {
      continue;
    }
    const pool = getPool(coin.category);
    if (isPositive(multiples.pf) && multiples.pf <= MULTIPLE_CAP) pool.pf.push(multiples.pf);
    if (isPositive(multiples.ps) && multiples.ps <= MULTIPLE_CAP) pool.ps.push(multiples.ps);
    if (isPositive(multiples.phr) && multiples.phr <= MULTIPLE_CAP) pool.phr.push(multiples.phr);
    if (
      isMcapTvlSector(coin.category) &&
      isPositive(multiples.mcapTvl)
    ) {
      pool.mcapTvl.push(multiples.mcapTvl);
    }
  }

  for (const pool of pools.values()) {
    pool.pf.sort((a, b) => a - b);
    pool.ps.sort((a, b) => a - b);
    pool.phr.sort((a, b) => a - b);
    pool.mcapTvl.sort((a, b) => a - b);
  }
  return pools;
}

function peerPercentile(
  value: number | null,
  pool: number[] | undefined,
): number | null {
  if (!isPositive(value) || !pool || pool.length < MIN_SECTOR_SAMPLE) return null;
  if (value > MULTIPLE_CAP) return 0;
  return inversePercentile(value, pool);
}

function buildPriceMedians(rows: Staged[]): Map<string, number> {
  const values = new Map<string, number[]>();
  for (const { coin } of rows) {
    if (
      coin.identityStatus !== "verified" ||
      !coin.category ||
      coin.priceChange60d === null
    ) {
      continue;
    }
    const categoryValues = values.get(coin.category) ?? [];
    categoryValues.push(coin.priceChange60d);
    values.set(coin.category, categoryValues);
  }

  const medians = new Map<string, number>();
  for (const [category, categoryValues] of values) {
    if (categoryValues.length < MIN_SECTOR_SAMPLE) continue;
    const value = median(categoryValues);
    if (value !== null) medians.set(category, value);
  }
  return medians;
}

function cashflowValue(coin: CoinRaw): number {
  if (isPositive(coin.holderValue.eligibleRunRate)) {
    return coin.holderValue.eligibleRunRate;
  }
  if (isPositive(coin.revenueAnnual)) return coin.revenueAnnual;
  if (isPositive(coin.feesAnnual)) return coin.feesAnnual * 0.25;
  return 0;
}

function buildCashflowRanks(rows: Staged[]): Map<string, number> {
  const ranked = rows
    .filter(({ coin }) => coin.identityStatus === "verified" && cashflowValue(coin) > 0)
    .sort((a, b) => cashflowValue(b.coin) - cashflowValue(a.coin));
  return new Map(ranked.map(({ coin }, index) => [coin.slug, index + 1]));
}

function persistenceScore(coin: CoinRaw): number | null {
  const series: [number | null, number | null][] = [
    [coin.holderValue.eligibleCurrent30d, coin.holderValue.eligibleTtm],
    [coin.revenue30d, coin.revenue1y],
    [coin.fees30d, coin.fees1y],
  ];
  for (const [recent, yearly] of series) {
    if (!isPositive(recent) || !isPositive(yearly)) continue;
    const ratioToMonthlyAverage = recent / (yearly / 12);
    return clamp(ratioToMonthlyAverage * 50, 0, 100);
  }
  return null;
}

function absoluteYieldScore(coin: CoinRaw): number | null {
  if (!isPositive(coin.mcap)) return null;
  if (isPositive(coin.holderValue.eligibleRunRate)) {
    const yieldPct = (coin.holderValue.eligibleRunRate / coin.mcap) * 100;
    return clamp(yieldPct * 10, 0, 100);
  }
  if (isPositive(coin.revenueAnnual)) {
    const revenueYieldPct = (coin.revenueAnnual / coin.mcap) * 100;
    return clamp(revenueYieldPct * 5, 0, 50);
  }
  return null;
}

function marketDataIsFresh(updatedAt: string | null, referenceMs: number): boolean {
  if (!updatedAt) return false;
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs) || !Number.isFinite(referenceMs)) return false;
  const ageHours = (referenceMs - updatedMs) / 3_600_000;
  return ageHours >= -1 && ageHours <= MARKET_FRESH_HOURS;
}

function confidenceGrade(confidence: number): ConfidenceGrade {
  if (confidence >= 0.8) return "A";
  if (confidence >= 0.6) return "B";
  return "C";
}

function statusFor({
  gates,
  isNewProject,
  score,
  axes,
  grade,
  price30d,
  price60d,
}: {
  gates: ScoreGates;
  isNewProject: boolean;
  score: number | null;
  axes: ScoreAxes;
  grade: ConfidenceGrade;
  price30d: number | null;
  price60d: number | null;
}): CandidateStatus {
  if (isNewProject) return "신규 프로젝트";
  if (!gates.passed || score === null) return "데이터 보류";

  if (axes.value >= 18 && axes.improvement < 10) return "가치 함정";
  if (
    axes.improvement >= 12.5 &&
    ((price30d ?? -Infinity) > 20 || (price60d ?? -Infinity) > 30)
  ) {
    return "재평가 진행 중";
  }

  const axisFloorsPass =
    axes.value >= 15 &&
    axes.improvement >= 12.5 &&
    axes.discovery >= 12.5 &&
    axes.quality >= 10;
  if (score >= 80 && axisFloorsPass && grade !== "C") return "발굴 후보";
  if (score >= 65) return "관찰";
  if (score >= 50) return "근거 부족";
  return "제외";
}

export function scoreCoins(
  coins: CoinRaw[],
  referenceIso = new Date().toISOString(),
): CoinScored[] {
  const referenceMs = Date.parse(referenceIso);
  const staged: Staged[] = coins.map((coin) => {
    const multiples = computeMultiples(coin);
    const lowActivity =
      (
        (coin.feesAnnual ?? 0) < MIN_ACTIVITY_USD &&
        (coin.revenueAnnual ?? 0) < MIN_ACTIVITY_USD &&
        (coin.holderValue.eligibleRunRate ?? 0) < MIN_ACTIVITY_USD
      ) ||
      (
        (coin.fees30d ?? 0) <= 0 &&
        (coin.revenue30d ?? 0) <= 0 &&
        (coin.holderValue.eligibleCurrent30d ?? 0) <= 0
      );
    const insufficientScale = coin.mcap === null || coin.mcap < MIN_MCAP_USD;
    return { coin, multiples, lowActivity, insufficientScale };
  });

  const pools = buildPools(staged);
  const priceMedians = buildPriceMedians(staged);
  const cashflowRanks = buildCashflowRanks(staged);

  return staged.map(({ coin, multiples, lowActivity, insufficientScale }): CoinScored => {
    const pool = coin.category ? pools.get(coin.category) : undefined;
    const pctPf = lowActivity ? null : peerPercentile(multiples.pf, pool?.pf);
    const pctPs = lowActivity ? null : peerPercentile(multiples.ps, pool?.ps);
    const pctPhr = lowActivity ? null : peerPercentile(multiples.phr, pool?.phr);
    const pctMcapTvl =
      !lowActivity && isMcapTvlSector(coin.category)
        ? peerPercentile(multiples.mcapTvl, pool?.mcapTvl)
        : null;

    const holderChange = percentChange(
      coin.holderValue.eligibleCurrent30d,
      coin.holderValue.eligiblePrevious30d,
    );
    const revenueChange = percentChange(coin.revenue30d, coin.revenuePrev30d);
    const feesChange = percentChange(coin.fees30d, coin.feesPrev30d);
    const fundamentalChange = holderChange ?? revenueChange ?? feesChange;
    const sectorMedian60d = coin.category
      ? (priceMedians.get(coin.category) ?? null)
      : null;
    const cashflowRank = cashflowRanks.get(coin.slug) ?? null;

    const marketData =
      isPositive(coin.price) &&
      isPositive(coin.mcap) &&
      coin.priceChange60d !== null &&
      isPositive(coin.totalVolume) &&
      marketDataIsFresh(coin.marketDataUpdatedAt, referenceMs);
    const fundamentalHistory =
      (
        isPositive(coin.holderValue.eligibleCurrent30d) &&
        isPositive(coin.holderValue.eligiblePrevious30d)
      ) ||
      (isPositive(coin.revenue30d) && isPositive(coin.revenuePrev30d)) ||
      (isPositive(coin.fees30d) && isPositive(coin.feesPrev30d));
    const liquidityThreshold = isPositive(coin.mcap)
      ? Math.max(100_000, Math.min(5_000_000, coin.mcap * 0.005))
      : null;
    const liquidity =
      liquidityThreshold !== null &&
      isPositive(coin.totalVolume) &&
      coin.totalVolume >= liquidityThreshold;
    const highDilution =
      multiples.dilution !== null && multiples.dilution > DILUTION_WARN;
    const dilution = multiples.dilution !== null && !highDilution;
    const listedAgeDays =
      coin.listedAt !== null && Number.isFinite(referenceMs)
        ? (referenceMs - coin.listedAt * 1000) / 86_400_000
        : null;
    const isNewProject =
      listedAgeDays !== null &&
      listedAgeDays >= 0 &&
      listedAgeDays < NEW_PROJECT_DAYS;
    const matureProject = listedAgeDays !== null && listedAgeDays >= NEW_PROJECT_DAYS;

    const gateReasons: string[] = [];
    if (coin.identityStatus !== "verified") gateReasons.push(coin.identityReason);
    if (!marketData) gateReasons.push("CMC 시세·60일·거래량 데이터 부족/지연");
    if (!fundamentalHistory) gateReasons.push("최근·직전 30일 펀더멘털 비교 불가");
    if (!liquidity) gateReasons.push("24시간 거래량이 유동성 기준 미달");
    if (multiples.dilution === null) gateReasons.push("FDV/희석 데이터 없음");
    else if (highDilution) gateReasons.push("FDV/Mcap 3.33배 초과·언락 미확인");
    if (!matureProject) {
      gateReasons.push(isNewProject ? "상장 90일 미만·신규 트랙" : "상장일 확인 불가");
    }
    if (lowActivity) gateReasons.push("현금흐름 규모·신선도 기준 미달");
    if (insufficientScale) gateReasons.push("시총 $1M 미만 또는 미확인");

    const gates: ScoreGates = {
      passed: gateReasons.length === 0,
      reasons: gateReasons,
      identity: coin.identityStatus === "verified",
      marketData,
      fundamentalHistory,
      liquidity,
      dilution,
      matureProject,
      activity: !lowActivity,
      scale: !insufficientScale,
      liquidityThreshold,
    };

    const capture = computeValueCapture({
      coin,
      pctPhr,
      pctPs,
      dilution: multiples.dilution,
      lowActivity,
    });

    const valueAxis = round1(
      points(pctPhr, 15) +
        points(pctPs, 5) +
        points(pctPf, 3) +
        points(pctMcapTvl, 2) +
        points(absoluteYieldScore(coin), 5),
    );

    const improvementAxis = round1(
      points(trendScore(holderChange), 10) +
        points(trendScore(revenueChange), 7) +
        points(trendScore(feesChange), 3) +
        points(persistenceScore(coin), 5),
    );

    const relativeLagScore =
      sectorMedian60d !== null && coin.priceChange60d !== null
        ? clamp(50 + (sectorMedian60d - coin.priceChange60d), 0, 100)
        : null;
    const divergenceScore =
      fundamentalChange !== null &&
      fundamentalChange > 0 &&
      coin.priceChange60d !== null
        ? clamp(50 + (fundamentalChange - coin.priceChange60d) * 0.5, 0, 100)
        : 0;
    const contextScore =
      fundamentalChange !== null && fundamentalChange > 0
        ? (
            (coin.priceChange30d !== null
              ? clamp(50 - coin.priceChange30d, 0, 100)
              : 0) +
            (coin.priceChange1y !== null
              ? clamp(50 - coin.priceChange1y / 4, 0, 100)
              : 0)
          ) / 2
        : 0;
    const attentionScore =
      cashflowRank !== null && coin.marketCapRank !== null
        ? clamp(
            50 +
              (
                Math.log10(coin.marketCapRank + 1) -
                Math.log10(cashflowRank + 1)
              ) *
                50,
            0,
            100,
          )
        : null;
    const discoveryAxis = round1(
      points(relativeLagScore, 10) +
        points(divergenceScore, 8) +
        points(contextScore, 4) +
        points(attentionScore, 3),
    );

    const liquidityScore =
      liquidity &&
      liquidityThreshold !== null &&
      coin.totalVolume !== null
        ? clamp(
            50 + Math.log2(coin.totalVolume / liquidityThreshold) * 25,
            50,
            100,
          )
        : 0;
    const completenessSignals = [
      coin.identityStatus === "verified",
      coin.cmcId !== null,
      marketData,
      coin.fdv !== null,
      pctPhr !== null,
      pctPs !== null,
      pctPf !== null,
      holderChange !== null,
      revenueChange !== null,
      feesChange !== null,
      sectorMedian60d !== null,
      coin.priceChange1y !== null,
    ];
    const confidence =
      completenessSignals.filter(Boolean).length / completenessSignals.length;
    const grade = confidenceGrade(confidence);
    const qualityAxis = round1(
      points(capture.score, 8) +
        points(dilutionScore(multiples.dilution), 5) +
        points(liquidityScore, 4) +
        points(confidence * 100, 3),
    );

    const scoreAxes: ScoreAxes = {
      value: valueAxis,
      improvement: improvementAxis,
      discovery: discoveryAxis,
      quality: qualityAxis,
    };
    const rawScore = round1(valueAxis + improvementAxis + discoveryAxis + qualityAxis);
    const valueScore = gates.passed ? Math.round(rawScore) : null;
    const status = statusFor({
      gates,
      isNewProject,
      score: valueScore,
      axes: scoreAxes,
      grade,
      price30d: coin.priceChange30d,
      price60d: coin.priceChange60d,
    });

    const scoreNotes: string[] = [];
    if (pctPhr !== null) scoreNotes.push(`P/HR 섹터 백분위 ${Math.round(pctPhr)}`);
    if (fundamentalChange !== null) {
      scoreNotes.push(`우선 펀더멘털 30일 변화 ${Math.round(fundamentalChange)}%`);
    }
    if (sectorMedian60d !== null && coin.priceChange60d !== null) {
      scoreNotes.push(
        `60일 섹터 대비 ${Math.round(sectorMedian60d - coin.priceChange60d)}%p`,
      );
    }
    if (coin.cmcId !== null) scoreNotes.push(`CMC ID ${coin.cmcId}`);

    return {
      ...coin,
      multiples,
      sectorPercentiles: {
        pf: pctPf,
        ps: pctPs,
        phr: pctPhr,
        mcapTvl: pctMcapTvl,
      },
      scoreAxes,
      valueScore,
      valueCapture: capture,
      status,
      confidence: Math.round(confidence * 100) / 100,
      confidenceGrade: grade,
      scoreNotes,
      gates,
      lowActivity,
      highDilution,
    };
  });
}
