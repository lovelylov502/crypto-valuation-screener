import type { Client } from "@libsql/client";
import { buildTableCatalog, TABLE_CATALOG_NAMESPACE, TABLE_DETAIL_NAMESPACE } from "./tableCatalog";
import { deleteDailyReadModels, readModelMetadata, writeDailyReadModel } from "./dailyReadModelDatabase";
import { historyRead } from "./historyDatabase";
import type { PublishedSnapshot } from "./publicationTypes";
import type { ScreenerResponse } from "./types";

/** Publish the catalog last, so a failed/budget-paused build cannot point at absent shards. */
export async function prepareTableReadModel(db: Client, options: { data: ScreenerResponse; reference: PublishedSnapshot; runId: string; minimumReserve?: number; now?: Date }) {
  const { catalog, shards } = buildTableCatalog(options.data, options.reference), now = options.now ?? new Date();
  let changed = 0, estimatedWrites = 0, compressedBytes = 0, jsonBytes = 0;
  for (const [key, json] of shards) {
    const result = await writeDailyReadModel(db, { ...options, namespace: TABLE_DETAIL_NAMESPACE, key, revision: key, json, metadata: { schema: 1, coins: json.coins.length }, immutable: true });
    changed += Number(result.changed); estimatedWrites += result.estimatedWrites; compressedBytes += result.compressedBytes; jsonBytes += result.jsonBytes;
  }
  const result = await writeDailyReadModel(db, { ...options, namespace: TABLE_CATALOG_NAMESPACE, key: catalog.publicationId, revision: catalog.snapshotSha256, json: catalog,
    metadata: { schema: 1, publicationId: catalog.publicationId, snapshotSha256: catalog.snapshotSha256, dataAt: catalog.metadata.updatedAt, shards: [...shards.keys()] }, immutable: true });
  changed += Number(result.changed); estimatedWrites += result.estimatedWrites; compressedBytes += result.compressedBytes; jsonBytes += result.jsonBytes;

  // Pin the verified target even after a publication correction restores an older date.
  const entries = await historyRead(db, { sql: "SELECT model_key,metadata,metadata_sha256,built_at FROM daily_read_models WHERE namespace=?", args: [TABLE_CATALOG_NAMESPACE] });
  const catalogs = entries.rows.map(row => {
    const metadata = readModelMetadata(row) as { schema: number; publicationId: string; dataAt: string; shards: string[] };
    if (metadata.schema !== 1 || metadata.publicationId !== row.model_key || !Number.isFinite(Date.parse(metadata.dataAt)) || !Array.isArray(metadata.shards) || metadata.shards.some(key => !/^[a-f0-9]{64}$/.test(key))) throw Error("table_retention_metadata_invalid");
    return { key: String(row.model_key), ...metadata };
  }).sort((a, b) => b.dataAt.localeCompare(a.dataAt) || b.key.localeCompare(a.key));
  const target = catalogs.find(row => row.key === options.reference.id);
  if (!target) throw Error("table_retention_target_missing");
  const retained = [target, ...catalogs.filter(row => row.key !== target.key).slice(0, 1)], retainedKeys = new Set(retained.map(row => row.key)), referenced = new Set(retained.flatMap(row => row.shards));
  const detailRows = await historyRead(db, { sql: "SELECT model_key,built_at FROM daily_read_models WHERE namespace=?", args: [TABLE_DETAIL_NAMESPACE] });
  let deleted = 0;
  const remove = async (namespace: string, keys: string[]) => { for (let start = 0; start < keys.length; start += 500) { const removed = await deleteDailyReadModels(db, { runId: options.runId, namespace, keys: keys.slice(start, start + 500), minimumReserve: options.minimumReserve, now }); deleted += removed.deleted; estimatedWrites += removed.estimatedWrites; } };
  // Remove old manifests before their unreachable blobs; a partial cleanup remains safe.
  await remove(TABLE_CATALOG_NAMESPACE, catalogs.filter(row => !retainedKeys.has(row.key)).map(row => row.key));
  await remove(TABLE_DETAIL_NAMESPACE, detailRows.rows.filter(row => !referenced.has(String(row.model_key)) && Date.parse(String(row.built_at)) < now.getTime() - 86400_000).map(row => String(row.model_key)));
  return { status: "prepared" as const, publicationId: catalog.publicationId, snapshotSha256: catalog.snapshotSha256, projects: catalog.entries.length, shards: shards.size, changed, deleted, estimatedWrites, compressedBytes, jsonBytes };
}
