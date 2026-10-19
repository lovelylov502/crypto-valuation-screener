import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { contentHash, objectHash, type SourceReceipt } from "./sourceBundle";
import type { CoinMetricsManifest, CoinMetricsReceipt } from "./dailyRawCoinMetrics";

export const DAILY_RAW_ARCHIVE_REPOSITORY = "lovelylov502/crypto-valuation-screener";
export const DAILY_RAW_ARCHIVE_MAX_BYTES = 100_000_000;
export const DAILY_RAW_ARCHIVE_ATTRIBUTION = [{ provider: "Coin Metrics", license: "CC BY-NC 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/", sourceUrl: "https://gitbook-docs.coinmetrics.io/packages/coin-metrics-community-data" }];
export const DAILY_RAW_ARCHIVE_NOTES = "Original public daily market, fees and dated supply responses, preserved with SHA-256 hashes and provider observation times. Missing dates and unverified FDV remain unavailable.\n\nSources: CoinGecko, DefiLlama, CoinMarketCap Keyless and Coin Metrics Community.\n\nCoin Metrics data is attributed to Coin Metrics and licensed under CC BY-NC 4.0: https://creativecommons.org/licenses/by-nc/4.0/ . Noncommercial use only; no commercial redistribution permission is asserted. Methodology: https://gitbook-docs.coinmetrics.io/packages/coin-metrics-community-data .\n";
interface Witness { url: string; observedAt: string; sha256: string }
export interface DailyRawArchiveBundle { file: string; sha256: string; uncompressedSha256: string; bytes: number; uncompressedBytes: number; receipts: Witness[] }
export interface DailyRawArchivePlan { schema: 1; repository: string; tag: string; target: string; bundles: DailyRawArchiveBundle[]; attribution: typeof DAILY_RAW_ARCHIVE_ATTRIBUTION }
export interface DailyRawArchiveManifest {
  schema: 1; receipts: { sha256: string; url: string; observedAt?: string; archiveUrl: string }[];
  metadata: { repository: string; tag: string; target: string; verifiedAt: string; attribution: typeof DAILY_RAW_ARCHIVE_ATTRIBUTION; bundles: { url: string; sha256: string; uncompressedBytes: number; receipts: number }[] };
}
const safeQuery = (url: URL, allowed: string[]) => [...url.searchParams.keys()].every(key => allowed.includes(key));

/** Public keyless provider routes only; never publish authenticated request URLs. */
export function assertDailyRawPublicSourceUrl(value: string) {
  let url: URL; try { url = new URL(value); } catch { throw Error("daily_raw_archive_source_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
    || [...url.searchParams.keys()].some(key => /key|secret|auth|signature|access|session|credential|jwt|password/i.test(key))) throw Error("daily_raw_archive_source_auth_or_url");
  const valid = url.hostname === "www.coingecko.com" && /^\/price_charts\/export\/[a-zA-Z0-9][a-zA-Z0-9-]*\/usd\.csv$/.test(url.pathname) && !url.search
    || url.hostname === "api.llama.fi" && (/^\/summary\/fees\/[a-z0-9_.()%-]+$/.test(url.pathname) || url.pathname === "/overview/fees") && safeQuery(url, ["excludeTotalDataChart", "excludeTotalDataChartBreakdown", "dataType"])
    || url.hostname === "community-api.coinmetrics.io" && ["/v4/catalog/asset-metrics", "/v4/reference-data/markets", "/v4/timeseries/asset-metrics"].includes(url.pathname) && safeQuery(url, ["exchange", "page_size", "assets", "metrics", "frequency", "paging_from", "start_time", "end_time", "next_page_token"])
    || url.hostname === "pro-api.coinmarketcap.com" && url.pathname === "/public-api/v3/cryptocurrency/listings/latest" && safeQuery(url, ["start", "limit", "convert"]);
  if (!valid) throw Error("daily_raw_archive_source_endpoint");
}

/** Whitelist response metadata; bodies are byte-verified before any publication. */
export function normalizeDailyRawArchiveReceipt(input: SourceReceipt): SourceReceipt {
  assertDailyRawPublicSourceUrl(input.url);
  if (typeof input.body !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256) || contentHash(input.body) !== input.sha256) throw Error("daily_raw_archive_original_hash_mismatch");
  if (![input.requestedAt, input.observedAt].every(t => typeof t === "string" && Number.isFinite(Date.parse(t))) || Date.parse(input.requestedAt) > Date.parse(input.observedAt)
    || input.status !== null && (!Number.isInteger(input.status) || input.status < 100 || input.status > 599)) throw Error("daily_raw_archive_receipt_metadata");
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers ?? {}).sort(([a], [b]) => a.localeCompare(b))) if (["content-type", "cache-control", "date", "etag", "last-modified", "retry-after", "x-ratelimit-plan"].includes(key.toLowerCase())) {
    if (typeof value !== "string" || value.length > 4096 || /[\r\n]/.test(value)) throw Error("daily_raw_archive_header");
    headers[key.toLowerCase()] = value;
  }
  return { url: input.url, requestedAt: input.requestedAt, observedAt: input.observedAt, status: input.status, headers, body: input.body, sha256: input.sha256 };
}

