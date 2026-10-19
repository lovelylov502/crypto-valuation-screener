import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { createClient, type Client } from "@libsql/client";
import { historyIdentity, shiftDay, utcDay } from "../lib/dailyHistory";
import { connectHistory, historyReadBatch, HISTORY_WRITE_LIMIT } from "../lib/historyDatabase";
import { historyRetrySeconds, loadHistoryInputs } from "../lib/historyCollection";
import { getDailyRawSources, readDailyRaw, upsertDailyRaw, type DailyRawAsset, type DailyRawStoredPoint } from "../lib/dailyRawDatabase";
import { acquireDailyRawCsv, archiveDailyRawOriginal, COINGECKO_CSV_CLOSE_SEMANTICS, parseDailyRawCsv, verifyDailyRawArchives, type DailyRawArchiveVerification, type DailyRawCsvFile } from "../lib/dailyRawCollection";
import { assertDailyRawQueue, planDailyRawQueue, reconcileDailyRawQueue, recordDailyRawAcquired, recordDailyRawArchived, recordDailyRawAttempt, recordDailyRawDeferred, recordDailyRawImported, type DailyRawQueueCoin, type DailyRawQueueReceipt, type DailyRawQueueState } from "../lib/dailyRawQueue";
import { contentHash, objectHash, type SourceReceipt } from "../lib/sourceBundle";

