import { createClient } from "@libsql/client";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { copyDailyRaw, initializeDailyRaw } from "../lib/dailyRawDatabase";

// Explicit local files only. Never opens the hosted database, even when credentials exist.
async function main() {
  const [target, ...inputs] = process.argv.slice(2);
  if (!target || !inputs.length || inputs.some(path => resolve(path) === resolve(target))) throw Error("Separate target and sealed source files required");
  await mkdir(dirname(resolve(target)), { recursive: true });
  const db = createClient({ url: pathToFileURL(resolve(target)).href }), reports = [];
  try {
    await initializeDailyRaw(db, { unmeteredLocal: true });
    for (const input of inputs) {
      const hash = createHash("sha256").update(await readFile(input)).digest("hex");
      const source = createClient({ url: pathToFileURL(resolve(input)).href });
      try {
        const result = await copyDailyRaw(source, db, { runId: `local-restore-${hash.slice(0, 24)}`, stagingId: hash, maxEstimatedWrites: 100_000_000, batchSize: 1000 });
        reports.push({ file: resolve(input), sha256: hash, ...result });
        await writeFile(target + ".restore.json", JSON.stringify({ remoteDatabaseRequests: 0, reports }, null, 2));
        console.log(JSON.stringify({ file: input, ...result }));
      } finally { source.close(); }
    }
  } finally { db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