async function cacheFile(root: string, path: string) {
  const directory = await realpath(root), target = await realpath(resolve(directory, path)), rel = relative(directory, target);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) throw Error("daily_raw_archive_cache_escape");
  return readFile(target);
}
const csvKey = (value: { url: string; observedAt: string; sha256: string }) => objectHash([value.url, value.observedAt, value.sha256]);

/** Read known collection manifests only. Never sweep credentials, databases or arbitrary cache files. */
export async function gatherDailyRawArchiveReceipts(cache: string, options: { csvManifest?: string; feesManifest?: string; coinMetricsManifest?: string } = {}): Promise<SourceReceipt[]> {
  const root = resolve(cache), receipts: SourceReceipt[] = [];
  const csv = JSON.parse((await cacheFile(root, options.csvManifest ?? "csv-manifest.json")).toString("utf8")) as { schema: number; files: { path: string; url: string; observedAt: string; sha256: string }[] };
  if (csv.schema !== 1 || !Array.isArray(csv.files)) throw Error("daily_raw_archive_csv_manifest");
  const metadata = new Map<string, SourceReceipt[]>();
  const originals = join(root, "originals");
  const receiptFiles = await readdir(originals).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; });
  for (const file of receiptFiles.filter(file => /^[a-f0-9]{64}\.receipt\.json$/.test(file)).sort()) {
    const bytes = await cacheFile(originals, file);
    // Unreferenced receipt files may still be in the acquisition writer's hands.
    // Only a complete hash-verified match can witness one of the selected CSVs.
    if (contentHash(bytes) !== file.slice(0, 64)) continue;
    const item = JSON.parse(bytes.toString("utf8")) as SourceReceipt;
    if (item.requestedAt && item.url && item.observedAt && item.sha256) metadata.set(csvKey(item), [...metadata.get(csvKey(item)) ?? [], item]);
  }
  for (const file of csv.files) {
    const original = await cacheFile(root, file.path);
    if (contentHash(original) !== file.sha256) throw Error("daily_raw_archive_original_hash_mismatch");
    const meta = metadata.get(csvKey(file))?.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0];
    if (!meta || meta.status !== 200) throw Error("daily_raw_archive_csv_request_metadata_missing");
    receipts.push(normalizeDailyRawArchiveReceipt({ ...meta, url: file.url, observedAt: file.observedAt, sha256: file.sha256, body: new TextDecoder("utf-8", { fatal: true }).decode(original) }));
  }
  const supplementalFiles = await readdir(join(root, "supplemental")).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; });
  for (const file of supplementalFiles.filter(file => file.endsWith(".json.gz")).sort()) {
    const value = JSON.parse(gunzipSync(await cacheFile(join(root, "supplemental"), file), { maxOutputLength: 500_000_000 }).toString("utf8")) as SourceReceipt | { receipts: SourceReceipt[] };
    for (const receipt of "receipts" in value ? value.receipts : [value]) receipts.push(normalizeDailyRawArchiveReceipt(receipt));
  }
  let feeFiles: { path: string; url: string; observedAt: string; sha256: string }[] = [];
  try {
    const fees = JSON.parse((await cacheFile(root, options.feesManifest ?? "fees-summaries-manifest.json")).toString("utf8")) as { schema: number; files: typeof feeFiles };
    if (fees.schema !== 1 || !Array.isArray(fees.files)) throw Error("daily_raw_archive_fee_manifest"); feeFiles = fees.files;
  } catch (error) { if (options.feesManifest || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const file of feeFiles) {
    const receipt = JSON.parse(gunzipSync(await cacheFile(root, file.path), { maxOutputLength: 500_000_000 }).toString("utf8")) as SourceReceipt;
    if (receipt.url !== file.url || receipt.observedAt !== file.observedAt || receipt.sha256 !== file.sha256) throw Error("daily_raw_archive_fee_manifest_mismatch");
    receipts.push(normalizeDailyRawArchiveReceipt(receipt));
  }
  const cmRoot = join(root, "coinmetrics");
  let cm: CoinMetricsManifest;
  try { cm = JSON.parse((await cacheFile(root, options.coinMetricsManifest ?? "coinmetrics/manifest.json")).toString("utf8")) as CoinMetricsManifest; }
  catch (error) { if (!options.coinMetricsManifest && (error as NodeJS.ErrnoException).code === "ENOENT") return receipts; throw error; }
  if (cm.schema !== 1 || cm.provider !== "CoinMetrics") throw Error("daily_raw_archive_coinmetrics_manifest");
  for (const receipt of [...cm.proofs.map(p => p.receipt), ...cm.histories.flatMap(h => h.pages)] as CoinMetricsReceipt[]) {
    const original = await cacheFile(cmRoot, receipt.file);
    if (contentHash(original) !== receipt.sha256 || !receipt.requestedAt) throw Error("daily_raw_archive_original_hash_mismatch");
    receipts.push(normalizeDailyRawArchiveReceipt({ url: receipt.url, requestedAt: receipt.requestedAt, observedAt: receipt.observedAt,
      sha256: receipt.sha256, status: receipt.status, headers: receipt.headers ?? {}, body: new TextDecoder("utf-8", { fatal: true }).decode(original) }));
  }
  return receipts;
}

