import { describe, expect, it, vi } from "vitest";
import {
  MIN_ACTIVITY_USD,
  MIN_SECTOR_SAMPLE,
  SCORE_VERSION,
  scoreCoins,
} from "./valuation";
import type { CoinRaw } from "./types";
import type { HolderValueSummary } from "./holderValue";
import { aggregateHolderValueByGroup, emptyHolderValueSummary } from "./holderValue";
import { compareFlow } from "./signals";
import { appendSnapshot, compareSnapshot, makeSnapshot, parseHistory } from "./snapshotHistory";
import { assembleScreener } from "./screener";
import { fetchLatestSnapshot } from "./screenerRefresh";
import { researchMultiple, researchReasons, revenueGrowing } from "./research";
import { matchesRange } from "./screenerFilters";
import { summarizeRevenueHistory } from "./revenueHistory";

const REFERENCE = "2026-07-28T05:00:00.000Z";
import { sample, make, fixtureFundamentals } from './testFixtures';

describe("Typed denominator research rules", () => {
  it("uses 20 as an optional highlight while leaving higher multiples screenable", () => {
    const [c] = scoreCoins([sample({ revenue30d: 100_000 })], REFERENCE);
    expect(researchMultiple(c)).toBeGreaterThan(20);
    expect(matchesRange(researchMultiple(c), 0, 0)).toBe(true);
    expect(researchReasons(c, 20)).not.toContain("시총/프로토콜 수익 20배 이하");
    expect(researchReasons(c, 100)).toContain("시총/프로토콜 수익 100배 이하");
  });
  it("keeps the same research reasons for rising and falling price histories", () => {
    const rows = scoreCoins([
      sample({ priceChange30d: 80, priceChange60d: 150 }),
      sample({ slug: "falling", priceChange30d: -80, priceChange60d: -90 }),
    ], REFERENCE);
    expect(rows.every(revenueGrowing)).toBe(true);
    expect(researchReasons(rows[0])).toEqual(researchReasons(rows[1]));
    const [uncertain] = scoreCoins([sample({ identityStatus: "ambiguous" })], REFERENCE);
    expect(researchMultiple(uncertain)).toBeNull();
    expect(revenueGrowing(uncertain)).toBe(false);
  });
  it("uses completed-day revenue in discovery without mixing the holder accounting denominator", () => {
    const end = Math.floor(Date.parse(REFERENCE) / 86400000) * 86400 - 86400;
    const chart: [number, Record<string, number>][] = Array.from({ length: 60 }, (_, i) => [end - i * 86400, { Sample: i < 30 ? 2000 : 1000 }]);
    const history = summarizeRevenueHistory([{ slug: "sample", name: "Sample" }], chart, Date.parse(REFERENCE), "fixture", new Map([["sample", fixtureFundamentals.revenue]])).sample;
    const raw = sample({ revenue30d: 100_000, revenuePrev30d: 200_000, revenueHistory: history });
    const [c] = scoreCoins([raw], REFERENCE);
    expect(c.opportunities.revenue.changePct).toBe(100);
    expect(researchMultiple(c)).toBeCloseTo(raw.mcap! / (60_000 * 365 / 30));
    expect(c.valueCapture.eligibleHolderValueShare).toBe(3);
    expect(makeSnapshot(assembleScreener([raw], REFERENCE, [])).coins.sample.revenue30d).toBe(60_000);
  });
  it("keeps observed zero amounts separate from missing comparison history", () => {
    const [zero, stopped] = scoreCoins([
      sample({ revenue30d: 0, revenuePrev30d: 0, fees30d: 0, feesPrev30d: 0, holderValue: { eligibleCurrent30d: 0, eligiblePrevious30d: 0 } }),
      sample({ slug: "stopped", holderValue: { eligibleCurrent30d: 0, eligiblePrevious30d: 100 } }),
    ], REFERENCE);
    expect(zero.opportunities.revenue.state).toBe("flat");
    expect(zero.opportunities.dataIssues).not.toContain("실적 비교 자료 부족 · 누락 또는 음수 금액 확인");
    expect(researchMultiple(zero)).toBeNull();
    expect(stopped.opportunities.holder).toBe(false);
    expect(stopped.opportunities.transition).toBe(true);
  });
});

