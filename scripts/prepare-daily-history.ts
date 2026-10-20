import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient, type Client } from "@libsql/client";
import { connectHistory, historyRead, HISTORY_WRITE_LIMIT, HistoryBudgetExceeded } from "../lib/historyDatabase";
import { initializeDailyRaw, openDailyRawRun, getDailyRawRun } from "../lib/dailyRawDatabase";
import { initializeDailyReadModels, writeDailyReadModel } from "../lib/dailyReadModelDatabase";
import { dailyHistoryModelCurrent, prepareDailyValuationHistory } from "../lib/dailyValuationPrepared";
import { dailyValuationAsOf } from "../lib/dailyValuation";
import { historyIdentity } from "../lib/dailyHistory";
import { loadArchivedSnapshot, loadHistoryReference } from "../lib/historyCollection";
import { decodeSnapshot } from "../lib/snapshotArchive";
import type { PublishedSnapshot } from "../lib/publicationTypes";
import type { DailyValuationCoin } from "../lib/dailyValuationRead";

const arg = (argv: string[], name: string) => { const index = argv.indexOf(name); if (index < 0) return undefined; if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw Error("missing_argument"); return argv[index + 1]; };
const number = (argv: string[], name: string, fallback: number, low: number, high: number) => { const value = arg(argv, name), parsed = value === undefined ? fallback : Number(value); if (value !== undefined && !/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < low || parsed > high) throw Error("invalid_argument"); return parsed; };
export async function prepareDailyHistoryMain(argv: string[]) {
  if (argv.includes("--help")) { console.log("prepare-daily-history.ts --cache <outside-Git-dir> [--reference <pinned-ref-or-journal.json>] [--snapshot <original.json.gz>] [--database <local.sqlite>] [--run-id <stable-id>] [--max-estimated-writes 50000] [--time-budget-seconds 2400] [--max-assets 3978] [--workers 4] [--slug <exact>] [--apply]\nDefault is SELECT-only dry-run. --apply alone enables additive DDL and budgeted model writes. Retains 500000 monthly credits; never retries writes. Re-run with the same run ID/allowance: current models are skipped. Compact history is full MAX through the verified snapshot asOf. No provider requests."); return; }
  const flags = new Set(["--cache", "--reference", "--snapshot", "--database", "--run-id", "--max-estimated-writes", "--time-budget-seconds", "--max-assets", "--workers", "--slug", "--apply"]), seen = new Set<string>();
  for (let index = 0; index < argv.length; index++) { const flag = argv[index]; if (!flags.has(flag) || seen.has(flag)) throw Error("invalid_argument"); seen.add(flag); if (flag !== "--apply") { if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw Error("missing_argument"); index++; } }
  const cacheArg = arg(argv, "--cache"); if (!cacheArg) throw Error("missing_cache");
  await mkdir(resolve(cacheArg), { recursive: true }); const cache = await realpath(resolve(cacheArg));
  if (spawnSync("git", ["-C", cache, "rev-parse", "--show-toplevel"], { windowsHide: true, encoding: "utf8" }).status === 0) throw Error("read_model_cache_must_be_outside_git");
  const apply = argv.includes("--apply"), maxEstimatedWrites = number(argv, "--max-estimated-writes", 50_000, 8, HISTORY_WRITE_LIMIT), seconds = number(argv, "--time-budget-seconds", 2400, 1, 2400), maxAssets = number(argv, "--max-assets", 100_000, 1, 100_000), workers = number(argv, "--workers", 4, 1, 4);
  const started = Date.now(), now = new Date(), deadline = started + seconds * 1000, runId = arg(argv, "--run-id") ?? `daily-history-model-${now.toISOString().slice(0, 10)}`, database = arg(argv, "--database");
  const referencePath = arg(argv, "--reference");
  let reference: PublishedSnapshot;
  if (referencePath) { const value = JSON.parse(await readFile(resolve(referencePath), "utf8")); reference = value.published ?? value; }
  else reference = await loadHistoryReference();
  const snapshotPath = arg(argv, "--snapshot"), snapshot = snapshotPath ? decodeSnapshot(await readFile(resolve(snapshotPath)), reference) : await loadArchivedSnapshot(reference, cache);
  const snapshotContext = { updatedAt: snapshot.updatedAt, publication: { published: { id: reference.id } } }, asOf = dailyValuationAsOf(snapshotContext, now).asOf;
  const connect = () => database ? createClient({ url: pathToFileURL(resolve(database)).href }) : connectHistory();
  const db = connect(), readers: Client[] = [];
  const report = { schema: 1, mode: apply ? "apply" : "dry-run", status: "running", runId, publicationId: reference.id, asOf, startedAt: now.toISOString(), completedAt: "", elapsedMs: 0, workers: database ? 1 : workers, maxEstimatedWrites, minimumReserve: 500_000, selected: 0, processed: 0, prepared: 0, current: 0, absent: 0, raced: 0, pending: 0, points: 0, compressedBytes: 0, estimatedWrites: 0, runEstimatedWrites: 0, plannedWrites: 0, providerRequests: 0, error: null as string | null, assets: [] as { slug: string; status: string; points: number; compressedBytes: number; estimatedWrites: number }[] };
  let failed = false, queue: Promise<unknown> = Promise.resolve(), initialRunWrites = 0;
  try {
    if (apply) { await initializeDailyRaw(db); await initializeDailyReadModels(db); initialRunWrites = (await getDailyRawRun(db, runId))?.estimatedWrites ?? 0; await openDailyRawRun(db, { id: runId, maxEstimatedWrites, minimumReserve: 500_000, now }); }
    let registry;
    try { registry = await historyRead(db, "SELECT a.id asset_id,a.slug,a.identity,COALESCE(r.revision,0) asset_revision,m.revision model_revision,m.metadata,m.metadata_sha256 FROM daily_raw_assets a LEFT JOIN daily_raw_asset_revisions r ON r.asset_id=a.id LEFT JOIN daily_read_models m ON m.namespace='daily-history-v1' AND m.model_key=CAST(a.id AS TEXT) WHERE EXISTS(SELECT 1 FROM daily_raw_days d WHERE d.asset_id=a.id)"); }
    catch (error) { if (!(error instanceof Error) || !/no such table: (daily_read_models|daily_raw_asset_revisions)/.test(error.message)) throw error; registry = await historyRead(db, "SELECT a.id asset_id,a.slug,a.identity,0 asset_revision,NULL metadata FROM daily_raw_assets a WHERE EXISTS(SELECT 1 FROM daily_raw_days d WHERE d.asset_id=a.id)"); }
    const available = new Map(registry.rows.map(row => [JSON.stringify([row.slug, row.identity]), row])), slug = arg(argv, "--slug");
    const coins = snapshot.coins.filter(coin => coin.identityStatus === "verified" && available.has(JSON.stringify([coin.slug, historyIdentity(coin)])) && (!slug || coin.slug === slug));
    coins.sort((a, b) => Number(!!(b.revenue30d || b.holderValue?.rawCurrent30d)) - Number(!!(a.revenue30d || a.holderValue?.rawCurrent30d)) || (b.mcap ?? 0) - (a.mcap ?? 0) || a.slug.localeCompare(b.slug));
    report.selected = coins.length;
    const pending = coins.filter(coin => !dailyHistoryModelCurrent(available.get(JSON.stringify([coin.slug, historyIdentity(coin)]))!, coin, asOf));
    report.current = coins.length - pending.length;
    let next = 0, reserved = 0, dryRunAllowance = 5;
    const publish: NonNullable<Parameters<typeof prepareDailyValuationHistory>[1]["publish"]> = candidate => {
      const job = queue.then(async () => { if (failed) throw Error("read_model_previous_write_failed"); try { return await writeDailyReadModel(db, candidate); } catch (error) { if (!(error instanceof HistoryBudgetExceeded) && !(error instanceof Error && error.message === "daily_read_model_raw_changed")) failed = true; throw error; } });
      queue = job.catch(() => {}); return job;
    };
    await Promise.all(Array.from({ length: database ? 1 : workers }, async () => {
      const reader = connect(); readers.push(reader);
      while (!failed && Date.now() < deadline && reserved < maxAssets && next < pending.length) {
        if (!apply && dryRunAllowance + 5 > maxEstimatedWrites) break;
        dryRunAllowance += 5;
        const coin: DailyValuationCoin = pending[next++]; reserved++;
        try {
          const result = await prepareDailyValuationHistory(reader, { coin, snapshot: snapshotContext, runId, minimumReserve: 500_000, now, dryRun: !apply, publish });
          report.processed++; report.points += result.points; report.compressedBytes += result.compressedBytes; report.plannedWrites += result.estimatedWrites;
          if (result.status === "current") report.current++; else if (result.status === "absent") report.absent++; else report.prepared++;
          report.assets.push({ slug: coin.slug, status: result.status, points: result.points, compressedBytes: result.compressedBytes, estimatedWrites: result.estimatedWrites });
          if (report.processed % 25 === 0) { await writeFile(join(cache, "daily-history-model-report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ event: "history-model-progress", processed: report.processed, prepared: report.prepared, current: report.current, compressedBytes: report.compressedBytes, estimatedWrites: report.plannedWrites })); }
        } catch (error) {
          if (error instanceof Error && error.message === "daily_read_model_raw_changed") { report.raced++; continue; }
          failed = true; report.status = error instanceof HistoryBudgetExceeded ? "budget-paused" : "failed"; report.error = error instanceof HistoryBudgetExceeded ? "history_write_or_storage_budget" : "daily_history_model_failed";
        }
      }
    }));
    report.pending = Math.max(0, pending.length - report.processed);
    if (report.status === "running") report.status = report.pending ? "paused" : "complete";
    if (apply) { report.runEstimatedWrites = (await getDailyRawRun(db, runId))!.estimatedWrites; report.estimatedWrites = report.runEstimatedWrites - initialRunWrites; }
  } catch (error) {
    report.status = error instanceof HistoryBudgetExceeded ? "budget-paused" : "failed";
    report.error = error instanceof HistoryBudgetExceeded ? "history_write_or_storage_budget" : "daily_history_model_failed";
  } finally {
    await queue; for (const reader of readers) reader.close(); db.close();
    report.completedAt = new Date().toISOString(); report.elapsedMs = Date.now() - started;
    await writeFile(join(cache, "daily-history-model-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
  if (report.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) prepareDailyHistoryMain(process.argv.slice(2)).catch(() => { console.error("daily_history_model_failed"); process.exitCode = 1; });
