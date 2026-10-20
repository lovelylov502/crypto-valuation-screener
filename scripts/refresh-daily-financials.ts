import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { collectRecentDailyFinancials, planRecentDailyFinancials, recentDailyFinancialCoverage } from "../lib/dailyRecentFinancials";
import { getDailyRawRun, initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "../lib/dailyRawDatabase";
import { loadHistoryInputs } from "../lib/historyCollection";
import { connectHistory, HISTORY_WRITE_LIMIT, HistoryBudgetExceeded } from "../lib/historyDatabase";
import { objectHash } from "../lib/sourceBundle";
import type { PublishedSnapshot } from "../lib/publicationTypes";

const values = (argv: string[], name: string) => argv.flatMap((value, index) => value === name ? [argv[index + 1]] : []);
const arg = (argv: string[], name: string) => values(argv, name).at(-1);
const integer = (argv: string[], name: string, fallback: number, low: number, high: number) => { const value = arg(argv, name), parsed = value === undefined ? fallback : Number(value); if (value !== undefined && !/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < low || parsed > high) throw Error("daily_financial_invalid_argument"); return parsed; };
async function atomic(path: string, value: unknown) { const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, path); }
export async function refreshDailyFinancialsMain(argv: string[]) {
  if (argv.includes("--help")) { console.log("refresh-daily-financials.ts --cache <outside-Git-dir> [--reference latest|<pinned-reference-or-journal.json>] [--database <local.sqlite>] [--run-id <stable-id>] [--max-estimated-writes 50000] [--time-budget-seconds 300] [--recent-days 3] [--max-assets N] [--slug exact (repeatable)] [--apply]\nDefault is a SELECT-only dry-run. --apply enables bounded recent Fees/Revenue/Holders upserts only, retaining500000 monthly credits. Uses verified archived originals; provider requests0. Writes pinned cache/reference.json and recent-financial-patch-report.json. Unchanged cells retain source references and cost0; no CSV/MAX queue or MAX attestation required. Time/budget/source-unavailable exits2; unknown write failure exits1 and is never retried."); return; }
  const allowed = new Set(["--cache", "--reference", "--database", "--run-id", "--max-estimated-writes", "--time-budget-seconds", "--recent-days", "--max-assets", "--slug", "--apply"]), seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) { const flag = argv[i]; if (!allowed.has(flag) || seen.has(flag) && flag !== "--slug") throw Error("daily_financial_invalid_argument"); seen.add(flag); if (flag !== "--apply") { if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw Error("daily_financial_missing_argument"); i++; } }
  const cacheArg = arg(argv, "--cache"); if (!cacheArg) throw Error("daily_financial_cache_required");
  await mkdir(resolve(cacheArg), { recursive: true }); const cache = await realpath(resolve(cacheArg));
  if (spawnSync("git", ["-C", cache, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true }).status === 0) throw Error("daily_financial_cache_must_be_outside_git");
  const apply = argv.includes("--apply"), allowance = integer(argv, "--max-estimated-writes", 50_000, 8, HISTORY_WRITE_LIMIT), seconds = integer(argv, "--time-budget-seconds", 300, 1, 1200), recentDays = integer(argv, "--recent-days", 3, 1, 14), maxAssets = integer(argv, "--max-assets", 100_000, 1, 100_000);
  const started = Date.now(), now = new Date(), deadline = started + seconds * 1000, runId = arg(argv, "--run-id") ?? `daily-financial-${now.toISOString().slice(0, 10)}`;
  const referencePath = arg(argv, "--reference"); let reference: PublishedSnapshot | undefined;
  if (referencePath && referencePath !== "latest") { const input = JSON.parse(await readFile(resolve(referencePath), "utf8")); reference = input.published ?? input; }
  const { snapshot, bundle, ref } = await loadHistoryInputs(cache, reference);
  await atomic(join(cache, "reference.json"), ref);
  const collected = collectRecentDailyFinancials({ snapshot, bundle, reference: ref, recentDays, slugs: values(argv, "--slug"), now });
  const database = arg(argv, "--database"), db = database ? createClient({ url: pathToFileURL(resolve(database)).href }) : connectHistory();
  const report = { schema: 1, mode: apply ? "apply" : "dry-run", status: "running", runId, publicationId: ref.id, rawBundleSha256: ref.rawBundleSha256, targetDay: collected.targetDay, from: collected.from, to: collected.to, startedAt: now.toISOString(), completedAt: "", elapsedMs: 0, maxEstimatedWrites: allowance, minimumReserve: 500_000, providerRequests: 0,
    sourceTargetCoverage: collected.targetCoverage, storedTargetCoverage: null as Awaited<ReturnType<typeof recentDailyFinancialCoverage>> | null, sources: collected.sources, selected: collected.assets.length, unchangedAssets: 0, unchangedCells: 0, changedAssets: 0, processed: 0, pendingAssets: 0, rowsWritten: 0, daysWritten: 0, estimatedWrites: 0, runEstimatedWrites: 0, estimatedWriteUpperBound: 0, lastAttemptedAsset: null as string | null, error: null as string | null,
    assets: [] as { slug: string; identity: string; days: number; rowsWritten: number; daysWritten: number; estimatedWrites: number }[] };
  let initialWrites = 0, runTracked = false;
  try {
    const plan = await planRecentDailyFinancials(db, collected);
    report.changedAssets = plan.assets.length; report.pendingAssets = plan.assets.length; report.unchangedAssets = plan.unchangedAssets; report.unchangedCells = plan.unchangedCells;
    // Conservative bound: all metadata new, all candidate cells potentially audited, plus one revision/checkpoint per asset.
    report.estimatedWriteUpperBound = plan.assets.reduce((sum, item) => sum + item.sources.length * 4 + item.points.length + item.points.reduce((n, point) => n + ["fees", "revenue", "holders"].filter(metric => point[metric as "fees" | "revenue" | "holders"]).length * 2, 0) + 8, 0) + Number(plan.assets.length > 0) * 5;
    if (!apply) report.status = "dry-run";
    else if (!plan.assets.length) report.status = "complete";
    else if (Date.now() >= deadline) report.status = "time-paused";
    else {
      await initializeDailyRaw(db); initialWrites = (await getDailyRawRun(db, runId))?.estimatedWrites ?? 0; runTracked = true;
      await openDailyRawRun(db, { id: runId, maxEstimatedWrites: allowance, minimumReserve: 500_000, now });
      for (const item of plan.assets) {
        if (Date.now() >= deadline || report.processed >= maxAssets) { report.status = Date.now() >= deadline ? "time-paused" : "asset-limit-paused"; break; }
        report.lastAttemptedAsset = `${item.asset.slug}:${item.asset.identity}`;
        const result = await upsertDailyRaw(db, { runId, asset: item.asset, sources: item.sources, points: item.points, minimumReserve: 500_000, now,
          checkpoint: { key: `recent-financial:${item.asset.slug}:${item.asset.identity}`, cursor: objectHash([ref.id, ref.rawBundleSha256, collected.from, collected.to, item.asset]), status: "complete" } });
        report.processed++; report.pendingAssets--; report.rowsWritten += result.rowsWritten; report.daysWritten += result.daysWritten;
        report.assets.push({ ...item.asset, days: item.points.length, rowsWritten: result.rowsWritten, daysWritten: result.daysWritten, estimatedWrites: result.estimatedWrites });
        if (report.processed % 25 === 0) { await atomic(join(cache, "recent-financial-patch-report.json"), report); console.log(JSON.stringify({ event: "recent-financial-progress", processed: report.processed, pendingAssets: report.pendingAssets, rowsWritten: report.rowsWritten, daysWritten: report.daysWritten })); }
      }
      if (report.status === "running") report.status = "complete";
    }
    if (!collected.targetCoverage.revenue.rows && !collected.targetCoverage.holders.rows) report.status = "source-unavailable";
  } catch (error) {
    report.status = error instanceof HistoryBudgetExceeded ? "budget-paused" : "failed";
    report.error = error instanceof HistoryBudgetExceeded ? "history_write_or_storage_budget" : "daily_financial_write_outcome_requires_inspection";
  } finally {
    try {
      report.storedTargetCoverage = await recentDailyFinancialCoverage(db, collected);
      if (apply) { report.runEstimatedWrites = (await getDailyRawRun(db, runId))?.estimatedWrites ?? 0; report.estimatedWrites = runTracked ? report.runEstimatedWrites - initialWrites : 0; }
    } catch { report.status = "failed"; report.error ??= "daily_financial_readback_failed"; }
    db.close(); report.completedAt = new Date().toISOString(); report.elapsedMs = Date.now() - started;
    await atomic(join(cache, "recent-financial-patch-report.json"), report); console.log(JSON.stringify(report));
  }
  if (["time-paused", "asset-limit-paused", "budget-paused", "source-unavailable"].includes(report.status)) process.exitCode = 2;
  else if (report.status === "failed") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) refreshDailyFinancialsMain(process.argv.slice(2)).catch(() => { console.error("daily_financial_refresh_failed"); process.exitCode = 1; });
