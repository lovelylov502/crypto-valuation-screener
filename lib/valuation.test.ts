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
    price: null,
    marketCapRank: null,
    totalVolume: null,
    priceChange7d: null,
    priceChange14d: null,
    priceChange30d: null,
    feesAnnual: null,
    fees7d: null,
    fees30d: null,
    feesChange7dover7d: null,
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

// 섹터 백분위가 의미를 가지려면 표본 >=5 필요 → 카테고리당 더미로 채움.
// fees30d(신선도 통과)와 tvl(Mcap/TVL 멀티플)을 줘서 밸류 멀티플 2개 이상을 만든다.
function fillSector(category: string, count: number, pfBase: number): CoinRaw[] {
  return Array.from({ length: count }, (_, i) =>
    make({
      slug: `${category}-filler-${i}`,
      category,
      mcap: 1_000_000_000,
      feesAnnual: 1_000_000_000 / (pfBase + i), // 다양한 P/F
      fees30d: 1_000_000,
      tvl: 500_000_000,
    }),
  );
}

describe("scoreCoins", () => {
  it("같은 섹터에서 P/F가 낮은(싼) 코인이 더 높은 valueScore를 받는다", () => {
    const cheap = make({
      slug: "cheap",
      category: "Dexs",
      mcap: 1_000_000_000,
      feesAnnual: 500_000_000, // P/F = 2 (매우 쌈)
      fees30d: 1_000_000,
      tvl: 500_000_000, // Mcap/TVL은 pricey와 동일 → P/F만 점수 차이를 만듦
    });
    const pricey = make({
      slug: "pricey",
      category: "Dexs",
      mcap: 1_000_000_000,
      feesAnnual: 10_000_000, // P/F = 100 (비쌈)
      fees30d: 1_000_000,
      tvl: 500_000_000,
    });
    const result = scoreCoins([cheap, pricey, ...fillSector("Dexs", 6, 10)]);
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
      category: "Dexs",
      mcap: 1_000_000_000,
      feesAnnual: MIN_ACTIVITY_USD - 1,
      fees30d: ((MIN_ACTIVITY_USD - 1) * 30) / 365,
      tvl: 50_000_000,
    });
    const [z] = scoreCoins([zombie, ...fillSector("Dexs", 6, 10)]);
    expect(z.lowActivity).toBe(true);
    expect(z.sectorPercentiles.pf).toBeNull();
    // Mcap/TVL 멀티플 자체는 활동성과 무관하게 계산됨
    expect(z.multiples.mcapTvl).toBeCloseTo(20);
    expect(z.confidence).toBeLessThan(0.5);
  });

  it("밸류 멀티플을 하나도 못 만들면 판단보류", () => {
    const noData = make({ slug: "ghost", mcap: 5_000_000 }); // tvl·fees·rev 없음
    const [g] = scoreCoins([noData]);
    expect(g.label).toBe("판단보류");
    expect(g.valueScore).toBeNull();
  });

  it("밸류 멀티플이 1개뿐이면(단일 신호) 판단보류로 보수화된다", () => {
    const single = make({
      slug: "single",
      category: "Dexs",
      mcap: 1_000_000_000,
      feesAnnual: 200_000_000, // P/F만 (tvl·rev·holderRev 없음)
      fees30d: 1_000_000,
    });
    const [x] = scoreCoins([single, ...fillSector("Dexs", 6, 10)]);
    expect(x.sectorPercentiles.pf).not.toBeNull(); // P/F 백분위는 산출
    expect(x.sectorPercentiles.mcapTvl).toBeNull();
    expect(x.label).toBe("판단보류"); // 멀티플 < 2개 → 보류
    expect(x.valueScore).toBeNull();
  });

  it("Mcap/TVL은 화이트리스트 밖 섹터(Bridge)에서는 점수에 반영되지 않는다", () => {
    const bridge = make({
      slug: "bridge",
      category: "Bridge",
      mcap: 1_000_000_000,
      tvl: 500_000_000,
      feesAnnual: 100_000_000,
      fees30d: 1_000_000,
      revenueAnnual: 50_000_000,
      revenue30d: 500_000,
    });
    const [b] = scoreCoins([bridge, ...fillSector("Bridge", 6, 10)]);
    expect(b.multiples.mcapTvl).toBeCloseTo(2); // 멀티플 자체는 계산
    expect(b.sectorPercentiles.mcapTvl).toBeNull(); // 점수엔 미반영
    expect(b.valueScore).not.toBeNull(); // P/F·P/S 2개로 점수는 산출
  });

  it("신선도: 연율값은 있어도 최근 30일 활동이 전부 없으면 lowActivity", () => {
    const stale = make({
      slug: "stale",
      category: "Dexs",
      mcap: 1_000_000_000,
      feesAnnual: 500_000_000, // 연율은 큼
      tvl: 500_000_000,
      // fees30d·revenue30d·holderRevenue30d 모두 null
    });
    const [s] = scoreCoins([stale, ...fillSector("Dexs", 6, 10)]);
    expect(s.lowActivity).toBe(true);
    expect(s.sectorPercentiles.pf).toBeNull();
  });

  it("극단 멀티플(데이터 글리치)은 분포에서 제외되고 최저 백분위로 처리된다", () => {
    const glitch = make({
      slug: "glitch",
      category: "Dexs",
      mcap: 1_000_000_000,
      holderRevenueAnnual: 1, // P/HR = 1e9 (비현실적 글리치)
      holderRevenue30d: 1,
      feesAnnual: 50_000_000,
      fees30d: 1_000_000,
    });
    const normal = make({
      slug: "normal-hr",
      category: "Dexs",
      mcap: 1_000_000_000,
      holderRevenueAnnual: 100_000_000, // P/HR = 10 (정상)
      holderRevenue30d: 1_000_000,
      feesAnnual: 50_000_000,
      fees30d: 1_000_000,
    });
    // P/HR 분포를 형성할 정상 코인들 (글리치 제외 검증을 위해 필요)
    const hrFillers = Array.from({ length: 6 }, (_, i) =>
      make({
        slug: `hr-filler-${i}`,
        category: "Dexs",
        mcap: 1_000_000_000,
        holderRevenueAnnual: 100_000_000 / (5 + i), // P/HR 5~13
        holderRevenue30d: 1_000_000,
        feesAnnual: 50_000_000,
        fees30d: 1_000_000,
      }),
    );
    const result = scoreCoins([glitch, normal, ...hrFillers, ...fillSector("Dexs", 6, 10)]);
    const g = result.find((x) => x.slug === "glitch")!;
    const n = result.find((x) => x.slug === "normal-hr")!;
    expect(g.multiples.phr).toBeCloseTo(1_000_000_000);
    // 글리치는 분포 밖이라 최저 백분위, 정상 코인은 그보다 높음
    expect(g.sectorPercentiles.phr!).toBeLessThan(n.sectorPercentiles.phr!);
    expect(g.sectorPercentiles.phr!).toBeLessThan(5);
  });

  it("희석(FDV/Mcap)이 큰 코인은 dilution 멀티플과 highDilution 태그에 반영된다", () => {
    const diluted = make({
      slug: "diluted",
      category: "Dexs",
      mcap: 100_000_000,
      fdv: 1_000_000_000, // 10배 희석 (MC/FDV=0.1 < 0.3)
      tvl: 50_000_000,
      feesAnnual: 20_000_000,
      fees30d: 1_000_000,
    });
    const [d] = scoreCoins([diluted, ...fillSector("Dexs", 6, 10)]);
    expect(d.multiples.dilution).toBeCloseTo(10);
    expect(d.multiples.fdvTvl).toBeCloseTo(20);
    expect(d.highDilution).toBe(true);
  });

  it("완전유통(FDV≈Mcap) 코인은 highDilution이 false다", () => {
    const full = make({
      slug: "full",
      category: "Dexs",
      mcap: 1_000_000_000,
      fdv: 1_000_000_000, // 1배 (MC/FDV=1)
      tvl: 500_000_000,
      feesAnnual: 50_000_000,
      fees30d: 1_000_000,
    });
    const [f] = scoreCoins([full, ...fillSector("Dexs", 6, 10)]);
    expect(f.highDilution).toBe(false);
  });

  it("P/HR(시총/홀더수익)이 계산되고 낮을수록 높은 점수를 받는다", () => {
    const cheapHr = make({
      slug: "cheap-hr",
      category: "Dexs",
      mcap: 1_000_000_000,
      holderRevenueAnnual: 200_000_000, // P/HR = 5 (쌈)
      holderRevenue30d: 1_000_000,
      feesAnnual: 50_000_000,
      fees30d: 1_000_000,
    });
    const priceyHr = make({
      slug: "pricey-hr",
      category: "Dexs",
      mcap: 1_000_000_000,
      holderRevenueAnnual: 5_000_000, // P/HR = 200 (비쌈)
      holderRevenue30d: 100_000,
      feesAnnual: 50_000_000,
      fees30d: 1_000_000,
    });
    const result = scoreCoins([cheapHr, priceyHr, ...fillSector("Dexs", 6, 10)]);
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
      fees30d: 1_000_000,
      revenueAnnual: 100_000_000, // 밸류 멀티플 2개(P/F·P/S) 확보
      revenue30d: 500_000,
    });
    // 다른 카테고리 코인들로 글로벌 풀 형성
    const [l] = scoreCoins([lonely, ...fillSector("Dexs", 6, 10)]);
    expect(l.valueScore).not.toBeNull();
  });

  it("holder revenue가 실측되면 직접 가치포획 후보로 분류하고 간접 매출 코인보다 높은 포획 점수를 준다", () => {
    const direct = make({
      slug: "direct-capture",
      category: "Dexs",
      mcap: 1_000_000_000,
      fdv: 1_000_000_000,
      feesAnnual: 300_000_000,
      fees30d: 20_000_000,
      revenueAnnual: 100_000_000,
      revenue30d: 8_000_000,
      holderRevenueAnnual: 50_000_000,
      holderRevenue30d: 4_000_000,
      tvl: 500_000_000,
    });
    const indirect = make({
      slug: "indirect-revenue",
      category: "Dexs",
      mcap: 1_000_000_000,
      fdv: 1_000_000_000,
      feesAnnual: 300_000_000,
      fees30d: 20_000_000,
      revenueAnnual: 100_000_000,
      revenue30d: 8_000_000,
      tvl: 500_000_000,
    });

    const result = scoreCoins([direct, indirect, ...fillSector("Dexs", 6, 10)]);
    const d = result.find((x) => x.slug === "direct-capture")!;
    const i = result.find((x) => x.slug === "indirect-revenue")!;

    expect(d.valueCapture.label).toMatch(/가치포획/);
    expect(d.valueCapture.holderRevenueShare).toBeCloseTo(0.5);
    expect(d.valueCapture.signals).toContain("holder revenue 실측");
    expect(i.valueCapture.label).toBe("간접 포획");
    expect(i.valueCapture.risks).toContain("holder revenue 없음");
    expect(d.valueCapture.score!).toBeGreaterThan(i.valueCapture.score!);
  });

  it("holder revenue share는 매출 대비 비율로 계산하되 100%를 넘으면 1로 클리핑한다", () => {
    const overDistributed = make({
      slug: "over-distributed",
      category: "Dexs",
      mcap: 1_000_000_000,
      feesAnnual: 300_000_000,
      fees30d: 20_000_000,
      revenueAnnual: 100_000_000,
      revenue30d: 8_000_000,
      holderRevenueAnnual: 150_000_000,
      holderRevenue30d: 12_000_000,
      tvl: 500_000_000,
    });

    const [c] = scoreCoins([overDistributed, ...fillSector("Dexs", 6, 10)]);
    expect(c.valueCapture.holderRevenueShare).toBe(1);
  });

  it("고희석 코인은 가치포획 리스크로 표시하고 포획 점수를 낮춘다", () => {
    const base = {
      category: "Dexs",
      mcap: 1_000_000_000,
      feesAnnual: 300_000_000,
      fees30d: 20_000_000,
      revenueAnnual: 100_000_000,
      revenue30d: 8_000_000,
      holderRevenueAnnual: 50_000_000,
      holderRevenue30d: 4_000_000,
      tvl: 500_000_000,
    } satisfies Partial<CoinRaw>;
    const full = make({ slug: "full-float", ...base, fdv: 1_000_000_000 });
    const diluted = make({ slug: "diluted-capture", ...base, fdv: 10_000_000_000 });

    const result = scoreCoins([full, diluted, ...fillSector("Dexs", 6, 10)]);
    const f = result.find((x) => x.slug === "full-float")!;
    const d = result.find((x) => x.slug === "diluted-capture")!;

    expect(d.valueCapture.risks).toContain("고희석");
    expect(d.valueCapture.score!).toBeLessThan(f.valueCapture.score!);
  });
});
