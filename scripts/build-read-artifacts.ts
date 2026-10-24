import type { Client } from "@libsql/client";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, gzipSync } from "node:zlib";
import { buildTableCatalog } from "../lib/tableCatalog";
import { readDailyValuationHistoryFull } from "../lib/dailyValuationRead";
import { compactDailyHistory, type CompactHistoryEnvelope } from "../lib/dailyValuationCompact";
import { calculateDailyValuation, dailyComparisonMetric, dailyValuationAsOf } from "../lib/dailyValuation";
import { eligibleCapital } from "../lib/capitalEligibility";
import { mapHistoricalPositions } from "../lib/discoveryMetrics";
import { objectHash } from "../lib/sourceBundle";
import { READ_ARTIFACT_BASE, READ_ARTIFACT_VERSION, assertArtifactManifest, type ArtifactManifest, type MapArtifact, type ComparisonArtifact } from "../lib/readArtifacts";
import type { PublicationJournal } from "../lib/publicationTypes";
import type { ScreenerResponse } from "../lib/types";

export async function buildReadArtifacts(db: Client, snapshot: ScreenerResponse, publication: PublicationJournal, output: string, tag: string, inputKey: string) {
  if (db.protocol !== "file" || !publication.published || !/^screener-read-[a-zA-Z0-9-]+$/.test(tag)) throw Error("read_artifact_local_source_required");
  await mkdir(output, { recursive: true });
  const ref = publication.published, built = buildTableCatalog(snapshot, ref), { asOf } = dailyValuationAsOf(snapshot);
  const manifest: ArtifactManifest = { schema: 1, version: READ_ARTIFACT_VERSION, inputKey, createdAt: new Date().toISOString(), publication: ref, files: {}, history: {}, remoteDatabase: { reads: 0, writes: 0 } };
  const save = async (name: string, value: unknown) => {
    const data = gzipSync(JSON.stringify(value), { level: 6 }), sha256 = createHash("sha256").update(data).digest("hex");
    await writeFile(join(output, name), data); manifest.files[name] = { url: `${READ_ARTIFACT_BASE}${tag}/${name}`, sha256 };
  };
  await save("catalog.json.gz", built.catalog); await save("publication.json.gz", publication);
  for (const [hash, shard] of built.shards) await save(`detail-${hash}.json.gz`, shard);
  const map: MapArtifact = {}, comparisons: ComparisonArtifact = {}, shards: Record<string, Record<string, CompactHistoryEnvelope>> = {};
  let processed = 0, points = 0;
  for (const entry of built.catalog.entries) {
    if (entry.binding.identityStatus !== "verified") continue;
    const fdv = await readDailyValuationHistoryFull(db, { coin: entry.binding, snapshot: { updatedAt: snapshot.updatedAt, publication }, capital: "fdv", from: "1900-01-01", to: asOf });
    if (!fdv) continue;
    const sources = new Map(fdv.sources.map(item => [item.key, item]));
    const mcap = fdv.points.map(point => calculateDailyValuation({ point, sources, capital: "mcap", eligible: eligibleCapital(entry.binding), completedThrough: asOf }));
    const data = compactDailyHistory(fdv.points, mcap, fdv.sources), json = JSON.stringify(data), sha256 = createHash("sha256").update(json).digest("hex");
    const revision = objectHash([ref.sha256, entry.row.identity, asOf, sha256]);
    const bucket = parseInt(createHash("sha256").update(entry.row.slug).digest("hex").slice(0, 2), 16) % 64, file = `history-${bucket.toString(16).padStart(2, "0")}.json.gz`;
    const { asset, freshness, convention } = fdv;
    (shards[file] ??= {})[entry.row.slug] = { schema: 3, calculationVersion: fdv.calculationVersion, asset, freshness, convention, asOf, revenueDays: 1, rawRevision: revision, encoding: "gzip-base64", sha256, payload: gzipSync(json).toString("base64") };
    manifest.history[entry.row.slug] = { file, identity: asset.identity, revision };
    comparisons[entry.row.slug] = {
      fdv: { pr: dailyComparisonMetric(fdv.points, "pr", asOf, false), phr: dailyComparisonMetric(fdv.points, "phr", asOf, false) },
      mcap: { pr: dailyComparisonMetric(mcap, "pr", asOf, false), phr: dailyComparisonMetric(mcap, "phr", asOf, false) },
    };
    if (entry.features.amounts.revenue[30]! > 0) map[entry.row.slug] = Object.fromEntries((["fdv", "mcap"] as const).map(capital => [capital,
      mapHistoricalPositions({ points: eligibleCapital(entry.binding) ? fdv.points : [], sources: fdv.sources, asOf, capital, currentRevenue: entry.features.amounts.revenue[30]! })])) as MapArtifact[string];
    points += data.points.length;
    if (++processed % 100 === 0) console.log(JSON.stringify({ event: "read-artifacts", processed, points, remoteDatabaseRequests: 0 }));
  }
  for (const [name, data] of Object.entries(shards)) await save(name, data);
  await save("map.json.gz", map); await save("comparisons.json.gz", comparisons);
  return { manifest, processed, points };
}
export async function sealReadArtifacts(manifest: ArtifactManifest, database: string, output: string, tag: string) {
  const file = join(output, "history.sqlite.gz"), digest = createHash("sha256");
  await pipeline(createReadStream(database), createGzip({ level: 6 }), createWriteStream(file));
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  manifest.files["history.sqlite.gz"] = { url: `${READ_ARTIFACT_BASE}${tag}/history.sqlite.gz`, sha256: digest.digest("hex") };
  assertArtifactManifest(manifest);
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest));
}
