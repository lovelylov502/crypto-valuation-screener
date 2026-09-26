import { describe, expect, it } from "vitest";
import {
  filterScreenableCoins,
  summarizeMarketDataFreshness,
} from "./screener";

describe("filterScreenableCoins", () => {
  it("keeps missing-cap and small projects in the complete universe", () => {
    const coins = [
      { slug: "missing", mcap: null },
      { slug: "micro", mcap: 999_999 },
      { slug: "boundary", mcap: 1_000_000 },
      { slug: "large", mcap: 50_000_000 },
    ];

    expect(filterScreenableCoins(coins).map((coin) => coin.slug)).toEqual([
      "missing",
      "micro",
      "boundary",
      "large",
    ]);
    expect(coins).toHaveLength(4);
  });
});

describe("summarizeMarketDataFreshness", () => {
  it("reports the actual source timestamp range and ignores missing values", () => {
    expect(
      summarizeMarketDataFreshness([
        { marketDataUpdatedAt: "2026-08-17T02:35:00.000Z" },
        { marketDataUpdatedAt: null },
        { marketDataUpdatedAt: "invalid" },
        { marketDataUpdatedAt: "2026-08-17T02:33:00.000Z" },
      ]),
    ).toEqual({
      source: "CoinMarketCap",
      oldestAt: "2026-08-17T02:33:00.000Z",
      newestAt: "2026-08-17T02:35:00.000Z",
      timestampedCoinCount: 2,
    });
  });
});
