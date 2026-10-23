import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { collectFdvRecovery, planFdvRecovery, type FdvRecoveryManifest } from "../lib/dailyRawFdvRecovery";
import { connectHistory, HistoryBudgetExceeded } from "../lib/historyDatabase";
import { getDailyRawRun, initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "../lib/dailyRawDatabase";
import { objectHash } from "../lib/sourceBundle";
import { contentHash } from "../lib/sourceBundle";
import { loadCoinMetricsManifest } from "../lib/dailyRawCoinMetrics";
import { combineDailyRawAssets } from "../lib/dailyRawCollection";
import { loadArchivedSnapshot } from "../lib/historyCollection";

async function main(argv: string[]) {
  if (argv.includes("--help")) { console.log("recover-captured-fdv.ts --cache <outside-Git-dir> --manifest <reviewed-manifest.json> [--coinmetrics-manifest <verified-local-manifest.json>] [--database <local.sqlite>] [--run-id stable-id] [--max-estimated-writes 50000] [--time-budget-seconds 1500] [--apply]\nDefault is SELECT-only. Replays pinned originals, fills only empty completed-day FDV with CAS, retains all held/conflicting/existing cells. This bounded repair uses maintenance headroom; no provider requests, paid sources, supply estimates or quota overrides."); return; }
  const flags = new Set(["--cache", "--manifest", "--coinmetrics-manifest", "--database", "--run-id", "--max-estimated-writes", "--time-budget-seconds", "--apply"]), seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) { const flag = argv[i]; if (!flags.has(flag) || seen.has(flag)) throw Error("daily_fdv_recovery_argument"); seen.add(flag); if (flag !== "--apply" && (!argv[++i] || argv[i].startsWith("--"))) throw Error("daily_fdv_recovery_argument"); }
  const arg = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const integer = (name: string, fallback: number, min: number, max: number) => { const text = arg(name), value = text === undefined ? fallback : Number(text); if (text !== undefined && !/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) throw Error("daily_fdv_recovery_argument"); return value; };
  if (!arg("--cache") || !arg("--manifest")) throw Error("daily_fdv_recovery_inputs_required");
  await mkdir(resolve(arg("--cache")!), { recursive: true }); const cache = await realpath(resolve(arg("--cache")!));
  if (spawnSync("git", ["-C", cache, "rev-parse", "--show-toplevel"], { windowsHide: true }).status === 0) throw Error("daily_fdv_recovery_cache_inside_git");
  const apply = argv.includes("--apply"), now = new Date(), allowance = integer("--max-estimated-writes", 50_000, 8, 50_000), deadline = Date.now() + integer("--time-budget-seconds", 1500, 1, 1800) * 1000;
  const runId = arg("--run-id") ?? `fdv-repair-${now.toISOString().replace(/[:.]/g, "-")}`;
  const manifest = JSON.parse(await readFile(resolve(arg("--manifest")!), "utf8")) as FdvRecoveryManifest;
  const input = await collectFdvRecovery(manifest, cache, now, progress => console.log(JSON.stringify({ event: "fdv-original-verified", ...progress })));
  const coinMetricsPath = arg("--coinmetrics-manifest"); let coinMetricsManifestSha256: string | null = null;
  if (coinMetricsPath) {
    const path = resolve(coinMetricsPath), snapshot = await loadArchivedSnapshot(input.reference, cache);
    const metrics = await loadCoinMetricsManifest(path, dirname(path), snapshot.coins);
    coinMetricsManifestSha256 = contentHash(await readFile(path));
    const groups = new Map(input.assets.map(item => [item.asset.slug, [item]]));
    for (const item of metrics.assets) {
      item.points = item.points.filter(point => point.fdv?.state === "complete" && point.day < now.toISOString().slice(0, 10));
      if (item.points.length) groups.set(item.asset.slug, [...groups.get(item.asset.slug) ?? [], item]);
    }
    input.assets = [...groups.values()].map(items => combineDailyRawAssets(items[0].asset, items));
  }
  await writeFile(join(cache, "reference.json"), JSON.stringify(input.reference, null, 2));
  const local = arg("--database"), db = local ? createClient({ url: pathToFileURL(resolve(local)).href }) : connectHistory();
  const report = { schema: 1, mode: apply ? "apply" : "dry-run", status: "running", runId, publicationId: input.reference.id, manifestSha256: input.manifestSha256, coinMetricsManifestSha256,
    startedAt: now.toISOString(), completedAt: "", minimumReserve: 0, maxEstimatedWrites: allowance, providerRequests: 0, originalQuotes: input.originalQuotes, heldQuotes: input.heldQuotes,
    selectedAssets: 0, selectedDates: 0, alreadyPresent: 0, heldCells: 0, processed: 0, pendingAssets: 0, daysWritten: 0, runEstimatedWrites: 0, estimatedWriteUpperBound: 0, error: null as string | null };
  const save = async () => { const file = join(cache, "fdv-recovery-report.json"); await writeFile(file + ".tmp", JSON.stringify(report, null, 2)); await rename(file + ".tmp", file); };
  try {
    const plan = await planFdvRecovery(db, input.assets);
    report.selectedAssets = plan.assets.length; report.selectedDates = plan.assets.reduce((n, item) => n + item.points.length, 0);
    report.pendingAssets = plan.assets.length; report.alreadyPresent = plan.alreadyPresent; report.heldCells = plan.held;
    report.estimatedWriteUpperBound = plan.assets.reduce((n, item) => n + item.sources.length * 4 + item.points.length * 3 + 8, 0) + Number(plan.assets.length > 0) * 5;
    if (!apply) report.status = "dry-run";
    else if (!plan.assets.length) report.status = "complete";
    else if (report.estimatedWriteUpperBound > allowance) report.status = "budget-paused";
    else if (Date.now() >= deadline) report.status = "time-paused";
    else {
      await initializeDailyRaw(db);
      await openDailyRawRun(db, { id: runId, maxEstimatedWrites: allowance, minimumReserve: 0, now });
      for (const item of plan.assets) {
        if (Date.now() >= deadline) { report.status = "time-paused"; break; }
        const result = await upsertDailyRaw(db, { runId, ...item, minimumReserve: 0, now,
          expectedCells: item.points.map(point => ({ day: point.day, metric: "fdv", sourceKey: "", value: null, state: 0, at: null })),
          checkpoint: { key: `fdv-repair:${objectHash(item.asset)}`, cursor: objectHash([input.manifestSha256, item.points]), status: "complete" } });
        report.processed++; report.pendingAssets--; report.daysWritten += result.daysWritten;
        if (report.processed % 50 === 0) { await save(); console.log(JSON.stringify({ event: "fdv-repair-progress", processed: report.processed, pending: report.pendingAssets, dates: report.daysWritten })); }
      }
      if (!report.pendingAssets) report.status = "complete";
    }
  } catch (error) { if (error instanceof HistoryBudgetExceeded) report.status = "budget-paused"; else { report.status = "failed"; report.error = "fdv_repair_failed_inspect_before_retry"; } }
  finally {
    report.runEstimatedWrites = (await getDailyRawRun(db, runId))?.estimatedWrites ?? 0; report.completedAt = new Date().toISOString(); await save(); db.close();
  }
  console.log(JSON.stringify(report));
  if (report.status === "failed") process.exitCode = 1; else if (apply && report.status !== "complete") process.exitCode = 2;
}
main(process.argv.slice(2)).catch(() => { console.error("daily_fdv_recovery_failed_before_writing_or_report"); process.exitCode = 1; });
