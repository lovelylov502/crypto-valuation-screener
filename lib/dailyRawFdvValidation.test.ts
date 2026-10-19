import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { contentHash, type SourceReceipt } from "./sourceBundle";
import { auditLegacyFdvSnapshot, checkCapturedFdvUpperBound, DAILY_RAW_FDV_BOUND_POLICY, indexCapturedFdvQuotes, loadVerifiedFdvValidationManifest, type FdvValidationManifest } from "./dailyRawFdvValidation";
import type { CoinRaw } from "./types";
import type { LegacyFdvManifest } from "./dailyRawCollection";

const quoteAt = "2026-10-11T22:39:47.000Z", observedAt = "2026-10-11T22:40:20.574Z";
const gecko = (changes: Record<string, unknown> = {}, receiptChanges: Partial<SourceReceipt> = {}): SourceReceipt => {
  const body = JSON.stringify([{ id: "sample", current_price: .01329411, fully_diluted_valuation: 1.3291053084725983e25, max_supply: 1e9, total_supply: 873400434.3366884, last_updated: quoteAt, ...changes }]);
  return { url: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=sample", requestedAt: "2026-10-11T22:40:19Z", observedAt, status: 200, headers: {}, body, sha256: contentHash(body), ...receiptChanges };
};
const check = (receipt: SourceReceipt, changes: Partial<Parameters<typeof checkCapturedFdvUpperBound>[0]> = {}) => checkCapturedFdvUpperBound({ provider: "CoinGecko", id: "sample", observedAt, quoteAt, fdv: (JSON.parse(receipt.body) as Record<string, number>[])[0].fully_diluted_valuation, ...changes }, indexCapturedFdvQuotes([receipt]));
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) { if (!folder.startsWith(join(tmpdir(), "fdv-bound-test-"))) throw Error("Unexpected FDV test cleanup target"); await rm(folder, { recursive: true, force: true }); } });

it("rejects the captured decimal-scale FDV contradiction without calculating replacement FDV", () => {
  const result = check(gecko());
  expect(result.state).toBe("exceeds_bound"); expect(result.proof).toMatchObject({ reportedFdv: 1.3291053084725983e25, upperBound: 13294110, allowanceUsd: 132941.1, maxSupply: 1e9 });
  expect(result).not.toHaveProperty("fdv");
});

it("allows documented provider rounding of max(1 USD, 1%) and rejects amounts beyond it", () => {
  expect(check(gecko({ current_price: 2, max_supply: 100, fully_diluted_valuation: 202 })).state).toBe("within_bound");
  expect(check(gecko({ current_price: 2, max_supply: 100, fully_diluted_valuation: 202.01 })).state).toBe("exceeds_bound");
  expect(check(gecko({ current_price: .004, max_supply: 100, fully_diluted_valuation: 1 })).state).toBe("within_bound");
  expect(check(gecko({ current_price: .004, max_supply: 100, fully_diluted_valuation: 2 })).state).toBe("exceeds_bound");
});

it("retains reported FDV when the maximum is absent, nonfinite, zero or explicitly unlimited", () => {
  for (const changes of [{ max_supply: null }, { max_supply: 0 }, { max_supply: "1000000000" }, { max_supply: 1e309 }, { infinite_supply: true }, { current_price: null }]) {
    const result = check(gecko(changes)); expect(result.state).toBe("bound_unavailable"); expect(result.proof).toBeUndefined();
  }
});

it("requires exact identity, receipt observation, quote time and reported value; never mixes records", () => {
  const receipt = gecko();
  for (const changes of [{ id: "another" }, { observedAt: "2026-10-11T22:40:21Z" }, { quoteAt: "2026-10-11T22:39:48Z" }, { provider: "CoinMarketCap" as const }, { fdv: 13294110 }]) expect(check(receipt, changes).state).toBe("receipt_unavailable");
  expect(check({ ...receipt, sha256: "a".repeat(64) }).state).toBe("receipt_unavailable");
  const index = indexCapturedFdvQuotes([receipt, gecko({ max_supply: 1e30 })]);
  expect(checkCapturedFdvUpperBound({ provider: "CoinGecko", id: "sample", observedAt, quoteAt, fdv: 1.3291053084725983e25 }, index)).toMatchObject({ state: "receipt_unavailable", reason: "fdv_bound_ambiguous_provider_records" });
});

