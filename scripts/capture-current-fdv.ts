import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { collectCurrentFdv, planFdvRecovery } from "../lib/dailyRawFdvRecovery";
import { loadHistoryInputs } from "../lib/historyCollection";
import { connectHistory, HistoryBudgetExceeded } from "../lib/historyDatabase";
import { captureMissingDailyFdv, getDailyRawRun, initializeDailyRaw, openDailyRawRun } from "../lib/dailyRawDatabase";
import { objectHash } from "../lib/sourceBundle";
import type { PublishedSnapshot } from "../lib/publicationTypes";

async function main(argv: string[]) {
  if (argv.includes("--help")) { console.log("capture-current-fdv.ts --cache <outside-Git-dir> [--reference latest|<pinned-reference.json>] [--run-id stable-id] [--max-estimated-writes 50000] [--time-budget-seconds 300] [--apply]\nSELECT-only by default. Verifies archived originals and captures the first valid FDV per actual UTC quote day, independently of CSV/MAX selection. Includes today's market observations; completed-day readers keep excluding today. Missing-only batches retain financials, existing values and holds, within the shared quota/storage limits."); return; }
  const allowed = new Set(["--cache", "--reference", "--run-id", "--max-estimated-writes", "--time-budget-seconds", "--apply"]), seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) { const flag = argv[i]; if (!allowed.has(flag) || seen.has(flag)) throw Error("daily_fdv_capture_argument"); seen.add(flag); if (flag !== "--apply" && (!argv[++i] || argv[i].startsWith("--"))) throw Error("daily_fdv_capture_argument"); }
  const arg = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const integer = (name: string, fallback: number, min: number, max: number) => { const text = arg(name), value = text === undefined ? fallback : Number(text); if (text !== undefined && !/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) throw Error("daily_fdv_capture_argument"); return value; };
  if (!arg("--cache")) throw Error("daily_fdv_capture_cache_required");
  await mkdir(resolve(arg("--cache")!), { recursive: true }); const cache = await realpath(resolve(arg("--cache")!));
  if (spawnSync("git", ["-C", cache, "rev-parse", "--show-toplevel"], { windowsHide: true }).status === 0) throw Error("daily_fdv_capture_cache_inside_git");
  const now = new Date(), apply = argv.includes("--apply"), allowance = integer("--max-estimated-writes", 50_000, 8, 50_000), deadline = Date.now() + integer("--time-budget-seconds", 300, 1, 1200) * 1000;
  const runId = arg("--run-id") ?? `current-fdv-${now.toISOString().replace(/[:.]/g, "-")}`, referenceArg = arg("--reference");
  let reference: PublishedSnapshot | undefined;
  if (referenceArg && referenceArg !== "latest") { const value = JSON.parse(await readFile(resolve(referenceArg), "utf8")); reference = value.published ?? value; }
  const { snapshot, bundle, ref } = await loadHistoryInputs(cache, reference), input = collectCurrentFdv(snapshot, bundle, ref, now);
  await writeFile(join(cache, "reference.json"), JSON.stringify(ref, null, 2));
  const db = connectHistory(), report = { schema: 1, mode: apply ? "apply" : "dry-run", status: "running", runId, publicationId: ref.id, sourceBundleSha256: ref.rawBundleSha256, providerRequests: 0, minimumReserve: 0,
    startedAt: now.toISOString(), completedAt: "", verifiedQuotes: input.assets.reduce((n, item) => n + item.points.length, 0), heldQuotes: input.heldQuotes, selectedCells: 0, pendingCells: 0, processedCells: 0, alreadyPresent: 0, heldCells: 0, rowsWritten: 0, daysWritten: 0, estimatedWrites: 0, runEstimatedWrites: 0, lastAttemptedBatch: null as string | null, error: null as string | null };
  const save = async () => { const path = join(cache, "current-fdv-report.json"); await writeFile(path + ".tmp", JSON.stringify(report, null, 2)); await rename(path + ".tmp", path); };
  let tracked = false, initial = 0;
  try {
    const plan = await planFdvRecovery(db, input.assets), entries = plan.assets.flatMap(item => item.points.map(point => ({ asset: item.asset, day: point.day, fdv: point.fdv!, source: item.sources.find(source => source.key === point.fdv!.source)! })));
    report.selectedCells = entries.length; report.pendingCells = entries.length; report.alreadyPresent = plan.alreadyPresent; report.heldCells = plan.held;
    if (!apply) report.status = "dry-run";
    else if (!entries.length) report.status = "complete";
    else if (Date.now() >= deadline) report.status = "time-paused";
    else {
      await initializeDailyRaw(db); initial = (await getDailyRawRun(db, runId))?.estimatedWrites ?? 0; tracked = true;
      await openDailyRawRun(db, { id: runId, maxEstimatedWrites: allowance, minimumReserve: 0, now });
      for (let offset = 0; offset < entries.length; offset += 300) {
        if (Date.now() >= deadline) { report.status = "time-paused"; break; }
        const batch = entries.slice(offset, offset + 300), cursor = objectHash([ref.sha256, ref.rawBundleSha256, batch]);
        report.lastAttemptedBatch = `current-fdv:${cursor}`;
        const result = await captureMissingDailyFdv(db, { runId, entries: batch, now, minimumReserve: 0, checkpoint: { key: report.lastAttemptedBatch, cursor, status: "complete" } });
        report.processedCells += batch.length; report.pendingCells -= batch.length; report.rowsWritten += result.rowsWritten; report.daysWritten += result.daysWritten;
        await save(); console.log(JSON.stringify({ event: "current-fdv-progress", written: report.daysWritten, pending: report.pendingCells }));
      }
      if (!report.pendingCells) report.status = "complete";
    }
  } catch (error) { report.status = error instanceof HistoryBudgetExceeded ? "budget-paused" : "failed"; if (report.status === "failed") report.error = "current_fdv_failed_inspect_checkpoint_before_retry"; }
  finally { if (tracked) { report.runEstimatedWrites = (await getDailyRawRun(db, runId))?.estimatedWrites ?? 0; report.estimatedWrites = report.runEstimatedWrites - initial; } report.completedAt = new Date().toISOString(); await save(); db.close(); }
  console.log(JSON.stringify(report));
  if (report.status === "failed") process.exitCode = 1; else if (apply && report.status !== "complete") process.exitCode = 2;
}
main(process.argv.slice(2)).catch(() => { console.error("daily_fdv_capture_failed_before_writing_or_report"); process.exitCode = 1; });
