import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { connectHistory } from "../lib/historyDatabase";
import { loadVerifiedFdvValidationManifest } from "../lib/dailyRawFdvValidation";
import { loadCurrentFdvPrimaryHolds, loadVerifiedFdvHoldsManifest } from "../lib/dailyRawFdvHolds";
import { applyFdvCorrections, fdvCorrectionClaims, fdvCorrectionError, readFdvCorrectionCandidates } from "../lib/dailyRawFdvCorrection";
import { contentHash } from "../lib/sourceBundle";

async function main() {
  const argv = process.argv.slice(2), arg = (name: string, fallback = "") => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1] ?? fallback; };
  const runId = arg("--run-id"), maxEstimatedWrites = Number(arg("--max-estimated-writes")), apply = argv.includes("--apply");
  if (!arg("--cache") || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(runId) || !Number.isSafeInteger(maxEstimatedWrites) || maxEstimatedWrites < 8 || maxEstimatedWrites > 50_000) throw Error("daily_raw_fdv_correction_cache_run_allowance_required");
  const cache = resolve(arg("--cache")), rel = relative(process.cwd(), cache);
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\")) throw Error("daily_raw_fdv_correction_cache_must_be_outside_git");
  const legacyBytes = await readFile(resolve(cache, arg("--legacy-fdv-manifest", "legacy-fdv-verified-manifest.json")));
  const bounds = await loadVerifiedFdvValidationManifest(resolve(cache, arg("--fdv-validation-manifest", "fdv-validation-initial-manifest.json")), cache, legacyBytes);
  const holds = await loadVerifiedFdvHoldsManifest(resolve(cache, arg("--fdv-holds-manifest", "fdv-holds-initial-manifest.json")), cache, legacyBytes);
  const reference = JSON.parse(await readFile(resolve(cache, arg("--reference", "reference.json")), "utf8"));
  const current = await loadCurrentFdvPrimaryHolds(legacyBytes, cache, reference), claims = fdvCorrectionClaims(bounds, holds, current);
  console.log(JSON.stringify({ event: "fdv-correction-original-proofs-verified", bounds: bounds.rejections.length, holds: holds.holds.length, currentHolds: current.length, inputManifestSha256: contentHash(legacyBytes) }));
  const db = connectHistory();
  try {
    const candidates = await readFdvCorrectionCandidates(db, claims), reasons: Record<string, number> = {};
    for (const item of candidates) reasons[item.claim.reason] = (reasons[item.claim.reason] ?? 0) + 1;
    const plan = { schema: 1, mode: apply ? "apply" : "dry-run", runId, maxEstimatedWrites, proofClaims: claims.length, candidates: candidates.length, reasons,
      sample: candidates.slice(0, 10).map(item => ({ slug: item.asset.slug, identity: item.asset.identity, day: item.day, value: item.value, previousSource: item.source.key, reason: item.claim.reason, proofSha256: item.claim.proofSha256 })) };
    console.log(JSON.stringify(plan));
    const result = apply ? await applyFdvCorrections(db, candidates, { runId, maxEstimatedWrites }) : { assets: 0, daysWritten: 0, rowsWritten: 0, estimatedWrites: 0 };
    const report = { ...plan, status: apply ? "applied" : "read-only-plan", ...result };
    await writeFile(resolve(cache, apply ? "fdv-correction-apply-report.json" : "fdv-correction-dry-run-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, ...result }));
  } finally { db.close(); }
}
main().catch(error => { console.error(JSON.stringify(fdvCorrectionError(error))); process.exitCode = 1; });
