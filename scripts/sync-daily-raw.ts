import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { createClient, type Client } from "@libsql/client";
import { historyIdentity } from "../lib/dailyHistory";
import { loadHistoryInputs } from "../lib/historyCollection";
import { connectHistory, HistoryBudgetExceeded, HISTORY_WRITE_LIMIT } from "../lib/historyDatabase";
import { copyDailyRaw, getDailyRawCheckpoint, getDailyRawRun, getDailyRawSources, initializeDailyRaw, listDailyRawAssets, openDailyRawRun, upsertDailyRaw, type DailyRawPoint, type DailyRawSource } from "../lib/dailyRawDatabase";
import { acquireDailyRawFeesSummary, archiveDailyRawOriginal, combineDailyRawAssets, dailyRawAssetFingerprint, dailyRawFeeCandidates, dailyRawObservationSources, dailyRawSource, DAILY_RAW_COLLECTION_VERSION, DailyRawInputError, extractDailyRawFundamentals, legacyDailyRawFdv, loadDailyRawCsvManifest, parseDailyRawCsv, rejectDailyRawCapturedFdv, snapshotDailyRaw, verifyDailyRawArchives, type CollectedDailyRawAsset, type DailyRawArchiveVerification, type DailyRawCsvFile, type LegacyFdvManifest } from "../lib/dailyRawCollection";
import { contentHash, objectHash, type SourceBundle, type SourceReceipt } from "../lib/sourceBundle";
import type { PublishedSnapshot } from "../lib/publicationTypes";
import { acquireCsvUniverse } from "./acquire-daily-csv";
import { loadCoinMetricsManifest } from "../lib/dailyRawCoinMetrics";
import { indexCapturedFdvQuotes, loadVerifiedFdvValidationManifest, type FdvRejection } from "../lib/dailyRawFdvValidation";
import { loadVerifiedFdvHoldsManifest } from "../lib/dailyRawFdvHolds";
import { certifyDailyRawFinancialMax, DAILY_RAW_FINANCIAL_MAX_PROOF, type DailyRawSelection } from "./continue-daily-raw";