describe("independent opportunity signals and same-period accounting", () => {
  it("uses matching 30-day amounts for shares and every primary cashflow multiple", () => {
    const raw = sample({ revenue30d: 97_363, revenueAnnual: 7_138_646, holderValue: { eligibleCurrent30d: 48_685, eligibleRunRate: 48_685 * 365 / 30 } });
    const [c] = scoreCoins([raw], REFERENCE);
    expect(c.valueCapture.eligibleHolderValueShare).toBeCloseTo(48_685 / 97_363);
    expect(c.multiples.revenueMultiple).toBeCloseTo(raw.mcap! / (97_363 * 365 / 30));
    expect(c.multiples.pf).toBeCloseTo(raw.mcap! / (raw.fees30d! * 365 / 30));
  });
  it("preserves ratios above 100% and warns about incompatible scope or funding", () => {
    const [c] = scoreCoins([sample({ revenue30d: 100_000, holderValue: { eligibleCurrent30d: 200_000 } })], REFERENCE);
    expect(c.valueCapture.eligibleHolderValueShare).toBe(2);
    expect(c.valueCapture.risks.join(" ")).toContain("분모를 초과");
    expect(c.valueCapture.score!).toBeLessThanOrEqual(100);
  });
  it("surfaces growing businesses even with no holder capture and no peer score", () => {
    const [c] = scoreCoins([sample({ holderValue: emptyHolderValueSummary() })], REFERENCE);
    expect(c.opportunities.business).toBe(true);
    expect(c.opportunities.holder).toBe(false);
    expect(c.peerCounts.phr).toBe(0);
    expect(c.status).not.toBe("발굴 후보");
  });
  it("keeps an opportunity when price rises or dilution fails a score gate", () => {
    const rows = [sample({ priceChange30d: 19 }), sample({ slug: "later", priceChange30d: 21, fdv: 500_000_000 })];
    const [a,b] = scoreCoins(rows, REFERENCE);
    expect(a.opportunities.business).toBe(true);
    expect(b.opportunities.business).toBe(true);
    expect(b.opportunities.holder).toBe(true);
    expect(b.opportunities.risks).toContain("높은 희석 비율");
    expect(b.opportunities.dataIssues).not.toContain("높은 희석 비율");
    expect(b.valueScore).toBeNull();
  });
  it("never promotes a token with an ambiguous identity", () => {
    const [c] = scoreCoins([sample({ identityStatus: "ambiguous" })], REFERENCE);
    expect([c.opportunities.business,c.opportunities.holder,c.opportunities.transition]).toEqual([false,false,false]);
  });
  it("separates zero transitions, missing history and a stopped flow", () => {
    expect(compareFlow(10, 0)).toEqual({state:"from_zero",changePct:null});
    expect(compareFlow(10, null)).toEqual({state:"unknown",changePct:null});
    expect(compareFlow(0, 10)).toEqual({state:"to_zero",changePct:-100});
    const [started, unknown] = scoreCoins([sample({holderValue:{eligiblePrevious30d:0}}), sample({holderValue:{eligiblePrevious30d:null}})], REFERENCE);
    expect(started.opportunities.transition).toBe(true);
    expect(unknown.opportunities.transition).toBe(false);
  });
  it("includes reviewed conditional locker revenue with an explicit condition", () => {
    const holderValue = aggregateHolderValueByGroup([{slug:"ve-test",total30d:100,total60dto30d:80,methodology:{HoldersRevenue:"All fees distributed to ve token voters."}}],s=>s).get("ve-test")!;
    const [c] = scoreCoins([sample({holderValue})], REFERENCE);
    expect(c.opportunities.holder).toBe(true);
    expect(c.opportunities.conditionalCurrent30d).toBe(100);
    expect(c.multiples.phr).toBeCloseTo(c.mcap! / (100 * 365 / 30));
    expect(c.holderValue.components[0].condition).toBe("락업·투표 조건");
  });
});

