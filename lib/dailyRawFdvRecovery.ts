import type { Client } from "@libsql/client";
import { gunzipSync } from "node:zlib";
import { cachedArchive, loadHistoryInputs } from "./historyCollection";
import { historyRead } from "./historyDatabase";
import { contentHash, objectHash, validateSourceBundle, type SourceBundle } from "./sourceBundle";
import { combineDailyRawAssets, originalCapturedFdv, type CollectedDailyRawAsset } from "./dailyRawCollection";
import { indexCapturedFdvQuotes } from "./dailyRawFdvValidation";
import type { PublishedSnapshot } from "./publicationTypes";
import type { CoinRaw } from "./types";

export interface FdvRecoveryManifest {
  schema: 1; reference: PublishedSnapshot;
  sources: { url: string; sha256: string; bundleSha256: string }[];
}
const archive = /^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/data-[A-Za-z0-9-]+\/data\.json\.gz$/;
const hash = /^[a-f0-9]{64}$/;
/** A reviewed repair replays existing primary originals. It never accepts a supplied FDV value. */
export async function collectFdvRecovery(manifest: FdvRecoveryManifest, cache: string, now = new Date(), progress?: (value: { source: number; assets: number }) => void) {
  if (manifest.schema !== 1 || !Array.isArray(manifest.sources) || !manifest.sources.length || manifest.sources.length > 100
    || manifest.sources.some(source => !archive.test(source.url) || !hash.test(source.sha256) || !hash.test(source.bundleSha256))
    || new Set(manifest.sources.map(source => source.url)).size !== manifest.sources.length) throw Error("daily_fdv_recovery_manifest");
  const { snapshot, ref } = await loadHistoryInputs(cache, manifest.reference), current = new Map(snapshot.coins.map(coin => [coin.slug, coin]));
  const beforeDay = [now.toISOString().slice(0, 10), ref.dataAt.slice(0, 10)].sort()[0];
  const groups = new Map<string, CollectedDailyRawAsset[]>(); let originalQuotes = 0, heldQuotes = 0;
  for (let i = 0; i < manifest.sources.length; i++) {
    const source = manifest.sources[i], bytes = await cachedArchive(source.url, source.sha256, cache);
    const captured = JSON.parse(gunzipSync(bytes, { maxOutputLength: 150_000_000 }).toString("utf8")) as { updatedAt: string; coins: CoinRaw[]; pipeline?: { rawBundleSha256: string } };
    if (!Array.isArray(captured.coins) || !Number.isFinite(Date.parse(captured.updatedAt)) || captured.pipeline?.rawBundleSha256 !== source.bundleSha256) throw Error("daily_fdv_recovery_original_pin");
    const bundleBytes = await cachedArchive(source.url.replace(/data\.json\.gz$/, "source-bundle.json.gz"), source.bundleSha256, cache);
    const bundle = JSON.parse(gunzipSync(bundleBytes, { maxOutputLength: 500_000_000 }).toString("utf8")) as SourceBundle;
    validateSourceBundle(bundle);
    const index = indexCapturedFdvQuotes(bundle.receipts);
    if (index.issues.length) throw Error("daily_fdv_recovery_original_receipt");
    for (const coin of captured.coins) {
      const currentCoin = current.get(coin.slug); if (!currentCoin) continue;
      const item = originalCapturedFdv(coin, currentCoin, { ...ref, url: source.url, sha256: source.sha256, dataAt: captured.updatedAt }, index);
      item.points = item.points.filter(point => point.day < beforeDay);
      heldQuotes += item.issues?.length ?? 0; originalQuotes += item.points.length;
      if (item.points.length) groups.set(coin.slug, [...groups.get(coin.slug) ?? [], item]);
    }
    progress?.({ source: i + 1, assets: groups.size });
  }
  return { reference: ref, manifestSha256: contentHash(JSON.stringify(manifest)), originalQuotes, heldQuotes,
    assets: [...groups.values()].map(items => combineDailyRawAssets(items[0].asset, items)) };
}
/** Only genuinely empty cells qualify. Conflicts, holds and existing values are untouched. */
export async function planFdvRecovery(db: Client, input: CollectedDailyRawAsset[]) {
  const assets: CollectedDailyRawAsset[] = []; let alreadyPresent = 0, held = 0;
  for (let offset = 0; offset < input.length; offset += 300) {
    const batch = input.slice(offset, offset + 300), wanted = batch.flatMap(item => item.points.map(point => ({ ...item.asset, day: point.day })));
    const result = await historyRead(db, { sql: `SELECT a.slug,a.identity,d.day,d.fdv_state,d.fdv_source,d.fdv_at FROM json_each(?) w
      JOIN daily_raw_assets a ON a.slug=json_extract(w.value,'$.slug') AND a.identity=json_extract(w.value,'$.identity')
      JOIN daily_raw_days d ON d.asset_id=a.id AND d.day=json_extract(w.value,'$.day')`, args: [JSON.stringify(wanted)] });
    const rows = new Map(result.rows.map(row => [objectHash([row.slug, row.identity, row.day]), row]));
    for (const item of batch) {
      const points = item.points.filter(point => {
        const row = rows.get(objectHash([item.asset.slug, item.asset.identity, point.day]));
        if (!row || row.fdv_state === 0 && row.fdv_source === null && row.fdv_at === null) return true;
        if (row.fdv_state === 5) held++; else alreadyPresent++; return false;
      });
      if (points.length) { const keys = new Set(points.map(point => point.fdv!.source)); assets.push({ asset: item.asset, points, sources: item.sources.filter(source => keys.has(source.key)) }); }
    }
  }
  return { assets, alreadyPresent, held };
}
