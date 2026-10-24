import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { readJournal } from "../lib/snapshotArchive";
import { loadHistoryInputs } from "../lib/historyCollection";
import { initializeDailyRaw } from "../lib/dailyRawDatabase";
import { objectHash } from "../lib/sourceBundle";
import { assertArtifactRef, assertArtifactManifest, READ_ARTIFACT_BASE, READ_ARTIFACT_VERSION, type ArtifactRef, type ArtifactManifest } from "../lib/readArtifacts";
import { buildReadArtifacts, sealReadArtifacts } from "./build-read-artifacts";
import source from "../lib/read-artifact-source.json";

const repo = "lovelylov502/crypto-valuation-screener", api = `repos/${repo}`;
const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function gh(args: string[], optional = false) {
  const r = spawnSync("gh", args, { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (r.status && !optional) throw Error(`read_artifact_github_failed:${args[0]}:${r.status}`);
  return r.status ? null : r.stdout.trim();
}
async function verified(ref: ArtifactRef) {
  assertArtifactRef(ref); const r = await fetch(ref.url, { signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw Error("read_artifact_download_failed");
  const bytes = Buffer.from(await r.arrayBuffer()); if (digest(bytes) !== ref.sha256) throw Error("read_artifact_hash_mismatch"); return bytes;
}
async function previous() {
  const r = await fetch(source.index, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (r.status === 404 && !source.fallback) return null;
  const pointer: ArtifactRef = r.ok ? await r.json() : source.fallback as unknown as ArtifactRef;
  if (!pointer) throw Error("read_artifact_pointer_unavailable");
  const manifest: ArtifactManifest = JSON.parse((await verified(pointer)).toString()); assertArtifactManifest(manifest); return { pointer, manifest };
}
async function restore(manifest: ArtifactManifest, database: string) {
  const ref = manifest.files["history.sqlite.gz"]; assertArtifactRef(ref);
  const response = await fetch(ref.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw Error("read_artifact_database_unavailable");
  const file = database + ".download.gz", hash = createHash("sha256");
  await pipeline(Readable.fromWeb(response.body as never), async function* (chunks) { for await (const chunk of chunks) { hash.update(chunk); yield chunk; } }, createWriteStream(file));
  if (hash.digest("hex") !== ref.sha256) throw Error("read_artifact_database_hash_mismatch");
  await pipeline(createReadStream(file), createGunzip(), createWriteStream(database));
}
async function publish(output: string, manifest: ArtifactManifest, tag: string, before: Awaited<ReturnType<typeof previous>>) {
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", windowsHide: true }).stdout?.trim();
  if (remote !== `https://github.com/${repo}.git`) throw Error("read_artifact_repository_mismatch");
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).stdout.trim();
  const existing = gh(["release", "view", tag, "--repo", repo, "--json", "isDraft"], true);
  if (!existing) gh(["release", "create", tag, "--repo", repo, "--target", commit, "--draft", "--latest=false", "--title", `Prepared reads ${manifest.publication.id}`, "--notes", `Verified publication ${manifest.publication.id}. Local history processing; hosted database reads 0, writes 0. Input ${manifest.inputKey}.`]);
  if (!existing || JSON.parse(existing).isDraft) {
    const files = [...Object.keys(manifest.files), "manifest.json"];
    for (let i = 0; i < files.length; i += 15) gh(["release", "upload", tag, "--repo", repo, "--clobber", ...files.slice(i, i + 15).map(name => join(output, name))]);
    const release = JSON.parse(gh(["api", `${api}/releases?per_page=100`])!).find((item: { tag_name: string }) => item.tag_name === tag);
    if (!release) throw Error("read_artifact_draft_missing");
    const assets = JSON.parse(gh(["api", `${api}/releases/${release.id}/assets?per_page=100`, "--paginate", "--slurp"])!).flat();
    for (const name of files) { const asset = assets.find((item: { name: string }) => item.name === name), hash = digest(await readFile(join(output, name))); if (asset?.digest !== `sha256:${hash}` || asset.state !== "uploaded") throw Error("read_artifact_upload_unverified"); }
    gh(["release", "edit", tag, "--repo", repo, "--draft=false", "--latest=false"]);
  }
  const pointer = { url: `${READ_ARTIFACT_BASE}${tag}/manifest.json`, sha256: digest(await readFile(join(output, "manifest.json"))) };
  const remoteManifest: ArtifactManifest = JSON.parse((await verified(pointer)).toString()); assertArtifactManifest(remoteManifest);
  const current = gh(["api", `${api}/contents/current.json?ref=read-model-index`], true), content = current ? JSON.parse(current) : null;
  const live = content ? JSON.parse(Buffer.from(content.content, "base64").toString()) : null;
  if (live && live.sha256 !== before?.pointer.sha256 && live.sha256 !== pointer.sha256) throw Error("read_artifact_pointer_changed");
  if (!content) {
    const branch = gh(["api", `${api}/git/ref/heads/read-model-index`], true);
    if (!branch) { const file = join(output, "branch-request.json"); await writeFile(file, JSON.stringify({ ref: "refs/heads/read-model-index", sha: commit })); gh(["api", `${api}/git/refs`, "--method", "POST", "--input", file]); }
  }
  if (live?.sha256 !== pointer.sha256) {
    const file = join(output, "pointer-request.json");
    await writeFile(file, JSON.stringify({ message: `Publish prepared reads ${manifest.publication.id}`, branch: "read-model-index", content: Buffer.from(JSON.stringify(pointer)).toString("base64"), ...(content ? { sha: content.sha } : {}) }));
    gh(["api", `${api}/contents/current.json`, "--method", "PUT", "--input", file]);
  }
  const readback = JSON.parse(gh(["api", `${api}/contents/current.json?ref=read-model-index`])!);
  if (JSON.parse(Buffer.from(readback.content, "base64").toString()).sha256 !== pointer.sha256) throw Error("read_artifact_pointer_readback_failed");
  await writeFile(join(output, "published-pointer.json"), JSON.stringify(pointer, null, 2));
}
async function main() {
  const cacheArg = arg("--cache"); if (!cacheArg) throw Error("read_artifact_cache_required");
  const cache = resolve(cacheArg); await mkdir(cache, { recursive: true });
  if (spawnSync("git", ["-C", cache, "rev-parse", "--show-toplevel"], { windowsHide: true }).status === 0) throw Error("read_artifact_cache_inside_git");
  const database = resolve(arg("--database") ?? join(cache, "history.sqlite")), before = await previous();
  if (process.argv.includes("--publish-prepared")) {
    const output = join(cache, "output"), manifest: ArtifactManifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")); assertArtifactManifest(manifest);
    if (before?.manifest.inputKey === manifest.inputKey) { console.log(JSON.stringify({ status: "unchanged", inputKey: manifest.inputKey, remoteDatabase: { reads: 0, writes: 0 } })); return; }
    if (before && before.manifest.publication.dataAt > manifest.publication.dataAt) throw Error("read_artifact_stale_publication");
    for (const [name, ref] of Object.entries(manifest.files)) if (digest(await readFile(join(output, name))) !== ref.sha256) throw Error("read_artifact_local_hash_mismatch");
    const tag = new URL(manifest.files["catalog.json.gz"].url).pathname.split("/").at(-2)!;
    await publish(output, manifest, tag, before); console.log(JSON.stringify({ status: "published", inputKey: manifest.inputKey, remoteDatabase: { reads: 0, writes: 0 } })); return;
  }
  if (process.argv.includes("--restore-only")) {
    if (!before) throw Error("read_artifact_verified_seed_required");
    await restore(before.manifest, database); await writeFile(join(cache, "base-pointer.json"), JSON.stringify(before.pointer)); return;
  }
  const publication = await readJournal(); if (!publication?.published) throw Error("read_artifact_publication_required");
  const token = arg("--input-token") ?? "snapshot", inputKey = objectHash([READ_ARTIFACT_VERSION, publication.published.sha256, token]);
  if (before?.manifest.inputKey === inputKey) { console.log(JSON.stringify({ status: "unchanged", inputKey, remoteDatabase: { reads: 0, writes: 0 } })); return; }
  if (!arg("--database")) { if (!before) throw Error("read_artifact_verified_seed_required"); await restore(before.manifest, database); }
  const { snapshot, ref } = await loadHistoryInputs(cache, publication.published), reference = join(cache, "reference.json"); await writeFile(reference, JSON.stringify(ref));
  const run = (script: string, args: string[]) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", script, "--cache", cache, "--reference", reference, "--database", database, "--run-id", `file-${inputKey.slice(0, 24)}-${script.includes("fdv") ? "fdv" : script.includes("market") ? "market" : "flow"}`, "--apply", ...args], { windowsHide: true, stdio: "inherit" });
    if (result.status !== 0) throw Error(`read_artifact_preparation_failed:${script}`);
  };
  run("scripts/capture-current-fdv.ts", []);
  run("scripts/capture-local-market.ts", []);
  run("scripts/refresh-daily-financials.ts", ["--max-estimated-writes", "500000", "--recent-days", "3", "--time-budget-seconds", "1200"]);
  const output = join(cache, "output"), tag = `screener-read-${ref.id.replace(/^data-/, "")}-${inputKey.slice(0, 12)}`, db = createClient({ url: pathToFileURL(database).href });
  let result;
  try { await initializeDailyRaw(db, { unmeteredLocal: true }); result = await buildReadArtifacts(db, snapshot, publication, output, tag, inputKey); await db.execute("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { db.close(); }
  await sealReadArtifacts(result.manifest, database, output, tag);
  if (process.argv.includes("--publish")) await publish(output, result.manifest, tag, before);
  const report = { status: "complete", publicationId: ref.id, inputKey, histories: result.processed, points: result.points, remoteDatabase: { reads: 0, writes: 0 }, cadenceHours: 12, published: process.argv.includes("--publish") };
  await writeFile(join(cache, "read-artifact-report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "read_artifact_preparation_failed"); process.exitCode = 1; });
