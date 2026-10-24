import { createClient } from "@libsql/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { cachedArchive, loadHistoryInputs } from "../lib/historyCollection";
import { combineDailyRawAssets, snapshotDailyRaw, type CollectedDailyRawAsset } from "../lib/dailyRawCollection";
import { captureMissingLocalMarket } from "../lib/dailyRawMarketCapture";
import { initializeDailyRaw, openDailyRawRun } from "../lib/dailyRawDatabase";
import type { FdvRecoveryManifest } from "../lib/dailyRawFdvRecovery";
import type { ScreenerResponse } from "../lib/types";

async function main() {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  if (!arg("--cache") || !arg("--database")) throw Error("local_market_inputs_required");
  const cache = resolve(arg("--cache")!); await mkdir(cache, { recursive: true });
  if (spawnSync("git", ["-C", cache, "rev-parse", "--show-toplevel"], { windowsHide: true }).status === 0) throw Error("local_market_cache_inside_git");
  const reference = arg("--reference") ? JSON.parse(await readFile(resolve(arg("--reference")!), "utf8")) : undefined;
  const { snapshot, ref } = await loadHistoryInputs(cache, reference), current = new Map(snapshot.coins.map(coin => [coin.slug, coin]));
  const manifest: FdvRecoveryManifest | null = arg("--manifest") ? JSON.parse(await readFile(resolve(arg("--manifest")!), "utf8")) : null;
  if (manifest && (manifest.schema !== 1 || !Array.isArray(manifest.sources) || manifest.sources.length > 100)) throw Error("local_market_manifest_invalid");
  const groups = new Map<string, CollectedDailyRawAsset[]>();
  const collect = (captured: ScreenerResponse, url: string, sha256: string) => {
    if (!Array.isArray(captured.coins) || !Number.isFinite(Date.parse(captured.updatedAt))) throw Error("local_market_snapshot_invalid");
    for (const coin of captured.coins) {
      const target = current.get(coin.slug); if (!target) continue;
      const item = snapshotDailyRaw(coin, target, { ...ref, url, sha256, dataAt: captured.updatedAt });
      item.points = item.points.map(({ day, price, mcap }) => ({ day, ...(price ? { price } : {}), ...(mcap ? { mcap } : {}) })).filter(point => point.price || point.mcap);
      item.sources = item.sources.filter(source => source.metric === "price" || source.metric === "mcap");
      if (item.points.length) groups.set(coin.slug, [...groups.get(coin.slug) ?? [], item]);
    }
  };
  for (const source of manifest?.sources ?? []) {
    const captured = JSON.parse(gunzipSync(await cachedArchive(source.url, source.sha256, cache), { maxOutputLength: 150_000_000 }).toString()) as ScreenerResponse;
    collect(captured, source.url, source.sha256);
  }
  collect(snapshot, ref.url, ref.sha256);
  const db = createClient({ url: pathToFileURL(resolve(arg("--database")!)).href }), runId = arg("--run-id") ?? `local-market-${ref.sha256.slice(0, 24)}`;
  try {
    await initializeDailyRaw(db, { unmeteredLocal: true }); await openDailyRawRun(db, { id: runId, maxEstimatedWrites: 1_000_000, minimumReserve: 0 });
    const cells = await captureMissingLocalMarket(db, [...groups.values()].map(items => combineDailyRawAssets(items[0].asset, items)), runId);
    const report = { status: "complete", publicationId: ref.id, cells, remoteDatabase: { reads: 0, writes: 0 } };
    await writeFile(join(cache, "local-market-report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { db.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "local_market_failed"); process.exitCode = 1; });
