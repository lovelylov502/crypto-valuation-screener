import { describe, expect, it } from "vitest";
import {
  MIN_ACTIVITY_USD,
  MIN_SECTOR_SAMPLE,
  SCORE_VERSION,
  scoreCoins,
} from "./valuation";
import type { CoinRaw } from "./types";
import type { HolderValueSummary } from "./holderValue";

const REFERENCE = "2026-07-28T05:00:00.000Z";
const OLD_LISTING = Date.parse("2025-01-01T00:00:00.000Z") / 1000;

type CoinOverrides = Omit<Partial<CoinRaw>, "holderValue"> & {
  slug: string;
  holderValue?: Partial<HolderValueSummary>;
};

function make(partial: CoinOverrides): CoinRaw {
  const { holderValue, ...rest } = partial;
  return {
    name: partial.slug,
    symbol: "TST",
    category: "Dexs",
    chains: [],
    geckoId: "test-token",
    cmcId: 100,
    cmcSlug: "test-token",
    logo: null,
    listedAt: OLD_LISTING,
    isParent: false,
    identityStatus: "verified",
    identityReason: "test verified",
    mcap: 100_000_000,
    tvl: 50_000_000,
    change1d: 0,
    change7d: 0,
    price: 1,
    marketCapRank: 500,
    totalVolume: 2_000_000,
    numMarketPairs: 20,
    marketDataUpdatedAt: "2026-07-28T04:00:00.000Z",
    priceChange7d: 0,
    priceChange14d: 0,
    priceChange30d: -5,
    priceChange60d: -10,
    priceChange90d: -10,
    priceChange1y: -20,
    athChangePercentage: -80,
    atlChangePercentage: 100,
    feesAnnual: 12_000_000,
    fees1y: 12_000_000,
    fees7d: 250_000,
    fees30d: 1_200_000,
    feesPrev30d: 1_000_000,
    feesChange7dover7d: 10,
    feesChange30dover30d: 20,
    revenueAnnual: 6_000_000,
    revenue1y: 6_000_000,
    revenue30d: 600_000,
    revenuePrev30d: 500_000,
    holderValue: {
      sourceStatus: "defillama-derived",
      availability: "eligible",
      eligibleCurrent30d: 300_000,
      eligiblePrevious30d: 250_000,
      eligibleRunRate: 3_650_000,
      eligibleTtm: 3_000_000,
      currentVsEligibleTtmRatio: 3_650_000 / 3_000_000,
      rawCurrent30d: 300_000,
      rawPrevious30d: 250_000,
      rawTtm: 3_000_000,
      excludedCurrent30d: null,
      excludedTtm: null,
      excludedDoublecountedCount: 0,
      phrUnavailableReason: null,
      warning: null,
      components: [],
      ...holderValue,
    },
    volumeAnnual: null,
    volume30d: null,
    fdv: 120_000_000,
    circulatingSupply: 100_000_000,
    totalSupply: 120_000_000,
    maxSupply: 120_000_000,
    ...rest,
  };
}

function fillSector(count = MIN_SECTOR_SAMPLE + 2): CoinRaw[] {
  return Array.from({ length: count }, (_, index) =>
    make({
      slug: `peer-${index}`,
      name: `Peer ${index}`,
      cmcId: 1000 + index,
      cmcSlug: `peer-${index}`,
      geckoId: `peer-${index}`,
      marketCapRank: 600 + index,
      mcap: 100_000_000,
      holderValue: {
        eligibleRunRate: 1_000_000 + index * 250_000,
        eligibleTtm: 10_000_000,
        rawTtm: 10_000_000,
      },
      revenueAnnual: 3_000_000 + index * 300_000,
      feesAnnual: 8_000_000 + index * 500_000,
      priceChange60d: -20 + index,
    }),
  );
}

