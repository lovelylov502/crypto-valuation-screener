import { readFile, writeFile, mkdir, rename, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DAILY_RAW_ARCHIVE_REPOSITORY, type DailyRawArchiveManifest } from "../lib/dailyRawArchive";
import { dailyRawQueueReleaseRef, latestDailyRawQueueRelease, prepareDailyRawQueueArchive, publishDailyRawQueueArchive, readDailyRawQueueArchive, restoreDailyRawQueueArchive, retryOnlyDailyRawQueue, type DailyRawQueueRef, type DailyRawQueueRelease } from "../lib/dailyRawQueueArchive";
import type { DailyRawQueueState } from "../lib/dailyRawQueue";

async function main() {
  const argv = process.argv.slice(2), arg = (name: string, fallback = "") => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1] ?? fallback; };
  if (argv.includes("--help")) { console.log("daily-raw-queue-state.ts --restore --cache <outside-Git> [--state daily-raw-queue.json]\ndaily-raw-queue-state.ts --publish --cache <outside-Git> --tag daily-raw-queue-<run>-<attempt> [--archive-manifest file] [--seed] [--prepare-only] [--retry-only]\nRestoration requires an existing verified seed. --retry-only is an explicit original-archive failure fallback: preserve holds and DB progress, declare unarchived receipts need refetching. Local originals and state are retained."); return; }
  if (!arg("--cache") || Number(argv.includes("--restore")) + Number(argv.includes("--publish")) !== 1) throw Error("daily_raw_queue_state_arguments");
  await mkdir(resolve(arg("--cache")), { recursive: true });
  const cache = await realpath(resolve(arg("--cache"))), repo = DAILY_RAW_ARCHIVE_REPOSITORY;
  const command = (binary: string, args: string[], missing = false) => {
    const result = spawnSync(binary, args, { encoding: "utf8", maxBuffer: 20_000_000, timeout: 120_000 });
    if (result.status === 0) return result.stdout.trim();
    if (missing && /HTTP 404/.test(result.stderr ?? "")) return null;
    throw Error("daily_raw_queue_state_external_operation_failed");
  };
  const root = await realpath(command("git", ["rev-parse", "--show-toplevel"])!), rel = relative(root, cache);
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\")) throw Error("daily_raw_queue_state_cache_inside_git");
  const cacheGit = spawnSync("git", ["-C", cache, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (cacheGit.status === 0) throw Error("daily_raw_queue_state_cache_inside_git");
  const file = (name: string) => { const path = resolve(cache, name), rel = relative(cache, path); if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) throw Error("daily_raw_queue_state_file_escape"); return path; };
  const save = async (path: string, value: unknown) => { const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, path); };
  const api = (path: string, missing = false): Record<string, unknown> | null => { const text = command("gh", ["api", `repos/${repo}/${path}`], missing); return text === null ? null : JSON.parse(text); };
  const release = (raw: Record<string, unknown>): DailyRawQueueRelease => {
    const assets = (raw.assets ?? []) as { name: string; digest?: string; state: string }[];
    return { tag: String(raw.tag_name), target: String(raw.target_commitish), notes: String(raw.body ?? ""), assets: assets.map(asset => asset.name),
      assetHashes: Object.fromEntries(assets.map(asset => [asset.name, asset.state === "uploaded" ? asset.digest?.replace(/^sha256:/, "") ?? "" : ""])),
      draft: raw.draft === true, immutable: raw.immutable === true, publishedAt: typeof raw.published_at === "string" ? raw.published_at : null, id: Number(raw.id) };
  };
  const page = async (number: number) => (api(`releases?per_page=100&page=${number}`) as unknown as Record<string, unknown>[]).map(release);
  const latest = () => latestDailyRawQueueRelease(page);
  const tagTarget = (tag: string) => {
    const ref = api(`git/ref/tags/${tag}`, true); if (!ref) return null;
    let object = ref.object as { type: string; sha: string };
    for (let depth = 0; depth < 5 && object.type === "tag"; depth++) {
      if (!/^[a-f0-9]{40}$/.test(object.sha)) throw Error("daily_raw_queue_state_tag_target");
      object = api(`git/tags/${object.sha}`)!.object as typeof object;
    }
    if (object.type !== "commit" || !/^[a-f0-9]{40}$/.test(object.sha)) throw Error("daily_raw_queue_state_tag_target"); return object.sha;
  };
  const stateFile = file(arg("--state", "daily-raw-queue.json")), originFile = file("daily-raw-queue-origin.json");
  if (argv.includes("--restore")) {
    const current = await latest(); if (!current) throw Error("daily_raw_queue_state_verified_seed_missing");
    current.target = tagTarget(current.tag) ?? "";
    const restored = await restoreDailyRawQueueArchive(current);
    await save(stateFile, restored.envelope.state); await save(originFile, restored.ref);
    if (restored.envelope.archiveManifest) await save(file("archive-manifest.json"), restored.envelope.archiveManifest);
    console.log(JSON.stringify({ status: "restored-and-readback-verified", ...restored.ref, entries: Object.keys(restored.envelope.state.entries).length, droppedUnarchived: restored.envelope.unarchivedReceipts?.length ?? 0 })); return;
  }
  const expectedRepo = `https://github.com/${repo}.git`;
  if (command("git", ["remote", "get-url", "origin"]) !== expectedRepo || command("git", ["remote", "get-url", "--push", "origin"]) !== expectedRepo) throw Error("daily_raw_queue_state_repository_mismatch");
  const target = command("git", ["rev-parse", "HEAD"])!;
  if (!/^[a-f0-9]{40}$/.test(target)) throw Error("daily_raw_queue_state_target");
  let previous: DailyRawQueueRef | null = null;
  if (!argv.includes("--seed")) previous = JSON.parse(await readFile(originFile, "utf8")) as DailyRawQueueRef;
  if (previous?.tag === arg("--tag")) {
    const bytes = await readDailyRawQueueArchive(previous), committed = prepareDailyRawQueueArchive(JSON.parse(bytes.toString("utf8")));
    if (committed.ref.sha256 !== previous.sha256 || !committed.bytes.equals(bytes)) throw Error("daily_raw_queue_state_committed_parent_mismatch");
    previous = committed.envelope.previous;
  }
  const input = JSON.parse(await readFile(stateFile, "utf8")) as DailyRawQueueState, retry = argv.includes("--retry-only") ? retryOnlyDailyRawQueue(input) : undefined;
  const archive = prepareDailyRawQueueArchive({ schema: 1, repository: repo, tag: arg("--tag"), target, previous,
    state: retry?.state ?? input, ...(retry?.unarchivedReceipts.length ? { unarchivedReceipts: retry.unarchivedReceipts } : {}),
    ...(arg("--archive-manifest") ? { archiveManifest: JSON.parse(await readFile(file(arg("--archive-manifest")), "utf8")) as DailyRawArchiveManifest } : {}) });
  const out = file("queue-state-archive"); await mkdir(out, { recursive: true });
  const asset = join(out, archive.file), notes = join(out, "release-notes.json");
  try { const existing = await readFile(asset); if (!existing.equals(archive.bytes)) throw Error("daily_raw_queue_state_prepared_mismatch"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(asset, archive.bytes, { flag: "wx" }); }
  await writeFile(notes, archive.notes);
  if (argv.includes("--prepare-only")) { console.log(JSON.stringify({ status: "prepared", ...archive.ref, bytes: archive.bytes.length })); return; }
  if (api(`commits/${target}`)?.sha !== target) throw Error("daily_raw_queue_state_remote_commit_missing");
  const existingTag = tagTarget(archive.ref.tag);
  if (existingTag && existingTag !== target) throw Error("daily_raw_queue_state_tag_target");
  let releaseId = 0;
  const readRelease = async () => {
    let raw = api(`releases/tags/${archive.ref.tag}`, true);
    if (!raw) for (let number = 1; ; number++) {
      const batch = api(`releases?per_page=100&page=${number}`) as unknown as Record<string, unknown>[];
      raw = batch.find(item => item.tag_name === archive.ref.tag) ?? null;
      if (raw || batch.length < 100) break;
    }
    if (!raw) return null;
    releaseId = Number(raw.id); const result = release(raw);
    result.target = tagTarget(result.tag) ?? (result.draft ? String(raw.target_commitish) : ""); return result;
  };
  const ref = await publishDailyRawQueueArchive(archive, {
    latest: async () => { const value = await latest(); return value ? dailyRawQueueReleaseRef(value) : null; },
    readRelease,
    createDraft: async () => { command("gh", ["release", "create", archive.ref.tag, "--repo", repo, "--target", target, "--draft", "--latest=false", "--title", archive.ref.tag, "--notes-file", notes]); },
    upload: async () => { command("gh", ["release", "upload", archive.ref.tag, asset, "--repo", repo]); },
    publish: async () => { command("gh", ["api", "--method", "PATCH", `repos/${repo}/releases/${releaseId}`, "-F", "draft=false", "-f", "make_latest=false"]); },
    readback: () => readDailyRawQueueArchive(archive.ref),
  });
  await save(originFile, ref);
  console.log(JSON.stringify({ status: "published-and-readback-verified", ...ref, entries: Object.keys(archive.envelope.state.entries).length, droppedUnarchived: retry?.unarchivedReceipts.length ?? 0, unarchivedReceipts: retry?.unarchivedReceipts ?? [] }));
}
main().catch(error => { const message = error instanceof Error ? error.message : ""; console.error(/^daily_raw_queue_[a-z_]+$/.test(message) ? message : "daily_raw_queue_state_failed"); process.exitCode = 1; });
