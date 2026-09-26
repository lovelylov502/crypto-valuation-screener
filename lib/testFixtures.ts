import type { CoinRaw } from './types';
import type { HolderValueSummary } from './holderValue';
import type { Fundamentals } from './fundamentals';
import { holderScope } from './valuationMetrics';
import type { RevenuePeriod } from './revenueHistory';
const OLD_LISTING = Date.parse('2025-01-01T00:00:00.000Z') / 1000;
export const fixtureFundamentals: Fundamentals = { version:'fundamental-definitions-v1', fingerprint:'a'.repeat(64), revenue:{kind:'protocol_revenue',fingerprint:'b'.repeat(64),components:[]},fees:{kind:'user_fees',fingerprint:'c'.repeat(64),components:[]},holders:[],holderShareReviewed:true };
type CoinOverrides = Omit<Partial<CoinRaw>, "holderValue"> & {
  slug: string;
  holderValue?: Partial<HolderValueSummary>;
};

export function sample(partial: Partial<CoinOverrides> = {}): CoinRaw { return make({ slug: "sample", ...partial }); }

export function make(partial: CoinOverrides): CoinRaw {
  const { holderValue, ...rest } = partial;
  const coin: CoinRaw = {
    fundamentals: fixtureFundamentals,
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
  // Synthetic dated coverage is explicit in v7; source rolling totals alone are insufficient.
  if (partial.holderHistory === undefined) {
    const end = Math.floor(Date.parse(coin.marketDataUpdatedAt ?? "2026-07-28") / 86400000) * 86400000 - 86400000;
    const period = (days: number, total: number | null, offset = 0): RevenuePeriod => ({
      days, total, reportedDays: total === null ? 0 : days,
      start: new Date(end - (days - 1 + offset) * 86400000).toISOString().slice(0,10),
      end: new Date(end - offset * 86400000).toISOString().slice(0,10),
    });
    coin.holderHistory = {
      definitionFingerprint: holderScope(coin), source: "fixture dated observations", observedAt: new Date(end + 86400000).toISOString(),
      periods: { 1: period(1,null), 7: period(7,null), 30: period(30,coin.holderValue.eligibleCurrent30d), 90: period(90,null), 365: period(365,coin.holderValue.eligibleTtm) },
      previous30: period(30,coin.holderValue.eligiblePrevious30d,30), weeks: [],
    };
  }
  return coin;
}

