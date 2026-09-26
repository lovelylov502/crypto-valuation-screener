import type { CoinRaw } from "./types";

export function coinUrl(c: Pick<CoinRaw, "cmcSlug" | "slug">): string {
  if (c.cmcSlug) return `https://coinmarketcap.com/currencies/${encodeURIComponent(c.cmcSlug)}/`;
  return `https://defillama.com/protocol/${encodeURIComponent(c.slug.replace(/^parent#/, ""))}`;
}