export interface DailyRawSelection { schema: 1; assets: { slug: string; identity: string; from?: string; to?: string; csv?: { from?: string; to: string } }[] }
export const DAILY_RAW_FINANCIAL_MAX_PROOF = "financial-max-copy-v1";
interface KnownAssets { schema: 1; proofVersion?: string; observedAt?: string; remainingEstimatedWrites?: number; assets: { slug: string; identity: string }[] }
const json = async <T>(path: string): Promise<T | null> => {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null; throw error; }
};
const atomic = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, path);
};
const key = (asset: { slug: string; identity: string }) => objectHash([asset.slug, asset.identity]);
const missing = (error: unknown) => error && typeof error === "object" && "code" in error && error.code === "ENOENT";
const archiveUrl = (url: string) => /^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/[^/]+\/[^/?#]+$/.test(url);
const localPath = (cache: string, file: string) => {
  const path = resolve(cache, file), name = relative(cache, path);
  if (isAbsolute(file) || name.startsWith("..") || isAbsolute(name)) throw Error("daily_raw_queue_file_outside_cache");
  return path;
};
async function outsideGit(cache: string) {
  await mkdir(cache, { recursive: true }); const actual = await realpath(cache);
  if (spawnSync("git", ["-C", actual, "rev-parse", "--show-toplevel"], { windowsHide: true, encoding: "utf8" }).status === 0) throw Error("daily_raw_queue_cache_must_be_outside_git");
  return actual;
}

/** Registry existence and a completed patch cannot prove that an older MAX copy
 * finished. Require an explicit full-stage attestation bound to its sealed copy. */
export async function establishedDailyRawFinancialAssets(db: Client): Promise<DailyRawAsset[]> {
  const prefix = `${DAILY_RAW_FINANCIAL_MAX_PROOF}:`;
  const [registry, proofs] = await historyReadBatch(db, ["SELECT slug,identity FROM daily_raw_assets", {
    sql: `SELECT p.checkpoint_key FROM daily_raw_checkpoints p
      JOIN daily_raw_checkpoints c ON c.run_id=p.run_id AND c.checkpoint_key='copy:' || substr(p.checkpoint_key,?) AND c.status='complete'
      JOIN daily_raw_checkpoints s ON s.run_id=p.run_id AND s.checkpoint_key='copy:staging' AND s.cursor=p.cursor
      WHERE p.checkpoint_key LIKE ? AND p.status='complete' AND length(p.cursor)=64`, args: [prefix.length + 1, `${prefix}%`],
  }]);
  const complete = new Set(proofs.rows.map(row => String(row.checkpoint_key).slice(prefix.length)));
  return registry.rows.map(row => ({ slug: String(row.slug), identity: String(row.identity) })).filter(asset => complete.has(`${asset.slug}:${asset.identity}`));
}

/** Called only after the copier commits an asset. A partial local stage or a
 * later bounded patch never establishes its full financial history. */
export async function certifyDailyRawFinancialMax(staged: Client, committed: Client, options: { asset: DailyRawAsset; runId: string; stagingId: string }) {
  const suffix = `${options.asset.slug}:${options.asset.identity}`;
  const local = await staged.execute({ sql: "SELECT cursor FROM daily_raw_checkpoints WHERE checkpoint_key=? AND status='complete'", args: [`stage:${suffix}`] });
  if (!local.rows.some(row => {
    try { return (JSON.parse(String(row.cursor)) as { financialMaxProof?: string }).financialMaxProof === DAILY_RAW_FINANCIAL_MAX_PROOF; } catch { return false; }
  })) return null;
  const checkpoints = (await historyReadBatch(committed, [{ sql: "SELECT checkpoint_key,cursor,status FROM daily_raw_checkpoints WHERE run_id=? AND checkpoint_key IN (?,?)", args: [options.runId, "copy:staging", `copy:${suffix}`] }]))[0].rows;
  if (!/^[a-f0-9]{64}$/i.test(options.stagingId) || !checkpoints.some(row => row.checkpoint_key === "copy:staging" && row.cursor === options.stagingId)) throw Error("daily_raw_financial_max_staging_not_committed");
  if (!checkpoints.some(row => row.checkpoint_key === `copy:${suffix}` && row.status === "complete")) return null;
  return upsertDailyRaw(committed, { runId: options.runId, asset: options.asset, sources: [], points: [], checkpoint: { key: `${DAILY_RAW_FINANCIAL_MAX_PROOF}:${suffix}`, cursor: options.stagingId, status: "complete" } });
}

/** One public Fees request per preparation. A failed observation is retained
 * outside the supplemental inputs; existing validated receipts remain intact. */
export async function prepareDailyRawFeesOverview(cache: string, options: { state?: DailyRawQueueState | null; now?: () => number; fetcher?: typeof fetch } = {}) {
  const now = options.now ?? Date.now, url = "https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false";
  const report = { schema: 1, status: "unavailable", observedAt: new Date(now()).toISOString(), url, sha256: null as string | null, originalPath: null as string | null, receiptPath: null as string | null, reason: "", retryAt: null as string | null };
  const directory = join(cache, "supplemental"); await mkdir(directory, { recursive: true });
  if (options.state?.feesProviderRetryAt && Date.parse(options.state.feesProviderRetryAt) > now()) {
    report.status = "provider-paused"; report.retryAt = options.state.feesProviderRetryAt; report.reason = "daily_raw_fees_overview_provider_hold";
    await atomic(join(cache, "prepare-fees-report.json"), report); return report;
  }
  const requestedAt = new Date(now()).toISOString(); let response: Response, body: string;
  try { response = await (options.fetcher ?? fetch)(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(45_000) }); body = await response.text(); }
  catch { report.reason = "daily_raw_fees_overview_request_failed"; await atomic(join(cache, "prepare-fees-report.json"), report); return report; }
  const receipt: SourceReceipt = { url, requestedAt, observedAt: new Date(now()).toISOString(), status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "", "retry-after": response.headers.get("retry-after") ?? "" }, body, sha256: contentHash(body) };
  const packed = gzipSync(JSON.stringify(receipt)), original = await archiveDailyRawOriginal(cache, packed, "receipt.json.gz");
  report.observedAt = receipt.observedAt; report.sha256 = receipt.sha256; report.originalPath = relative(cache, original.path).replaceAll("\\", "/");
  if (!response.ok) {
    report.reason = `daily_raw_fees_overview_http_${response.status}`;
    if ([401, 403, 429].includes(response.status)) {
      report.retryAt = new Date(now() + historyRetrySeconds(response.status, response.headers.get("retry-after"), now()) * 1000).toISOString();
      if (options.state) options.state.feesProviderRetryAt = report.retryAt;
    }
  } else {
    let value: { protocols?: unknown[]; totalDataChartBreakdown?: unknown[] } | null = null; try { value = JSON.parse(body) as { protocols?: unknown[]; totalDataChartBreakdown?: unknown[] }; } catch {}
    const finite = (amount: unknown) => typeof amount === "number" && Number.isFinite(amount);
    if (!Array.isArray(value?.protocols) || !value.protocols.length || !Array.isArray(value.totalDataChartBreakdown) || !value.totalDataChartBreakdown.some(point => Array.isArray(point) && finite(point[0]) && point[0] % 86400 === 0 && point[1] && typeof point[1] === "object" && !Array.isArray(point[1]) && Object.values(point[1]).some(finite))) report.reason = "daily_raw_fees_overview_schema_unavailable";
    else {
      const path = join(directory, `fees-${original.sha256}.json.gz`);
      try { await writeFile(path, packed, { flag: "wx" }); } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST") || contentHash(await readFile(path)) !== original.sha256) throw error;
      }
      report.status = "ready"; report.receiptPath = relative(cache, path).replaceAll("\\", "/");
      if (options.state) options.state.feesProviderRetryAt = null;
    }
  }
  await atomic(join(cache, "prepare-fees-report.json"), report); return report;
}

