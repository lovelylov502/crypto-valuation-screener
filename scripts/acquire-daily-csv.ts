import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { acquireDailyRawCsv, type DailyRawCsvFile, type DailyRawCsvManifest } from "../lib/dailyRawCollection";

export async function acquireCsvUniverse(options: { cache: string; universe: string; maxCsv?: number; timeBudgetSeconds?: number; requestIntervalMs?: number }) {
  const { cache } = options, started = Date.now();
  await mkdir(cache, { recursive: true });
  const realCache = await realpath(cache), git = spawnSync("git", ["-C", realCache, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true });
  if (git.status === 0) throw Error("daily_raw_cache_must_be_outside_git");
  const raw: unknown = JSON.parse(await readFile(options.universe, "utf8"));
  const universe = (Array.isArray(raw) ? raw : raw && typeof raw === "object" && "coins" in raw ? raw.coins : null) as Record<string, unknown>[] | null;
  if (!Array.isArray(universe)) throw Error("daily_raw_universe_schema");
  const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
  const cashflow = (coin: Record<string, unknown>) => [coin.revenue24h, coin.revenue30d, coin.holdersRevenue30d, coin.holderRevenue30d, coin.holderRevenueAnnual].some(positive);
  const ids = [...new Set([...universe].sort((a, b) => Number(cashflow(b)) - Number(cashflow(a)) || Number(positive(b.fdv)) - Number(positive(a.fdv)) || Number(b.mcap ?? 0) - Number(a.mcap ?? 0)).map(coin => coin.geckoId).filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(id)))];
  const files = new Map<string, DailyRawCsvFile>(), manifestPath = join(cache, "csv-manifest.json");
  try {
    const previous = JSON.parse(await readFile(manifestPath, "utf8")) as DailyRawCsvManifest;
    if (previous.schema !== 1 || !Array.isArray(previous.files)) throw Error("daily_raw_csv_manifest_schema");
    for (const file of previous.files) files.set(file.geckoId, file);
  } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  const report = { schema: 1, startedAt: new Date(started).toISOString(), completedAt: "", status: "running", universe: ids.length, requests: 0, fetched: 0, cached: 0, unavailable: 0, deferred: 0, pending: 0, files: 0, issues: [] as { geckoId: string; reason: string }[] };
  const save = async () => {
    const manifest: DailyRawCsvManifest = { schema: 1, files: [...files.values()].sort((a, b) => a.geckoId.localeCompare(b.geckoId)) };
    const temporary = `${manifestPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest, null, 2)); await rename(temporary, manifestPath);
    report.files = files.size;
    await writeFile(join(cache, "csv-acquisition-report.json"), JSON.stringify(report, null, 2));
  };
  let lastRequest = 0, requestedAssets = 0, providerPaused = false, visited = 0;
  for (const geckoId of ids) {
    const time = !options.timeBudgetSeconds || Date.now() - started < options.timeBudgetSeconds * 1000;
    const allowed = time && !providerPaused && (options.maxCsv === undefined || requestedAssets < options.maxCsv);
    let requested = false;
    try {
      const result = await acquireDailyRawCsv(geckoId, cache, { allowRequest: allowed, onRequest: async () => {
        if (!requested) { requested = true; requestedAssets++; }
        const delay = Math.max(0, (options.requestIntervalMs ?? 1000) - (Date.now() - lastRequest));
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        lastRequest = Date.now(); report.requests++;
      } });
      if (result.file) {
        // Keep public archival and reviewed timestamp metadata added after acquisition.
        const previous = files.get(geckoId);
        files.set(geckoId, previous?.sha256 === result.file.sha256 ? { ...result.file, ...previous, path: result.file.path } : result.file);
      }
      if (result.status === "cached") report.cached++;
      else if (result.status === "fetched") report.fetched++;
      else if (result.status === "deferred") { report.deferred++; providerPaused ||= [401, 403, 429].includes(result.httpStatus ?? 0); }
      else if (requested || result.retryAt) report.unavailable++;
      else report.pending++;
    } catch { report.issues.push({ geckoId, reason: "daily_raw_csv_asset_failed" }); }
    // Each successful immutable checkpoint precedes this resumable manifest.
    if (requested || ++visited % 100 === 0) await save();
    if (requested && requestedAssets % 25 === 0) console.log(JSON.stringify({ event: "csv-progress", requestedAssets, fetched: report.fetched, cached: report.cached, files: files.size }));
  }
  report.completedAt = new Date().toISOString();
  report.status = providerPaused ? "provider-paused" : report.pending ? "pending" : report.issues.length || report.unavailable ? "partial" : "complete";
  await save(); return report;
}

async function main() {
  const argv = process.argv.slice(2), arg = (name: string) => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index + 1]; };
  const cache = resolve(arg("--cache") ?? join(homedir(), ".codex", "cache", "crypto-valuation-screener", "daily-raw"));
  const count = (name: string) => { const value = arg(name); if (value === undefined) return undefined; const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw Error(`Invalid ${name}`); return number; };
  const requestIntervalMs = count("--request-interval-ms") ?? 1000;
  if (requestIntervalMs < 1000) throw Error("CSV requests require at least 1000ms spacing");
  const report = await acquireCsvUniverse({ cache, universe: resolve(arg("--universe") ?? join(cache, "universe.json")), maxCsv: count("--max-csv"), timeBudgetSeconds: count("--time-budget-seconds"), requestIntervalMs });
  console.log(JSON.stringify(report));
}
if (process.argv[1] && basename(process.argv[1]) === "acquire-daily-csv.ts") {
  main().catch(() => { console.error("daily_raw_csv_acquisition_failed"); process.exitCode = 1; });
}
