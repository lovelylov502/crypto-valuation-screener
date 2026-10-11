import type { CoinRaw, QuoteLookup } from "./types";

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const text = (v: unknown) => typeof v === "string" ? v : "";
const nameKey = (v: unknown) => text(v).toLowerCase().replace(/[^a-z0-9]/g, "");
export const addressKey = (v: unknown) => {
  const address = text(v).replace(/^[a-z][a-z\d-]*:(?!:)/i, "");
  return /^0x[\da-f]{40}$/i.test(address) ? address.toLowerCase() : address;
};

/** Vendor slugs are not asset IDs. A contract match outranks name matches and stale directory IDs. */
export function resolveCmcAsset(rows: Row[], ids: number[], addresses: string[], name: string, symbol: string | null, discoveryComplete: boolean): Row | undefined {
  if (ids.length > 1) return undefined;
  const keys = new Set(addresses.map(addressKey).filter(Boolean));
  const candidates = rows.filter(r => !symbol || text(r.symbol).toUpperCase() === symbol.toUpperCase());
  const contract = (r: Row) => addressKey((r.platform as Row | undefined)?.token_address);
  const compatible = (r: Row) => !keys.size || !contract(r) || keys.has(contract(r));
  const exactContracts = candidates.filter(r => keys.has(contract(r)));
  if (exactContracts.length === 1) return exactContracts[0];
  if (exactContracts.length > 1) return undefined;
  const numeric = candidates.find(r => r.id === ids[0]);
  if (numeric && compatible(numeric)) return numeric;
  if (!discoveryComplete) return undefined;
  const named = candidates.filter(r => nameKey(r.name) === nameKey(name) && compatible(r));
  return named.length === 1 ? named[0] : undefined;
}

/** Retain the original bytes in receipts; reject unusable fields before selecting any quote. */
export function checkedMarketRow(row: Row, vendor: "cmc" | "gecko", asOf: string): Row {
  const result = { ...row }, exclusions = [...((row.quoteExclusions as QuoteLookup["exclusions"]) ?? [])];
  const quotes = vendor === "cmc" && Array.isArray(row.quote) ? row.quote.map(v => ({ ...v })) : null;
  const quote = vendor === "cmc" ? quotes?.find(v => v.symbol === "USD") : result;
  if (!quote) return result;
  const fields = vendor === "cmc" ? { mcap: "market_cap", price: "price", fdv: "fully_diluted_market_cap" }
    : { mcap: "market_cap", price: "current_price", fdv: "fully_diluted_valuation" };
  const exclude = (field: keyof typeof fields, reason: string) => {
    quote[fields[field]] = null;
    if (!exclusions.some(e => e.field === field && e.reason === reason)) exclusions.push({ field, reason });
  };
  for (const field of ["mcap", "price", "fdv"] as const) if ((num(quote[fields[field]]) ?? 0) < 0) exclude(field, "음수 시세 금액");
  const dates = [row.last_updated, quote.last_updated].map(v => Date.parse(text(v))).filter(Number.isFinite);
  const stale = dates.some(date => Date.parse(asOf) - date > 12 * 3600_000);
  if (vendor === "cmc" && row.is_active === 0 || stale) {
    for (const field of ["mcap", "price", "fdv"] as const) exclude(field, stale ? "시세 기준일 12시간 초과" : "비활성 자산 시세");
    for (const field of ["volume_24h", "total_volume", "percent_change_24h", "percent_change_7d", "percent_change_30d", "percent_change_60d", "percent_change_90d",
      "price_change_percentage_24h", "price_change_percentage_7d_in_currency", "price_change_percentage_30d_in_currency"]) quote[field] = null;
    for (const field of ["circulating_supply", "total_supply", "max_supply", "cmc_rank", "num_market_pairs"]) result[field] = null;
  }
  const cap = num(quote[fields.mcap]), fdv = num(quote[fields.fdv]), price = num(quote[fields.price]), supply = num(result.circulating_supply);
  if (price === 0 && ((cap ?? 0) > 0 || (fdv ?? 0) > 0)) {
    exclude("mcap", "가격 0과 양수 시총 불일치"); exclude("fdv", "가격 0과 양수 FDV 불일치");
  } else if (price !== null && price > 0 && supply !== null && supply > 0 && cap !== null && cap > 0 &&
    Math.max(price * supply / cap, cap / (price * supply)) > 1.25) exclude("mcap", "가격·유통량과 시총 불일치");
  // Allow small rounding/quote-time differences, never a materially smaller diluted value.
  if (cap !== null && cap > 0 && fdv !== null && fdv < cap * .95) exclude("fdv", "FDV가 유통 시총보다 작음");
  if (quotes) result.quote = quotes;
  if (exclusions.length) result.quoteExclusions = exclusions;
  return result;
}

export function excludeQuoteField(lookup: QuoteLookup | null, field: "fdv", reason: string): QuoteLookup | null {
  return lookup ? { ...lookup, available: lookup.available.filter(f => f !== field), positive: lookup.positive?.filter(f => f !== field),
    exclusions: [...(lookup.exclusions ?? []), { field, reason }] } : null;
}

/** Independently check the joined fields, including cross-provider fallbacks. */
export function marketValueErrors(coins: CoinRaw[]): string[] {
  const errors: string[] = [];
  for (const c of coins) {
    if (c.mcap !== null && c.mcap > 0 && c.fdv !== null && c.fdv < c.mcap * .95) errors.push(`${c.slug}: FDV below circulating cap`);
    if (c.mcap !== null && c.mcap > 0 && c.price !== null && c.price > 0 && c.circulatingSupply !== null && c.circulatingSupply > 0 &&
      Math.max(c.price * c.circulatingSupply / c.mcap, c.mcap / (c.price * c.circulatingSupply)) > 1.25) errors.push(`${c.slug}: price/supply/cap conflict`);
  }
  return errors;
}