interface ArchiveManifest { schema: 1; receipts: { sha256: string; url?: string; observedAt?: string; archiveUrl: string }[] }
const metrics = ["price", "mcap", "fdv", "fees", "revenue", "holders"] as const;
const argValues = (argv: string[], name: string) => argv.flatMap((value, i) => {
  if (value !== name) return [];
  if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw Error(`Missing ${name}`);
  return [argv[i + 1]];
});
const arg = (argv: string[], name: string, fallback?: string) => argValues(argv, name).at(-1) ?? fallback;
const positiveArg = (argv: string[], name: string, fallback?: number, minimum = 1) => {
  const raw = arg(argv, name); if (raw === undefined) return fallback;
  const value = Number(raw); if (!Number.isSafeInteger(value) || value < minimum) throw Error(`Invalid ${name}`);
  return value;
};
async function outsideGit(path: string) {
  await mkdir(path, { recursive: true });
  const actual = await realpath(path), git = spawnSync("git", ["-C", actual, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true });
  if (git.status === 0) throw Error("daily_raw_files_must_be_outside_git");
  return actual;
}
const receiptKey = (receipt: Pick<SourceReceipt, "url" | "observedAt" | "sha256">) => objectHash([receipt.url, receipt.observedAt, receipt.sha256]);
async function readSupplemental(path: string, cache: string): Promise<{ receipt: SourceReceipt; archiveUrl?: string }[]> {
  if ((await stat(path)).isDirectory()) {
    const result: { receipt: SourceReceipt; archiveUrl?: string }[] = [];
    for (const file of (await readdir(path)).filter(file => /\.json\.gz$/.test(file)).sort()) result.push(...await readSupplemental(join(path, file), cache));
    return result;
  }
  const bytes = await readFile(path); await archiveDailyRawOriginal(cache, bytes, path.endsWith(".gz") ? "receipt.json.gz" : "receipt.json");
  const parsed: unknown = JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes, { maxOutputLength: 500_000_000 }) : bytes).toString());
  if (!parsed || typeof parsed !== "object") throw new DailyRawInputError("daily_raw_supplemental_schema");
  if ("files" in parsed && Array.isArray(parsed.files)) {
    const result: { receipt: SourceReceipt; archiveUrl?: string }[] = [];
    for (const entry of parsed.files as { path: string; archiveUrl?: string }[]) result.push(...(await readSupplemental(resolve(dirname(path), entry.path), cache)).map(item => ({ ...item, archiveUrl: entry.archiveUrl ?? item.archiveUrl })));
    return result;
  }
  const receipts = "receipts" in parsed && Array.isArray(parsed.receipts) ? parsed.receipts as SourceReceipt[] : [parsed as SourceReceipt];
  for (const receipt of receipts) if (typeof receipt.body !== "string" || contentHash(receipt.body) !== receipt.sha256 || !Number.isFinite(Date.parse(receipt.observedAt))) throw new DailyRawInputError("daily_raw_supplemental_receipt_integrity");
  return receipts.map(receipt => ({ receipt }));
}
async function archiveLookup(path?: string) {
  const lookup = new Map<string, string>();
  if (!path) return lookup;
  const input = JSON.parse(await readFile(path, "utf8")) as ArchiveManifest;
  if (input.schema !== 1 || !Array.isArray(input.receipts)) throw new DailyRawInputError("daily_raw_archive_manifest_schema");
  for (const entry of input.receipts) {
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || entry.observedAt !== undefined && !Number.isFinite(Date.parse(entry.observedAt)) || !/^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/[^/]+\/[^/?#]+$/.test(entry.archiveUrl)) throw new DailyRawInputError("daily_raw_archive_manifest_entry");
    lookup.set(entry.observedAt === undefined ? `${entry.url ?? ""}|${entry.sha256}` : `${entry.url ?? ""}|${entry.observedAt}|${entry.sha256}`, entry.archiveUrl);
  }
  return lookup;
}
const resolvedArchive = (archives: Map<string, string>, source: { url: string; observedAt: string; sha256: string }) => archives.get(`${source.url}|${source.observedAt}|${source.sha256}`)
  ?? archives.get(`|${source.observedAt}|${source.sha256}`) ?? archives.get(`${source.url}|${source.sha256}`) ?? archives.get(`|${source.sha256}`);
async function acquireFeesUniverse(bundle: SourceBundle, cache: string, options: { maxFees?: number; hasTime: () => boolean; requestIntervalMs: number }) {
  const candidates = dailyRawFeeCandidates(bundle), path = join(cache, "fees-summaries-manifest.json"), files = new Map<string, { slug: string; path: string; url: string; sha256: string; observedAt: string }>();
  try {
    const previous = JSON.parse(await readFile(path, "utf8")) as { schema: number; files: { slug: string; path: string; url: string; sha256: string; observedAt: string }[] };
    if (previous.schema !== 1 || !Array.isArray(previous.files)) throw new DailyRawInputError("daily_raw_fee_manifest_schema");
    for (const file of previous.files) files.set(file.slug, file);
  } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  const report = { schema: 1, status: "running", startedAt: new Date().toISOString(), completedAt: "", universe: candidates.length, requests: 0, fetched: 0, cached: 0, unavailable: 0, deferred: 0, pending: 0, files: files.size, issues: [] as { scope: string; reason: string }[] };
  const save = async () => {
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ schema: 1, files: [...files.values()].sort((a, b) => a.slug.localeCompare(b.slug)) }, null, 2));
    await rename(temporary, path);
    report.files = files.size; await writeFile(join(cache, "fees-acquisition-report.json"), JSON.stringify(report, null, 2));
  };
  let requestedAssets = 0, lastRequest = 0, providerPaused = false, visited = 0;
  for (const candidate of candidates) {
    const allowed = !providerPaused && options.hasTime() && (options.maxFees === undefined || requestedAssets < options.maxFees); let requested = false;
    try {
      const result = await acquireDailyRawFeesSummary(candidate, cache, { allowRequest: allowed, onRequest: async () => {
        if (!requested) { requested = true; requestedAssets++; }
        const delay = Math.max(0, options.requestIntervalMs - (Date.now() - lastRequest));
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        lastRequest = Date.now(); report.requests++;
      } });
      if ((result.status === "cached" || result.status === "fetched") && result.file && result.receipt) files.set(candidate.slug, { slug: candidate.slug, path: result.file, url: result.receipt.url, sha256: result.receipt.sha256, observedAt: result.receipt.observedAt });
      if (result.status === "fetched") report.fetched++;
      else if (result.status === "cached") report.cached++;
      else if (result.status === "deferred") { report.deferred++; providerPaused ||= [401, 403, 429].includes(result.httpStatus ?? 0); }
      else if (requested || result.retryAt) { report.unavailable++; if (result.reason) report.issues.push({ scope: candidate.slug, reason: result.reason }); }
      else report.pending++;
    } catch (error) {
      if (!(error instanceof DailyRawInputError)) throw error;
      report.issues.push({ scope: candidate.slug, reason: error.message });
    }
    if (requested || ++visited % 100 === 0) await save();
    if (requested && requestedAssets % 25 === 0) console.log(JSON.stringify({ event: "fees-progress", requestedAssets, fetched: report.fetched, cached: report.cached, files: files.size }));
  }
  report.completedAt = new Date().toISOString(); report.status = providerPaused ? "provider-paused" : report.pending ? "pending" : report.issues.length || report.unavailable ? "partial" : "complete";
  await save(); return report;
}
function applyArchives(input: CollectedDailyRawAsset, archives: Map<string, string>) {
  const keys = new Map<string, string>();
  const sources = input.sources.map(source => {
    const archiveUrl = resolvedArchive(archives, source) ?? source.archiveUrl;
    if (archiveUrl === source.archiveUrl) { keys.set(source.key, source.key); return source; }
    const { key, ...metadata } = source, next = dailyRawSource(input.asset.slug, { ...metadata, archiveUrl });
    keys.set(key, next.key); return next;
  });
  const points = input.points.map(point => {
    const next: DailyRawPoint = { day: point.day };
    for (const metric of metrics) if (point[metric]) next[metric] = { ...point[metric]!, source: keys.get(point[metric]!.source) ?? point[metric]!.source,
      ...(point[metric]!.witnesses ? { witnesses: point[metric]!.witnesses!.map(witness => ({ ...witness, source: keys.get(witness.source) ?? witness.source })) } : {}) };
    return next;
  });
  return { ...input, sources, points };
}