/** Group equal URL/body witnesses together because archive lookup keys are URL + body hash. */
export function packDailyRawArchiveReceipts(input: SourceReceipt[], maxBytes = DAILY_RAW_ARCHIVE_MAX_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > DAILY_RAW_ARCHIVE_MAX_BYTES) throw Error("daily_raw_archive_bundle_limit");
  const unique = new Map<string, SourceReceipt>();
  for (const value of input) {
    const receipt = normalizeDailyRawArchiveReceipt(value), key = csvKey(receipt), previous = unique.get(key);
    if (!previous || JSON.stringify(receipt) < JSON.stringify(previous)) unique.set(key, receipt);
  }
  const groups = new Map<string, SourceReceipt[]>();
  for (const receipt of [...unique.values()].sort((a, b) => a.url.localeCompare(b.url) || a.sha256.localeCompare(b.sha256) || a.observedAt.localeCompare(b.observedAt))) {
    const key = `${receipt.url}|${receipt.sha256}`; groups.set(key, [...groups.get(key) ?? [], receipt]);
  }
  const prefix = `{"schema":1,"metadata":{"attribution":${JSON.stringify(DAILY_RAW_ARCHIVE_ATTRIBUTION)}},"receipts":[`, suffix = "]}";
  const base = Buffer.byteLength(prefix + suffix), result: { bundle: DailyRawArchiveBundle; bytes: Buffer }[] = [];
  let current: SourceReceipt[] = [], parts: string[] = [], length = base;
  const finish = () => {
    if (!current.length) return;
    const original = Buffer.from(prefix + parts.join(",") + suffix), bytes = gzipSync(original, { level: 9 }), sha256 = contentHash(bytes);
    result.push({ bundle: { file: `daily-raw-sources-${sha256}.json.gz`, sha256, uncompressedSha256: contentHash(original), bytes: bytes.length, uncompressedBytes: original.length,
      receipts: current.map(({ url, observedAt, sha256: digest }) => ({ url, observedAt, sha256: digest })) }, bytes });
    current = []; parts = []; length = base;
  };
  for (const group of groups.values()) {
    const serialized = group.map(r => JSON.stringify(r)), size = serialized.reduce((sum, s) => sum + Buffer.byteLength(s), 0) + Math.max(0, group.length - 1);
    if (base + size > maxBytes) throw Error("daily_raw_archive_original_exceeds_bundle_limit");
    if (length + size + Number(parts.length > 0) > maxBytes) finish();
    length += size + Number(parts.length > 0); current.push(...group); parts.push(...serialized);
  }
  finish();
  return result;
}

