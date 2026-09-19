import { describe, expect, it } from "vitest";
import {
  aggregateHolderValueByGroup,
  classifyHolderMethodology,
  holderEconomicTypeLabel,
} from "./holderValue";

describe("holderEconomicTypeLabel", () => {
  it("exposes all economic types with compact non-equivalent labels", () => {
    expect(holderEconomicTypeLabel("direct_distribution")).toBe("직접 분배");
    expect(holderEconomicTypeLabel("market_buyback")).toBe("시장매입");
    expect(holderEconomicTypeLabel("buyback_and_burn")).toBe("매입+소각");
    expect(holderEconomicTypeLabel("native_fee_burn")).toBe("수수료 소각");
    expect(holderEconomicTypeLabel("ve_voter_locker_distribution")).toBe("ve/투표자");
    expect(holderEconomicTypeLabel("unclear_other")).toBe("불명확");
  });
});

describe("classifyHolderMethodology", () => {
  it.each([
    [
      "direct_distribution",
      "All trading fees are distributed to DYDX token stakers as staking rewards.",
      true,
    ],
    [
      "market_buyback",
      "99% of fees go to Assistance Fund for buying HYPE tokens.",
      true,
    ],
    [
      "market_buyback",
      "EDGE token buybacks funded by edgeX protocol revenue.",
      true,
    ],
    [
      "market_buyback",
      "JUP token buybacks from 50% of platform revenue, started 2025-02-17.",
      true,
    ],
    [
      "market_buyback",
      "PUMP token buyback sourced from onchain burns; aggregates buybacks across all pump products.",
      true,
    ],
    [
      "buyback_and_burn",
      "50% of revenue are used to buy back and burn CAKE.",
      true,
    ],
    [
      "native_fee_burn",
      "All the collected fees are burned.",
      false,
    ],
    [
      "ve_voter_locker_distribution",
      "Fees are forwarded to FeeVotingReward for distribution to veAERO voters.",
      false,
    ],
    [
      "unclear_other",
      "Money going to governance token holders",
      false,
    ],
    [
      "unclear_other",
      "From 2025-02-17, 50% of revenue goes to JUP holders.",
      false,
    ],
    [
      "market_buyback",
      "Tracks LIDO bought back by the DAO as part of the LDO Accumulation Program",
      true,
    ],
    [
      "market_buyback",
      "From 2026-01-01, 60% of protocol revenue is used to buy $KDK on the open market.",
      true,
    ],
    [
      "market_buyback",
      "Protocol revenue is used to by back KDK on the open market.",
      true,
    ],
    [
      "direct_distribution",
      "90% of the protocol revenue goes to stYFI stakers since 2026-02-05",
      true,
    ],
    [
      "direct_distribution",
      "A share of each trade fee goes to xSUSHI stakers.",
      true,
    ],
    [
      "direct_distribution",
      "30% of all collected fees goes to GMX stakers",
      true,
    ],
    [
      "direct_distribution",
      "50% of the revenue goes to TONIC stakers",
      true,
    ],
    [
      "direct_distribution",
      "Protocol revenue is paid out to people who stake SEND.",
      true,
    ],
    [
      "ve_voter_locker_distribution",
      "72% of swap fees allocated to token holders, plus all bribes paid to holders who vote.",
      false,
    ],
    [
      "ve_voter_locker_distribution",
      "The protocol's 50% share of swap fees plus external bribes, all distributed to AQUA holders who voted for the markets where they were collected.",
      false,
    ],
    [
      "market_buyback",
      "NEAR revenue is used to buy back $NEAR on the open market (not burned), returning value to holders.",
      true,
    ],
    [
      "unclear_other",
      "No revenue share to AAVE token holders.",
      false,
    ],
    [
      "unclear_other",
      "Token holders have no revenue.",
      false,
    ],
    [
      "unclear_other",
      "0% of protocol fees goes to token holders.",
      false,
    ],
    [
      "unclear_other",
      "No fees distributed to SUSHI token holders.",
      false,
    ],
    [
      "unclear_other",
      "SUSHI stakers stopped receiving swap fees, so no part of the fee is counted as going to holders.",
      false,
    ],
    [
      "unclear_other",
      "Fees going to governance token holders",
      false,
    ],
    [
      "unclear_other",
      "50% of fees goes to token stakers and 50% goes to the protocol treasury.",
      false,
    ],
    [
      "unclear_other",
      "Revenue is paid to liquidity providers and the Foundation.",
      false,
    ],
    [
      "unclear_other",
      "20% to gov token holder, 10% to buyback gov token, 0% to protocol.",
      false,
    ],
    [
      "unclear_other",
      "11% of deployed SUI are used to buyback and add liquidity for AUR on DEXs.",
      false,
    ],
    [
      "unclear_other",
      "80% of revenue goes to burn and FAITH buybacks.",
      false,
    ],
    [
      "unclear_other",
      "Fees are collected for SDEX buybacks and burns on some chains and for a staking pool on others.",
      false,
    ],
    [
      "unclear_other",
      "3.05% distributed to holders: 1.05% to COAL stakers, 1% jackpot pool, and 1% Liquidity Pool. The rest is burned.",
      false,
    ],
    [
      "unclear_other",
      "Fees are distributed to BMX stakers and BMX/wBLT LP stakers.",
      false,
    ],
    [
      "unclear_other",
      "Fees are distributed to HDX stakers, referrers, and traders.",
      false,
    ],
    [
      "unclear_other",
      "Fees are distributed to TITN stakers plus in-game raffle pot players.",
      false,
    ],
    [
      "unclear_other",
      "MOR buybacks funded by yield: buy and burn, buy and lock, buy and add to PoL.",
      false,
    ],
    [
      "buyback_and_burn",
      "JVT is converted and burned under a documented buyback-and-burn policy.",
      true,
    ],
    [
      "buyback_and_burn",
      "All fees are used to buy back QUBIC and burn them.",
      true,
    ],
    [
      "buyback_and_burn",
      "The vault funds the on-chain buyback; 90% of the bought MRCY is burned and 10% is distributed to stakers.",
      true,
    ],
    [
      "buyback_and_burn",
      "A buyback bot swaps ETH for SpiceETH; 90% is burned and 10% is distributed to SPICE stakers.",
      true,
    ],
    [
      "buyback_and_burn",
      "ROAR buybacks whose acquired tokens are burned and distributed to stakers.",
      true,
    ],
    [
      "buyback_and_burn",
      "Executed SWELL buybacks are transferred to the burn address.",
      true,
    ],
    [
      "buyback_and_burn",
      "Revenue buys back STEP; part goes to stakers and the rest is burnt.",
      true,
    ],
    [
      "buyback_and_burn",
      "Token buyback: 0.15% of bought tokens are burned and 0.15% are shared with holders.",
      true,
    ],
    [
      "buyback_and_burn",
      "Funds enter a buyback vault, are converted to ZINC, then distributed to stakers or burned.",
      true,
    ],
    [
      "buyback_and_burn",
      "70% is paid to GRAIL holders through staking and GRAIL buyback & burn.",
      true,
    ],
    [
      "buyback_and_burn",
      "Vault fees fund automated NICKEL buybacks — 90% burned, 10% distributed to NICKEL stakers.",
      true,
    ],
    [
      "buyback_and_burn",
      "A fee is forwarded to Treasury, then used by the buyback bot to swap ETH for SpiceETH — 90% burned, 10% distributed to SPICE stakers via Treasury.distributeYield.",
      true,
    ],
    [
      "buyback_and_burn",
      "USD value of VVV bought back and burned, plus discretionary revenue buybacks.",
      true,
    ],
  ] as const)("classifies %s conservatively", (economicType, text, eligible) => {
    expect(classifyHolderMethodology({ HoldersRevenue: text })).toMatchObject({
      economicType,
      eligible,
    });
  });

  it.each([
    "Fees are not distributed to TOKEN holders.",
    "TOKEN holders do not receive protocol fees.",
    "TOKEN holders are no longer paid fees.",
    "No fees go to TOKEN stakers.",
    "Protocol revenue does not go to TOKEN stakers.",
    "Fee distributions to TOKEN holders have ended.",
    "Protocol fees were not paid to TOKEN stakers.",
    "Fee revenue was not allocated to TOKEN holders.",
    "Rewards are not shared with TOKEN stakers.",
    "TOKEN stakers did not get protocol fees.",
    "TOKEN holders no longer earn rewards.",
    "No protocol revenue goes to TOKEN holders.",
    "No rewards are going to TOKEN stakers.",
    "Protocol fees did not go to TOKEN holders.",
    "Payments to TOKEN stakers ceased.",
    "Revenue sharing with TOKEN holders was suspended.",
    "Holder distributions are disabled.",
    "Fees were distributed to TOKEN holders last year, but payments to holders have stopped.",
    "Fees aren't distributed to TOKEN holders.",
    "TOKEN holders don't receive protocol fees.",
    "TOKEN holders aren't paid fees.",
    "Protocol revenue doesn't go to TOKEN stakers.",
    "TOKEN stakers didn't earn rewards.",
    "Rewards no longer go to TOKEN stakers.",
    "The protocol stopped paying TOKEN holders fees.",
    "Fee sharing with TOKEN holders has ceased.",
  ])("keeps negated or ended holder flows ineligible: %s", (text) => {
    expect(classifyHolderMethodology({ HoldersRevenue: text })).toMatchObject({
      economicType: "unclear_other",
      eligible: false,
      reason: "홀더 수익 부재·중단 문구",
    });
  });

  it.each([
    [
      "NEAR Intents",
      "NEAR revenue is used to buy back $NEAR on the open market (not burned), returning value to holders.",
      "market_buyback",
      true,
    ],
    [
      "Hyperliquid Assistance Fund",
      "99% of fees go to Assistance Fund for buying HYPE tokens.",
      "market_buyback",
      true,
    ],
    [
      "Lido",
      "Tracks LIDO bought back by the DAO as part of the LDO Accumulation Program",
      "market_buyback",
      true,
    ],
    [
      "Kodiak V3",
      "From 2026-01-01, 60% of protocol revenue is used to buy $KDK on the open market.",
      "market_buyback",
      true,
    ],
    [
      "Yearn",
      "90% of the protocol revenue goes to stYFI stakers since 2026-02-05",
      "direct_distribution",
      true,
    ],
    [
      "Sushi",
      "A share of each trade fee goes to xSUSHI stakers.",
      "direct_distribution",
      true,
    ],
    [
      "Ramses CL",
      "72% of swap fees allocated to token holders, plus all bribes paid to holders who vote.",
      "ve_voter_locker_distribution",
      false,
    ],
    [
      "Aquarius",
      "The protocol's 50% share of swap fees plus external bribes, all distributed to AQUA holders who voted for the markets where they were collected.",
      "ve_voter_locker_distribution",
      false,
    ],
    [
      "Pump",
      "PUMP token buyback sourced from onchain burns; aggregates buybacks across all pump products.",
      "market_buyback",
      true,
    ],
    [
      "PancakeSwap",
      "50% of revenue are used to buy back and burn CAKE.",
      "buyback_and_burn",
      true,
    ],
    [
      "Venice",
      "USD value of VVV bought back and burned, plus discretionary revenue buybacks.",
      "buyback_and_burn",
      true,
    ],
  ] as const)(
    "preserves the audited %s classification",
    (_name, text, economicType, eligible) => {
      expect(classifyHolderMethodology({ HoldersRevenue: text })).toMatchObject({
        economicType,
        eligible,
      });
    },
  );

  it("keeps missing holder methodology unclear", () => {
    expect(classifyHolderMethodology({ Revenue: "Burned coins" })).toMatchObject({
      economicType: "unclear_other",
      eligible: false,
    });
  });
});

