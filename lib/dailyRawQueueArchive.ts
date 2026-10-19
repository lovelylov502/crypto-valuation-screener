import { contentHash } from "./sourceBundle";
import { assertDailyRawQueue, type DailyRawQueueState } from "./dailyRawQueue";
import { assertDailyRawPublicSourceUrl, DAILY_RAW_ARCHIVE_ATTRIBUTION, DAILY_RAW_ARCHIVE_REPOSITORY, type DailyRawArchiveManifest } from "./dailyRawArchive";

export const DAILY_RAW_QUEUE_PREFIX = "daily-raw-queue-";
export const DAILY_RAW_QUEUE_MAX_BYTES = 20_000_000;
const tagPattern = /^daily-raw-queue-[A-Za-z0-9-]+$/;
const hashPattern = /^[a-f0-9]{64}$/;
const archivePattern = /^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/daily-raw-[A-Za-z0-9-]+\/daily-raw-sources-[a-f0-9]{64}\.json\.gz$/;
export interface DailyRawQueueRef { tag: string; sha256: string }
export interface DailyRawQueueRelease { tag: string; target: string; notes: string; assets: string[]; assetHashes: Record<string, string>; draft: boolean; immutable: boolean; publishedAt: string | null; id: number }
interface UnarchivedReceipt { geckoId: string; sha256: string; observedAt: string; reason: "original_not_durable_requires_refetch" }
export interface DailyRawQueueEnvelope { schema: 1; repository: string; tag: string; target: string; previous: DailyRawQueueRef | null; state: DailyRawQueueState; archiveManifest?: DailyRawArchiveManifest; unarchivedReceipts?: UnarchivedReceipt[] }
export interface DailyRawQueueArchive { envelope: DailyRawQueueEnvelope; ref: DailyRawQueueRef; file: string; bytes: Buffer; notes: string }
const sameRef = (a: DailyRawQueueRef | null, b: DailyRawQueueRef | null) => a?.tag === b?.tag && a?.sha256 === b?.sha256;
function assertRef(ref: DailyRawQueueRef) { if (!tagPattern.test(ref.tag) || !hashPattern.test(ref.sha256)) throw Error("daily_raw_queue_archive_reference"); }
const fileFor = (hash: string) => `daily-raw-queue-${hash}.json`;
const stamp = (value: string | null) => value === null || typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