export function assertDailyRawArchivePlan(plan: DailyRawArchivePlan) {
  if (plan.schema !== 1 || plan.repository !== DAILY_RAW_ARCHIVE_REPOSITORY || !/^daily-raw-[a-zA-Z0-9-]+$/.test(plan.tag) || !/^[a-f0-9]{40}$/.test(plan.target) || !plan.bundles.length) throw Error("daily_raw_archive_plan");
  const keys = new Map<string, string>();
  const files = new Set<string>();
  for (const bundle of plan.bundles) {
    if (files.has(bundle.file) || bundle.file !== `daily-raw-sources-${bundle.sha256}.json.gz` || !/^[a-f0-9]{64}$/.test(bundle.sha256) || !/^[a-f0-9]{64}$/.test(bundle.uncompressedSha256)
      || !Number.isInteger(bundle.uncompressedBytes) || bundle.uncompressedBytes < 1 || bundle.uncompressedBytes > DAILY_RAW_ARCHIVE_MAX_BYTES || !Number.isInteger(bundle.bytes) || bundle.bytes < 1 || !bundle.receipts.length) throw Error("daily_raw_archive_bundle_metadata");
    files.add(bundle.file);
    for (const receipt of bundle.receipts) {
      assertDailyRawPublicSourceUrl(receipt.url);
      if (!/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isFinite(Date.parse(receipt.observedAt))) throw Error("daily_raw_archive_witness_metadata");
      const key = `${receipt.url}|${receipt.sha256}`;
      if (keys.has(key) && keys.get(key) !== bundle.file) throw Error("daily_raw_archive_split_witness_group");
      keys.set(key, bundle.file);
    }
  }
}

export const dailyRawArchiveUrl = (plan: DailyRawArchivePlan, file: string) => `https://github.com/${plan.repository}/releases/download/${plan.tag}/${file}`;
/** Follow only known public GitHub asset hosts, validating redirects before issuing each request. */
export async function readbackDailyRawArchive(url: string, expectedHash: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw Error("daily_raw_archive_readback_digest");
  const start = new URL(url);
  if (start.origin !== "https://github.com" || start.username || start.password || start.search || start.hash || !new RegExp(`^/${DAILY_RAW_ARCHIVE_REPOSITORY}/releases/download/daily-raw-[a-zA-Z0-9-]+/daily-raw-sources-${expectedHash}\\.json\\.gz$`).test(start.pathname)) throw Error("daily_raw_archive_readback_url");
  let next = start.href;
  for (let attempt = 0; attempt < 6; attempt++) {
    const target = new URL(next);
    if (target.protocol !== "https:" || target.username || target.password || target.port || target.hash || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(target.hostname)
      || target.hostname === "github.com" && (target.pathname !== start.pathname || target.search)) throw Error("daily_raw_archive_redirect_host");
    const response = await fetcher(next, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location) throw Error("daily_raw_archive_redirect_missing"); next = new URL(location, next).href; continue;
    }
    if (!response.ok) throw Error("daily_raw_archive_readback_unavailable");
    const reader = response.body?.getReader(), parts: Uint8Array[] = []; let size = 0;
    if (!reader) throw Error("daily_raw_archive_readback_empty");
    try {
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > DAILY_RAW_ARCHIVE_MAX_BYTES + 1_000_000) throw Error("daily_raw_archive_readback_size"); parts.push(part.value); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = Buffer.concat(parts, size);
    if (contentHash(bytes) !== expectedHash) throw Error("daily_raw_archive_readback_hash_mismatch");
    return bytes;
  }
  throw Error("daily_raw_archive_redirect_limit");
}