describe("aggregateHolderValueByGroup", () => {
  it("does not manufacture growth from an incomplete component history", () => {
    const result = aggregateHolderValueByGroup([
      { slug: "a", total30d: 100, total60dto30d: 100, methodology: { HoldersRevenue: "Token buybacks" } },
      { slug: "b", total30d: 100, total60dto30d: null, methodology: { HoldersRevenue: "Token buybacks" } },
    ], () => "parent").get("parent")!;
    expect(result.eligibleCurrent30d).toBe(200);
    expect(result.eligiblePrevious30d).toBeNull();
    expect(result.warning).toContain("이력 누락");
  });
  it("preserves a reported all-zero eligible history", () => {
    const result = aggregateHolderValueByGroup([{slug:"zero",total30d:0,total60dto30d:0,methodology:{HoldersRevenue:"Token buybacks"}}],s=>s).get("zero")!;
    expect(result.eligibleCurrent30d).toBe(0);
    expect(result.eligiblePrevious30d).toBe(0);
    expect(result.eligibleRunRate).toBeNull();
  });
  const parent = (slug: string) =>
    slug.startsWith("mixed-") || slug === "duplicate" ? "parent#mixed" : slug;

  it("splits parent components and annualizes only eligible current 30d value", () => {
    const result = aggregateHolderValueByGroup(
      [
        {
          name: "Mixed Buyback",
          slug: "mixed-buyback",
          total30d: 300,
          total60dto30d: 200,
          total1y: 3_000,
          methodology: { HoldersRevenue: "Token buybacks funded by protocol revenue." },
        },
        {
          name: "Mixed Fee Burn",
          slug: "mixed-fee-burn",
          total30d: 100,
          total60dto30d: 80,
          total1y: 1_000,
          methodology: { HoldersRevenue: "All collected protocol fees are burned." },
        },
        {
          name: "Mixed Unclear",
          slug: "mixed-unclear",
          total30d: 50,
          total60dto30d: 40,
          total1y: 500,
          methodology: { HoldersRevenue: "Money going to governance token holders" },
        },
        {
          name: "Duplicate eligible row",
          slug: "duplicate",
          total30d: 999,
          total60dto30d: 999,
          total1y: 9_999,
          doublecounted: true,
          methodology: { HoldersRevenue: "Token buybacks funded by protocol revenue." },
        },
      ],
      parent,
    ).get("parent#mixed");

    expect(result).toMatchObject({
      sourceStatus: "defillama-derived",
      availability: "mixed",
      eligibleCurrent30d: 300,
      eligiblePrevious30d: 200,
      eligibleRunRate: 3_650,
      rawCurrent30d: 450,
      rawPrevious30d: 320,
      rawTtm: 4_500,
      excludedCurrent30d: 150,
      excludedTtm: 1_500,
      excludedDoublecountedCount: 1,
      phrUnavailableReason: null,
    });
    expect(result?.currentVsEligibleTtmRatio).toBeNull();
    expect(result?.components.map((component) => component.slug)).toEqual([
      "mixed-buyback",
      "mixed-fee-burn",
      "mixed-unclear",
    ]);
  });

  it("does not use positive TTM when eligible current 30d is zero", () => {
    const result = aggregateHolderValueByGroup(
      [
        {
          name: "Aave V3",
          slug: "aave-v3",
          total30d: 0,
          total60dto30d: 576_537,
          total1y: 25_657_324,
          methodology: {
            HoldersRevenue: "Aave starts buy back AAVE tokens using Aave Treasury.",
          },
        },
      ],
      () => "parent#aave",
    ).get("parent#aave");

    expect(result).toMatchObject({
      availability: "stale",
      eligibleCurrent30d: 0,
      eligiblePrevious30d: 576_537,
      eligibleRunRate: null,
      rawTtm: 25_657_324,
      currentVsEligibleTtmRatio: null,
    });
    expect(result?.warning).toContain("원천 1년");
    expect(result?.phrUnavailableReason).toContain("최근 30일");
  });

  it("keeps current excluded flows visible without making them P/HR eligible", () => {
    const result = aggregateHolderValueByGroup(
      [
        {
          name: "Canton",
          slug: "canton",
          total30d: 50_700_736,
          total60dto30d: 55_385_244,
          total1y: 554_426_081,
          methodology: { HoldersRevenue: "All collected fees are burned." },
        },
      ],
      (slug) => slug,
    ).get("canton");

    expect(result).toMatchObject({
      availability: "excluded",
      eligibleCurrent30d: null,
      eligibleRunRate: null,
      rawCurrent30d: 50_700_736,
      rawTtm: 554_426_081,
      excludedCurrent30d: 50_700_736,
    });
    expect(result?.phrUnavailableReason).toContain("제외");
  });
});
