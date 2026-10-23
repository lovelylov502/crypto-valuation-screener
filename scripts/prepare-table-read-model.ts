import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { connectHistory, HistoryBudgetExceeded } from "../lib/historyDatabase";
import { initializeDailyRaw, openDailyRawRun } from "../lib/dailyRawDatabase";
import { initializeDailyReadModels } from "../lib/dailyReadModelDatabase";
import { decodeSnapshot, parseJournal, readJournal } from "../lib/snapshotArchive";
import { readAuditSnapshot } from "./audit-coverage";
import { buildTableCatalog } from "../lib/tableCatalog";
import { prepareTableReadModel } from "../lib/tableBuild";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { reference: { type: "string" }, snapshot: { type: "string" }, "run-id": { type: "string" }, "max-estimated-writes": { type: "string", default: "50000" }, "minimum-reserve": { type: "string", default: "0" }, apply: { type: "boolean", default: false }, help: { type: "boolean" } } });
  if (values.help) { console.log("prepare-table-read-model [--reference journal.json] [--snapshot original.json.gz] [--run-id ID] [--max-estimated-writes 50000] [--minimum-reserve 0] [--apply]\nDefault: validate/build only. Writes use the existing Turso writer environment and shared quota."); return; }
  // Current-data maintenance uses the reserve that bulk historical acquisition leaves untouched.
  const maxEstimatedWrites = Number(values["max-estimated-writes"]), minimumReserve = Number(values["minimum-reserve"]);
  if (!Number.isSafeInteger(maxEstimatedWrites) || maxEstimatedWrites < 8 || maxEstimatedWrites > 50000 || !Number.isSafeInteger(minimumReserve) || minimumReserve < 0) throw Error("Invalid table model write allowance/reserve");
  const journal = values.reference ? parseJournal(JSON.parse(await readFile(values.reference, "utf8"))) : await readJournal(), reference = journal.published;
  if (!reference) throw Error("No verified publication");
  const data = values.snapshot ? decodeSnapshot(await readFile(values.snapshot), reference) : await readAuditSnapshot(reference);
  if (!values.apply) { const { catalog, shards } = buildTableCatalog(data, reference); console.log(JSON.stringify({ status: "dry-run", publicationId: reference.id, snapshotSha256: reference.sha256, projects: catalog.entries.length, shards: shards.size, maxEstimatedWrites, minimumReserve })); return; }
  const current = (await readJournal()).published;
  if (current?.id !== reference.id || current.sha256 !== reference.sha256) throw Error("Table target is not the current verified publication");
  const db = connectHistory();
  try {
    await initializeDailyRaw(db); await initializeDailyReadModels(db);
    const runId = values["run-id"] ?? `table-${reference.id}`;
    await openDailyRawRun(db, { id: runId, maxEstimatedWrites, minimumReserve });
    const result = await prepareTableReadModel(db, { data, reference, runId, minimumReserve });
    console.log(JSON.stringify({ ...result, runId, maxEstimatedWrites, minimumReserve }));
  } catch (error) { if (error instanceof HistoryBudgetExceeded) { console.log(JSON.stringify({ status: "budget-paused", publicationId: reference.id, reason: error.message })); process.exitCode = 2; } else throw error; }
  finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error("table_read_model_preparation_failed"); process.exitCode = 1; });
