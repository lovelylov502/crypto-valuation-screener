import { getPublication, getScreener, publicPublication } from "./serverScreener";
import { publicFreshness } from "./datedFreshness";
import { connectHistory } from "./historyDatabase";
import { decodeDailyReadModel, readDailyReadModels } from "./dailyReadModelDatabase";
import { buildTableCatalog, coinIdentity, queryTableCatalog, TABLE_CATALOG_NAMESPACE, TABLE_DETAIL_NAMESPACE, tableHash, type TableCatalog, type TableShard } from "./tableCatalog";
import { TABLE_MODEL_VERSION, type TableDetail } from "./tableDto";
import { fundamentalErrors } from "./fundamentalContract";
import type { PublishedSnapshot, PublicationJournal } from "./publicationTypes";
import type { DailyValuationCoin } from "./dailyValuationRead";
import type { WorkspacePreferences } from "./workspacePreferences";
import { readPreparedDailyComparisonBatch } from "./dailyValuationPrepared";
import { HOSTED_DATABASE_ENABLED } from "./dataDeliveryPolicy";
import { currentArtifactSet, readArtifact, type ComparisonArtifact } from "./readArtifacts";
import { dailyValuationAsOf } from "./dailyValuation";

const catalogs = new Map<string, TableCatalog>(), fallbackCatalogs = new Map<string, TableCatalog>(), shards = new Map<string, TableShard>(), preparedShards = new Set<string>();
const remember = <T>(cache: Map<string, T>, key: string, value: T, limit: number) => { cache.set(key, value); while (cache.size > limit) cache.delete(cache.keys().next().value!); return value; };
function checkCatalog(catalog: TableCatalog, ref: PublishedSnapshot) {
  if (catalog.schema !== 1 || catalog.version !== TABLE_MODEL_VERSION || catalog.publicationId !== ref.id || catalog.snapshotSha256 !== ref.sha256 || catalog.metadata.updatedAt !== ref.dataAt || !Array.isArray(catalog.entries)
    || catalog.entries.some(entry => entry.row.slug !== entry.binding.slug || entry.row.identity !== coinIdentity(entry.binding) || !/^[a-f0-9]{64}$/.test(entry.detail.shard) || !/^[a-f0-9]{64}$/.test(entry.detail.hash))) throw Error("table_catalog_binding_mismatch");
  return catalog;
}
async function preparedCatalog(ref: PublishedSnapshot) {
  const cacheKey = `${ref.id}:${ref.sha256}`, existing = catalogs.get(cacheKey); if (existing) return existing;
  const db = connectHistory();
  try {
    const [row] = await readDailyReadModels(db, { namespace: TABLE_CATALOG_NAMESPACE, keys: [ref.id] });
    if (!row || row.revision !== ref.sha256) return null;
    return remember(catalogs, cacheKey, checkCatalog(decodeDailyReadModel<TableCatalog>(row), ref), 2);
  } finally { db.close(); }
}
export async function currentCatalog() {
  if (!HOSTED_DATABASE_ENABLED) {
    const { catalog, publication } = await currentArtifactSet();
    return { catalog: checkCatalog(catalog, publication.published!), publication, readModel: "prepared" as const };
  }
  const publication = await getPublication(), ref = publication.published;
  if (ref) try { const catalog = await preparedCatalog(ref); if (catalog) return { catalog, publication, readModel: "prepared" as const }; } catch { console.error("table_catalog_unavailable"); }
  const data = await getScreener(), actualPublication = data.publication, actual = actualPublication?.published;
  if (!actual || !actualPublication) throw Error("table_catalog_verified_publication_unavailable");
  const cacheKey = `${actual.id}:${actual.sha256}`, existing = fallbackCatalogs.get(cacheKey);
  if (existing) return { catalog: existing, publication: actualPublication, readModel: "snapshot-fallback" as const };
  const built = buildTableCatalog(data, actual);
  for (const [hash, shard] of built.shards) remember(shards, hash, shard, 4);
  return { catalog: remember(fallbackCatalogs, cacheKey, built.catalog, 2), publication: actualPublication, readModel: "snapshot-fallback" as const };
}
/** Cheap exact identity resolution for raw-history/version readers. */
export async function getTableCoinContext(slug: string): Promise<{ coin: DailyValuationCoin; snapshot: { updatedAt: string; publication: PublicationJournal } } | null> {
  if (!HOSTED_DATABASE_ENABLED) {
    const { catalog, publication } = await currentCatalog(), entry = catalog.entries.find(entry => entry.row.slug === slug);
    return entry ? { coin: entry.binding, snapshot: { updatedAt: catalog.metadata.updatedAt, publication } } : null;
  }
  const publication = await getPublication(), ref = publication.published;
  if (ref) try {
    const catalog = await preparedCatalog(ref);
    if (catalog) { const entry = catalog.entries.find(entry => entry.row.slug === slug); return entry ? { coin: entry.binding, snapshot: { updatedAt: catalog.metadata.updatedAt, publication } } : null; }
  } catch { console.error("table_identity_catalog_unavailable"); }
  const data = await getScreener(), coin = data.coins.find(coin => coin.slug === slug);
  if (!data.publication) throw Error("table_identity_publication_unavailable");
  return coin ? { coin, snapshot: { updatedAt: data.updatedAt, publication: data.publication } } : null;
}
export async function readTablePage(prefs: WorkspacePreferences, favorites: string[], page: number, size: number) {
  const { catalog, publication, readModel } = await currentCatalog(), result = queryTableCatalog(catalog, prefs, favorites, page, size, publicPublication(publication));
  if (catalog.metadata.freshness) result.publicFreshness = publicFreshness(catalog.metadata.freshness, Date.now());
  try {
    if (!HOSTED_DATABASE_ENABLED) {
      const set = await currentArtifactSet();
      if (set.catalog.publicationId !== catalog.publicationId) throw new TablePublicationChanged();
      const all = await readArtifact<ComparisonArtifact>(set.manifest, "comparisons.json.gz"), period = dailyValuationAsOf(catalog.metadata);
      result.valuationComparison = { schema: 1, capital: prefs.capital, revenueDays: 1, asOf: period.asOf, baseline: period.baseline,
        rows: Object.fromEntries(result.rows.filter(row => all[row.slug]).map(row => [row.slug, period.freshness.status === "stale" ? { pr: { status: "unavailable", validDays: 0, reason: "stale_data" }, phr: { status: "unavailable", validDays: 0, reason: "stale_data" } } : all[row.slug][prefs.capital]])) };
    } else result.valuationComparison = await readPreparedDailyComparisonBatch({ coins: result.rows.map(row => catalog.entries.find(entry => entry.row.slug === row.slug)!.binding), capital: prefs.capital, snapshot: { updatedAt: result.updatedAt, publication } });
  }
  catch { console.error("prepared_daily_comparison_unavailable"); }
  return { ...result, readModel };
}
export class TablePublicationChanged extends Error {}
export async function readTableDetail(slug: string, publicationId: string, identity: string): Promise<TableDetail | null> {
  if (HOSTED_DATABASE_ENABLED && (await getPublication()).published?.id !== publicationId) throw new TablePublicationChanged();
  const { catalog, publication } = await currentCatalog();
  if (publication.published?.id !== publicationId || catalog.publicationId !== publicationId) throw new TablePublicationChanged();
  const entry = catalog.entries.find(entry => entry.row.slug === slug); if (!entry) return null;
  if (entry.row.identity !== identity) throw new TablePublicationChanged();
  let shard = shards.get(entry.detail.shard);
  if (!shard && !HOSTED_DATABASE_ENABLED) {
    const set = await currentArtifactSet();
    if (set.catalog.publicationId !== publicationId) throw new TablePublicationChanged();
    shard = await readArtifact<TableShard>(set.manifest, `detail-${entry.detail.shard}.json.gz`);
    if (tableHash(shard) !== entry.detail.shard) throw Error("table_detail_shard_hash_mismatch");
    remember(shards, entry.detail.shard, shard, 4); preparedShards.add(entry.detail.shard);
  }
  if (!shard && HOSTED_DATABASE_ENABLED) {
    const db = connectHistory();
    try { const [row] = await readDailyReadModels(db, { namespace: TABLE_DETAIL_NAMESPACE, keys: [entry.detail.shard] }); if (row) { shard = decodeDailyReadModel<TableShard>(row); preparedShards.add(entry.detail.shard); } } finally { db.close(); }
    if (shard && tableHash(shard) !== entry.detail.shard) throw Error("table_detail_shard_hash_mismatch");
    if (shard) remember(shards, entry.detail.shard, shard, 4);
  }
  let coin = shard?.coins.find(coin => coin.slug === slug);
  if (!coin) { const data = await getScreener(); if (data.publication?.published?.id !== publicationId) throw new TablePublicationChanged(); coin = data.coins.find(coin => coin.slug === slug); }
  if (!coin || coinIdentity(coin) !== identity || tableHash(coin) !== entry.detail.hash || fundamentalErrors(coin).length) throw Error("table_detail_coin_binding_mismatch");
  return { schema: 1, publicationId, snapshotSha256: catalog.snapshotSha256, updatedAt: catalog.metadata.updatedAt, identity, coin, readModel: preparedShards.has(entry.detail.shard) ? "prepared" : "snapshot-fallback" };
}
