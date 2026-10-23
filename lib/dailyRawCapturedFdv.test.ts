import { expect, it } from "vitest";
import { contentHash, type SourceReceipt } from "./sourceBundle";
import { indexCapturedFdvQuotes } from "./dailyRawFdvValidation";
import { originalCapturedFdv, snapshotDailyRaw } from "./dailyRawCollection";
import type { CoinRaw } from "./types";
import type { PublishedSnapshot } from "./publicationTypes";

const observedAt = "2026-10-12T00:01:00Z", quoteAt = "2026-10-11T23:59:00Z";
const reference = { url: "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-test-complete/data.json.gz", sha256: "a".repeat(64), dataAt: observedAt, validatedAt: observedAt } as PublishedSnapshot;
const coin = { slug: "sample", identityStatus: "verified", geckoId: "sample", cmcId: 123, cmcIdentity: { basis: "source-id" },
  price: 2, mcap: 100, fdv: 200, marketDataUpdatedAt: "2026-10-12T00:00:30Z",
  marketSources: { price: "CoinGecko", mcap: "CoinGecko", fdv: "CoinMarketCap", gecko: { id: "sample", status: "received", observedAt }, cmc: { id: "123", status: "received", observedAt } } } as CoinRaw;
function index(changes: Record<string, unknown> = {}, quoteChanges: Record<string, unknown> = {}, receiptChanges: Partial<SourceReceipt> = {}) {
  const body = JSON.stringify({ data: [{ id: 123, max_supply: 100, total_supply: 100, ...changes, quote: [{ symbol: "USD", price: 2, fully_diluted_market_cap: 200, last_updated: quoteAt, ...quoteChanges }] }] });
  return indexCapturedFdvQuotes([{ url: "https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=123&convert=USD", requestedAt: observedAt, observedAt, status: 200, headers: {}, body, sha256: contentHash(body), ...receiptChanges }]);
}
it("recovers a fallback FDV at its own original UTC date, keeping price on its own date", () => {
  const result = snapshotDailyRaw(coin, coin, reference, index());
  expect(result.points).toHaveLength(2);
  expect(result.points[0]).toMatchObject({ day: "2026-10-11", fdv: { value: 200, at: quoteAt, state: "complete" } });
  expect(result.points[0]).not.toHaveProperty("price");
  expect(result.points[1]).toMatchObject({ day: "2026-10-12", price: { value: 2 } });
  expect(result.points[1]).not.toHaveProperty("fdv");
  expect(result.sources.find(source => source.metric === "fdv")).toMatchObject({ provider: "CoinMarketCap", url: reference.url, sha256: reference.sha256, observedAt });
});
it("requires the selected original FDV amount, receipt, token and CMC identity proof", () => {
  for (const source of [index({}, { fully_diluted_market_cap: 201 }), index({ id: 124 }), index({}, {}, { sha256: "b".repeat(64) }), index({}, {}, { observedAt: "2026-10-12T00:02:00Z" })]) {
    expect(originalCapturedFdv(coin, coin, reference, source).points).toEqual([]);
  }
  expect(originalCapturedFdv(coin, { ...coin, cmcIdentity: { ...coin.cmcIdentity!, basis: "full-name" as never } }, reference, index()).points).toEqual([]);
  expect(originalCapturedFdv(coin, { ...coin, geckoId: "migrated" }, reference, index()).points).toEqual([]);
});
it("does not reconstruct missing supply, accept stale/future quotes or bypass anomaly rejection", () => {
  expect(originalCapturedFdv(coin, coin, reference, index({ max_supply: null })).points[0].fdv?.value).toBe(200);
  for (const source of [index({ max_supply: 10 }), index({}, { last_updated: "2026-10-12T00:02:00Z" }), index({}, { last_updated: "2026-10-11T00:00:00Z" })]) {
    expect(originalCapturedFdv(coin, coin, reference, source).points).toEqual([]);
  }
});
it("retains the explicit Snowbank supply review hold even with a verified timestamp", () => {
  const snowbank = { ...coin, slug: "snowbank", geckoId: "snowbank", marketSources: { ...coin.marketSources!, fdv: "CoinGecko", gecko: { id: "snowbank", status: "received", observedAt } } } as CoinRaw;
  const body = JSON.stringify([{ id: "snowbank", current_price: 2, fully_diluted_valuation: 200, max_supply: null, last_updated: quoteAt }]);
  const source = indexCapturedFdvQuotes([{ url: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=snowbank", requestedAt: observedAt, observedAt, status: 200, headers: {}, body, sha256: contentHash(body) }]);
  const result = originalCapturedFdv(snowbank, snowbank, reference, source);
  expect(result.points).toEqual([]); expect(result.issues?.[0].reason).toContain("supply_basis_under_review");
});
