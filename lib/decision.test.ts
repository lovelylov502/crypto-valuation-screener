import { describe, expect, it } from "vitest";
import { summarizeDecision } from "./decision";
import type { CoinScored } from "./types";

function coin(partial: Partial<CoinScored> & { slug: string; name?: string }): CoinScored {
  const { slug, name, ...rest } = partial;
  return {
    slug,
    name: name ?? slug,
    symbol: null,
    category: "Dexs",
    chains: [],
    geckoId: null,
    logo: null,
    mcap: 1_000_000_000,
    tvl: 500_000_000,
    change1d: null,
    change7d: null,
    price: null,
    marketCapRank: null,
    totalVolume: null,
    priceChange7d: null,
    priceChange14d: null,
    priceChange30d: null,
    feesAnnual: 100_000_000,
    fees7d: null,
    fees30d: 8_000_000,
    feesChange7dover7d: null,
    feesChange30dover30d: null,
    revenueAnnual: 80_000_000,
    revenue30d: 6_000_000,
    holderRevenueAnnual: null,
    holderRevenue30d: null,
    volumeAnnual: null,
    volume30d: null,
    fdv: 1_200_000_000,
    circulatingSupply: null,
    totalSupply: null,
    maxSupply: null,
    multiples: {
      pf: 10,
      ps: 12.5,
      phr: null,
      mcapTvl: 2,
      fdvTvl: 2.4,
      dilution: 1.2,
    },
    sectorPercentiles: {
      pf: 70,
      ps: 70,
      phr: null,
      mcapTvl: 50,
    },
    growthScore: 50,
    valueScore: 78,
    valueCapture: {
      score: 38,
      label: "간접 포획",
      holderRevenueShare: null,
      signals: ["매출/수수료 실측"],
      risks: ["holder revenue 없음"],
    },
    label: "다소 저평가",
    confidence: 0.75,
    lowActivity: false,
    highDilution: false,
    ...rest,
  };
}

describe("summarizeDecision", () => {
  it("직접 holder revenue가 있고 싼 토큰을 검토 우선으로 분류한다", () => {
    const decision = summarizeDecision(coin({
      slug: "direct-cheap",
      holderRevenueAnnual: 50_000_000,
      holderRevenue30d: 4_000_000,
      multiples: {
        pf: 8,
        ps: 10,
        phr: 20,
        mcapTvl: 2,
        fdvTvl: 2.4,
        dilution: 1.2,
      },
      sectorPercentiles: {
        pf: 70,
        ps: 72,
        phr: 80,
        mcapTvl: 50,
      },
      valueScore: 86,
      valueCapture: {
        score: 86,
        label: "강한 가치포획",
        holderRevenueShare: 0.63,
        signals: ["holder revenue 실측", "P/HR 섹터 상위"],
        risks: [],
      },
    }));

    expect(decision.bucket).toBe("research-priority");
    expect(decision.priority).toBeGreaterThanOrEqual(80);
    expect(decision.thesis).toContain("holder revenue");
    expect(decision.evidence.map((e) => e.label)).toContain("holder revenue 실측");
    expect(decision.nextQuestions.join(" ")).toContain("지속");
  });

  it("싸지만 holder revenue가 없는 토큰을 포획 불명확 함정으로 분류한다", () => {
    const decision = summarizeDecision(coin({ slug: "cheap-no-capture", valueScore: 82 }));

    expect(decision.bucket).toBe("cheap-but-unclear-capture");
    expect(decision.risks.map((r) => r.label)).toContain("holder revenue 없음");
    expect(decision.unknowns).toContain("토큰 포획 경로 미확인");
    expect(decision.nextQuestions.join(" ")).toContain("수수료");
  });

  it("직접 포획이 있어도 고희석이면 고희석 리스크로 우선 분류한다", () => {
    const decision = summarizeDecision(coin({
      slug: "diluted-direct",
      fdv: 8_000_000_000,
      multiples: {
        pf: 8,
        ps: 10,
        phr: 20,
        mcapTvl: 2,
        fdvTvl: 16,
        dilution: 8,
      },
      holderRevenueAnnual: 50_000_000,
      holderRevenue30d: 4_000_000,
      valueScore: 84,
      highDilution: true,
      valueCapture: {
        score: 75,
        label: "강한 가치포획",
        holderRevenueShare: 0.63,
        signals: ["holder revenue 실측"],
        risks: ["고희석"],
      },
    }));

    expect(decision.bucket).toBe("dilution-risk");
    expect(decision.risks.map((r) => r.label)).toContain("고희석");
    expect(decision.nextQuestions.join(" ")).toContain("언락");
  });

  it("데이터가 부족하면 점수 대신 리서치 질문을 만든다", () => {
    const decision = summarizeDecision(coin({
      slug: "missing",
      mcap: null,
      valueScore: null,
      multiples: {
        pf: null,
        ps: null,
        phr: null,
        mcapTvl: null,
        fdvTvl: null,
        dilution: null,
      },
      sectorPercentiles: {
        pf: null,
        ps: null,
        phr: null,
        mcapTvl: null,
      },
      valueCapture: {
        score: null,
        label: "판단보류",
        holderRevenueShare: null,
        signals: [],
        risks: ["시총/토큰 데이터 부족"],
      },
    }));

    expect(decision.bucket).toBe("data-missing");
    expect(decision.priority).toBeLessThan(40);
    expect(decision.unknowns.length).toBeGreaterThan(0);
    expect(decision.nextQuestions.join(" ")).toContain("데이터");
  });
});