describe("local observations and refresh recovery", () => {
  const payload = (at = REFERENCE) => assembleScreener([sample()], at, []);
  it("keeps one newest observation per KST day without replacing it with old ISR data", () => {
    const a = makeSnapshot(payload());
    const b = makeSnapshot(payload("2026-07-28T06:00:00.000Z"));
    expect(appendSnapshot([a], b)).toEqual([b]);
    expect(appendSnapshot([b], a)).toEqual([b]);
    const tomorrow = makeSnapshot(payload("2026-07-28T16:00:00.000Z"));
    expect(appendSnapshot([b], tomorrow)).toHaveLength(2);
  });
  it("rejects corrupt persisted records and retains a valid snapshot", () => {
    const a = makeSnapshot(payload());
    expect(parseHistory(JSON.stringify([a]))).toEqual([a]);
    expect(parseHistory('{bad')).toEqual([]);
    expect(parseHistory(JSON.stringify([{...a,coins:{broken:{identity:"x"}}}]))).toEqual([]);
  });
  it("retains pre-v5 history and rejects malformed optional valuation fields", () => {
    const snapshot = makeSnapshot(payload());
    delete snapshot.coins.sample.revenueMultiple;
    delete snapshot.coins.sample.mcap;
    expect(parseHistory(JSON.stringify([snapshot]))).toEqual([snapshot]);
    expect(parseHistory(JSON.stringify([{ ...snapshot, coins: { sample: { ...snapshot.coins.sample, revenueMultiple: "20" } } }]))).toEqual([]);
  });
  it("does not classify price or experimental score movement alone as a research change", () => {
    const data = payload(); const c = data.coins[0]; const baseline = makeSnapshot(data);
    const changed = { ...c, mcap: c.mcap! * 2, price: c.price! * 2, valueScore: 99 };
    const comparison = compareSnapshot(changed, baseline, data.scoreVersion);
    expect(comparison.multipleDelta).toBeGreaterThan(0);
    expect(comparison.meaningful).toBe(false);
    const later = appendSnapshot([baseline], makeSnapshot({ ...data, updatedAt: "2026-07-29T05:00:00.000Z" }));
    expect(later).toHaveLength(2);
    expect(baseline.at).toBe(REFERENCE);
  });
  it("does not compare scores after a rule or token identity change", () => {
    const data = payload(); const c = data.coins[0]; const s = makeSnapshot(data);
    expect(compareSnapshot(c,s,"new-rules").state).toBe("rules_changed");
    expect(compareSnapshot({...c,cmcId:999999},s,data.scoreVersion).state).toBe("identity_changed");
    expect(compareSnapshot(c,s,data.scoreVersion).meaningful).toBe(false);
    expect(compareSnapshot({...c,revenue30d:c.revenue30d! * 1.1},s,data.scoreVersion).meaningful).toBe(true);
  });
  it("retries a stale ISR response and returns the regenerated snapshot", async () => {
    const old = payload("2026-07-27T00:00:00.000Z"); const fresh = payload();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(old))).mockResolvedValueOnce(new Response(JSON.stringify(fresh)));
    const onWaiting = vi.fn();
    const result = await fetchLatestSnapshot({fetcher,signal:new AbortController().signal,onWaiting,wait:async()=>{},now:()=>Date.parse(REFERENCE)});
    expect(result.updatedAt).toBe(REFERENCE); expect(fetcher).toHaveBeenCalledTimes(2); expect(onWaiting).toHaveBeenCalledOnce();
  });
  it("bounds stale retries and rejects failure, empty and old-schema payloads", async () => {
    const old = payload("2026-07-27T00:00:00.000Z");
    const options = {signal:new AbortController().signal,onWaiting:()=>{},wait:async()=>{},now:()=>Date.parse(REFERENCE)};
    const fetcher = vi.fn().mockImplementation(async()=>new Response(JSON.stringify(old)));
    expect((await fetchLatestSnapshot({...options,fetcher})).updatedAt).toBe(old.updatedAt);
    expect(fetcher).toHaveBeenCalledTimes(7);
    for (const response of [new Response("{}",{status:502}),new Response(JSON.stringify({...payload(),coins:[]})),new Response(JSON.stringify({...payload(),coins:[{}]}))]) {
      await expect(fetchLatestSnapshot({...options,fetcher:async()=>response})).rejects.toThrow();
    }
  });
});

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
        eligibleCurrent30d: (1_000_000 + index * 250_000) * 30 / 365,
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
  return make({ ...coin, holderHistory: undefined });
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
    expect(SCORE_VERSION).toBe("research-v9-full-universe-and-24h");
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
    expect(scored.sectorPercentiles.revenueMultiple).toBeNull();
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
