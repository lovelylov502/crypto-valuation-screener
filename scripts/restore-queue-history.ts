import { createClient } from "@libsql/client";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { contentHash } from "../lib/sourceBundle";
import { assertDailyRawQueue, type DailyRawQueueState } from "../lib/dailyRawQueue";
import type { DailyRawArchiveManifest } from "../lib/dailyRawArchive";
import { COINGECKO_CSV_CLOSE_SEMANTICS, parseDailyRawCsv } from "../lib/dailyRawCollection";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "../lib/dailyRawDatabase";

// Restore only receipts already acknowledged by the durable queue; no provider/hosted SQL calls.
async function main() {
  const [directory, database, after] = process.argv.slice(2);
  if (!directory || !database || !/^\d{4}-\d{2}-\d{2}$/.test(after)) throw Error("queue_cache_local_database_and_after_date_required");
  const queue = JSON.parse(await readFile(join(directory, "daily-raw-queue.json"), "utf8")) as DailyRawQueueState; assertDailyRawQueue(queue);
  const manifest = JSON.parse(await readFile(join(directory, "archive-manifest.json"), "utf8")) as DailyRawArchiveManifest;
  const wanted = Object.values(queue.entries).flatMap(entry => {
    const receipt = manifest.receipts.find(item => item.sha256 === entry.lastImportedSha256 && item.url === `https://www.coingecko.com/price_charts/export/${entry.geckoId}/usd.csv`);
    return receipt && receipt.observedAt! >= after ? [{ entry, receipt }] : [];
  });
  const bundles = new Map<string, { receipts: { url: string; sha256: string; observedAt: string; body: string }[] }>();
  for (const { receipt } of wanted) if (!bundles.has(receipt.archiveUrl)) {
    const expected = manifest.metadata!.bundles.find(bundle => bundle.url === receipt.archiveUrl); if (!expected) throw Error("queue_restore_missing_bundle");
    const response = await fetch(expected.url, { signal: AbortSignal.timeout(120_000) }); if (!response.ok) throw Error("queue_restore_archive_unavailable");
    const bytes = Buffer.from(await response.arrayBuffer()); if (contentHash(bytes) !== expected.sha256) throw Error("queue_restore_bundle_hash");
    bundles.set(expected.url, JSON.parse(gunzipSync(bytes).toString()));
  }
  const db = createClient({ url: pathToFileURL(resolve(database)).href }), runId = `queue-restore-${contentHash(JSON.stringify(wanted)).slice(0, 24)}`; let restored = 0;
  try {
    await initializeDailyRaw(db, { unmeteredLocal: true }); await openDailyRawRun(db, { id: runId, maxEstimatedWrites: 1_000_000 });
    for (const { entry, receipt } of wanted) {
      const original = bundles.get(receipt.archiveUrl)!.receipts.find(item => item.url === receipt.url && item.sha256 === receipt.sha256 && item.observedAt === receipt.observedAt);
      if (!original || contentHash(original.body) !== receipt.sha256) throw Error("queue_restore_receipt_mismatch");
      for (const binding of entry.bindings.filter(binding => binding.active && binding.fullImported)) {
        const input = parseDailyRawCsv(original.body, { geckoId: entry.geckoId, path: "archived", ...receipt, observedAt: original.observedAt, timestampSemantics: COINGECKO_CSV_CLOSE_SEMANTICS }, binding);
        for (let i = 0; i < input.points.length; i += 1000) await upsertDailyRaw(db, { runId, asset: input.asset, sources: input.sources, points: input.points.slice(i, i + 1000) });
        restored++;
      }
    }
    const report = { status: "complete", receipts: wanted.length, restored, remoteDatabaseRequests: 0 }; await writeFile(join(directory, "restore-imported-report.json"), JSON.stringify(report)); console.log(JSON.stringify(report));
  } finally { db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