/** Reconstruct only portable fields. Local files and unrelated cache metadata never enter a release. */
export function portableDailyRawQueue(input: DailyRawQueueState): DailyRawQueueState {
  assertDailyRawQueue(input);
  if (![input.updatedAt, input.providerRetryAt].every(stamp)) throw Error("daily_raw_queue_archive_timestamp");
  if (input.feesProviderRetryAt !== undefined && !stamp(input.feesProviderRetryAt)) throw Error("daily_raw_queue_archive_fees_timestamp");
  const state: DailyRawQueueState = { schema: 1, targetDay: input.targetDay, updatedAt: input.updatedAt, providerRetryAt: input.providerRetryAt,
    ...(input.feesProviderRetryAt !== undefined ? { feesProviderRetryAt: input.feesProviderRetryAt } : {}),
    entries: Object.fromEntries(Object.entries(input.entries).sort(([a], [b]) => a.localeCompare(b)).map(([id, entry]) => {
      if (!Number.isSafeInteger(entry.priority) || entry.priority < 0 || entry.priority > 3 || ![entry.lastAttemptAt, entry.retryAt].every(stamp)) throw Error("daily_raw_queue_archive_entry");
      const pending = entry.pending;
      if (pending && (!pending.archiveVerified || !pending.archiveUrl || !archivePattern.test(pending.archiveUrl) || !stamp(pending.observedAt))) throw Error("daily_raw_queue_archive_pending_not_archived");
      return [id, { geckoId: id, priority: entry.priority, bindings: entry.bindings.map(binding => {
        if (!/^[A-Za-z0-9][A-Za-z0-9_.()%+#-]*$/.test(binding.slug)) throw Error("daily_raw_queue_archive_slug");
        return { slug: binding.slug, identity: binding.identity, active: binding.active, fullImported: binding.fullImported, closedThrough: binding.closedThrough };
      }), lastAttemptAt: entry.lastAttemptAt, retryAt: entry.retryAt,
      pending: pending ? { url: pending.url, observedAt: pending.observedAt, sha256: pending.sha256, firstDay: pending.firstDay, availableThrough: pending.availableThrough, archiveUrl: pending.archiveUrl, archiveVerified: true } : null,
      ...(entry.lastImportedSha256 ? { lastImportedSha256: entry.lastImportedSha256 } : {}) }];
    })) };
  assertDailyRawQueue(state);
  return state;
}

/** Explicit archival-failure fallback: preserve holds and DB progress, declare that unarchived bytes need refetching. */
export function retryOnlyDailyRawQueue(input: DailyRawQueueState) {
  assertDailyRawQueue(input);
  const state = structuredClone(input), unarchivedReceipts: UnarchivedReceipt[] = [];
  for (const entry of Object.values(state.entries)) if (entry.pending && (!entry.pending.archiveVerified || !entry.pending.archiveUrl)) {
    unarchivedReceipts.push({ geckoId: entry.geckoId, sha256: entry.pending.sha256, observedAt: entry.pending.observedAt, reason: "original_not_durable_requires_refetch" });
    entry.pending = null;
  }
  return { state: portableDailyRawQueue(state), unarchivedReceipts };
}

function portableManifest(input: DailyRawArchiveManifest): DailyRawArchiveManifest {
  const meta = input.metadata;
  if (input.schema !== 1 || !Array.isArray(input.receipts) || !meta || meta.repository !== DAILY_RAW_ARCHIVE_REPOSITORY || !/^daily-raw-[A-Za-z0-9-]+$/.test(meta.tag)
    || !/^[a-f0-9]{40}$/.test(meta.target) || !stamp(meta.verifiedAt) || !Array.isArray(meta.bundles)) throw Error("daily_raw_queue_archive_manifest");
  return { schema: 1, receipts: input.receipts.map(receipt => {
    assertDailyRawPublicSourceUrl(receipt.url);
    if (!hashPattern.test(receipt.sha256) || !archivePattern.test(receipt.archiveUrl) || receipt.observedAt !== undefined && !stamp(receipt.observedAt)) throw Error("daily_raw_queue_archive_manifest_receipt");
    return { url: receipt.url, sha256: receipt.sha256, archiveUrl: receipt.archiveUrl, ...(receipt.observedAt ? { observedAt: receipt.observedAt } : {}) };
  }), metadata: { repository: DAILY_RAW_ARCHIVE_REPOSITORY, tag: meta.tag, target: meta.target, verifiedAt: meta.verifiedAt, attribution: DAILY_RAW_ARCHIVE_ATTRIBUTION,
    bundles: meta.bundles.map(bundle => {
      if (!archivePattern.test(bundle.url) || !hashPattern.test(bundle.sha256) || !bundle.url.endsWith(`-${bundle.sha256}.json.gz`) || !Number.isSafeInteger(bundle.uncompressedBytes) || bundle.uncompressedBytes < 1 || !Number.isSafeInteger(bundle.receipts) || bundle.receipts < 1) throw Error("daily_raw_queue_archive_manifest_bundle");
      return { url: bundle.url, sha256: bundle.sha256, uncompressedBytes: bundle.uncompressedBytes, receipts: bundle.receipts };
    }) } };
}

export function prepareDailyRawQueueArchive(input: DailyRawQueueEnvelope): DailyRawQueueArchive {
  if (input.schema !== 1 || input.repository !== DAILY_RAW_ARCHIVE_REPOSITORY || !tagPattern.test(input.tag) || !/^[a-f0-9]{40}$/.test(input.target)) throw Error("daily_raw_queue_archive_identity");
  if (input.previous) assertRef(input.previous);
  const unarchivedReceipts = input.unarchivedReceipts?.map(receipt => {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(receipt.geckoId) || !hashPattern.test(receipt.sha256) || !stamp(receipt.observedAt) || receipt.reason !== "original_not_durable_requires_refetch") throw Error("daily_raw_queue_archive_retry_diagnostic");
    return { geckoId: receipt.geckoId, sha256: receipt.sha256, observedAt: receipt.observedAt, reason: receipt.reason };
  });
  const envelope: DailyRawQueueEnvelope = { schema: 1, repository: DAILY_RAW_ARCHIVE_REPOSITORY, tag: input.tag, target: input.target,
    previous: input.previous ? { tag: input.previous.tag, sha256: input.previous.sha256 } : null, state: portableDailyRawQueue(input.state),
    ...(input.archiveManifest ? { archiveManifest: portableManifest(input.archiveManifest) } : {}), ...(unarchivedReceipts?.length ? { unarchivedReceipts } : {}) };
  const bytes = Buffer.from(JSON.stringify(envelope));
  if (bytes.length > DAILY_RAW_QUEUE_MAX_BYTES) throw Error("daily_raw_queue_archive_size");
  const sha256 = contentHash(bytes), file = fileFor(sha256), ref = { tag: envelope.tag, sha256 };
  return { envelope, ref, file, bytes, notes: JSON.stringify({ schema: 1, kind: "daily-raw-queue", file, sha256 }) };
}

export function dailyRawQueueReleaseRef(release: DailyRawQueueRelease): DailyRawQueueRef {
  let note: { schema: number; kind: string; file: string; sha256: string };
  try { note = JSON.parse(release.notes); } catch { throw Error("daily_raw_queue_archive_release_note"); }
  const ref = { tag: release.tag, sha256: note.sha256 }; assertRef(ref);
  if (note.schema !== 1 || note.kind !== "daily-raw-queue" || note.file !== fileFor(ref.sha256) || release.draft || !Number.isFinite(Date.parse(release.publishedAt ?? ""))) throw Error("daily_raw_queue_archive_release_note");
  if (release.assets.length !== 1 || release.assets[0] !== note.file) throw Error("daily_raw_queue_archive_release_assets");
  return ref;
}

/** Do not use /releases/latest: economic releases intentionally own that pointer. */
export async function latestDailyRawQueueRelease(page: (number: number) => Promise<DailyRawQueueRelease[]>): Promise<DailyRawQueueRelease | null> {
  let latest: DailyRawQueueRelease | null = null;
  for (let number = 1; ; number++) {
    const batch = await page(number);
    for (const release of batch.filter(release => release.tag.startsWith(DAILY_RAW_QUEUE_PREFIX) && !release.draft)) {
      dailyRawQueueReleaseRef(release);
      if (!latest || Date.parse(release.publishedAt!) > Date.parse(latest.publishedAt!) || release.publishedAt === latest.publishedAt && release.id > latest.id) latest = release;
    }
    if (batch.length < 100) return latest;
  }
}

export async function readDailyRawQueueArchive(ref: DailyRawQueueRef, fetcher: typeof fetch = fetch): Promise<Buffer> {
  assertRef(ref);
  const start = `https://github.com/${DAILY_RAW_ARCHIVE_REPOSITORY}/releases/download/${ref.tag}/${fileFor(ref.sha256)}`;
  let next = start;
  for (let redirects = 0; redirects < 6; redirects++) {
    const url = new URL(next);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname)
      || url.hostname === "github.com" && next !== start) throw Error("daily_raw_queue_archive_redirect");
    const response = await fetcher(next, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location) throw Error("daily_raw_queue_archive_redirect"); next = new URL(location, next).href; continue;
    }
    if (!response.ok || !response.body) throw Error("daily_raw_queue_archive_unavailable");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > DAILY_RAW_QUEUE_MAX_BYTES) throw Error("daily_raw_queue_archive_size"); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => {}); }
    const bytes = Buffer.concat(chunks, size);
    if (contentHash(bytes) !== ref.sha256) throw Error("daily_raw_queue_archive_hash_mismatch");
    return bytes;
  }
  throw Error("daily_raw_queue_archive_redirect");
}

