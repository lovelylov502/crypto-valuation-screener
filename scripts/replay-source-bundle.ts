import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { replayDataPipeline } from "../lib/dataPipeline";
import { pipelineIntegrityErrors, pipelineOutputHash } from "../lib/pipelineIntegrity";
import { snapshotErrors } from "../lib/publication";
import { contentHash, objectHash, type SourceBundle } from "../lib/sourceBundle";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: npm run snapshot:replay -- source-bundle.json.gz [data.json.gz]");
  const bytes = await readFile(path);
  const bundle = JSON.parse(gunzipSync(bytes, { maxOutputLength: 500_000_000 }).toString()) as SourceBundle;
  const data = await replayDataPipeline(bundle, contentHash(bytes));
  const errors = [...snapshotErrors(data), ...pipelineIntegrityErrors(data)];
  if (process.argv[3]) {
    const expected = JSON.parse(gunzipSync(await readFile(process.argv[3]), { maxOutputLength: 150_000_000 }).toString());
    errors.push(...pipelineIntegrityErrors(expected));
    if (pipelineOutputHash(expected) !== pipelineOutputHash(data) || objectHash(expected.pipeline) !== objectHash(data.pipeline)) errors.push("Source replay differs from the saved publication");
  }
  if (process.env.SCREENER_REPLAY_OUTPUT) await writeFile(process.env.SCREENER_REPLAY_OUTPUT, gzipSync(JSON.stringify(data)));
  console.log(JSON.stringify({ mode: "offline-source-replay", at: data.updatedAt, rows: data.coins.length, receipts: bundle.receipts.length, pipeline: data.pipeline, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
