import { describe, expect, it } from "vitest";
import { defiLlamaUrl, marketLink, officialWebsite } from "./coinLinks";

describe("independent protocol and market links", () => {
  it("keeps the protocol link alongside the preferred exact CoinGecko asset page", () => {
    const c = { slug: "parent#aerodrome", cmcSlug: "aerodrome-finance", geckoId: "aerodrome-finance" };
    expect(defiLlamaUrl(c)).toBe("https://defillama.com/protocol/aerodrome");
    expect(marketLink(c)).toEqual({ label: "CoinGecko", url: "https://www.coingecko.com/en/coins/aerodrome-finance" });
  });
  it("falls back to a known CMC slug only when the CoinGecko ID is absent", () => {
    expect(marketLink({ cmcSlug: null, geckoId: "sat-rush" })).toEqual({ label: "CoinGecko", url: "https://www.coingecko.com/en/coins/sat-rush" });
    expect(marketLink({ cmcSlug: null, geckoId: null })).toBeNull();
    expect(marketLink({ cmcSlug: "sat-rush", geckoId: null })).toEqual({ label: "CoinMarketCap", url: "https://coinmarketcap.com/currencies/sat-rush/" });
  });
  it("encodes source identifiers as a single path segment", () => {
    expect(marketLink({ cmcSlug: null, geckoId: "a/b?c" })?.url).toBe("https://www.coingecko.com/en/coins/a%2Fb%3Fc");
  });
  it("keeps known asset pages independent of unavailable current quotes", () => {
    const c = { cmcSlug: "sky", geckoId: "sky", price: null, mcap: null };
    expect(marketLink(c)?.label).toBe("CoinGecko");
  });
  it("accepts only explicit safe HTTP(S) official websites", () => {
    expect(officialWebsite({ website: "https://sky.money/?ref=app" })).toBe("https://sky.money/?ref=app");
    expect(officialWebsite({ website: "http://example.org" })).toBe("http://example.org/");
    for (const website of [null, undefined, "", "sky.money", "//sky.money", "javascript:alert(1)", "data:text/html,test", "https://user:pass@example.org"]) {
      expect(officialWebsite({ website })).toBeNull();
    }
  });
});