export async function restoreDailyRawQueueArchive(release: DailyRawQueueRelease, fetcher: typeof fetch = fetch): Promise<DailyRawQueueArchive> {
  const ref = dailyRawQueueReleaseRef(release), bytes = await readDailyRawQueueArchive(ref, fetcher);
  const archive = prepareDailyRawQueueArchive(JSON.parse(bytes.toString("utf8")) as DailyRawQueueEnvelope);
  if (!sameRef(archive.ref, ref) || archive.envelope.target !== release.target || !archive.bytes.equals(bytes)) throw Error("daily_raw_queue_archive_envelope_mismatch");
  return archive;
}

export interface DailyRawQueuePublisher {
  latest: () => Promise<DailyRawQueueRef | null>; readRelease: () => Promise<DailyRawQueueRelease | null>;
  createDraft: () => Promise<void>; upload: () => Promise<void>; publish: () => Promise<void>;
  readback: () => Promise<Buffer>;
}
/** Each mutation is attempted once. Its outcome is then inspected; verified assets are never overwritten. */
export async function publishDailyRawQueueArchive(archive: DailyRawQueueArchive, publisher: DailyRawQueuePublisher) {
  const checkParent = async () => {
    const latest = await publisher.latest();
    if (!sameRef(latest, archive.ref) && !sameRef(latest, archive.envelope.previous)) throw Error("daily_raw_queue_archive_stale_parent");
  };
  const checkRelease = (release: DailyRawQueueRelease | null) => {
    if (!release) throw Error("daily_raw_queue_archive_outcome_unconfirmed");
    if (release.tag !== archive.ref.tag || release.target !== archive.envelope.target || release.notes !== archive.notes || release.assets.some(file => file !== archive.file || release.assetHashes[file] !== archive.ref.sha256)) throw Error("daily_raw_queue_archive_existing_mismatch");
    return release;
  };
  await checkParent();
  let release = await publisher.readRelease();
  if (!release) { try { await publisher.createDraft(); } catch { /* Inspect an unknown outcome; never blindly repeat it. */ } release = checkRelease(await publisher.readRelease()); }
  else release = checkRelease(release);
  if (!release.assets.includes(archive.file)) {
    if (!release.draft || release.immutable) throw Error("daily_raw_queue_archive_published_missing_asset");
    try { await publisher.upload(); } catch { /* Inspect without clobbering. */ }
    release = checkRelease(await publisher.readRelease());
    if (!release.assets.includes(archive.file)) throw Error("daily_raw_queue_archive_outcome_unconfirmed");
  }
  await checkParent();
  if (release.draft) { try { await publisher.publish(); } catch { /* Inspect the published state before declaring success. */ } release = checkRelease(await publisher.readRelease()); }
  if (release.draft) throw Error("daily_raw_queue_archive_outcome_unconfirmed");
  dailyRawQueueReleaseRef(release);
  if (contentHash(await publisher.readback()) !== archive.ref.sha256) throw Error("daily_raw_queue_archive_hash_mismatch");
  if (!sameRef(await publisher.latest(), archive.ref)) throw Error("daily_raw_queue_archive_latest_mismatch");
  return archive.ref;
}
