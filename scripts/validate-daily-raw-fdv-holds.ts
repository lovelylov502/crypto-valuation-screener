import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { buildFdvHoldsManifest, loadVerifiedFdvHoldsManifest } from "../lib/dailyRawFdvHolds";
import { contentHash } from "../lib/sourceBundle";

async function main() {
  const argv = process.argv.slice(2), arg = (name: string, fallback = "") => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1] ?? fallback; };
  if (!arg("--cache")) throw Error("daily_raw_fdv_holds_cache_required");
  const cache = resolve(arg("--cache")), rel = relative(process.cwd(), cache);
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\")) throw Error("daily_raw_fdv_holds_cache_must_be_outside_git");
  const output = resolve(cache, arg("--output", "fdv-holds-initial-manifest.json")), outRel = relative(cache, output);
  if (isAbsolute(outRel) || outRel === ".." || outRel.startsWith("../") || outRel.startsWith("..\\")) throw Error("daily_raw_fdv_holds_output_escape");
  const bytes = await readFile(resolve(cache, arg("--manifest", "legacy-fdv-verified-manifest.json")));
  const manifest = await buildFdvHoldsManifest(bytes, cache, source => console.log(JSON.stringify({ event: "fdv-primary-evidence-audit", status: source.status, holds: source.holds })));
  const encoded = JSON.stringify(manifest, null, 2); await writeFile(output, encoded, { flag: "wx" });
  await loadVerifiedFdvHoldsManifest(output, cache, bytes);
  const reasons: Record<string, number> = {}, dates: Record<string, number> = {};
  for (const hold of manifest.holds) { reasons[hold.reason] = (reasons[hold.reason] ?? 0) + 1; dates[hold.day] = (dates[hold.day] ?? 0) + 1; }
  console.log(JSON.stringify({ status: "frozen-and-proof-verified", sources: manifest.sources.length, holds: manifest.holds.length, reasons, dates, sha256: contentHash(encoded) }));
}
main().catch(error => { const message = error instanceof Error ? error.message : ""; console.error(/^daily_raw_fdv_[a-z_]+$/.test(message) ? message : "daily_raw_fdv_holds_failed"); process.exitCode = 1; });
