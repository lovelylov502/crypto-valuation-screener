import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gzipSync } from "node:zlib";
import { captureDataPipeline, assessPipelineCandidate, encodeSourceBundle } from "../lib/dataPipeline";
import { readJournal, readSnapshot } from "../lib/snapshotArchive";
import { withDeadline } from "../lib/withDeadline";

async function main() {
  const output = resolve(process.env.SCREENER_SHADOW_DIR ?? "snapshot-output/shadow");
  await mkdir(output, { recursive: true });
  const journal = await readJournal();
  if (!journal.published) throw new Error("Missing published baseline");
  const baseline = await readSnapshot(journal.published);
  const startedAt = new Date().toISOString();
  console.log(JSON.stringify({ stage: "capture", startedAt, baseline: journal.published.id, output }));
  const result = await withDeadline(() => captureDataPipeline(baseline, startedAt, async bundle => {
    await writeFile(join(output, "source-bundle.json.gz"), encodeSourceBundle(bundle));
    console.log(JSON.stringify({ stage: "offline-replay", receipts: bundle.receipts.length }));
  }), 10 * 60_000);
  const completedAt = new Date().toISOString();
  const assessment = assessPipelineCandidate(result.data, result.bundle, baseline, startedAt, completedAt, result.data);
  await writeFile(join(output, "data.json.gz"), gzipSync(JSON.stringify(result.data)));
  const report = { mode: "shadow-no-publication", startedAt, completedAt, baseline: journal.published, rows: result.data.coins.length,
    elapsedSeconds: (Date.parse(completedAt) - Date.parse(startedAt)) / 1000, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    rawBundleBytes: Buffer.byteLength(JSON.stringify(result.bundle)), compressedBundleBytes: encodeSourceBundle(result.bundle).byteLength,
    pipeline: result.data.pipeline, sources: result.data.sources, ...assessment };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: report.mode, rows: report.rows, elapsedSeconds: report.elapsedSeconds, peakRssBytes: report.peakRssBytes,
    rawBundleBytes: report.rawBundleBytes, compressedBundleBytes: report.compressedBundleBytes, pipeline: report.pipeline, errors: report.errors }, null, 2));
  if (assessment.errors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
