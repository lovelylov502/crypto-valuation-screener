import { execFileSync } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JOURNAL_LATEST, JOURNAL_REPOSITORY } from "../lib/publication";
import { journalFromRelease } from "../lib/journalBody";
import { parseJournal } from "../lib/snapshotArchive";
import { DEPLOY_CONTRACT } from "./deploy-contract.mjs";
import { version } from "../package.json";

type Gh = (args: string[]) => string;
const gh: Gh = args => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Both application releases and data journals share a repository. Only journals own Latest. */
export async function verifyReleasePublication(run: Gh = gh, fetcher = fetch) {
  const release = JSON.parse(run(["api", `repos/${JOURNAL_REPOSITORY}/releases/latest`]));
  if (release.draft || release.prerelease || !/^data-[a-zA-Z0-9-]+$/.test(release.tag_name)) throw Error("Latest must remain a published data journal");
  const journal = await journalFromRelease(release, fetcher);
  if (!journal.published) throw Error("Latest journal has no verified snapshot");
  const read = async (url: string) => {
    const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw Error(`Release readback HTTP ${response.status}`);
    return response.json();
  };
  // Read the public redirect as well: a warm function can hide a broken Latest pointer.
  const direct = parseJournal(await read(JOURNAL_LATEST));
  if (direct.id !== journal.id || direct.published?.sha256 !== journal.published.sha256) throw Error("Public Latest journal differs; inspect before proceeding");
  const status = await read(`${DEPLOY_CONTRACT.liveBaseUrl}/api/status`);
  if (status.storeError || status.published?.id !== journal.published.id || status.published?.sha256 !== journal.published.sha256) throw Error("Live publication readback differs");
  const table = await read(`${DEPLOY_CONTRACT.liveBaseUrl}/api/screener?view=table&size=50`);
  if (!Array.isArray(table.rows) || !table.rows.length || table.error) throw Error("Live table did not load");
  return { journal, status, rows: table.rows.length };
}

export async function releaseApp(input: { version: string; notesFile: string; assets: string[] }, run: Gh = gh, fetcher = fetch) {
  if (!/^\d+\.\d+\.\d+$/.test(input.version)) throw Error("Expected an application version");
  const before = await verifyReleasePublication(run, fetcher), tag = `v${input.version}`;
  const commit = JSON.parse(run(["api", `repos/${JOURNAL_REPOSITORY}/commits/${tag}`])).sha;
  if (!/^[a-f0-9]{40}$/.test(commit) || before.status.appVersion !== input.version || before.status.deployment?.codeCommit !== commit) throw Error("Application tag must match the verified live deployment");
  // Never retry creation automatically: a failed response can still have created the release.
  run(["release", "create", tag, ...input.assets.map(file => resolve(file)), "--repo", JOURNAL_REPOSITORY,
    "--verify-tag", "--latest=false", "--title", tag, "--notes-file", resolve(input.notesFile)]);
  const after = await verifyReleasePublication(run, fetcher);
  if (Date.parse(after.journal.createdAt) < Date.parse(before.journal.createdAt)) throw Error("Publication journal moved backwards during application release");
  return { tag, journal: after.journal.id, published: after.journal.published!.id, rows: after.rows };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--verify-only") {
    const result = await verifyReleasePublication();
    console.log(JSON.stringify({ journal: result.journal.id, published: result.journal.published!.id, rows: result.rows }));
    return;
  }
  if (args[0] !== "--notes-file" || !args[1] || args.slice(2).some(arg => arg.startsWith("--"))) throw Error("Usage: npm run release:app -- --notes-file <file> [assets...] | --verify-only");
  for (const file of args.slice(1)) await access(resolve(file));
  console.log(JSON.stringify(await releaseApp({ version, notesFile: args[1], assets: args.slice(2) })));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
