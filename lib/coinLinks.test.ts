import { describe, expect, it } from "vitest";
import { defiLlamaUrl, marketLink } from "./coinLinks";

describe("independent protocol and market links", () => {
  it("keeps the protocol link alongside the preferred CMC asset page", () => {
    const c = { slug: "parent#aerodrome", cmcSlug: "aerodrome-finance", geckoId: "aerodrome-finance" };
    expect(defiLlamaUrl(c)).toBe("https://defillama.com/protocol/aerodrome");
    expect(marketLink(c)).toEqual({ label: "CoinMarketCap", url: "https://coinmarketcap.com/currencies/aerodrome-finance/" });
  });
  it("uses the exact CoinGecko ID when CMC is absent, without guessing from a symbol", () => {
    expect(marketLink({ cmcSlug: null, geckoId: "sat-rush" })).toEqual({ label: "CoinGecko", url: "https://www.coingecko.com/en/coins/sat-rush" });
    expect(marketLink({ cmcSlug: null, geckoId: null })).toBeNull();
  });
  it("encodes source identifiers as a single path segment", () => {
    expect(marketLink({ cmcSlug: null, geckoId: "a/b?c" })?.url).toBe("https://www.coingecko.com/en/coins/a%2Fb%3Fc");
  });
});
