import type { CoinRaw } from "./types";

export const STABLECOIN_SOURCE = "https://stablecoins.llama.fi/stablecoins?includePrices=true";
export interface StablecoinAsset { gecko_id?: string | null; symbol?: string | null }

/** Stablecoin circulation measures issued liabilities, not the issuer's investment token value. */
export function capitalExclusion(geckoId: string | null, symbol: string | null, assets: StablecoinAsset[]): string | null {
  if (!geckoId || !symbol) return null;
  return assets.some(a => a.gecko_id === geckoId && a.symbol?.toUpperCase() === symbol.toUpperCase())
    ? "스테이블코인 발행액은 사업·투자 토큰 가치가 아니므로 밸류에이션 배수를 보류합니다"
    : null;
}

export function eligibleCapital(c: Pick<CoinRaw, "identityStatus" | "capitalExclusionReason">): boolean {
  return c.identityStatus === "verified" && !c.capitalExclusionReason;
}
