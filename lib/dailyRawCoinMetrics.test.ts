import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { COIN_METRICS_BASE, COIN_METRICS_FIELDS, coinMetricsFreeSupplyAssets, loadCoinMetricsManifest, matchCoinMetricsBindings, parseCoinMetricsHistory, type CoinMetricsBinding, type CoinMetricsCoin, type CoinMetricsManifest, type CoinMetricsReceipt } from "./dailyRawCoinMetrics";

const address = "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9";
const coin: CoinMetricsCoin = { slug: "parent#aave", geckoId: "aave", cmcId: 7278, identityStatus: "verified", cmcIdentity: { basis: "contract", address, sourceIdentifiersPresent: true } };
const cmc = { id: 7278, platform: { slug: "ethereum", token_address: address }, total_supply: 16_000_000, max_supply: null };
const markets = { data: [{ market: "uniswap_v2_eth-aave-weth-spot", exchange: "uniswap_v2_eth", base: "aave", base_address: address.slice(2), quote: "weth", quote_address: "c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" }] };
const catalog = { data: ["SplyCur", "PriceUSD"].map(metric => ({ metric, frequencies: [{ frequency: "1d", assets: ["aave", "uni", "eth"] }] })) };
const binding = (): CoinMetricsBinding => matchCoinMetricsBindings([coin], [cmc], [markets], catalog)[0];
const url = `${COIN_METRICS_BASE}/timeseries/asset-metrics?assets=aave&metrics=${COIN_METRICS_FIELDS}&frequency=1d`;
const receipt: CoinMetricsReceipt = { url, observedAt: "2026-10-19T12:00:00Z", status: 200, sha256: "a".repeat(64), file: "body.json" };
const entry = (overrides: Record<string, unknown> = {}) => ({ asset: "aave", time: "2020-10-10T00:00:00.000000000Z", PriceUSD: "2", SplyCur: "16000000", CapMrktCurUSD: "32000000", CapMrktEstUSD: "12000000", ...overrides });
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) { if (!folder.startsWith(join(tmpdir(), "coinmetrics-raw-"))) throw Error("Unexpected test cleanup target"); await rm(folder, { recursive: true, force: true }); } });

it("requires both free dated supply and price, without assuming every asset with a price has supply", () => {
  const data = { data: [{ metric: "PriceUSD", frequencies: [{ frequency: "1d", assets: ["aave", "hype"] }] }, { metric: "SplyCur", frequencies: [{ frequency: "1d", assets: ["aave"] }] }] };
  expect([...coinMetricsFreeSupplyAssets(data)]).toEqual(["aave"]);
});

it("proves an exact Ethereum contract through the current verified CMC ID, never matching a symbol", () => {
  expect(binding()).toMatchObject({ asset: { slug: coin.slug, identity: "gecko:aave" }, cmAsset: "aave", contract: address, fdvVerified: true, expectedSupply: 16_000_000 });
  expect(matchCoinMetricsBindings([{ ...coin, identityStatus: "review" }], [cmc], [markets], catalog)).toEqual([]);
  expect(matchCoinMetricsBindings([coin], [{ ...cmc, platform: { ...cmc.platform, slug: "arbitrum" } }], [markets], catalog)).toEqual([]);
  expect(matchCoinMetricsBindings([coin], [{ ...cmc, platform: { ...cmc.platform, token_address: "0x" + "1".repeat(40) } }], [markets], catalog)).toEqual([]);
  expect(matchCoinMetricsBindings([coin], [{ ...cmc, id: 1 }], [markets], catalog)).toEqual([]);
});