/** A runner may discard every local file: exact archived receipt membership
 * restores the original without making another request to the provider. */
export async function restoreDailyRawPending(cache: string, id: string, receipt: DailyRawQueueReceipt, fetcher: typeof fetch = fetch, downloads = new Map<string, Buffer>()): Promise<DailyRawCsvFile> {
  let bytes: Buffer | null = null, recovered: SourceReceipt | undefined;
  if (receipt.file) try { bytes = await readFile(localPath(cache, receipt.file)); } catch (error) { if (!missing(error)) throw error; }
  if (bytes && contentHash(bytes) !== receipt.sha256) throw Error("daily_raw_queue_original_hash_mismatch");
  if (!bytes) {
    if (!receipt.archiveVerified || !receipt.archiveUrl || !archiveUrl(receipt.archiveUrl)) throw Error("daily_raw_queue_pending_original_unarchived");
    let packed = downloads.get(receipt.archiveUrl);
    if (!packed) {
      const response = await fetcher(receipt.archiveUrl, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok || response.url && !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(new URL(response.url).hostname)) throw Error("daily_raw_queue_archive_unavailable");
      packed = Buffer.from(await response.arrayBuffer()); downloads.set(receipt.archiveUrl, packed);
    }
    if (contentHash(packed) === receipt.sha256) bytes = packed;
    else {
      const parsed = JSON.parse(gunzipSync(packed, { maxOutputLength: 500_000_000 }).toString()) as { receipts?: SourceReceipt[] } & Partial<SourceReceipt>;
      const originals = parsed.receipts ?? (typeof parsed.body === "string" ? [parsed as SourceReceipt] : []);
      const original = originals.find(item => item.url === receipt.url && item.observedAt === receipt.observedAt && item.sha256 === receipt.sha256 && contentHash(item.body) === receipt.sha256);
      if (!original) throw Error("daily_raw_queue_archived_receipt_missing");
      if (!Number.isFinite(Date.parse(original.requestedAt)) || Date.parse(original.requestedAt) > Date.parse(original.observedAt) || original.status !== 200) throw Error("daily_raw_queue_archived_request_metadata_invalid");
      bytes = Buffer.from(original.body); recovered = original;
    }
  }
  const saved = await archiveDailyRawOriginal(cache, bytes, "csv"); receipt.file = relative(cache, saved.path).replaceAll("\\", "/");
  if (recovered) {
    const { body: _body, ...metadata } = recovered;
    await archiveDailyRawOriginal(cache, Buffer.from(JSON.stringify({ ...metadata, geckoId: id, path: saved.path })), "receipt.json");
  }
  const file: DailyRawCsvFile = { geckoId: id, path: receipt.file, url: receipt.url, sha256: receipt.sha256, observedAt: receipt.observedAt, firstDay: receipt.firstDay, availableThrough: receipt.availableThrough, timestampSemantics: COINGECKO_CSV_CLOSE_SEMANTICS, ...(receipt.archiveUrl ? { archiveUrl: receipt.archiveUrl } : {}) };
  const points = parseDailyRawCsv(bytes.toString(), file, { slug: id, identity: `gecko:${id}` }).points.filter(point => [point.price, point.mcap].some(value => value?.state === "complete"));
  if (points[0]?.day !== receipt.firstDay || points.at(-1)?.day !== receipt.availableThrough) throw Error("daily_raw_queue_coverage_mismatch");
  return file;
}