it("checks the USD quote and maximum from the same numeric CoinMarketCap asset record", () => {
  const body = JSON.stringify({ data: [{ id: 123, max_supply: 100, total_supply: 90, quote: [{ symbol: "BTC", price: .001, fully_diluted_market_cap: 999999, last_updated: quoteAt }, { symbol: "USD", price: 2, fully_diluted_market_cap: 205, last_updated: quoteAt }] }] });
  const receipt = gecko({}, { url: "https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=123&convert=USD", body, sha256: contentHash(body) });
  expect(checkCapturedFdvUpperBound({ provider: "CoinMarketCap", id: "123", observedAt, quoteAt, fdv: 205 }, indexCapturedFdvQuotes([receipt]))).toMatchObject({ state: "exceeds_bound", proof: { upperBound: 200, price: 2, reportedFdv: 205, assetId: "123" } });
});

it("re-verifies rejection files against their input hash, pinned originals, asset and exact UTC date", async () => {
  const cache = await mkdtemp(join(tmpdir(), "fdv-bound-test-")); folders.push(cache);
  const receipt = gecko(), bundle = gzipSync(JSON.stringify({ schema: 1, receipts: [receipt] })), bundleHash = contentHash(bundle);
  const coin = { slug: "sample-project", geckoId: "sample", cmcId: null, fdv: 1.3291053084725983e25, marketDataUpdatedAt: quoteAt, marketSources: { fdv: "CoinGecko", gecko: { id: "sample", status: "received", observedAt } } } as CoinRaw;
  const snapshot = gzipSync(JSON.stringify({ coins: [coin], pipeline: { rawBundleSha256: bundleHash } })), snapshotHash = contentHash(snapshot);
  const source = { id: "source-1", url: "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-test/data.json.gz", sha256: snapshotHash, observedAt };
  const input: LegacyFdvManifest = { schema: 1, sources: [source], assets: [{ slug: coin.slug, identity: "gecko:sample", points: [{ day: "2026-10-11", fdv: coin.fdv!, fdvAt: quoteAt, sourceId: source.id, observedAt, provider: "CoinGecko", verification: "verified" }] }] };
  const inputBytes = Buffer.from(JSON.stringify(input)), audited = auditLegacyFdvSnapshot(input, source, [coin], [receipt], { url: source.url.replace("data.json.gz", "source-bundle.json.gz"), sha256: bundleHash });
  expect(audited.rejections).toHaveLength(1); expect(audited.checks).toEqual({ exceeds_bound: 1 });
  const manifest: FdvValidationManifest = { schema: 1, methodology: DAILY_RAW_FDV_BOUND_POLICY, inputManifestSha256: contentHash(inputBytes), createdAt: observedAt, sources: [], rejections: audited.rejections };
  const path = join(cache, "validation.json");
  await writeFile(join(cache, `${snapshotHash}.gz`), snapshot); await writeFile(join(cache, `${bundleHash}.gz`), bundle); await writeFile(path, JSON.stringify(manifest));
  await expect(loadVerifiedFdvValidationManifest(path, cache, inputBytes)).resolves.toMatchObject({ rejections: audited.rejections });
  await expect(loadVerifiedFdvValidationManifest(path, cache, Buffer.from("{}"))).rejects.toThrow(/validation_manifest/);
  for (const modify of [
    (m: FdvValidationManifest) => { m.rejections[0].proof.price = 2; },
    (m: FdvValidationManifest) => { m.rejections[0].slug = "another-project"; },
    (m: FdvValidationManifest) => { m.rejections[0].day = "2026-10-12"; },
  ]) { const changed = structuredClone(manifest); modify(changed); await writeFile(path, JSON.stringify(changed)); await expect(loadVerifiedFdvValidationManifest(path, cache, inputBytes)).rejects.toThrow(/rejection_proof_mismatch/); }
  await writeFile(path, JSON.stringify(manifest)); await writeFile(join(cache, `${bundleHash}.gz`), "corrupted");
  await expect(loadVerifiedFdvValidationManifest(path, cache, inputBytes)).rejects.toThrow(/bundle_hash/);
  expect((await readFile(join(cache, `${snapshotHash}.gz`))).equals(snapshot)).toBe(true);
});