it("withholds ambiguous contracts, migrated identities and incompatible maximum supply", () => {
  const ambiguous = { data: [...markets.data, { ...markets.data[0], base: "uni" }] };
  expect(matchCoinMetricsBindings([coin], [cmc], [ambiguous], catalog)).toEqual([]);
  expect(matchCoinMetricsBindings([{ ...coin, geckoId: "sky", cmcIdentity: { ...coin.cmcIdentity!, address: "0x56072c95faa701256059aa122697b133aded9279" } }], [cmc], [markets], catalog)).toEqual([]);
  expect(matchCoinMetricsBindings([coin], [{ ...cmc, max_supply: 20_000_000 }], [markets], catalog)[0].fdvVerified).toBe(false);
  expect(matchCoinMetricsBindings([coin], [{ ...cmc, total_supply: 15_000_000 }], [markets], catalog)[0].fdvVerified).toBe(false);
});

it("retains unapproved issued-supply acquisitions without exposing them as ordinary FDV", () => {
  const unapproved = { ...binding(), cmAsset: "uni", fdvVerified: false, expectedSupply: null };
  const parsed = parseCoinMetricsHistory({ data: [entry({ asset: "uni", SplyCur: "1000000000" })] }, unapproved, { ...receipt, url: url.replace("assets=aave", "assets=uni") });
  expect(parsed).toMatchObject({ supplyDays: 1, points: [], sources: [] });
});

it("uses actual dated supply through negligible full-issuance deviations while rejecting material gaps", () => {
  const supply = 1_499_999_999.997, inch = { ...binding(), cmAsset: "1inch", expectedSupply: 1_500_000_000 };
  const source = { ...receipt, url: url.replace("assets=aave", "assets=1inch") };
  const point = { ...entry(), asset: "1inch", SplyCur: String(supply), CapMrktCurUSD: String(supply * 2) };
  expect(parseCoinMetricsHistory({ data: [point] }, inch, source).points[0].fdv?.value).toBe(supply * 2);
  expect(parseCoinMetricsHistory({ data: [{ ...point, SplyCur: "1499999999" }] }, inch, source).points).toEqual([]);
  expect(parseCoinMetricsHistory({ data: [entry({ asset: "ldo", SplyCur: "996308500" })] }, { ...binding(), cmAsset: "ldo", expectedSupply: 1e9 }, { ...receipt, url: url.replace("assets=aave", "assets=ldo") }).points).toEqual([]);
});

it("uses the dated supply and same-day close, disclosing the next-midnight measurement", () => {
  const parsed = parseCoinMetricsHistory({ data: [entry()] }, binding(), receipt);
  expect(parsed.points).toEqual([{ day: "2020-10-10", fdv: { value: 32_000_000, state: "complete", source: parsed.sources[0].key, at: "2020-10-11T00:00:00.000Z" } }]);
  expect(parsed.sources[0].basis).toBe("utc_daily_close_verified_total_supply");
  expect(parsed.sources[0].definition).toContain("dated SplyCur");
  expect(parseCoinMetricsHistory({ data: [entry({ SplyCur: null })] }, binding(), receipt).points).toEqual([]);
  expect(parseCoinMetricsHistory({ data: [entry({ SplyCur: "15999999" })] }, binding(), receipt).points).toEqual([]);
  expect(parseCoinMetricsHistory({ data: [entry({ PriceUSD: null })] }, binding(), receipt).points).toEqual([]);
});

it("distinguishes circulating market cap from issued capitalization and preserves conflict", () => {
  const parsed = parseCoinMetricsHistory({ data: [entry()] }, binding(), receipt, { includeMarket: true });
  expect(parsed.points[0]).toMatchObject({ price: { value: 2 }, mcap: { value: 12_000_000 }, fdv: { value: 32_000_000 } });
  const conflict = parseCoinMetricsHistory({ data: [entry({ CapMrktCurUSD: "31000000" })] }, binding(), receipt);
  expect(conflict.points[0].fdv).toMatchObject({ value: null, state: "conflict" });
  expect(conflict.issues).toHaveLength(1);
});