export interface VerifiedDailyRawArchive { manifest: DailyRawArchiveManifest; witnesses: Set<string> }
export function emptyDailyRawArchiveManifest(tag: string, target: string, now = new Date()): DailyRawArchiveManifest {
  if (!/^daily-raw-[a-zA-Z0-9-]+$/.test(tag) || !/^[a-f0-9]{40}$/.test(target)) throw Error("daily_raw_archive_empty_manifest");
  return { schema: 1, receipts: [], metadata: { repository: DAILY_RAW_ARCHIVE_REPOSITORY, tag, target, verifiedAt: now.toISOString(), attribution: DAILY_RAW_ARCHIVE_ATTRIBUTION, bundles: [] } };
}
/** Legacy manifests omit observation times. Recover them only from hash-verified public originals. */
export async function verifyPreviousDailyRawArchive(input: DailyRawArchiveManifest, fetcher: typeof fetch = fetch): Promise<VerifiedDailyRawArchive> {
  const metadata = input.metadata;
  if (input.schema !== 1 || !Array.isArray(input.receipts) || !metadata || metadata.repository !== DAILY_RAW_ARCHIVE_REPOSITORY
    || !/^daily-raw-[a-zA-Z0-9-]+$/.test(metadata.tag) || !/^[a-f0-9]{40}$/.test(metadata.target) || !Number.isFinite(Date.parse(metadata.verifiedAt))
    || JSON.stringify(metadata.attribution) !== JSON.stringify(DAILY_RAW_ARCHIVE_ATTRIBUTION) || !Array.isArray(metadata.bundles)) throw Error("daily_raw_archive_previous_manifest");
  const bundles = new Map<string, Map<string, Witness>>();
  for (const bundle of metadata.bundles) {
    if (bundles.has(bundle.url) || !Number.isInteger(bundle.uncompressedBytes) || bundle.uncompressedBytes < 1 || bundle.uncompressedBytes > DAILY_RAW_ARCHIVE_MAX_BYTES
      || !Number.isInteger(bundle.receipts) || bundle.receipts < 1) throw Error("daily_raw_archive_previous_bundle_metadata");
    const bytes = await readbackDailyRawArchive(bundle.url, bundle.sha256, fetcher);
    const original = gunzipSync(bytes, { maxOutputLength: DAILY_RAW_ARCHIVE_MAX_BYTES });
    if (original.length !== bundle.uncompressedBytes) throw Error("daily_raw_archive_previous_bundle_metadata");
    const parsed = JSON.parse(original.toString("utf8")) as { schema: number; metadata: { attribution: typeof DAILY_RAW_ARCHIVE_ATTRIBUTION }; receipts: SourceReceipt[] };
    if (parsed.schema !== 1 || JSON.stringify(parsed.metadata?.attribution) !== JSON.stringify(DAILY_RAW_ARCHIVE_ATTRIBUTION)
      || !Array.isArray(parsed.receipts) || parsed.receipts.length !== bundle.receipts) throw Error("daily_raw_archive_previous_bundle_metadata");
    const witnesses = new Map<string, Witness>();
    for (const value of parsed.receipts) {
      const receipt = normalizeDailyRawArchiveReceipt(value);
      witnesses.set(csvKey(receipt), { url: receipt.url, observedAt: receipt.observedAt, sha256: receipt.sha256 });
    }
    bundles.set(bundle.url, witnesses);
  }
  const receipts = new Map<string, DailyRawArchiveManifest["receipts"][number]>();
  for (const entry of input.receipts) {
    assertDailyRawPublicSourceUrl(entry.url);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || entry.observedAt !== undefined && !Number.isFinite(Date.parse(entry.observedAt))) throw Error("daily_raw_archive_previous_witness_metadata");
    const matches = [...bundles.get(entry.archiveUrl)?.values() ?? []].filter(witness => witness.url === entry.url && witness.sha256 === entry.sha256 && (entry.observedAt === undefined || witness.observedAt === entry.observedAt));
    if (!matches.length) throw Error("daily_raw_archive_previous_witness_missing");
    for (const witness of matches) {
      const key = csvKey(witness), previous = receipts.get(key);
      if (previous && previous.archiveUrl !== entry.archiveUrl) throw Error("daily_raw_archive_previous_witness_conflict");
      receipts.set(key, { ...witness, archiveUrl: entry.archiveUrl });
    }
  }
  for (const [url, witnesses] of bundles) for (const key of witnesses.keys()) if (receipts.get(key)?.archiveUrl !== url) throw Error("daily_raw_archive_previous_witness_missing");
  return { witnesses: new Set(receipts.keys()), manifest: { schema: 1, receipts: [...receipts.values()], metadata: { repository: metadata.repository, tag: metadata.tag,
    target: metadata.target, verifiedAt: new Date().toISOString(), attribution: DAILY_RAW_ARCHIVE_ATTRIBUTION, bundles: metadata.bundles.map(({ url, sha256, uncompressedBytes, receipts: count }) => ({ url, sha256, uncompressedBytes, receipts: count })) } } };
}

