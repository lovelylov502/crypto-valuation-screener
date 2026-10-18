import type { CoinRaw } from "./types";

export function defiLlamaUrl(c: Pick<CoinRaw, "slug">): string {
  return `https://defillama.com/protocol/${encodeURIComponent(c.slug.replace(/^parent#/, ""))}`;
}

export function marketLink(c: Pick<CoinRaw, "cmcSlug" | "geckoId">): { label: string; url: string } | null {
  if (c.geckoId) return { label: "CoinGecko", url: `https://www.coingecko.com/en/coins/${encodeURIComponent(c.geckoId)}` };
  if (c.cmcSlug) return { label: "CoinMarketCap", url: `https://coinmarketcap.com/currencies/${encodeURIComponent(c.cmcSlug)}/` };
  return null;
}

export function officialWebsite(c: Pick<CoinRaw, "website">): string | null {
  if (!c.website) return null;
  try {
    const url = new URL(c.website);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function coinUrl(c: Pick<CoinRaw, "cmcSlug" | "slug">): string {
  if (c.cmcSlug) return `https://coinmarketcap.com/currencies/${encodeURIComponent(c.cmcSlug)}/`;
  return defiLlamaUrl(c);
}