function attachHolderValue(
  coin: CoinRaw,
  partial: Partial<HolderValueSummary>,
): CoinRaw {
  Object.assign(coin, {
    holderValue: {
      sourceStatus: "defillama-derived",
      availability: "eligible",
      eligibleCurrent30d: 300_000,
      eligiblePrevious30d: 250_000,
      eligibleRunRate: 3_650_000,
      eligibleTtm: 3_000_000,
      currentVsEligibleTtmRatio: 3_650_000 / 3_000_000,
      rawCurrent30d: 300_000,
      rawPrevious30d: 250_000,
      rawTtm: 3_000_000,
      excludedCurrent30d: null,
      excludedTtm: null,
      excludedDoublecountedCount: 0,
      phrUnavailableReason: null,
      warning: null,
      components: [],
      ...partial,
    } satisfies HolderValueSummary,
  });
  return coin;
}

describe("scoreCoins discovery model", () => {
  it("uses eligible current 30d run-rate for P/HR instead of raw TTM", () => {
    const current = attachHolderValue(
      make({
        slug: "current-run-rate",
        mcap: 120_000_000,
      }),
      {
        eligibleCurrent30d: 1_000_000,
        eligiblePrevious30d: 900_000,
        eligibleRunRate: 12_166_666.666666666,
        eligibleTtm: 300_000_000,
        currentVsEligibleTtmRatio: 12_166_666.666666666 / 300_000_000,
        rawCurrent30d: 1_000_000,
        rawTtm: 300_000_000,
      },
    );

    const [scored] = scoreCoins([current], REFERENCE);

    expect(scored.multiples.phr).toBeCloseTo(120_000_000 / 12_166_666.666666666);
    expect(SCORE_VERSION).toBe("rediscovery-v3-holder-classifier");
  });

  it("leaves current P/HR unavailable when TTM is positive but current 30d is zero", () => {
    const stale = attachHolderValue(
      make({
        slug: "aave-like",
      }),
      {
        availability: "stale",
        eligibleCurrent30d: 0,
        eligiblePrevious30d: 576_537,
        eligibleRunRate: null,
        eligibleTtm: 25_657_324,
        currentVsEligibleTtmRatio: null,
        rawCurrent30d: 0,
        rawTtm: 25_657_324,
        phrUnavailableReason: "최근 30일 적격 holder value가 0/누락",
        warning: "최근 30일 적격 흐름이 0/누락됐지만 TTM은 양수",
      },
    );

    const [scored] = scoreCoins([stale], REFERENCE);

    expect(scored.multiples.phr).toBeNull();
    expect(scored.valueCapture.score).toBeNull();
  });

  it("does not give ordinary holder-value credit to excluded fee burns", () => {
    const feeBurn = attachHolderValue(
      make({
        slug: "canton-like",
      }),
      {
        availability: "excluded",
        eligibleCurrent30d: null,
        eligiblePrevious30d: null,
        eligibleRunRate: null,
        eligibleTtm: null,
        currentVsEligibleTtmRatio: null,
        rawCurrent30d: 50_700_736,
        rawPrevious30d: 55_385_244,
        rawTtm: 554_426_081,
        excludedCurrent30d: 50_700_736,
        excludedTtm: 554_426_081,
        phrUnavailableReason: "일반 홀더 P/HR 제외 경제유형",
        warning: "DefiLlama holder revenue가 일반 홀더 P/HR 제외 유형",
      },
    );

    const [scored] = scoreCoins([feeBurn], REFERENCE);

    expect(scored.multiples.phr).toBeNull();
    expect(scored.valueCapture.score).toBeNull();
    expect(scored.valueCapture.signals).not.toContain("holder revenue 실측");
  });

  it("computes holder trend only from comparable eligible components", () => {
    const mixedTrend = attachHolderValue(
      make({
        slug: "mixed-trend",
      }),
      {
        eligibleCurrent30d: 100,
        eligiblePrevious30d: 200,
        eligibleRunRate: (100 * 365) / 30,
        rawCurrent30d: 300,
        rawPrevious30d: 100,
      },
    );

    const [scored] = scoreCoins([mixedTrend], REFERENCE);

    expect(scored.scoreNotes).toContain("우선 펀더멘털 30일 변화 -50%");
  });

  it("uses fixed-weight value inputs so cheaper P/HR ranks above expensive P/HR", () => {
    const cheap = make({
      slug: "cheap",
      holderValue: {
        eligibleCurrent30d: 2_000_000,
        eligiblePrevious30d: 1_500_000,
        eligibleRunRate: (2_000_000 * 365) / 30,
        eligibleTtm: 20_000_000,
        rawCurrent30d: 2_000_000,
        rawPrevious30d: 1_500_000,
        rawTtm: 20_000_000,
      },
    });
    const expensive = make({
      slug: "expensive",
      holderValue: {
        eligibleCurrent30d: 50_000,
        eligiblePrevious30d: 40_000,
        eligibleRunRate: (50_000 * 365) / 30,
        eligibleTtm: 500_000,
        rawCurrent30d: 50_000,
        rawPrevious30d: 40_000,
        rawTtm: 500_000,
      },
    });

    const result = scoreCoins([cheap, expensive, ...fillSector()], REFERENCE);
    const cheapScored = result.find((coin) => coin.slug === "cheap")!;
    const expensiveScored = result.find((coin) => coin.slug === "expensive")!;

    expect(cheapScored.sectorPercentiles.phr!).toBeGreaterThan(
      expensiveScored.sectorPercentiles.phr!,
    );
    expect(cheapScored.scoreAxes.value).toBeGreaterThan(
      expensiveScored.scoreAxes.value,
    );
  });

  it("holds ambiguous parent groups before any score is emitted", () => {
    const ambiguous = make({
      slug: "parent#mixed",
      isParent: true,
      identityStatus: "ambiguous",
      identityReason: "parent 그룹에 토큰 후보가 여러 개임 (3)",
    });
    const [scored] = scoreCoins([ambiguous, ...fillSector()], REFERENCE);

    expect(scored.valueScore).toBeNull();
    expect(scored.status).toBe("데이터 보류");
    expect(scored.gates.identity).toBe(false);
    expect(scored.gates.reasons[0]).toContain("토큰 후보");
  });

  it("does not renormalize missing P/HR into a near-perfect score", () => {
    const complete = make({ slug: "complete" });
    const missingHolderRevenue = make({
      slug: "missing-holder",
      holderValue: {
        availability: "none",
        eligibleCurrent30d: null,
        eligiblePrevious30d: null,
        eligibleRunRate: null,
        eligibleTtm: null,
        rawCurrent30d: null,
        rawPrevious30d: null,
        rawTtm: null,
        phrUnavailableReason: "최근 30일 적격 holder value 없음",
      },
    });

    const result = scoreCoins(
      [complete, missingHolderRevenue, ...fillSector()],
      REFERENCE,
    );
    const completeScored = result.find((coin) => coin.slug === "complete")!;
    const missingScored = result.find((coin) => coin.slug === "missing-holder")!;

    expect(missingScored.scoreAxes.value).toBeLessThan(completeScored.scoreAxes.value);
    expect(missingScored.confidence).toBeLessThan(completeScored.confidence);
  });

  it("does not use a global fallback when a sector peer sample is too small", () => {
    const rare = make({ slug: "rare", category: "Rare" });
    const result = scoreCoins([rare, ...fillSector()], REFERENCE);
    const scored = result.find((coin) => coin.slug === "rare")!;

    expect(scored.sectorPercentiles.phr).toBeNull();
    expect(scored.sectorPercentiles.ps).toBeNull();
    expect(scored.sectorPercentiles.pf).toBeNull();
  });

  it("counts holder revenue when applying the activity gate", () => {
    const holderOnly = make({
      slug: "holder-only",
      feesAnnual: null,
      fees1y: null,
      fees30d: null,
      feesPrev30d: null,
      revenueAnnual: null,
      revenue1y: null,
      revenue30d: null,
      revenuePrev30d: null,
      holderValue: {
        eligibleCurrent30d: 20_000,
        eligiblePrevious30d: 10_000,
        eligibleRunRate: MIN_ACTIVITY_USD + 1,
        eligibleTtm: MIN_ACTIVITY_USD + 1,
        rawCurrent30d: 20_000,
        rawPrevious30d: 10_000,
        rawTtm: MIN_ACTIVITY_USD + 1,
      },
    });
    const [scored] = scoreCoins([holderOnly, ...fillSector()], REFERENCE);

    expect(scored.lowActivity).toBe(false);
    expect(scored.gates.activity).toBe(true);
  });

  it("holds assets below the dynamic liquidity threshold", () => {
    const illiquid = make({
      slug: "illiquid",
      mcap: 1_000_000_000,
      totalVolume: 99_999,
    });
    const [scored] = scoreCoins([illiquid, ...fillSector()], REFERENCE);

    expect(scored.gates.liquidity).toBe(false);
    expect(scored.status).toBe("데이터 보류");
    expect(scored.gates.reasons).toContain("24시간 거래량이 유동성 기준 미달");
  });

  it("holds severe dilution until unlock risk is explicitly known", () => {
    const diluted = make({
      slug: "diluted",
      mcap: 100_000_000,
      fdv: 1_000_000_000,
    });
    const [scored] = scoreCoins([diluted, ...fillSector()], REFERENCE);

    expect(scored.highDilution).toBe(true);
    expect(scored.gates.dilution).toBe(false);
    expect(scored.valueScore).toBeNull();
    expect(scored.gates.reasons).toContain("FDV/Mcap 3.33배 초과·언락 미확인");
  });

  it("routes listings younger than 90 days to a separate lane", () => {
    const recent = make({
      slug: "recent",
      listedAt: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
    });
    const [scored] = scoreCoins([recent, ...fillSector()], REFERENCE);

    expect(scored.gates.matureProject).toBe(false);
    expect(scored.status).toBe("신규 프로젝트");
    expect(scored.valueScore).toBeNull();
  });

  it("labels strong fundamentals with already-rising price as rerating underway", () => {
    const rerated = make({
      slug: "rerated",
      holderValue: {
        eligibleCurrent30d: 600_000,
        eligiblePrevious30d: 250_000,
        eligibleRunRate: (600_000 * 365) / 30,
        rawCurrent30d: 600_000,
        rawPrevious30d: 250_000,
      },
      revenue30d: 1_200_000,
      revenuePrev30d: 500_000,
      fees30d: 2_400_000,
      feesPrev30d: 1_000_000,
      priceChange30d: 45,
      priceChange60d: 60,
    });
    const result = scoreCoins([rerated, ...fillSector()], REFERENCE);
    const scored = result.find((coin) => coin.slug === "rerated")!;

    expect(scored.gates.passed).toBe(true);
    expect(scored.scoreAxes.improvement).toBeGreaterThanOrEqual(12.5);
    expect(scored.status).toBe("재평가 진행 중");
  });

  it("never assumes 100% holder capture when the denominator is missing", () => {
    const unknownDenominator = make({
      slug: "unknown-denominator",
      feesAnnual: null,
      fees1y: null,
      fees30d: null,
      feesPrev30d: null,
      revenueAnnual: null,
      revenue1y: null,
      revenue30d: null,
      revenuePrev30d: null,
      holderValue: {
        eligibleCurrent30d: 100_000,
        eligiblePrevious30d: 80_000,
        eligibleRunRate: 1_000_000,
        eligibleTtm: 1_000_000,
        rawCurrent30d: 100_000,
        rawPrevious30d: 80_000,
        rawTtm: 1_000_000,
      },
    });
    const [scored] = scoreCoins(
      [unknownDenominator, ...fillSector()],
      REFERENCE,
    );

    expect(scored.valueCapture.eligibleHolderValueShare).toBeNull();
  });
});
