import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { contentHash, type SourceReceipt } from "./sourceBundle";
import { buildFdvHoldsManifest, loadCurrentFdvPrimaryHolds, loadVerifiedFdvHoldsManifest, type FdvHoldsManifest } from "./dailyRawFdvHolds";
import type { CoinRaw } from "./types";
import type { LegacyFdvManifest } from "./dailyRawCollection";

const folders: string[] = [], quoteAt = "2026-10-11T22:39:47.000Z", observedAt = "2026-10-11T22:40:20.574Z";
afterEach(async () => { for (const folder of folders.splice(0)) { if (!folder.startsWith(join(tmpdir(), "fdv-hold-test-"))) throw Error("Unexpected FDV hold cleanup target"); await rm(folder, { recursive: true, force: true }); } });
async function fixture(pinned: boolean, rawTime = quoteAt) {
  const cache = await mkdtemp(join(tmpdir(), "fdv-hold-test-")); folders.push(cache);
  const body = JSON.stringify([{ id: "sample", current_price: 1, fully_diluted_valuation: 100, max_supply: null, total_supply: 100, last_updated: rawTime }]);
  const receipt: SourceReceipt = { url: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=sample", status: 200, requestedAt: "2026-10-11T22:40:19Z", observedAt, headers: {}, sha256: contentHash(body), body };
  const bundle = gzipSync(JSON.stringify({ schema: 1, receipts: [receipt] })), bundleHash = contentHash(bundle);
  const coin = { slug: "sample-project", identityStatus: "verified", geckoId: "sample", cmcId: null, fdv: 100, marketDataUpdatedAt: quoteAt, marketSources: { fdv: "CoinGecko", gecko: { id: "sample", status: "received", observedAt } } } as CoinRaw;
  const snapshot = gzipSync(JSON.stringify({ coins: [coin], ...(pinned ? { pipeline: { rawBundleSha256: bundleHash } } : {}) })), snapshotHash = contentHash(snapshot);
  const source = { id: "source-1", url: "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-test/data.json.gz", sha256: snapshotHash, observedAt };
  const input: LegacyFdvManifest = { schema: 1, sources: [source], assets: [{ slug: coin.slug, identity: "gecko:sample", points: [{ day: "2026-10-11", fdv: 100, fdvAt: quoteAt, observedAt, provider: "CoinGecko", sourceId: source.id, verification: "verified" }] }] };
  const inputBytes = Buffer.from(JSON.stringify(input));
  await writeFile(join(cache, `${snapshotHash}.gz`), snapshot); if (pinned) await writeFile(join(cache, `${bundleHash}.gz`), bundle);
  return { cache, inputBytes, snapshot, snapshotHash, bundleHash, source };
}

it("retains exact primary-reported FDV with an unavailable maximum, without changing original files", async () => {
  const f = await fixture(true), manifest = await buildFdvHoldsManifest(f.inputBytes, f.cache);
  expect(manifest.holds).toEqual([]); expect(manifest.sources[0].status).toBe("original_inspected");
  expect((await readFile(join(f.cache, `${f.snapshotHash}.gz`))).equals(f.snapshot)).toBe(true);
});

it("holds a snapshot-only claim and proves the absence of its original bundle pin", async () => {
  const f = await fixture(false), manifest = await buildFdvHoldsManifest(f.inputBytes, f.cache), path = join(f.cache, "holds.json");
  expect(manifest.holds).toHaveLength(1); expect(manifest.holds[0]).toMatchObject({ fdv: 100, reason: "primary_provider_bundle_unpinned", proof: { snapshotSha256: f.snapshotHash, candidates: [] } });
  expect(manifest.holds[0].proof.bundleSha256).toBeUndefined(); await writeFile(path, JSON.stringify(manifest));
  await expect(loadVerifiedFdvHoldsManifest(path, f.cache, f.inputBytes)).resolves.toEqual(manifest);
});

it("holds a mismatched quote time even when the amount matches, preserving the actual original date for audit", async () => {
  for (const rawTime of ["2026-10-11T22:40:00.000Z", "2026-08-01T00:00:00.000Z"]) {
    const f = await fixture(true, rawTime), manifest = await buildFdvHoldsManifest(f.inputBytes, f.cache), path = join(f.cache, "holds.json");
    expect(manifest.holds).toHaveLength(1); expect(manifest.holds[0]).toMatchObject({ day: "2026-10-11", fdv: 100, fdvAt: quoteAt, reason: "raw_quote_time_mismatch", proof: { candidates: [{ quoteAt: rawTime, reportedFdv: 100 }] } });
    await writeFile(path, JSON.stringify(manifest)); await expect(loadVerifiedFdvHoldsManifest(path, f.cache, f.inputBytes)).resolves.toEqual(manifest);
  }
});

it("rejects forged hold targets, changed evidence, changed inputs and corrupted originals", async () => {
  const f = await fixture(true, "2026-08-01T00:00:00Z"), manifest = await buildFdvHoldsManifest(f.inputBytes, f.cache), path = join(f.cache, "holds.json");
  for (const modify of [
    (m: FdvHoldsManifest) => { m.holds[0].slug = "another"; },
    (m: FdvHoldsManifest) => { m.holds[0].fdv = 999; },
    (m: FdvHoldsManifest) => { m.holds[0].day = "2026-10-12"; },
  ]) { const changed = structuredClone(manifest); modify(changed); await writeFile(path, JSON.stringify(changed)); await expect(loadVerifiedFdvHoldsManifest(path, f.cache, f.inputBytes)).rejects.toThrow(/unknown_claim/); }
  const changed = structuredClone(manifest); changed.holds[0].proof.candidates[0].reportedFdv = 999; await writeFile(path, JSON.stringify(changed));
  await expect(loadVerifiedFdvHoldsManifest(path, f.cache, f.inputBytes)).rejects.toThrow(/proof_mismatch/);
  await writeFile(path, JSON.stringify(manifest)); await expect(loadVerifiedFdvHoldsManifest(path, f.cache, Buffer.from("{}"))).rejects.toThrow(/holds_manifest/);
  await writeFile(join(f.cache, `${f.bundleHash}.gz`), "changed original");
  await expect(loadVerifiedFdvHoldsManifest(path, f.cache, f.inputBytes)).rejects.toThrow(/original_hash/);
});

it("derives current quote-time holds only after matching the frozen reference and original bundle pin", async () => {
  const f = await fixture(true, "2026-10-11T22:38:00Z"), reference = { url: f.source.url, sha256: f.snapshotHash, rawBundleSha256: f.bundleHash };
  expect(await loadCurrentFdvPrimaryHolds(f.inputBytes, f.cache, reference)).toMatchObject([{ slug: "sample-project", reason: "raw_quote_time_mismatch", proof: { candidates: [{ quoteAt: "2026-10-11T22:38:00Z", reportedFdv: 100 }] } }]);
  await expect(loadCurrentFdvPrimaryHolds(f.inputBytes, f.cache, { ...reference, rawBundleSha256: "a".repeat(64) })).rejects.toThrow(/current_reference/);
});
