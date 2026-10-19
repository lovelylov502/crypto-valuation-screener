import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { contentHash } from "../lib/sourceBundle";
import { assertDailyRawArchivePlan, DAILY_RAW_ARCHIVE_ATTRIBUTION, DAILY_RAW_ARCHIVE_NOTES, DAILY_RAW_ARCHIVE_REPOSITORY, dailyRawArchiveUrl, emptyDailyRawArchiveManifest, gatherDailyRawArchiveReceipts, newDailyRawArchiveReceipts, packDailyRawArchiveReceipts, publishDailyRawArchive, readbackDailyRawArchive, verifyPreviousDailyRawArchive, type DailyRawArchiveManifest, type DailyRawArchivePlan, type DailyRawArchiveRelease } from "../lib/dailyRawArchive";

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string, fallback = "") => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1] ?? fallback; };
  const cache = resolve(arg("--cache")), tag = arg("--tag"), out = join(cache, "source-archive");
  if (!arg("--cache") || !/^daily-raw-[a-zA-Z0-9-]+$/.test(tag)) throw Error("daily_raw_archive_cache_and_tag_required");
  const rel = relative(process.cwd(), cache);
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\")) throw Error("daily_raw_archive_cache_must_be_outside_git");
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 1_000_000 });
    if (result.status !== 0) throw Error("daily_raw_archive_git_preflight"); return result.stdout.trim();
  };
  const expectedRepo = `https://github.com/${DAILY_RAW_ARCHIVE_REPOSITORY}.git`;
  if (git("remote", "get-url", "origin") !== expectedRepo || git("remote", "get-url", "--push", "origin") !== expectedRepo) throw Error("daily_raw_archive_repository_mismatch");
  const target = git("rev-parse", "HEAD");
  if (!/^[a-f0-9]{40}$/.test(target) || arg("--target", target) !== target) throw Error("daily_raw_archive_target_must_be_current_commit");
  const manifestOutput = resolve(cache, arg("--manifest-output", "archive-manifest.json")), outputRel = relative(cache, manifestOutput);
  if (isAbsolute(outputRel) || outputRel === ".." || outputRel.startsWith("../") || outputRel.startsWith("..\\")) throw Error("daily_raw_archive_manifest_output_escape");
  const save = async (file: string, value: unknown) => { const temporary = `${file}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, file); };
  const previous = arg("--previous-manifest") ? await verifyPreviousDailyRawArchive(JSON.parse(await readFile(resolve(cache, arg("--previous-manifest")), "utf8")) as DailyRawArchiveManifest) : undefined;
  const packed = packDailyRawArchiveReceipts(newDailyRawArchiveReceipts(await gatherDailyRawArchiveReceipts(cache, {
    csvManifest: arg("--csv-manifest") || undefined, feesManifest: arg("--fees-manifest") || undefined, coinMetricsManifest: arg("--coinmetrics-manifest") || undefined,
  }), previous));
  if (!packed.length) {
    if (!argv.includes("--prepare-only")) await save(manifestOutput, previous?.manifest ?? emptyDailyRawArchiveManifest(tag, target));
    console.log(JSON.stringify({ status: previous ? "previous-archives-readback-verified" : "no-new-originals", bundles: 0, receipts: 0, previousReceipts: previous?.witnesses.size ?? 0 })); return;
  }
  const plan: DailyRawArchivePlan = { schema: 1, repository: DAILY_RAW_ARCHIVE_REPOSITORY, tag, target, attribution: DAILY_RAW_ARCHIVE_ATTRIBUTION, bundles: packed.map(p => p.bundle) };
  assertDailyRawArchivePlan(plan);
  await mkdir(out, { recursive: true });
  for (const { bundle, bytes } of packed) {
    const file = join(out, bundle.file);
    try { if (contentHash(await readFile(file)) !== bundle.sha256) throw Error("daily_raw_archive_prepared_package_mismatch"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(file, bytes, { flag: "wx" }); }
  }
  await save(join(out, "archive-plan.json"), plan);
  await save(join(out, `archive-plan-${tag}.json`), plan);
  await writeFile(join(out, "release-notes.md"), DAILY_RAW_ARCHIVE_NOTES);
  const report = { tag, target, bundles: plan.bundles.length, receipts: plan.bundles.reduce((sum, b) => sum + b.receipts.length, 0), previousReceipts: previous?.witnesses.size ?? 0,
    compressedBytes: plan.bundles.reduce((sum, b) => sum + b.bytes, 0), uncompressedBytes: plan.bundles.reduce((sum, b) => sum + b.uncompressedBytes, 0) };
  if (argv.includes("--prepare-only")) { console.log(JSON.stringify({ status: "prepared", ...report })); return; }
  const gh = (args: string[], missing = false): string | null => {
    const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 20_000_000 });
    if (result.status === 0) return result.stdout.trim();
    if (missing && /HTTP 404/.test(result.stderr)) return null;
    throw Error("daily_raw_archive_github_operation_failed");
  };
  const api = (path: string, missing = false) => { const text = gh(["api", `repos/${plan.repository}/${path}`], missing); return text === null ? null : JSON.parse(text) as Record<string, unknown>; };
  const tagTarget = () => {
    const reference = api(`git/ref/tags/${tag}`, true); if (!reference) return null;
    let object = reference.object as { type: string; sha: string };
    for (let depth = 0; depth < 5 && object.type === "tag"; depth++) {
      if (!/^[a-f0-9]{40}$/.test(object.sha)) throw Error("daily_raw_archive_remote_tag");
      object = api(`git/tags/${object.sha}`)!.object as typeof object;
    }
    if (object.type !== "commit" || !/^[a-f0-9]{40}$/.test(object.sha)) throw Error("daily_raw_archive_remote_tag"); return object.sha;
  };
  const remoteCommit = gh(["api", `repos/${plan.repository}/commits/${target}`, "--jq", ".sha"]);
  if (remoteCommit !== target) throw Error("daily_raw_archive_remote_commit_mismatch");
  const existingTag = tagTarget();
  if (existingTag && existingTag !== target) throw Error("daily_raw_archive_remote_tag_mismatch");
  const readRelease = async (): Promise<DailyRawArchiveRelease | null> => {
    const release = api(`releases/tags/${tag}`, true); if (!release) return null;
    return { target: tagTarget() ?? "", notes: String(release.body ?? ""), assets: (release.assets as { name: string }[]).map(a => a.name), draft: release.draft === true, immutable: release.immutable === true };
  };
  const manifest = await publishDailyRawArchive(plan, {
    readRelease,
    createRelease: async () => { gh(["release", "create", tag, ...plan.bundles.map(b => join(out, b.file)), "--repo", plan.repository, "--target", target, "--latest=false", "--title", tag, "--notes-file", join(out, "release-notes.md")]); },
    uploadAssets: async files => { gh(["release", "upload", tag, ...files.map(file => join(out, file)), "--repo", plan.repository]); },
    verifyAsset: async bundle => { await readbackDailyRawArchive(dailyRawArchiveUrl(plan, bundle.file), bundle.sha256); },
  }, previous);
  await save(manifestOutput, manifest);
  console.log(JSON.stringify({ status: "published-and-readback-verified", ...report }));
}
main().catch(error => { const message = error instanceof Error ? error.message : ""; console.error(/^daily_raw_archive_[a-z_]+$/.test(message) ? message : "daily_raw_archive_failed"); process.exitCode = 1; });
