import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { connectHistory } from "../lib/historyDatabase";
import { reconcileDailyRawBudget } from "../lib/dailyRawBudgetReconciliation";

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === "--help") {
    console.log("reconcile-daily-raw-budget.ts --proof <outside-Git usage-proof.json> --observed-at <UTC ISO timestamp> [--apply]\nDefault: read-only dry-run. Fixed October 2026 operation: one 1,000,000 credit, eight bookkeeping credits, unchanged 8M/4GB guards.\nUse reader credentials for dry-run; stop all writers before explicit --apply. Keep the original proof private; only its SHA and observation time enter the audit.\nAn unknown write outcome requires read-only inspection; do not blindly retry. No amount, month or cap override is supported."); return;
  }
  const values = new Map<string, string>(); let apply = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--apply" && !apply) { apply = true; continue; }
    if (!["--proof", "--observed-at"].includes(flag) || values.has(flag) || !argv[index + 1] || argv[index + 1].startsWith("--")) throw Error("daily_raw_budget_reconciliation_arguments");
    values.set(flag, argv[++index]);
  }
  if (!values.has("--proof") || !values.has("--observed-at")) throw Error("daily_raw_budget_reconciliation_arguments");
  const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "..")), proof = await realpath(resolve(values.get("--proof")!));
  const rel = relative(root, proof), proofGit = spawnSync("git", ["-C", dirname(proof), "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if ((!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\")) || proofGit.status === 0) throw Error("daily_raw_budget_reconciliation_proof_must_be_outside_git");
  const bytes = await readFile(proof), parsed = JSON.parse(bytes.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("daily_raw_budget_reconciliation_invalid_proof_json");
  const code = createHash("sha256");
  for (const path of ["lib/historyDatabase.ts", "lib/historyIncremental.ts", "scripts/publish-history.ts"]) { code.update(path); code.update(await readFile(resolve(root, path))); }
  const evidence = { proofSha256: createHash("sha256").update(bytes).digest("hex"), observedAt: values.get("--observed-at")!, codeSha256: code.digest("hex") };
  const db = connectHistory();
  try { console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...await reconcileDailyRawBudget(db, { evidence, apply }) }, null, 2)); }
  finally { db.close(); }
}
main().catch(error => {
  const message = error instanceof Error && /^daily_raw_budget_reconciliation_[a-z_]+$/.test(error.message) ? error.message : "daily_raw_budget_reconciliation_failed";
  console.error(JSON.stringify({ error: message })); process.exitCode = 1;
});