export async function markDailyRawQueueArchives(state: DailyRawQueueState, cache: string, manifestPath: string, fetcher: typeof fetch = fetch) {
  const manifest = await json<{ schema: number; receipts: { url?: string; observedAt?: string; sha256: string; archiveUrl: string }[] }>(manifestPath);
  if (manifest?.schema !== 1 || !Array.isArray(manifest.receipts)) throw Error("daily_raw_queue_archive_manifest");
  const downloads = new Map<string, Buffer>(), verified = new Map<string, DailyRawArchiveVerification>(); let archived = 0;
  for (const entry of Object.values(state.entries)) if (entry.pending) {
    const pending = entry.pending;
    const witness = manifest.receipts.find(item => item.url === pending.url && item.observedAt === pending.observedAt && item.sha256 === pending.sha256)
      ?? manifest.receipts.find(item => item.observedAt === undefined && (!item.url || item.url === pending.url) && item.sha256 === pending.sha256);
    if (!witness) continue;
    const restored = { ...pending, archiveUrl: witness.archiveUrl, archiveVerified: true };
    const file = await restoreDailyRawPending(cache, entry.geckoId, restored, fetcher, downloads), points = parseDailyRawCsv(await readFile(localPath(cache, file.path), "utf8"), { ...file, archiveUrl: witness.archiveUrl }, { slug: entry.geckoId, identity: `gecko:${entry.geckoId}` });
    await verifyDailyRawArchives(points.sources, fetcher, verified); recordDailyRawArchived(state, entry.geckoId, witness.archiveUrl); archived++;
    pending.file = restored.file;
  }
  return archived;
}

/** The remote copy checkpoint proves the sealed local asset was fully committed.
 * Source membership ties that asset to this exact pending CSV observation. */
export async function acknowledgeDailyRawQueue(state: DailyRawQueueState, staged: Client, committed: Client, options: { runId: string; stagingId: string; cache: string; fetcher?: typeof fetch }) {
  const rows = (await historyReadBatch(committed, [{ sql: "SELECT checkpoint_key,cursor,status FROM daily_raw_checkpoints WHERE run_id=?", args: [options.runId] }]))[0].rows;
  const checkpoints = new Map(rows.map(row => [String(row.checkpoint_key), { cursor: String(row.cursor), status: String(row.status) }]));
  if (checkpoints.get("copy:staging")?.cursor !== options.stagingId) throw Error("daily_raw_queue_staging_not_committed");
  const verified = new Map<string, DailyRawArchiveVerification>(), downloads = new Map<string, Buffer>(), jobs = planDailyRawQueue(state, { maxRequests: 0 }); let completed = 0;
  for (const entry of Object.values(state.entries)) if (entry.pending) {
    const pending = entry.pending, slugs: string[] = [];
    for (const binding of entry.bindings.filter(binding => binding.active)) {
      if (checkpoints.get(`copy:${binding.slug}:${binding.identity}`)?.status !== "complete") continue;
      const sources = (await getDailyRawSources(staged, binding)).filter(source => ["price", "mcap"].includes(source.metric) && source.provider === "CoinGecko" && source.url === pending.url && source.observedAt === pending.observedAt && source.sha256 === pending.sha256 && source.basis.includes("coingecko_web_csv"));
      if (!sources.length || !sources[0].archiveUrl) continue;
      await verifyDailyRawArchives(sources, options.fetcher ?? fetch, verified);
      {
        const receipt = { ...pending, archiveUrl: sources[0].archiveUrl, archiveVerified: true }, file = await restoreDailyRawPending(options.cache, entry.geckoId, receipt, options.fetcher, downloads);
        const job = jobs.find(job => job.geckoId === entry.geckoId), expected = parseDailyRawCsv(await readFile(localPath(options.cache, file.path), "utf8"), file, binding).points.filter(point => (!job?.from || point.day >= job.from) && point.day <= pending.availableThrough);
        const actual = new Map<string, DailyRawStoredPoint>();
        let after: string | undefined;
        do {
          const page = await readDailyRaw(staged, { asset: binding, from: job?.from ?? pending.firstDay, to: pending.availableThrough, after, limit: 1000 });
          for (const point of page?.points ?? []) actual.set(point.day, point);
          after = page?.nextCursor ?? undefined;
        } while (after);
        const same = expected.length && expected.every(point => ["price", "mcap"].every(metric => {
          const claim = point[metric as "price" | "mcap"], stored = actual.get(point.day)?.[metric as "price" | "mcap"];
          return !claim || claim.state === "missing" && claim.value === null || !!stored && claim.value === stored.value && (claim.at ?? null) === stored.at;
        }));
        if (!same) continue;
      }
      recordDailyRawArchived(state, entry.geckoId, sources[0].archiveUrl); slugs.push(binding.slug);
    }
    if (!slugs.length) continue;
    recordDailyRawImported(state, entry.geckoId, { throughDay: pending.availableThrough, mode: entry.bindings.some(binding => binding.active && !binding.fullImported) ? "full" : "patch", slugs }); completed += slugs.length;
  }
  return completed;
}