export function newDailyRawArchiveReceipts(input: SourceReceipt[], previous?: VerifiedDailyRawArchive) {
  return input.map(normalizeDailyRawArchiveReceipt).filter(receipt => !previous?.witnesses.has(csvKey(receipt)));
}

export interface DailyRawArchiveRelease { target: string; notes: string; assets: string[]; draft: boolean; immutable: boolean }
export interface DailyRawArchivePublisher {
  readRelease: () => Promise<DailyRawArchiveRelease | null>; createRelease: () => Promise<void>;
  uploadAssets: (files: string[]) => Promise<void>; verifyAsset: (bundle: DailyRawArchiveBundle) => Promise<void>;
}
/** A failed mutation is resolved by read-only inspection, never blind create/upload retries or clobber. */
export async function publishDailyRawArchive(plan: DailyRawArchivePlan, publisher: DailyRawArchivePublisher, previous?: VerifiedDailyRawArchive): Promise<DailyRawArchiveManifest> {
  assertDailyRawArchivePlan(plan);
  const expected = new Set(plan.bundles.map(b => b.file)), verified = new Set<string>();
  const check = (release: DailyRawArchiveRelease | null) => {
    if (!release) throw Error("daily_raw_archive_release_outcome_unconfirmed");
    if (release.target !== plan.target || release.notes.trim() !== DAILY_RAW_ARCHIVE_NOTES.trim() || release.draft || release.assets.some(name => !expected.has(name))) throw Error("daily_raw_archive_immutable_release_mismatch");
    return release;
  };
  let release = await publisher.readRelease();
  if (!release) {
    try { await publisher.createRelease(); } catch { /* Inspect a potentially completed external write before proceeding. */ }
    release = check(await publisher.readRelease());
  } else release = check(release);
  for (const bundle of plan.bundles.filter(b => release!.assets.includes(b.file))) { await publisher.verifyAsset(bundle); verified.add(bundle.file); }
  const missing = plan.bundles.filter(b => !release!.assets.includes(b.file));
  if (missing.length) {
    if (release.immutable) throw Error("daily_raw_archive_immutable_release_missing_asset");
    try { await publisher.uploadAssets(missing.map(b => b.file)); } catch { /* Resolve uncertain upload state without overwriting any asset. */ }
    release = check(await publisher.readRelease());
    if (plan.bundles.some(b => !release!.assets.includes(b.file))) throw Error("daily_raw_archive_upload_outcome_unconfirmed");
  }
  for (const bundle of plan.bundles.filter(b => !verified.has(b.file))) await publisher.verifyAsset(bundle);
  const lookup = new Map(previous?.manifest.receipts.map(receipt => [csvKey(receipt as Witness), receipt]));
  for (const bundle of plan.bundles) for (const receipt of bundle.receipts) if (!lookup.has(csvKey(receipt))) lookup.set(csvKey(receipt), { ...receipt, archiveUrl: dailyRawArchiveUrl(plan, bundle.file) });
  return { schema: 1, receipts: [...lookup.values()], metadata: { repository: plan.repository, tag: plan.tag, target: plan.target, verifiedAt: new Date().toISOString(), attribution: DAILY_RAW_ARCHIVE_ATTRIBUTION,
    bundles: [...previous?.manifest.metadata.bundles ?? [], ...plan.bundles.map(b => ({ url: dailyRawArchiveUrl(plan, b.file), sha256: b.sha256, uncompressedBytes: b.uncompressedBytes, receipts: b.receipts.length }))] } };
}
