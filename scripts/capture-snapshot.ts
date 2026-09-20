import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fetchCoins } from "../lib/sources";
import { assembleScreener } from "../lib/screener";
import { fundamentalErrors } from "../lib/fundamentalContract";
import { holderMultiple } from "../lib/valuationMetrics";
import { makeSnapshot } from "../lib/snapshotHistory";
import type { SourceObservation } from "../lib/types";

async function main() {
  const startedAt = new Date().toISOString();
  const sources: SourceObservation[] = [];
  const raw = await fetchCoins(sources);
  const at = new Date().toISOString();
  const data = assembleScreener(raw, at, sources);
  const output = resolve(
    process.argv[2] ?? "snapshot-output",
    at.replace(/[:.]/g, "-"),
  );
  // Immutable observation receipt: raw joined inputs allow replay; no credentials or env dump.
  const files = {
    "inputs.json.gz": gzipSync(JSON.stringify(raw)),
    "scored.json.gz": gzipSync(JSON.stringify(data)),
    "snapshot.json": Buffer.from(JSON.stringify(makeSnapshot(data))),
    "quality.json": Buffer.from(JSON.stringify({
      at, rows: data.coins.length,
      coverage: { sales: data.coins.filter(c => c.multiples.psSales !== null).length, protocolRevenue: data.coins.filter(c => c.multiples.pr !== null).length, holder: Object.fromEntries(([7,30,90,365] as const).map(n => [n, data.coins.filter(c => holderMultiple(c,n) !== null).length])) },
      review: data.coins.filter(c => c.sales?.status === "expired" || [...c.fundamentals.revenue.components,...c.fundamentals.fees.components,...c.fundamentals.holders].some(p => p.status === "changed")).map(c => ({slug:c.slug,issues:c.opportunities.dataIssues})),
      errors: data.coins.flatMap(c => fundamentalErrors(c).map(error => ({slug:c.slug,error}))),
    }, null, 2)),
  };
  await mkdir(output, { recursive: true });
  const artifacts = [];
  for (const [name, content] of Object.entries(files)) {
    await writeFile(resolve(output, name), content, { flag: "wx" });
    artifacts.push({
      name,
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const dirty =
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
      .length > 0;
  const ruleHashes: Record<string, string> = {};
  for (const name of [
    "lib/valuation.ts",
    "lib/signals.ts",
    "lib/sources.ts",
    "lib/holderValue.ts",
    "lib/snapshotHistory.ts",
    "lib/screener.ts",
    "lib/revenueHistory.ts",
    "lib/revenueSource.ts",
    "lib/research.ts",
    "lib/protocolResearch.ts",
    "lib/fundamentals.ts",
    "lib/fundamentalSource.ts",
    "lib/fundamentalDefinitions.json",
    "lib/fundamentalContract.ts",
    "lib/valuationMetrics.ts",
    "lib/salesSource.ts",
    "lib/salesEvidence.json",
    "lib/holderHistorySource.ts",
    "lib/capitalEligibility.ts",
  ]) {
    ruleHashes[name] = createHash("sha256")
      .update(await readFile(resolve(name)))
      .digest("hex");
  }
  const manifest = {
    schema: 1,
    startedAt,
    observedAt: at,
    scoreVersion: data.scoreVersion,
    gitCommit: sha,
    worktreeDirty: dirty,
    ruleHashes,
    sourceTimestampNote:
      "observedAt is collection time, not upstream generation time",
    sources,
    marketDataFreshness: data.marketDataFreshness,
    universeRows: raw.length,
    screenableRows: data.coins.length,
    artifacts,
  };
  await writeFile(
    resolve(output, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      output,
      rows: data.coins.length,
      sourceFailures: sources.filter((s) => s.status === "error").length,
      bytes: artifacts.reduce((sum, a) => sum + a.bytes, 0),
      scoreVersion: data.scoreVersion,
    }),
  );
  if (data.coins.some(c => fundamentalErrors(c).length)) throw new Error("Valuation contract failed; diagnostic snapshot retained");
  if (data.cmcCoverage === 0)
    throw new Error(
      "CMC collection unavailable; partial snapshot saved for diagnosis",
    );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Snapshot capture failed",
  );
  process.exitCode = 1;
});
