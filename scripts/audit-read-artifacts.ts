import { createClient } from "@libsql/client";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { assertArtifactManifest, type ArtifactManifest, type MapArtifact } from "../lib/readArtifacts";
import { readMapHistoryBatch } from "../lib/dailyValuationRead";
import { decodeCompactHistory, type CompactHistoryEnvelope } from "../lib/dailyValuationCompact";
import type { TableCatalog } from "../lib/tableCatalog";
import { MAP_PERIODS } from "../lib/discoveryTypes";

async function main() {
  const [directory, database] = process.argv.slice(2); if (!directory || !database) throw Error("Local artifact directory and database required");
  const manifest: ArtifactManifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")); assertArtifactManifest(manifest);
  let bytes = 0;
  for (const [name, ref] of Object.entries(manifest.files)) {
    const hash = createHash("sha256"); for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
    if (hash.digest("hex") !== ref.sha256) throw Error(`Invalid hash: ${name}`); bytes += (await stat(join(directory, name))).size;
  }
  const json = async <T>(file: string): Promise<T> => JSON.parse(gunzipSync(await readFile(join(directory, file))).toString());
  const catalog = await json<TableCatalog>("catalog.json.gz"), map = await json<MapArtifact>("map.json.gz"), db = createClient({ url: pathToFileURL(resolve(database)).href });
  const report = { publicationId: manifest.publication.id, files: Object.keys(manifest.files).length, bytes, histories: 0, points: 0, mapComparisons: 0, remoteDatabaseRequests: 0, filters: [] as unknown[] };
  try {
    for (const file of new Set(Object.values(manifest.history).map(entry => entry.file))) {
      const shard = await json<Record<string, CompactHistoryEnvelope>>(file);
      for (const [slug, envelope] of Object.entries(shard)) {
        const entry = manifest.history[slug];
        if (!entry || entry.file !== file || entry.identity !== envelope.asset.identity || envelope.asset.snapshotId !== manifest.publication.id) throw Error(`Invalid history binding: ${slug}`);
        const decoded = await decodeCompactHistory(envelope); report.histories++; report.points += decoded.data.points.length;
      }
    }
    for (const capital of ["fdv", "mcap"] as const) {
      const eligible = catalog.entries.filter(entry => entry.cells[capital].pr.value! > 0 && entry.features.amounts.revenue[30]! > 0);
      for (let start = 0; start < eligible.length; start += 200) {
        const entries = eligible.slice(start, start + 200), raw = await readMapHistoryBatch({ db, capital, coins: entries.map(entry => ({ ...entry.binding, revenue30d: entry.features.amounts.revenue[30]! })), snapshot: { updatedAt: catalog.metadata.updatedAt, publication: { published: manifest.publication } } });
        for (const entry of entries) for (const period of MAP_PERIODS) {
          const actual = map[entry.row.slug]?.[capital]?.[period], expected = raw.get(entry.row.slug)?.[period];
          for (const field of ["point", "revenue"] as const) if (JSON.stringify(actual?.[field] ?? null) !== JSON.stringify(expected?.[field] ?? null)) throw Error(`Map/raw mismatch: ${entry.row.slug}:${capital}:${period}:${field}`);
          report.mapComparisons++;
        }
      }
      for (const period of MAP_PERIODS) {
        const entries = eligible.filter(entry => entry.row.mcap! >= 100000);
        const growth = entries.filter(entry => { const old = map[entry.row.slug]?.[capital]?.[period]?.revenue; return old && entry.features.amounts.revenue[30]! > old.value; });
        report.filters.push({ capital, period, eligible: entries.length, revenueComparable: entries.filter(entry => map[entry.row.slug]?.[capital]?.[period]?.revenue).length, prComparable: entries.filter(entry => map[entry.row.slug]?.[capital]?.[period]?.point).length, revenueGrowth: growth.length, growthAndLowerPr: growth.filter(entry => { const old = map[entry.row.slug]?.[capital]?.[period]?.point; return old && entry.cells[capital].pr.value! < old.pr; }).length });
      }
    }
  } finally { db.close(); }
  await writeFile(join(directory, "audit.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
