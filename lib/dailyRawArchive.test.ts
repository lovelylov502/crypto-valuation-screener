import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { contentHash, type SourceReceipt } from "./sourceBundle";
import { assertDailyRawPublicSourceUrl, DAILY_RAW_ARCHIVE_ATTRIBUTION, DAILY_RAW_ARCHIVE_NOTES, DAILY_RAW_ARCHIVE_REPOSITORY, dailyRawArchiveUrl, emptyDailyRawArchiveManifest, gatherDailyRawArchiveReceipts, newDailyRawArchiveReceipts, normalizeDailyRawArchiveReceipt, packDailyRawArchiveReceipts, publishDailyRawArchive, readbackDailyRawArchive, verifyPreviousDailyRawArchive, type DailyRawArchivePlan, type DailyRawArchivePublisher, type DailyRawArchiveRelease } from "./dailyRawArchive";

const original = (overrides: Partial<SourceReceipt> = {}): SourceReceipt => {
  const body = overrides.body ?? "date,price\n2020-01-01,1\n";
  return { url: "https://www.coingecko.com/price_charts/export/aave/usd.csv", requestedAt: "2026-10-19T00:00:00Z", observedAt: "2026-10-19T00:00:01Z", status: 200, headers: { "content-type": "text/csv" }, body, sha256: contentHash(body), ...overrides };
};
const plan = (count = 1): DailyRawArchivePlan => ({ schema: 1, repository: DAILY_RAW_ARCHIVE_REPOSITORY, tag: "daily-raw-test", target: "a".repeat(40), attribution: DAILY_RAW_ARCHIVE_ATTRIBUTION,
  bundles: Array.from({ length: count }, (_, n) => packDailyRawArchiveReceipts([original({ url: `https://www.coingecko.com/price_charts/export/aave-${n}/usd.csv` })])[0].bundle) });
const release = (input: DailyRawArchivePlan): DailyRawArchiveRelease => ({ target: input.target, notes: DAILY_RAW_ARCHIVE_NOTES, assets: input.bundles.map(b => b.file), draft: false, immutable: false });
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) { if (!folder.startsWith(join(tmpdir(), "raw-archive-test-"))) throw Error("Unexpected archive test cleanup target"); await rm(folder, { recursive: true, force: true }); } });

it("rejects a changed original body, authenticated URLs, unapproved provider paths and hosts", () => {
  expect(() => assertDailyRawPublicSourceUrl("https://api.llama.fi/summary/fees/ether.fi?dataType=dailyFees")).not.toThrow();
  const mixedCase = "https://www.coingecko.com/price_charts/export/Chain-2/usd.csv";
  expect(normalizeDailyRawArchiveReceipt(original({ url: mixedCase })).url).toBe(mixedCase);
  expect(() => assertDailyRawPublicSourceUrl("https://www.coingecko.com/price_charts/export/IOTA/usd.csv")).not.toThrow();
  expect(() => normalizeDailyRawArchiveReceipt({ ...original(), body: "changed" })).toThrow(/hash_mismatch/);
  for (const url of [
    "https://api.llama.fi/summary/fees/aave?api_key=secret", "https://secret@api.llama.fi/summary/fees/aave",
    "https://api.llama.fi.evil.test/overview/fees", "https://pro-api.coinmarketcap.com/v3/cryptocurrency/listings/latest",
    "http://www.coingecko.com/price_charts/export/aave/usd.csv", "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?authorization=secret",
  ]) expect(() => assertDailyRawPublicSourceUrl(url)).toThrow();
});

it("preserves body and observation time, excluding credentials, cookies and local receipt fields", () => {
  const receipt = normalizeDailyRawArchiveReceipt({ ...original(), headers: { "content-type": "text/csv", authorization: "SECRET", "set-cookie": "PRIVATE", "x-local-path": "C:/secret" } });
  expect(receipt.body).toBe(original().body); expect(receipt.observedAt).toBe(original().observedAt);
  expect(receipt.headers).toEqual({ "content-type": "text/csv" });
  expect(JSON.stringify(receipt)).not.toMatch(/SECRET|PRIVATE|C:\/secret/);
});