export async function stageDailyRawAsset(db: Client, runId: string, input: CollectedDailyRawAsset, hasTime: () => boolean, financialMax = false) {
  const fingerprint = objectHash([dailyRawAssetFingerprint(input), financialMax ? DAILY_RAW_FINANCIAL_MAX_PROOF : null]), key = `stage:${input.asset.slug}:${input.asset.identity}`, checkpoint = await getDailyRawCheckpoint(db, runId, key);
  let after = "";
  if (checkpoint) {
    const cursor = JSON.parse(checkpoint.cursor) as { fingerprint: string; after: string };
    if (cursor.fingerprint === fingerprint) { if (checkpoint.status === "complete") return { skipped: true, paused: false, rowsWritten: 0, daysWritten: 0, estimatedWrites: 0 }; after = cursor.after; }
  }
  const sourceByKey = new Map(input.sources.map(source => [source.key, source])), points = input.points.filter(point => point.day > after);
  const total = { skipped: false, paused: false, rowsWritten: 0, daysWritten: 0, estimatedWrites: 0 };
  for (let start = 0; start < points.length || start === 0 && !points.length;) {
    if (!hasTime()) { total.paused = true; break; }
    const keys = new Set<string>(); let end = start;
    while (end < points.length && end - start < 1000) {
      const required = metrics.flatMap(metric => dailyRawObservationSources(points[end][metric]));
      if (new Set([...keys, ...required]).size > 100 && end > start) break;
      required.forEach(key => keys.add(key)); end++;
    }
    const chunk = points.slice(start, end), sources = [...keys].map(key => sourceByKey.get(key));
    if (sources.some(source => !source)) throw new DailyRawInputError("daily_raw_staging_source_missing");
    const complete = end === points.length;
    const result = await upsertDailyRaw(db, { runId, asset: input.asset, sources: sources as DailyRawSource[], points: chunk,
      checkpoint: { key, cursor: JSON.stringify({ fingerprint, after: chunk.at(-1)?.day ?? after, ...(financialMax ? { financialMaxProof: DAILY_RAW_FINANCIAL_MAX_PROOF } : {}) }), status: complete ? "complete" : "running" } });
    total.rowsWritten += result.rowsWritten; total.daysWritten += result.daysWritten; total.estimatedWrites += result.estimatedWrites;
    if (complete) break;
    start = end;
  }
  return total;
}

