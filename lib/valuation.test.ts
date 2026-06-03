import { describe, it, expect } from "vitest";
import { scoreCoins, MIN_ACTIVITY_USD } from "./valuation";
import type { CoinRaw } from "./types";

function make(partial: Partial<CoinRaw> & { slug: string }): CoinRaw {
  return {
    name: partial.slug,
    symbol: null,
    category: null,
    chains: [],
    geckoId: null,
    logo: null,
    mcap: null,
    tvl: null,
    change1d: null,
    change7d: null,
    feesAnnual: null,
    fees30d: null,
    feesChange30dover30d: null,
    revenueAnnual: null,
    revenue30d: null,
    holderRevenueAnnual: null,
    holderRevenue30d: null,
    volumeAnnual: null,
    volume30d: null,
    fdv: null,
    circulatingSupply: null,
    totalSupply: null,
    maxSupply: null,
    ...partial,
  };
}

// 섹터 백분위가 의미를 가지려면 표본 >=5 필요 → 카테고리당 더미로 채움
function fillSector(category: string, count: number, pfBase: number): CoinRaw[] {
  return Array.from({ length: count }, (_, i) =>
    make({
      slug: `${category}-filler-${i}`,
      category,
      mcap: 1_000_000_000,
      feesAnnual: 1_000_000_000 / (pfBase + i), // 다양한 P/F
    }),
  );
}

describe("scoreCoins", () => {
  it("같은 섹터에서 P/F가 낮은(싼) 코인이 더 높은 valueScore를 받는다", () => {
    const cheap = make({
      slug: "cheap",
      category: "Dexes",
      mcap: 1_000_000_000,
      feesAnnual: 500_000_000, // P/F = 2 (매우 쌈)
    });
    const pricey = make({
      slug: "pricey",
      category: "Dexes",
      mcap: 1_000_000_000,
      feesAnnual: 10_000_000, // P/F = 100 (비쌈)
    });
    const result = scoreCoins([cheap, pricey, ...fillSector("Dexes", 6, 10)]);
    const c = result.find((x) => x.slug === "cheap")!;
    const p = result.find((x) => x.slug === "pricey")!;

    expect(c.multiples.pf).toBeCloseTo(2);
    expect(p.multiples.pf).toBeCloseTo(100);
    expect(c.valueScore!).toBeGreaterThan(p.valueScore!);
    expect(c.sectorPercentiles.pf!).toBeGreaterThan(p.sectorPercentiles.pf!);
  });

  it("매출이 임계값 미만이면 lowActivity로 플래그되고 P/F 백분위가 제외된다", () => {
    const zombie = make({
      slug: "zombie",
      category: "Dexes",
      mcap: 1_000_000_000,
      feesAnnual: MIN_ACTIVITY_USD - 1,
      tvl: 50_000_000,
    });
    const [z] = scoreCoins([zombie, ...fillSector("Dexes", 6, 10)]);
    expect(z.lowActivity).toBe(true);
    expect(z.sectorPercentiles.pf).toBeNull();
    // Mcap/TVL은 활동성과 무관하게 계산됨
    expect(z.multiples.mcapTvl).toBeCloseTo(20);
    expect(z.confidence).toBeLessThan(0.5);
  });

  it("밸류 멀티플을 하나도 못 만들면 판단보류", () => {
    const noData = make({ slug: "ghost", mcap: 5_000_000 }); // tvl·fees·rev 없음
    const [g] = scoreCoins([noData]);
    expect(g.label).toBe("판단보류");
    expect(g.valueScore).toBeNull();
  });

  it("희석(FDV/Mcap)이 큰 코인은 dilution 멀티플에 반영된다", () => {
    const diluted = make({
      slug: "diluted",
      category: "Dexes",
      mcap: 100_000_000,
      fdv: 1_000_000_000, // 10배 희석
      tvl: 50_000_000,
      feesAnnual: 20_000_000,
    });
    const [d] = scoreCoins([diluted, ...fillSector("Dexes", 6, 10)]);
    expect(d.multiples.dilution).toBeCloseTo(10);
    expect(d.multiples.fdvTvl).toBeCloseTo(20);
  });

  it("P/HR(시총/홀더수익)이 계산되고 낮을수록 높은 점수를 받는다", () => {
    const cheapHr = make({
      slug: "cheap-hr",
      category: "Dexes",
      mcap: 1_000_000_000,
      holderRevenueAnnual: 200_000_000, // P/HR = 5 (쌈)
      feesAnnual: 50_000_000,
    });
    const priceyHr = make({
      slug: "pricey-hr",
      category: "Dexes",
      mcap: 1_000_000_000,
      holderRevenueAnnual: 5_000_000, // P/HR = 200 (비쌈)
      feesAnnual: 50_000_000,
    });
    const result = scoreCoins([cheapHr, priceyHr, ...fillSector("Dexes", 6, 10)]);
    const c = result.find((x) => x.slug === "cheap-hr")!;
    const p = result.find((x) => x.slug === "pricey-hr")!;
    expect(c.multiples.phr).toBeCloseTo(5);
    expect(p.multiples.phr).toBeCloseTo(200);
    expect(c.sectorPercentiles.phr!).toBeGreaterThan(p.sectorPercentiles.phr!);
    expect(c.valueScore!).toBeGreaterThan(p.valueScore!);
  });

  it("섹터 표본이 부족하면 전체 풀로 fallback해도 점수가 산출된다", () => {
    const lonely = make({
      slug: "lonely",
      category: "VeryRareCategory",
      mcap: 1_000_000_000,
      feesAnnual: 200_000_000,
    });
    // 다른 카테고리 코인들로 글로벌 풀 형성
    const [l] = scoreCoins([lonely, ...fillSector("Dexes", 6, 10)]);
    expect(l.valueScore).not.toBeNull();
  });
});