it("packs deterministic bounded originals and keeps all observation witnesses for one URL/hash in one bundle", () => {
  const a = original({ body: "a".repeat(1000) }), b = original({ body: "b".repeat(1000), url: "https://www.coingecko.com/price_charts/export/comp/usd.csv" });
  const later = { ...a, observedAt: "2026-10-19T00:00:02Z" }, groupLimit = packDailyRawArchiveReceipts([a, later])[0].bundle.uncompressedBytes;
  const packed = packDailyRawArchiveReceipts([a, b, later, a], groupLimit), again = packDailyRawArchiveReceipts([later, b, a], groupLimit);
  expect(packed).toHaveLength(2); expect(packed.map(p => p.bytes)).toEqual(again.map(p => p.bytes));
  expect(packed.every(p => p.bundle.uncompressedBytes <= groupLimit && contentHash(p.bytes) === p.bundle.sha256)).toBe(true);
  expect(packed.find(p => p.bundle.receipts.some(r => r.url === a.url))?.bundle.receipts).toHaveLength(2);
  for (const part of packed) {
    const parsed = JSON.parse(gunzipSync(part.bytes).toString("utf8"));
    expect(parsed.metadata.attribution[0].license).toBe("CC BY-NC 4.0");
    expect(parsed.receipts.every((r: SourceReceipt) => contentHash(r.body) === r.sha256)).toBe(true);
  }
  expect(() => packDailyRawArchiveReceipts([a, later], groupLimit - 1)).toThrow(/exceeds_bundle_limit/);
});

it("refuses an unapproved redirect before contacting it and verifies the public readback hash", async () => {
  const bytes = Buffer.from("original archive"), digest = contentHash(bytes), url = `https://github.com/${DAILY_RAW_ARCHIVE_REPOSITORY}/releases/download/daily-raw-test/daily-raw-sources-${digest}.json.gz`;
  const evil = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://unapproved.test/file" } }));
  await expect(readbackDailyRawArchive(url, digest, evil)).rejects.toThrow(/redirect_host/); expect(evil).toHaveBeenCalledTimes(1);
  const valid = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/public-file?sig=ephemeral" } }))
    .mockResolvedValueOnce(new Response(bytes.toString("utf8")));
  await expect(readbackDailyRawArchive(url, digest, valid)).resolves.toEqual(bytes);
  await expect(readbackDailyRawArchive(url, digest, vi.fn<typeof fetch>().mockResolvedValue(new Response("changed")))).rejects.toThrow(/hash_mismatch/);
});

it("never overwrites an existing mismatch or uploads anything before its existing assets pass readback", async () => {
  const input = plan(2), existing = { ...release(input), assets: [input.bundles[0].file] };
  const publisher: DailyRawArchivePublisher = { readRelease: vi.fn().mockResolvedValue(existing), createRelease: vi.fn(), uploadAssets: vi.fn(), verifyAsset: vi.fn().mockRejectedValue(Error("digest mismatch")) };
  await expect(publishDailyRawArchive(input, publisher)).rejects.toThrow("digest mismatch");
  expect(publisher.createRelease).not.toHaveBeenCalled(); expect(publisher.uploadAssets).not.toHaveBeenCalled();
  publisher.readRelease = vi.fn().mockResolvedValue({ ...existing, target: "b".repeat(40) });
  await expect(publishDailyRawArchive(input, publisher)).rejects.toThrow(/immutable_release_mismatch/);
  expect(publisher.uploadAssets).not.toHaveBeenCalled();
});

it("recovers an unknown create outcome by reading the matching release, without creating twice", async () => {
  const input = plan(), existing = release(input);
  const publisher: DailyRawArchivePublisher = { readRelease: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing), createRelease: vi.fn().mockRejectedValue(Error("transport disconnected after upload")), uploadAssets: vi.fn(), verifyAsset: vi.fn() };
  const manifest = await publishDailyRawArchive(input, publisher);
  expect(publisher.createRelease).toHaveBeenCalledTimes(1); expect(publisher.uploadAssets).not.toHaveBeenCalled();
  expect(manifest.receipts[0]).toMatchObject({ archiveUrl: dailyRawArchiveUrl(input, input.bundles[0].file), sha256: original().sha256 });
  expect(manifest.metadata.attribution[0].license).toBe("CC BY-NC 4.0");
});

it("resumes only missing assets and resolves an uncertain upload with readback, without blind replay", async () => {
  const input = plan(2), partial = { ...release(input), assets: [input.bundles[0].file] };
  const publisher: DailyRawArchivePublisher = { readRelease: vi.fn().mockResolvedValueOnce(partial).mockResolvedValueOnce(release(input)), createRelease: vi.fn(), uploadAssets: vi.fn().mockRejectedValue(Error("unknown upload result")), verifyAsset: vi.fn() };
  expect((await publishDailyRawArchive(input, publisher)).receipts).toHaveLength(2);
  expect(publisher.createRelease).not.toHaveBeenCalled(); expect(publisher.uploadAssets).toHaveBeenCalledExactlyOnceWith([input.bundles[1].file]);
  expect(publisher.verifyAsset).toHaveBeenCalledTimes(2);
});

