// Keyless CloudFront requests above ~2 KB returned 403 in the September 30 incident.
// Bound the encoded URL as well as the ID count; collector and independent audit agree.
const PREFIX = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=";
const SUFFIX = "&per_page=250&price_change_percentage=7d,14d,30d,1y";
export const GECKO_INTERVAL_MS = 12_500;
export const GECKO_BUDGET_MS = 8 * 60_000;
const MAX_URL_LENGTH = 1800;
const MAX_IDS = 150;

export function geckoRequests(ids: string[]): { ids: string[]; url: string }[] {
  const requests: { ids: string[]; url: string }[] = [];
  let batch: string[] = [], encoded: string[] = [];
  const flush = () => {
    if (batch.length) requests.push({ ids: batch, url: PREFIX + encoded.join(",") + SUFFIX });
    batch = []; encoded = [];
  };
  for (const id of [...new Set(ids)].sort()) {
    const value = encodeURIComponent(id);
    if (PREFIX.length + value.length + SUFFIX.length > MAX_URL_LENGTH) throw new Error("CoinGecko asset ID exceeds request limit");
    if (batch.length >= MAX_IDS || PREFIX.length + [...encoded, value].join(",").length + SUFFIX.length > MAX_URL_LENGTH) flush();
    batch.push(id); encoded.push(value);
  }
  flush();
  return requests;
}
