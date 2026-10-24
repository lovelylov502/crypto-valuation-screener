import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import source from "./read-artifact-source.json";
import type { PublicationJournal, PublishedSnapshot } from "./publicationTypes";
import type { TableCatalog } from "./tableCatalog";
import type { CompactHistoryEnvelope } from "./dailyValuationCompact";
import type { MapHistory, MapPeriod } from "./discoveryTypes";
import type { ValuationComparisonMetric } from "./valuationComparison";

export const READ_ARTIFACT_VERSION = 1;
export const READ_ARTIFACT_BASE = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/";
export interface ArtifactRef { url: string; sha256: string }
export interface ArtifactManifest {
  schema: 1; version: number; inputKey: string; createdAt: string; publication: PublishedSnapshot; files: Record<string, ArtifactRef>;
  history: Record<string, { file: string; identity: string; revision: string }>;
  remoteDatabase: { reads: 0; writes: 0 };
}
export type MapArtifact = Record<string, Record<"fdv" | "mcap", Record<MapPeriod, MapHistory>>>;
export type ComparisonArtifact = Record<string, Record<"fdv" | "mcap", { pr: ValuationComparisonMetric; phr: ValuationComparisonMetric }>>;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function assertArtifactRef(ref: ArtifactRef) {
  if (!ref || !/^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/screener-read-[a-zA-Z0-9-]+\/[a-zA-Z0-9.-]+$/.test(ref.url) || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error("read_artifact_invalid_reference");
}
export function assertArtifactManifest(value: ArtifactManifest) {
  if (!value || value.schema !== 1 || value.version !== READ_ARTIFACT_VERSION || !/^[a-f0-9]{64}$/.test(value.inputKey) || !value.publication?.id || !/^[a-f0-9]{64}$/.test(value.publication.sha256) || !value.files || !value.history || !Number.isFinite(Date.parse(value.createdAt))) throw Error("read_artifact_invalid_manifest");
  for (const [name, ref] of Object.entries(value.files)) { if (!/^[a-zA-Z0-9.-]+$/.test(name)) throw Error("read_artifact_invalid_name"); assertArtifactRef(ref); }
  for (const entry of Object.values(value.history)) if (!value.files[entry.file] || !/^[a-f0-9]{64}$/.test(entry.revision)) throw Error("read_artifact_invalid_history_index");
  if (!["catalog.json.gz", "publication.json.gz", "map.json.gz", "comparisons.json.gz", "history.sqlite.gz"].every(name => value.files[name])) throw Error("read_artifact_incomplete_manifest");
}
async function bytes(ref: ArtifactRef): Promise<Buffer> {
  assertArtifactRef(ref);
  const local = process.env.SCREENER_READ_ARTIFACT_DIR;
  let data: Buffer;
  if (local) data = await readFile(join(local, new URL(ref.url).pathname.split("/").at(-1)!));
  else {
    const response = await fetch(ref.url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok || Number(response.headers.get("content-length")) > 64 * 1024 * 1024) throw Error("read_artifact_unavailable");
    data = Buffer.from(await response.arrayBuffer());
  }
  if (data.length > 64 * 1024 * 1024 || hash(data) !== ref.sha256) throw Error("read_artifact_hash_mismatch");
  return data;
}
const objects = new Map<string, Promise<unknown>>();
export async function readArtifact<T>(manifest: ArtifactManifest, name: string): Promise<T> {
  const ref = manifest.files[name]; if (!ref) throw Error("read_artifact_not_prepared");
  let promise = objects.get(ref.sha256);
  if (!promise) {
    promise = bytes(ref).then(data => JSON.parse(gunzipSync(data, { maxOutputLength: 128 * 1024 * 1024 }).toString("utf8"))).catch(error => { objects.delete(ref.sha256); throw error; });
    objects.set(ref.sha256, promise);
    while (objects.size > 12) objects.delete(objects.keys().next().value!);
  }
  return await promise as T;
}
export interface ArtifactSet { manifest: ArtifactManifest; catalog: TableCatalog; publication: PublicationJournal }
let cached: ArtifactSet | null = null, until = 0, pending: Promise<ArtifactSet> | null = null, lastFailure: unknown = null;
async function verifiedSet(manifest: ArtifactManifest): Promise<ArtifactSet> {
  assertArtifactManifest(manifest);
  const [catalog, publication] = await Promise.all([readArtifact<TableCatalog>(manifest, "catalog.json.gz"), readArtifact<PublicationJournal>(manifest, "publication.json.gz")]);
  if (catalog.publicationId !== manifest.publication.id || catalog.snapshotSha256 !== manifest.publication.sha256 || publication.published?.id !== catalog.publicationId || publication.published.sha256 !== catalog.snapshotSha256 || catalog.metadata.updatedAt !== manifest.publication.dataAt) throw Error("read_artifact_publication_mismatch");
  return { manifest, catalog, publication };
}
async function resolveSet() {
  const local = process.env.SCREENER_READ_ARTIFACT_DIR;
  let manifest: ArtifactManifest;
  if (local) manifest = JSON.parse(await readFile(join(local, "manifest.json"), "utf8"));
  else {
    let pointer: ArtifactRef;
    try { const r = await fetch(source.index, { next: { revalidate: 600 }, signal: AbortSignal.timeout(8000) }); if (!r.ok) throw Error("read_artifact_pointer_unavailable"); pointer = await r.json(); }
    catch (error) { if (!source.fallback) throw error; pointer = source.fallback as ArtifactRef; }
    manifest = JSON.parse((await bytes(pointer)).toString("utf8"));
  }
  return verifiedSet(manifest);
}
/** Completed versions only; simultaneous cold requests share one load. No SQL fallback. */
export async function currentArtifactSet(): Promise<ArtifactSet> {
  if (cached && Date.now() < until) return cached;
  if (!cached && lastFailure && Date.now() < until) throw lastFailure;
  if (!pending) pending = resolveSet().then(value => { cached = value; lastFailure = null; until = Date.now() + 600_000; return value; }).catch(async error => {
    until = Date.now() + 60_000; if (cached) return cached;
    if (source.fallback && !process.env.SCREENER_READ_ARTIFACT_DIR) try {
      cached = await verifiedSet(JSON.parse((await bytes(source.fallback as ArtifactRef)).toString("utf8"))); return cached;
    } catch { /* A missing/corrupt pinned version is also unavailable, never a SQL fallback. */ }
    lastFailure = error; throw error;
  }).finally(() => { pending = null; });
  return pending;
}
export async function artifactHistory(set: ArtifactSet, slug: string) {
  const entry = set.manifest.history[slug]; if (!entry) return null;
  const shard = await readArtifact<Record<string, CompactHistoryEnvelope>>(set.manifest, entry.file), result = shard[slug];
  if (!result || result.asset.identity !== entry.identity || result.rawRevision !== entry.revision || result.asset.snapshotId !== set.catalog.publicationId) throw Error("read_artifact_history_binding_mismatch");
  return result;
}