it("fails closed when create outcome remains unknown or an immutable release is incomplete", async () => {
  const input = plan(), publisher: DailyRawArchivePublisher = { readRelease: vi.fn().mockResolvedValue(null), createRelease: vi.fn().mockRejectedValue(Error("unknown")), uploadAssets: vi.fn(), verifyAsset: vi.fn() };
  await expect(publishDailyRawArchive(input, publisher)).rejects.toThrow(/outcome_unconfirmed/); expect(publisher.createRelease).toHaveBeenCalledTimes(1);
  publisher.readRelease = vi.fn().mockResolvedValue({ ...release(input), immutable: true, assets: [] });
  await expect(publishDailyRawArchive(input, publisher)).rejects.toThrow(/immutable_release_missing_asset/); expect(publisher.uploadAssets).not.toHaveBeenCalled();
});

it("reuses only verified prior witnesses, preserving old origins when an identical body is observed again", async () => {
  const first = original(), packed = packDailyRawArchiveReceipts([first]), initial = { ...plan(), bundles: packed.map(p => p.bundle) };
  const publisher = (input: DailyRawArchivePlan): DailyRawArchivePublisher => ({ readRelease: vi.fn().mockResolvedValue(release(input)), createRelease: vi.fn(), uploadAssets: vi.fn(), verifyAsset: vi.fn() });
  const old = await publishDailyRawArchive(initial, publisher(initial));
  // The first published schema omitted observation times. Its public original must supply them.
  delete old.receipts[0].observedAt;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array(packed[0].bytes)));
  const previous = await verifyPreviousDailyRawArchive(old, fetcher);
  expect(fetcher).toHaveBeenCalledOnce(); expect(previous.manifest.receipts[0].observedAt).toBe(first.observedAt);
  expect(newDailyRawArchiveReceipts([first], previous)).toEqual([]);
  const later = { ...first, observedAt: "2026-10-19T00:00:02Z" }, anotherOrigin = { ...first, url: "https://www.coingecko.com/price_charts/export/comp/usd.csv" };
  const pending = newDailyRawArchiveReceipts([first, later, anotherOrigin], previous);
  expect(pending).toEqual([later, anotherOrigin]);
  const nextPacked = packDailyRawArchiveReceipts(pending), next = { ...initial, tag: "daily-raw-next", bundles: nextPacked.map(p => p.bundle) };
  const merged = await publishDailyRawArchive(next, publisher(next), previous);
  expect(merged.receipts).toHaveLength(3); expect(merged.metadata.bundles).toHaveLength(2);
  expect(merged.receipts.find(r => r.url === first.url && r.observedAt === first.observedAt)?.archiveUrl).toBe(old.receipts[0].archiveUrl);
  expect(merged.receipts.find(r => r.url === later.url && r.observedAt === later.observedAt)?.archiveUrl).toBe(dailyRawArchiveUrl(next, next.bundles[0].file));
  const archives = new Map([[old.receipts[0].archiveUrl, packed[0].bytes], [dailyRawArchiveUrl(next, next.bundles[0].file), nextPacked[0].bytes]]);
  const restored = await verifyPreviousDailyRawArchive(merged, vi.fn<typeof fetch>().mockImplementation(async url => new Response(new Uint8Array(archives.get(String(url))!))));
  expect(newDailyRawArchiveReceipts([first, later, anotherOrigin], restored)).toEqual([]);
});

it("does not trust previous manifest claims until public hashes, bundle metadata and exact observations match", async () => {
  const packed = packDailyRawArchiveReceipts([original()]), input = { ...plan(), bundles: packed.map(p => p.bundle) };
  const manifest = await publishDailyRawArchive(input, { readRelease: vi.fn().mockResolvedValue(release(input)), createRelease: vi.fn(), uploadAssets: vi.fn(), verifyAsset: vi.fn() });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array(packed[0].bytes)));
  await expect(verifyPreviousDailyRawArchive(manifest, vi.fn<typeof fetch>().mockResolvedValue(new Response("changed public bytes")))).rejects.toThrow(/readback_hash_mismatch/);
  const laterClaim = structuredClone(manifest); laterClaim.receipts[0].observedAt = "2026-10-19T00:00:03Z";
  await expect(verifyPreviousDailyRawArchive(laterClaim, fetcher)).rejects.toThrow(/previous_witness_missing/);
  const wrongSize = structuredClone(manifest); wrongSize.metadata.bundles[0].uncompressedBytes++;
  await expect(verifyPreviousDailyRawArchive(wrongSize, fetcher)).rejects.toThrow(/previous_bundle_metadata/);
  const unknown = structuredClone(manifest); unknown.metadata.bundles[0].url = "https://unapproved.test/originals.json.gz";
  fetcher.mockClear(); await expect(verifyPreviousDailyRawArchive(unknown, fetcher)).rejects.toThrow(/readback_url/); expect(fetcher).not.toHaveBeenCalled();
});

