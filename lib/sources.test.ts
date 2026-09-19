import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregateOverviewByGroup, fetchCoins } from "./sources";

describe("quote changes", () => {
  afterEach(() => vi.unstubAllGlobals());
  const mockSources = (quote: boolean) => vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    const body = url.includes("/coins/markets")
      ? quote ? [{ id: "token", current_price: 1, market_cap: 10000000, price_change_percentage_24h: 3, price_change_percentage_7d_in_currency: 5 }] : []
      : url.includes("coinmarketcap.com") ? { data: [] }
      : url.endsWith("/protocols") ? [{ slug: "token", name: "Token", symbol: "T", gecko_id: "token", mcap: 10000000, change_1d: 99, change_7d: 88 }]
      : { protocols: [{ slug: "token", total30d: 100, total60dto30d: 90 }] };
    return new Response(JSON.stringify(body));
  }));
  it("never fills missing price changes with DefiLlama TVL changes", async () => {
    mockSources(false);
    const [coin] = await fetchCoins([]);
    expect([coin.change1d, coin.change7d, coin.priceChange7d]).toEqual([null, null, null]);
  });
  it("uses actual CoinGecko price changes when CMC is unavailable", async () => {
    mockSources(true);
    const [coin] = await fetchCoins([]);
    expect([coin.change1d, coin.change7d, coin.priceChange7d]).toEqual([3, 5, 5]);
  });
});

describe("aggregateOverviewByGroup", () => {
  it("preserves zeros but marks incomplete parent periods as unknown", () => {
    const result = aggregateOverviewByGroup([{slug:"a",total30d:100,total60dto30d:0},{slug:"b",total30d:100}],()=>"parent").get("parent")!;
    expect(result.d30).toBe(200);
    expect(result.prev30).toBeNull();
    const zero = aggregateOverviewByGroup([{slug:"a",total30d:0,total60dto30d:0}],s=>s).get("a")!;
    expect(zero.d30).toBe(0); expect(zero.prev30).toBe(0);
  });
  it("uses a single common annual window instead of mixing TTM and run-rate components", () => {
    const result = aggregateOverviewByGroup([{slug:"a",total1y:5000,total30d:100},{slug:"b",total30d:100}],()=>"parent").get("parent")!;
    expect(result.y1).toBeNull();
    expect(result.annual).toBeCloseTo(200*365/30);
  });
  it("excludes DefiLlama overview rows marked doublecounted from parent sums", () => {
    const rows = [
      {
        slug: "parent-primary",
        total1y: 1_200,
        total7d: 70,
        total14dto7d: 60,
        total30d: 300,
        total60dto30d: 250,
      },
      {
        slug: "parent-duplicate",
        total1y: 9_999,
        total7d: 999,
        total14dto7d: 999,
        total30d: 999,
        total60dto30d: 999,
        doublecounted: true,
      },
    ];

    const aggregate = aggregateOverviewByGroup(rows, () => "parent#protocol").get(
      "parent#protocol",
    );

    expect(aggregate).toEqual({
      annual: 300 * 365 / 30,
      y1: 1_200,
      d7: 70,
      prev7: 60,
      d30: 300,
      prev30: 250,
      hit: true,
    });
  });
});