/** A timed-out local stage is durable for resumption, but cannot certify a full
 * asset import. Check local checkpoints before connecting a remote writer. */
export async function assertDailyRawSealed(db: Client) {
  const incomplete = await db.execute("SELECT checkpoint_key FROM daily_raw_checkpoints WHERE checkpoint_key LIKE 'stage:%' AND status <> 'complete' LIMIT 1");
  if (incomplete.rows.length) throw new DailyRawInputError("daily_raw_staging_incomplete");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    console.log("Stage: sync-daily-raw.ts --local --cache <outside-Git> [--reference reference.json] [--csv-manifest csv-manifest.json] [--supplemental-receipts directory|manifest.json] [--legacy-fdv-manifest file] [--coinmetrics-manifest file] [--archive-manifest file] [--database daily-raw.sqlite] [--slug exact-project-slug]\nAcquire CSV only: sync-daily-raw.ts --acquire-only --cache <outside-Git> --universe <verified snapshot JSON> [--max-csv N] [--request-interval-ms 2000]\nAcquire Fees only: add --acquire-fees --reference reference.json --supplemental-receipts <full Fees overview> [--max-fees N] to acquire-only.\nImport sealed staging: sync-daily-raw.ts --cache <outside-Git> --database <sealed.sqlite> --run-id <stable id> --max-estimated-writes <explicit shared allowance>\nOptional --max-assets N / --time-budget-seconds N limits work; no history date cap is applied.");
    console.log("Remote --batch-size defaults to 1000 (1..1000); source batches remain bounded at 100. Local SQLite defaults to an unmetered staging allowance and requires a fresh unmetered database.");
    console.log("Continuation uses --selection-manifest queue-selection.json to stage selected CSV dates separately from financial patches. Legacy proof gates: --fdv-validation-manifest file and --fdv-holds-manifest file, each bound to --legacy-fdv-manifest. Latest captured FDV always requires an exact original provider record.");
    return;
  }
  const cache = await outsideGit(resolve(arg(argv, "--cache", join(homedir(), ".codex", "cache", "crypto-valuation-screener", "daily-raw"))!));
  const local = argv.includes("--local"), acquireOnly = argv.includes("--acquire-only"), timeBudget = positiveArg(argv, "--time-budget-seconds"), maxAssets = positiveArg(argv, "--max-assets", undefined, 0);
  const started = Date.now(), hasTime = () => timeBudget === undefined || Date.now() - started < timeBudget * 1000;
  if (acquireOnly) {
    if (argv.includes("--acquire-fees")) {
      const referencePath = arg(argv, "--reference"), reference = referencePath ? JSON.parse(await readFile(resolve(referencePath), "utf8")) as PublishedSnapshot : undefined;
      const { bundle } = await loadHistoryInputs(cache, reference);
      for (const path of argValues(argv, "--supplemental-receipts")) for (const item of await readSupplemental(resolve(path), cache)) bundle.receipts.push(item.receipt);
      console.log(JSON.stringify(await acquireFeesUniverse(bundle, cache, { maxFees: positiveArg(argv, "--max-fees", undefined, 0), hasTime, requestIntervalMs: positiveArg(argv, "--request-interval-ms", 1000, 1000)! })));
    } else console.log(JSON.stringify(await acquireCsvUniverse({ cache, universe: resolve(arg(argv, "--universe", join(cache, "universe.json"))!), maxCsv: positiveArg(argv, "--max-csv", undefined, 0), timeBudgetSeconds: timeBudget, requestIntervalMs: positiveArg(argv, "--request-interval-ms", 1000, 1000) })));
    return;
  }
  if (!local && (argv.includes("--acquire-csv") || argv.includes("--acquire-fees") || arg(argv, "--archive-manifest") || arg(argv, "--slug"))) throw Error("Build an archived local staging database before remote import");
  const database = resolve(cache, arg(argv, "--database", "daily-raw.sqlite")!);
  await outsideGit(dirname(database));
  const allowance = positiveArg(argv, "--max-estimated-writes", local ? Number.MAX_SAFE_INTEGER : undefined, 8);
  if (allowance === undefined || !local && allowance > HISTORY_WRITE_LIMIT) throw Error("An explicit --max-estimated-writes shared monthly allowance is required");
  const batchSize = positiveArg(argv, "--batch-size", 1000)!;
  if (batchSize > 1000) throw Error("Invalid --batch-size");
  const runId = arg(argv, "--run-id", `daily-raw-${local ? "stage" : "import"}-${new Date(started).toISOString().slice(0, 10)}`)!;
  const report = { schema: 1, version: DAILY_RAW_COLLECTION_VERSION, runId, startedAt: new Date(started).toISOString(), completedAt: "", status: "running", snapshot: "", assets: 0, skippedAssets: 0, emptyAssetsSkipped: 0, pendingAssets: 0, rowsWritten: 0, daysWritten: 0, estimatedWrites: 0, runEstimatedWrites: null as number | null, accountingVersion: null as string | null, maxEstimatedWrites: allowance, issues: [] as { scope: string; reason: string; count?: number }[] };
  let db: Client | undefined, remote: Client | undefined;
  const issue = (scope: string, reason: string, count?: number) => { report.issues.push({ scope, reason, ...(count ? { count } : {}) }); };
  try {
    if (!local && !(await stat(database)).isFile()) throw new DailyRawInputError("daily_raw_sealed_staging_missing");
    db = createClient({ url: `file:${database.replaceAll("\\", "/")}` });
    if (!local) {
      await assertDailyRawSealed(db);
      const staged = await listDailyRawAssets(db), verified = new Map<string, DailyRawArchiveVerification>();
      // Every public archive is read back before any remote schema/data write.
      let verifiedAssets = 0;
      for (const asset of staged) {
        if (!hasTime()) { report.status = "time-paused"; report.pendingAssets = staged.length; return; }
        await verifyDailyRawArchives(await getDailyRawSources(db, asset), fetch, verified);
        if (++verifiedAssets % 100 === 0) console.log(JSON.stringify({ event: "daily-raw-archive-verification", assets: verifiedAssets, totalAssets: staged.length, archives: verified.size }));
      }
      const stagingId = contentHash(await readFile(database));
      remote = connectHistory(); await initializeDailyRaw(remote);
      const result = await copyDailyRaw(db, remote, { runId, maxEstimatedWrites: allowance, stagingId, maxAssets, hasTime, batchSize, onBatch: async progress => {
        if (progress.complete) report.assets++;
        report.daysWritten += progress.daysWritten; report.estimatedWrites += progress.estimatedWrites;
        if (progress.complete) {
          const proof = await certifyDailyRawFinancialMax(db!, remote!, { asset: progress.asset, runId, stagingId });
          if (proof) { report.rowsWritten += proof.rowsWritten; report.estimatedWrites += proof.estimatedWrites; }
        }
        if (progress.complete && report.assets % 25 === 0) console.log(JSON.stringify({ event: "daily-raw-import", assets: report.assets, daysWritten: report.daysWritten, estimatedWrites: report.estimatedWrites }));
      } });
      report.assets = result.assetsCompleted; report.skippedAssets = result.assetsSkipped; report.rowsWritten = result.rowsWritten; report.daysWritten = result.daysWritten; report.estimatedWrites = result.estimatedWrites; report.pendingAssets = result.pendingAssets;
      report.emptyAssetsSkipped = "emptyAssetsSkipped" in result ? Number(result.emptyAssetsSkipped) : 0;
      report.accountingVersion = result.accountingVersion;
      if (contentHash(await readFile(database)) !== stagingId) throw Error("daily_raw_staging_changed_during_import");
      report.status = result.stopped ? hasTime() ? "asset-limit-paused" : "time-paused" : "complete"; return;
    }
    const referencePath = arg(argv, "--reference"), reference = referencePath ? JSON.parse(await readFile(resolve(referencePath), "utf8")) as PublishedSnapshot : undefined;
    const { snapshot, bundle, ref } = await loadHistoryInputs(cache, reference); report.snapshot = ref.id;
    const archives = await archiveLookup(arg(argv, "--archive-manifest")), originals = new Set(bundle.receipts.map(receiptKey)), supplementalArchive = new Map<string, string>();
    for (const path of argValues(argv, "--supplemental-receipts")) for (const item of await readSupplemental(resolve(path), cache)) {
      if (!bundle.receipts.some(receipt => receiptKey(receipt) === receiptKey(item.receipt))) bundle.receipts.push(item.receipt);
      if (item.archiveUrl) supplementalArchive.set(receiptKey(item.receipt), item.archiveUrl);
    }
    const fundamentals = extractDailyRawFundamentals(bundle, ref.rawBundleUrl!, receipt => resolvedArchive(archives, receipt) ?? (originals.has(receiptKey(receipt)) ? ref.rawBundleUrl : supplementalArchive.get(receiptKey(receipt))));
    const fdvIndex = indexCapturedFdvQuotes(bundle.receipts);
    const csvPath = arg(argv, "--csv-manifest"), csvFiles = new Map<string, DailyRawCsvFile>();
    if (csvPath) for (const file of (await loadDailyRawCsvManifest(resolve(csvPath), cache, (file, error) => issue(file.geckoId, error.message))).files) csvFiles.set(file.geckoId, file);
    const legacy = new Map<string, CollectedDailyRawAsset>(); let fdvRejections: FdvRejection[] = [];
    const legacyPath = arg(argv, "--legacy-fdv-manifest");
    if ((arg(argv, "--fdv-validation-manifest") || arg(argv, "--fdv-holds-manifest")) && !legacyPath) throw new DailyRawInputError("daily_raw_fdv_validation_needs_legacy_manifest");
    if (legacyPath) {
      const bytes = await readFile(resolve(legacyPath)); await archiveDailyRawOriginal(cache, bytes, "legacy.json");
      const input = JSON.parse(bytes.toString()) as LegacyFdvManifest;
      if (input.schema !== 1 || !Array.isArray(input.assets)) throw new DailyRawInputError("daily_raw_legacy_manifest_schema");
      const holdsPath = arg(argv, "--fdv-holds-manifest");
      if (holdsPath) {
        const holds = (await loadVerifiedFdvHoldsManifest(resolve(holdsPath), cache, bytes)).holds;
        const held = new Set(holds.map(hold => JSON.stringify([hold.slug, hold.identity, hold.day, hold.sourceId, hold.fdv, Date.parse(hold.fdvAt)])));
        for (const hold of holds) issue(`${hold.slug}:fdv:${hold.day}`, hold.reason);
        for (const asset of input.assets) asset.points = asset.points.filter(point => !held.has(JSON.stringify([asset.slug, asset.identity, point.day, point.sourceId, point.fdv, Date.parse(point.fdvAt)])));
      }
      const validationPath = arg(argv, "--fdv-validation-manifest");
      if (validationPath) {
        fdvRejections = (await loadVerifiedFdvValidationManifest(resolve(validationPath), cache, bytes)).rejections;
        const rejected = new Set(fdvRejections.map(rejected => JSON.stringify([rejected.slug, rejected.identity, rejected.day, rejected.sourceId, rejected.proof.reportedFdv, Date.parse(rejected.proof.quoteAt)])));
        for (const rejected of fdvRejections) issue(`${rejected.slug}:fdv:${rejected.day}`, rejected.reason);
        for (const asset of input.assets) asset.points = asset.points.filter(point => !rejected.has(JSON.stringify([asset.slug, asset.identity, point.day, point.sourceId, point.fdv, Date.parse(point.fdvAt)])));
      }
      for (const asset of input.assets) try { for (const collected of legacyDailyRawFdv({ ...input, assets: [asset] }, snapshot.coins)) legacy.set(collected.asset.slug, collected); }
      catch (error) { if (!(error instanceof DailyRawInputError)) throw error; issue(asset.slug, error.message); }
    }
    const coinMetrics = new Map<string, CollectedDailyRawAsset>(), cmPath = arg(argv, "--coinmetrics-manifest");
    if (cmPath) {
      const result = await loadCoinMetricsManifest(resolve(cmPath), dirname(resolve(cmPath)), snapshot.coins);
      for (const collected of result.assets) coinMetrics.set(collected.asset.slug, collected);
      report.issues.push(...result.issues);
    }
    await initializeDailyRaw(db, { unmeteredLocal: true }); await openDailyRawRun(db, { id: runId, maxEstimatedWrites: allowance });
    const selectionPath = arg(argv, "--selection-manifest"), selection = new Map<string, DailyRawSelection["assets"][number]>();
    if (selectionPath) {
      const input = JSON.parse(await readFile(resolve(selectionPath), "utf8")) as DailyRawSelection;
      if (input.schema !== 1 || !Array.isArray(input.assets)) throw new DailyRawInputError("daily_raw_selection_schema");
      for (const asset of input.assets) {
        if (!asset.slug || !asset.identity || [asset.from, asset.to, asset.csv?.from, asset.csv?.to].some(day => day !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)) || asset.from && asset.to && asset.from > asset.to || asset.csv?.from && asset.csv.from > asset.csv.to || selection.has(asset.slug)) throw new DailyRawInputError("daily_raw_selection_entry");
        selection.set(asset.slug, asset);
      }
    }
    const selected = new Set(argValues(argv, "--slug"));
    if ([...selected].some(slug => !snapshot.coins.some(coin => coin.slug === slug))) throw new DailyRawInputError("daily_raw_unknown_project_slug");
    const coins = snapshot.coins.filter(coin => (!selected.size || selected.has(coin.slug)) && (!selectionPath || selection.has(coin.slug))).sort((a, b) => Number(fundamentals.series.has(b.slug)) - Number(fundamentals.series.has(a.slug)) || (b.mcap ?? 0) - (a.mcap ?? 0) || a.slug.localeCompare(b.slug));
    for (let index = 0; index < coins.length; index++) {
      if (!hasTime() || maxAssets !== undefined && report.assets >= maxAssets) {
        report.pendingAssets = coins.length - index; report.status = hasTime() ? "asset-limit-paused" : "time-paused"; break;
      }
      const coin = coins[index], marketVerified = coin.identityStatus === "verified" && historyIdentity(coin) !== "unlinked" && !coin.capitalExclusionReason;
      const asset = { slug: coin.slug, identity: marketVerified ? historyIdentity(coin) : `defillama:${coin.slug}` };
      try {
        const bounds = selection.get(coin.slug);
        if (bounds && bounds.identity !== asset.identity) throw new DailyRawInputError("daily_raw_selection_identity_changed");
        const inputs: CollectedDailyRawAsset[] = [{ asset, sources: fundamentals.sources.get(coin.slug) ?? [], points: fundamentals.series.get(coin.slug) ?? [] }];
        if (marketVerified) {
          const captured = rejectDailyRawCapturedFdv(snapshotDailyRaw(coin, coin, ref, fdvIndex), fdvRejections, ref.sha256);
          inputs.push(captured);
          const old = legacy.get(coin.slug); if (old) inputs.push(old);
          const cm = coinMetrics.get(coin.slug); if (cm) inputs.push(cm);
          const file = coin.geckoId ? csvFiles.get(coin.geckoId) : undefined;
          if (file) try { inputs.push(parseDailyRawCsv(await readFile(file.path, "utf8"), file, asset)); }
          catch (error) {
            if (!(error instanceof DailyRawInputError || error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
            issue(`${coin.slug}:csv`, error instanceof DailyRawInputError ? error.message : "daily_raw_csv_original_missing");
          }
        }
        const scoped = bounds ? inputs.map(input => {
          const csv = input.sources.some(source => source.provider === "CoinGecko" && source.basis.includes("coingecko_web_csv"));
          const range = csv ? bounds.csv : bounds;
          return { ...input, points: !range ? [] : input.points.filter(point => (!range.from || point.day >= range.from) && (!range.to || point.day <= range.to)) };
        }) : inputs;
        const combined = combineDailyRawAssets(asset, scoped), counts = new Map<string, number>();
        for (const entry of combined.issues ?? []) { const key = `${entry.metric ?? "csv"}|${entry.reason}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
        for (const [key, count] of counts) { const [metric, reason] = key.split("|"); issue(`${coin.slug}:${metric}`, reason, count); }
        const financialMax = !bounds?.from && (!bounds?.to || (fundamentals.series.get(coin.slug) ?? []).every(point => point.day <= bounds.to!)) && (fundamentals.series.get(coin.slug) ?? []).some(point => [point.fees, point.revenue, point.holders].some(value => value && value.state !== "missing"));
        const result = await stageDailyRawAsset(db, runId, applyArchives(combined, archives), hasTime, financialMax);
        if (result.paused) { report.pendingAssets = coins.length - index; report.status = "time-paused"; break; }
        report.assets += Number(!result.skipped); report.skippedAssets += Number(result.skipped); report.rowsWritten += result.rowsWritten; report.daysWritten += result.daysWritten; report.estimatedWrites += result.estimatedWrites;
      } catch (error) { if (!(error instanceof DailyRawInputError)) throw error; issue(coin.slug, error.message); }
      if ((index + 1) % 25 === 0) { console.log(JSON.stringify({ event: "daily-raw-stage", assets: report.assets, skippedAssets: report.skippedAssets, daysWritten: report.daysWritten, estimatedWrites: report.estimatedWrites })); await writeFile(join(cache, "daily-raw-report.json"), JSON.stringify(report, null, 2)); }
    }
    if (report.status === "running") report.status = report.issues.length ? "partial" : "complete";
    // Known source values are durable before this optional long network phase.
    if (argv.includes("--acquire-csv") && hasTime()) await acquireCsvUniverse({ cache, universe: resolve(arg(argv, "--universe", join(cache, "universe.json"))!), maxCsv: positiveArg(argv, "--max-csv", undefined, 0), timeBudgetSeconds: timeBudget === undefined ? undefined : Math.max(1, timeBudget - Math.floor((Date.now() - started) / 1000)), requestIntervalMs: positiveArg(argv, "--request-interval-ms", 1000, 1000) });
    if (argv.includes("--acquire-fees") && hasTime()) await acquireFeesUniverse(bundle, cache, { maxFees: positiveArg(argv, "--max-fees", undefined, 0), hasTime, requestIntervalMs: positiveArg(argv, "--request-interval-ms", 1000, 1000)! });
  } catch (error) {
    if (error instanceof HistoryBudgetExceeded) { report.status = "budget-paused"; issue("shared-write-budget", error.message); }
    else { report.status = error instanceof DailyRawInputError ? "input-blocked" : "failed"; issue("run", error instanceof DailyRawInputError ? error.message : "daily_raw_sync_failed"); process.exitCode = 1; }
  } finally {
    if (remote ?? db) try { const run = await getDailyRawRun((remote ?? db)!, runId); report.runEstimatedWrites = run?.estimatedWrites ?? null; report.accountingVersion = run?.accountingVersion ?? report.accountingVersion; } catch {}
    db?.close(); remote?.close(); report.completedAt = new Date().toISOString();
    await writeFile(join(cache, "daily-raw-report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  }
}
if (process.argv[1] && basename(process.argv[1]) === "sync-daily-raw.ts") main().catch(() => { console.error("daily_raw_sync_failed"); process.exitCode = 1; });