it("supports an empty fresh cache without optional providers but rejects explicitly requested missing manifests", async () => {
  const cache = await mkdtemp(join(tmpdir(), "raw-archive-test-")); folders.push(cache);
  await writeFile(join(cache, "csv-manifest.json"), JSON.stringify({ schema: 1, files: [] }));
  expect(await gatherDailyRawArchiveReceipts(cache)).toEqual([]);
  expect(packDailyRawArchiveReceipts([])).toEqual([]);
  await expect(gatherDailyRawArchiveReceipts(cache, { coinMetricsManifest: "requested-cm.json" })).rejects.toMatchObject({ code: "ENOENT" });
  await expect(gatherDailyRawArchiveReceipts(cache, { feesManifest: "requested-fees.json" })).rejects.toMatchObject({ code: "ENOENT" });
  const manifest = emptyDailyRawArchiveManifest("daily-raw-empty", "a".repeat(40)), fetcher = vi.fn<typeof fetch>();
  expect((await verifyPreviousDailyRawArchive(manifest, fetcher)).witnesses.size).toBe(0);
  expect(fetcher).not.toHaveBeenCalled();
});

it("archives new fee receipts from a fresh cache with zero CSVs and no Coin Metrics inputs", async () => {
  const cache = await mkdtemp(join(tmpdir(), "raw-archive-test-")); folders.push(cache);
  await writeFile(join(cache, "csv-manifest.json"), JSON.stringify({ schema: 1, files: [] }));
  await mkdir(join(cache, "supplemental"));
  const fees = original({ url: "https://api.llama.fi/summary/fees/aave?dataType=dailyRevenue", body: "{\"totalDataChart\":[]}" });
  await writeFile(join(cache, "supplemental", "fees.json.gz"), gzipSync(JSON.stringify(fees)));
  expect(await gatherDailyRawArchiveReceipts(cache)).toEqual([fees]);
});

it("gathers only referenced original CSV, supplemental and Coin Metrics bodies, excluding local metadata and credentials", async () => {
  const cache = await mkdtemp(join(tmpdir(), "raw-archive-test-")); folders.push(cache);
  for (const directory of ["originals", "supplemental", "coinmetrics"]) await mkdir(join(cache, directory));
  const csv = original(), csvFile = join(cache, "originals", `${csv.sha256}.csv`);
  await writeFile(csvFile, csv.body);
  const meta = JSON.stringify({ ...csv, body: undefined, path: "C:/private-local-path" });
  await writeFile(join(cache, "originals", `${contentHash(meta)}.receipt.json`), meta);
  await writeFile(join(cache, "csv-manifest.json"), JSON.stringify({ schema: 1, files: [{ path: csvFile, sha256: csv.sha256, url: csv.url, observedAt: csv.observedAt }] }));
  const fees = original({ url: "https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false", body: "{\"totalDataChart\":[]}" });
  await writeFile(join(cache, "supplemental", "fees.json.gz"), gzipSync(JSON.stringify(fees)));
  const cm = original({ url: "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=aave&metrics=PriceUSD,SplyCur&frequency=1d", body: "{\"data\":[]}" });
  await writeFile(join(cache, "coinmetrics", "body.json"), cm.body);
  const { body, ...cmMeta } = cm;
  await writeFile(join(cache, "coinmetrics", "manifest.json"), JSON.stringify({ schema: 1, provider: "CoinMetrics", proofs: [], histories: [{ pages: [{ ...cmMeta, file: "body.json" }] }] }));
  await writeFile(join(cache, ".env.private"), "SECRET_ACCOUNT_PASSWORD=PRIVATE");
  const gathered = await gatherDailyRawArchiveReceipts(cache), unpacked = gunzipSync(packDailyRawArchiveReceipts(gathered)[0].bytes).toString("utf8");
  expect(gathered).toHaveLength(3); expect(unpacked).not.toMatch(/private-local-path|SECRET_ACCOUNT_PASSWORD|PRIVATE/);
  expect((JSON.parse(unpacked).receipts as SourceReceipt[]).map(r => r.observedAt)).toEqual([csv.observedAt, csv.observedAt, csv.observedAt]);
  await writeFile(csvFile, "corrupt");
  await expect(gatherDailyRawArchiveReceipts(cache)).rejects.toThrow(/original_hash_mismatch/);
});
