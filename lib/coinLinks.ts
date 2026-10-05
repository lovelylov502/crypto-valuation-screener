import type { CoinRaw } from "./types";

export function defiLlamaUrl(c: Pick<CoinRaw, "slug">): string {
  return `https://defillama.com/protocol/${encodeURIComponent(c.slug.replace(/^parent#/, ""))}`;
}

export function marketLink(c: Pick<CoinRaw, "cmcSlug" | "geckoId">): { label: string; url: string } | null {
  if (c.cmcSlug) return { label: "CoinMarketCap", url: `https://coinmarketcap.com/currencies/${encodeURIComponent(c.cmcSlug)}/` };
  if (c.geckoId) return { label: "CoinGecko", url: `https://www.coingecko.com/en/coins/${encodeURIComponent(c.geckoId)}` };
  return null;
}

export function coinUrl(c: Pick<CoinRaw, "cmcSlug" | "slug">): string {
  if (c.cmcSlug) return `https://coinmarketcap.com/currencies/${encodeURIComponent(c.cmcSlug)}/`;
  return defiLlamaUrl(c);
}
