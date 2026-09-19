import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { fetchCoins } from "../lib/sources";
import { assembleScreener } from "../lib/screener";
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