export async function continueDailyRaw(options: { cache: string; universe: string; state?: string; knownAssets?: string; maxRequests?: number; timeBudgetSeconds?: number; requestIntervalMs?: number; remainingEstimatedWrites?: number; maintenanceReserve?: number; now?: () => number; fetcher?: typeof fetch }) {
  const cache = await outsideGit(resolve(options.cache)), now = options.now ?? Date.now, started = now(), targetDay = shiftDay(utcDay(started), -1), statePath = options.state ?? join(cache, "daily-raw-queue.json");
  const input = await json<DailyRawQueueCoin[] | { coins: DailyRawQueueCoin[] }>(options.universe), coins = Array.isArray(input) ? input : input?.coins;
  if (!Array.isArray(coins)) throw Error("daily_raw_queue_universe_schema");
  const known = options.knownAssets ? await json<KnownAssets>(options.knownAssets) : null;
  if (known && (known.schema !== 1 || !Array.isArray(known.assets))) throw Error("daily_raw_queue_known_assets_schema");
  const remaining = options.remainingEstimatedWrites ?? known?.remainingEstimatedWrites ?? 0, reserve = options.maintenanceReserve ?? 500000, allowFull = remaining > reserve;
  const state = reconcileDailyRawQueue(await json<DailyRawQueueState>(statePath), coins, targetDay, new Date(started));
  const report = { schema: 1, status: "running", startedAt: new Date(started).toISOString(), completedAt: "", targetDay, requests: 0, acquired: 0, restored: 0, archivedPending: 0, pending: 0, selectedAssets: 0, fullAssets: 0, remainingEstimatedWrites: remaining, maintenanceReserve: reserve, recommendedMaxEstimatedWrites: remaining, providerRetryAt: state.providerRetryAt, issues: [] as { geckoId: string; reason: string }[] };
  const maxRequests = options.maxRequests ?? 80, interval = options.requestIntervalMs ?? 2000;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 0 || !Number.isSafeInteger(interval) || interval < 1000 || !Number.isSafeInteger(remaining) || remaining < 0 || !Number.isSafeInteger(reserve) || reserve < 0) throw Error("daily_raw_queue_invalid_limit");
  const hasTime = () => now() - started < (options.timeBudgetSeconds ?? 1800) * 1000;
  const save = () => atomic(statePath, state); await save();
  const files = new Map<string, DailyRawCsvFile>(), downloads = new Map<string, Buffer>(); let lastRequest = 0;
  for (const entry of Object.values(state.entries)) if (entry.pending) try { files.set(entry.geckoId, await restoreDailyRawPending(cache, entry.geckoId, entry.pending, options.fetcher, downloads)); report.restored++; }
  catch { report.issues.push({ geckoId: entry.geckoId, reason: "daily_raw_queue_pending_restore_failed" }); }
  for (const job of planDailyRawQueue(state, { now: new Date(now()), maxRequests, allowFull })) {
    if (job.action !== "acquire" || !hasTime() || report.requests >= maxRequests) continue;
    recordDailyRawAttempt(state, job.geckoId, new Date(now())); await save();
    try {
      const result = await acquireDailyRawCsv(job.geckoId, cache, { now, fetcher: options.fetcher, targetDay: job.mode === "full" ? undefined : targetDay, onRequest: async () => {
        if (!hasTime() || report.requests >= maxRequests) throw Error("daily_raw_queue_request_limit");
        const delay = Math.max(0, interval - (now() - lastRequest)); if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        lastRequest = now(); report.requests++;
      } });
      if (result.file && (result.status === "cached" || result.status === "fetched")) {
        const file = result.file;
        recordDailyRawAcquired(state, job.geckoId, { url: file.url, sha256: file.sha256, observedAt: file.observedAt, file: relative(cache, file.path).replaceAll("\\", "/"), firstDay: file.firstDay!, availableThrough: file.availableThrough! }, new Date(now()));
        if (state.entries[job.geckoId].pending) files.set(job.geckoId, { ...file, path: relative(cache, file.path).replaceAll("\\", "/") }); report.acquired++;
      } else if (result.retryAt) recordDailyRawDeferred(state, job.geckoId, result.retryAt, [401, 403, 429].includes(result.httpStatus ?? 0), new Date(now()));
      if (result.reason) report.issues.push({ geckoId: job.geckoId, reason: result.reason });
    } catch { recordDailyRawDeferred(state, job.geckoId, new Date(now() + 3600_000).toISOString(), false, new Date(now())); report.issues.push({ geckoId: job.geckoId, reason: "daily_raw_queue_asset_acquisition_failed" }); }
    await save();
    if (state.providerRetryAt && Date.parse(state.providerRetryAt) > now()) break;
  }
  const selected = new Map<string, DailyRawSelection["assets"][number]>(), registry = new Set(known?.proofVersion === DAILY_RAW_FINANCIAL_MAX_PROOF ? known.assets.map(key) : []);
  if (known) for (const coin of coins) {
    const identity = historyIdentity({ geckoId: coin.geckoId, cmcId: coin.cmcId ?? null }), eligible = coin.identityStatus === "verified" && identity !== "unlinked" && !coin.capitalExclusionReason;
    const asset = { slug: coin.slug, identity: eligible ? identity : `defillama:${coin.slug}` }, existing = registry.has(key(asset));
    if (existing || allowFull) selected.set(key(asset), { ...asset, ...(existing ? { from: shiftDay(targetDay, -13) } : {}), to: shiftDay(targetDay, 1) });
  }
  for (const job of planDailyRawQueue(state, { now: new Date(now()), maxRequests: 0, allowFull })) if (job.action === "apply_receipt" && files.has(job.geckoId)) for (const asset of job.assets) {
    const old = selected.get(key(asset)), existing = registry.has(key(asset));
    selected.set(key(asset), { ...(old ?? { slug: asset.slug, identity: asset.identity, ...(existing ? { from: shiftDay(targetDay, -13) } : {}), to: shiftDay(targetDay, 1) }), csv: { ...(job.from ? { from: job.from } : {}), to: job.to } });
  }
  report.pending = Object.values(state.entries).filter(entry => entry.pending).length; report.archivedPending = Object.values(state.entries).filter(entry => entry.pending?.archiveVerified).length;
  report.selectedAssets = selected.size; report.fullAssets = [...selected.values()].filter(asset => !asset.from || asset.csv && !asset.csv.from).length; report.providerRetryAt = state.providerRetryAt;
  report.recommendedMaxEstimatedWrites = report.fullAssets ? Math.max(0, remaining - reserve) : remaining;
  report.status = state.providerRetryAt && Date.parse(state.providerRetryAt) > now() ? "provider-paused" : !hasTime() ? "time-paused" : !allowFull && Object.values(state.entries).some(entry => entry.bindings.some(binding => binding.active && !binding.fullImported)) ? "budget-reserve-paused" : report.issues.length ? "partial" : "ready";
  report.completedAt = new Date(now()).toISOString();
  await atomic(join(cache, "queue-csv-manifest.json"), { schema: 1, files: [...files.values()] });
  await atomic(join(cache, "queue-selection.json"), { schema: 1, assets: [...selected.values()] } satisfies DailyRawSelection);
  await save(); await atomic(join(cache, "queue-report.json"), report); return report;
}