it("rejects foreign assets, unfinished days, non-daily source URLs and conflicting duplicate dates", () => {
  expect(() => parseCoinMetricsHistory({ data: [entry({ asset: "uni" })] }, binding(), receipt)).toThrow(/identity/);
  expect(() => parseCoinMetricsHistory({ data: [entry({ time: "2026-10-19T00:00:00Z" })] }, binding(), receipt)).toThrow(/Incomplete/);
  expect(() => parseCoinMetricsHistory({ data: [entry({ time: "2020-02-30T00:00:00Z" })] }, binding(), receipt)).toThrow(/invalid/);
  expect(() => parseCoinMetricsHistory({ data: [entry()] }, binding(), { ...receipt, url: url.replace("frequency=1d", "frequency=1h") })).toThrow(/basis/);
  expect(() => parseCoinMetricsHistory({ data: [entry(), entry({ PriceUSD: "3", CapMrktCurUSD: "48000000" })] }, binding(), receipt)).toThrow(/duplicate/);
  expect(parseCoinMetricsHistory({ data: [entry(), entry()] }, binding(), receipt).points).toHaveLength(1);
});

async function fixture() {
  const cache = await mkdtemp(join(tmpdir(), "coinmetrics-raw-")); folders.push(cache);
  const persist = async (name: string, body: unknown, origin: string) => {
    const text = JSON.stringify(body); await writeFile(join(cache, name), text);
    return { ...receipt, file: name, url: origin, sha256: createHash("sha256").update(text).digest("hex") };
  };
  const manifest: CoinMetricsManifest = { schema: 1, provider: "CoinMetrics", startedAt: receipt.observedAt, status: "complete", snapshotSha256: "b".repeat(64), bundleSha256: "c".repeat(64),
    bindings: [], issues: [], proofs: [
      { role: "catalog", receipt: await persist("catalog.json", catalog, `${COIN_METRICS_BASE}/catalog/asset-metrics`) },
      { role: "markets", receipt: await persist("markets.json", markets, `${COIN_METRICS_BASE}/reference-data/markets?exchange=uniswap_v2_eth`) },
      { role: "cmc", receipt: await persist("cmc.json", { data: [cmc] }, "https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/listings/latest") },
    ], histories: [{ cmAsset: "aave", complete: true, pages: [await persist("history.json", { data: [entry()] }, url)] }] };
  const path = join(cache, "manifest.json"); await writeFile(path, JSON.stringify(manifest));
  return { cache, path, manifest };
}

it("rebuilds current identity and basis from hash-verified originals, ignoring a forged binding approval", async () => {
  const f = await fixture();
  expect((await loadCoinMetricsManifest(f.path, f.cache, [coin])).assets[0].points[0].fdv?.value).toBe(32_000_000);
  expect((await loadCoinMetricsManifest(f.path, f.cache, [{ ...coin, geckoId: "sky", cmcIdentity: { ...coin.cmcIdentity!, address: "0x56072c95faa701256059aa122697b133aded9279" } }])).assets).toEqual([]);
  await writeFile(join(f.cache, "history.json"), (await readFile(join(f.cache, "history.json"), "utf8")).replace("32000000", "99000000"));
  await expect(loadCoinMetricsManifest(f.path, f.cache, [coin])).rejects.toThrow(/hash mismatch/);
});

it("rejects receipt path escapes and premium/all catalog substitutions", async () => {
  const f = await fixture();
  f.manifest.proofs[0].receipt.file = "../outside.json";
  await writeFile(f.path, JSON.stringify(f.manifest));
  await expect(loadCoinMetricsManifest(f.path, f.cache, [coin])).rejects.toThrow(/escapes/);
  f.manifest.proofs[0].receipt.file = "catalog.json";
  f.manifest.proofs[0].receipt.url = `${COIN_METRICS_BASE}/catalog-all/asset-metrics`;
  await writeFile(f.path, JSON.stringify(f.manifest));
  await expect(loadCoinMetricsManifest(f.path, f.cache, [coin])).rejects.toThrow(/endpoint/);
});