async function main() {
  const argv = process.argv.slice(2), arg = (name: string) => { const i = argv.indexOf(name); if (i < 0) return undefined; if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw Error(`Missing ${name}`); return argv[i + 1]; };
  if (argv.includes("--help")) { console.log("Prepare: continue-daily-raw.ts --prepare --cache <outside-Git>\nAcquire: continue-daily-raw.ts --cache <dir> [--universe universe.json] [--known-assets known-assets.json] [--max-requests 200] [--time-budget-seconds 2400] [--request-interval-ms 2000] [--maintenance-reserve 500000]\nAfter original archive publication: add --mark-archives --archive-manifest <verified manifest>.\nAfter sealed stage commit: add --ack-import --database <sealed.sqlite> --import-run-id <stable id>.\nAll modes preserve --state <portable queue.json>, default cache/daily-raw-queue.json. Acquisition emits queue-csv-manifest.json, queue-selection.json and queue-report.json. Acquisition/archival never marks an asset imported."); return; }
  const cache = await outsideGit(resolve(arg("--cache") ?? join(homedir(), ".codex", "cache", "crypto-valuation-screener", "daily-raw"))), statePath = resolve(arg("--state") ?? join(cache, "daily-raw-queue.json"));
  if (argv.includes("--prepare")) {
    const { snapshot, ref } = await loadHistoryInputs(cache), db = connectHistory();
    try {
      const assets = await establishedDailyRawFinancialAssets(db), [budget] = await historyReadBatch(db, [{ sql: "SELECT reserved FROM history_budget WHERE month=?", args: [new Date().toISOString().slice(0, 7)] }]);
      await atomic(join(cache, "reference.json"), ref); await atomic(join(cache, "universe.json"), { coins: snapshot.coins });
      await atomic(join(cache, "known-assets.json"), { schema: 1, proofVersion: DAILY_RAW_FINANCIAL_MAX_PROOF, observedAt: new Date().toISOString(), remainingEstimatedWrites: Math.max(0, HISTORY_WRITE_LIMIT - Number(budget.rows[0]?.reserved ?? 0)), assets });
    } finally { db.close(); }
    const state = await json<DailyRawQueueState>(statePath), fees = await prepareDailyRawFeesOverview(cache, { state });
    if (state) { state.updatedAt = new Date().toISOString(); await atomic(statePath, state); }
    console.log(JSON.stringify({ status: "prepared", snapshot: ref.id, assets: snapshot.coins.length, feesStatus: fees.status, feesReason: fees.reason }));
    return;
  }
  if (argv.includes("--mark-archives") || argv.includes("--ack-import")) {
    const state = await json<DailyRawQueueState>(statePath); if (!state) throw Error("daily_raw_queue_state_missing"); assertDailyRawQueue(state); let completed = 0;
    try {
      if (argv.includes("--mark-archives")) { const manifest = arg("--archive-manifest"); if (!manifest) throw Error("Missing --archive-manifest"); completed = await markDailyRawQueueArchives(state, cache, resolve(manifest)); }
      if (argv.includes("--ack-import")) {
        const database = arg("--database"), runId = arg("--import-run-id"); if (!database || !runId) throw Error("Missing sealed --database or --import-run-id");
        const path = resolve(cache, database), stagingId = contentHash(await readFile(path)), staged = createClient({ url: `file:${path.replaceAll("\\", "/")}` }), committed = connectHistory();
        try { completed = await acknowledgeDailyRawQueue(state, staged, committed, { runId, stagingId, cache }); } finally { staged.close(); committed.close(); }
        if (contentHash(await readFile(path)) !== stagingId) throw Error("daily_raw_queue_staging_changed");
      }
    } finally { await atomic(statePath, state); }
    console.log(JSON.stringify({ status: "checkpointed", completed })); return;
  }
  const number = (name: string) => { const value = arg(name); if (value === undefined) return undefined; const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw Error(`Invalid ${name}`); return n; };
  console.log(JSON.stringify(await continueDailyRaw({ cache, state: statePath, universe: resolve(arg("--universe") ?? join(cache, "universe.json")), knownAssets: resolve(arg("--known-assets") ?? join(cache, "known-assets.json")), maxRequests: number("--max-requests"), timeBudgetSeconds: number("--time-budget-seconds"), requestIntervalMs: number("--request-interval-ms"), remainingEstimatedWrites: number("--remaining-estimated-writes"), maintenanceReserve: number("--maintenance-reserve") })));
}
if (process.argv[1] && basename(process.argv[1]) === "continue-daily-raw.ts") main().catch(() => { console.error("daily_raw_continuation_failed"); process.exitCode = 1; });
