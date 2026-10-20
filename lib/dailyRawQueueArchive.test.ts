import { expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { DAILY_RAW_ARCHIVE_REPOSITORY } from "./dailyRawArchive";
import { reconcileDailyRawQueue, recordDailyRawAcquired, recordDailyRawArchived, recordDailyRawDeferred } from "./dailyRawQueue";
import { latestDailyRawQueueRelease, portableDailyRawQueue, prepareDailyRawQueueArchive, publishDailyRawQueueArchive, readDailyRawQueueArchive, restoreDailyRawQueueArchive, retryOnlyDailyRawQueue, type DailyRawQueueArchive, type DailyRawQueuePublisher, type DailyRawQueueRelease } from "./dailyRawQueueArchive";

const now = new Date("2026-10-19T12:00:00Z"), sha = "a".repeat(64), archiveUrl = `https://github.com/${DAILY_RAW_ARCHIVE_REPOSITORY}/releases/download/daily-raw-original/daily-raw-sources-${sha}.json.gz`;
const previous = { tag: "daily-raw-queue-previous", sha256: "b".repeat(64) };
function state() {
  const queue = reconcileDailyRawQueue(null, [{ slug: "alpha", geckoId: "alpha", identityStatus: "verified", fdv: 1 }], "2026-10-18", now);
  recordDailyRawAcquired(queue, "alpha", { url: "https://www.coingecko.com/price_charts/export/alpha/usd.csv", observedAt: now.toISOString(), sha256: sha, file: "C:/private/account/original.csv", firstDay: "2018-01-01", availableThrough: "2026-10-18" }, now);
  recordDailyRawArchived(queue, "alpha", archiveUrl, now);
  recordDailyRawDeferred(queue, "alpha", "2026-10-20T12:00:00Z", true, now);
  return queue;
}
const prepared = () => prepareDailyRawQueueArchive({ schema: 1, repository: DAILY_RAW_ARCHIVE_REPOSITORY, tag: "daily-raw-queue-test", target: "c".repeat(40), previous, state: state() });
const release = (archive: DailyRawQueueArchive, draft = false, assets = [archive.file]): DailyRawQueueRelease => ({ tag: archive.ref.tag, target: archive.envelope.target, notes: archive.notes, assets,
  assetHashes: Object.fromEntries(assets.map(file => [file, archive.ref.sha256])), draft, immutable: false, publishedAt: draft ? null : now.toISOString(), id: 1 });
function publisher(archive: DailyRawQueueArchive): DailyRawQueuePublisher {
  return { latest: vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(previous).mockResolvedValue(archive.ref),
    readRelease: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(release(archive, true, [])).mockResolvedValueOnce(release(archive, true)).mockResolvedValue(release(archive)),
    createDraft: vi.fn(), upload: vi.fn(), publish: vi.fn(), readback: vi.fn().mockResolvedValue(archive.bytes) };
}

it("exports only portable queue fields and preserves pending work, retry times and DB progress", () => {
  const original = state(); Object.assign(original, { secret: "DO_NOT_PUBLISH" }); Object.assign(original.entries.alpha, { credential: "DO_NOT_PUBLISH" });
  const clean = portableDailyRawQueue(original), bytes = prepared().bytes.toString("utf8");
  expect(JSON.stringify(clean)).not.toMatch(/DO_NOT_PUBLISH|private|account|original\.csv|"file"/);
  expect(clean.providerRetryAt).toBe("2026-10-20T12:00:00Z");
  expect(clean.entries.alpha.pending).toMatchObject({ archiveUrl, sha256: sha, archiveVerified: true });
  expect(clean.entries.alpha.bindings[0]).toMatchObject({ fullImported: false, closedThrough: null });
  expect(original.entries.alpha.pending?.file).toBe("C:/private/account/original.csv");
  expect(bytes).not.toContain("C:/");
  original.entries.alpha.bindings[0].slug = "parent#ethereum";
  expect(portableDailyRawQueue(original).entries.alpha.bindings[0].slug).toBe("parent#ethereum");
});

it("refuses pending originals without a durable public archive and refuses local or foreign archive URLs", () => {
  for (const url of [undefined, "file:///private/original", "https://foreign.test/original", `${archiveUrl}?token=secret`]) {
    const input = state(); input.entries.alpha.pending!.archiveUrl = url;
    expect(() => portableDailyRawQueue(input)).toThrow(/pending_not_archived|proof_missing/);
  }
});

it("preserves every DB binding flag and cooldown in explicit retry-only state while declaring lost unarchived bytes", () => {
  const input = state(); input.entries.alpha.pending!.archiveVerified = false; delete input.entries.alpha.pending!.archiveUrl;
  input.entries.alpha.bindings[0].fullImported = true; input.entries.alpha.bindings[0].closedThrough = "2026-10-01";
  const retry = retryOnlyDailyRawQueue(input);
  expect(retry.state.entries.alpha.bindings).toEqual(input.entries.alpha.bindings);
  expect(retry.state.providerRetryAt).toBe(input.providerRetryAt); expect(retry.state.entries.alpha.retryAt).toBe(input.entries.alpha.retryAt);
  expect(retry.state.entries.alpha.lastAttemptAt).toBe(input.entries.alpha.lastAttemptAt);
  expect(retry.state.entries.alpha.pending).toBeNull(); expect(input.entries.alpha.pending?.file).toContain("C:/private");
  expect(retry.unarchivedReceipts).toEqual([{ geckoId: "alpha", sha256: sha, observedAt: now.toISOString(), reason: "original_not_durable_requires_refetch" }]);
  expect(JSON.stringify(prepareDailyRawQueueArchive({ ...prepared().envelope, ...retry }).envelope)).not.toContain("C:/private");
});

it("finds queue state beyond the first hundred unrelated economic releases and honors publication time", async () => {
  const archive = prepared(), older = { ...release(archive), id: 3 }, newer = { ...release(archive), tag: "daily-raw-queue-newer", id: 4, publishedAt: "2026-10-20T12:00:00Z" };
  const page = vi.fn().mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ ...older, tag: `data-${i}` }))).mockResolvedValueOnce([older, newer, { ...older, tag: "daily-raw-queue-draft", draft: true }]);
  expect(await latestDailyRawQueueRelease(page)).toEqual(newer);
  expect(page.mock.calls).toEqual([[1], [2]]);
  expect(await latestDailyRawQueueRelease(async () => [])).toBeNull();
});

it("restores canonical hash-verified state after local originals and cache files are gone", async () => {
  const archive = prepared(), restored = await restoreDailyRawQueueArchive(release(archive), vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(archive.bytes))));
  expect(restored.envelope.state.entries.alpha.pending?.file).toBeUndefined();
  expect(restored.envelope.state.entries.alpha.pending?.archiveUrl).toBe(archiveUrl);
  expect(restored.envelope.state.entries.alpha.bindings[0].fullImported).toBe(false);
  expect(restored.ref).toEqual(archive.ref);
  await expect(restoreDailyRawQueueArchive(release(archive), vi.fn<typeof fetch>().mockResolvedValue(new Response("changed bytes")))).rejects.toThrow("hash_mismatch");
});

it("preserves the separate Fees provider hold through public archive restore and retry-only fallback", async () => {
  const input = state(); input.feesProviderRetryAt = "2026-10-21T12:00:00Z";
  const archive = prepareDailyRawQueueArchive({ ...prepared().envelope, state: input });
  const restored = await restoreDailyRawQueueArchive(release(archive), vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(archive.bytes))));
  expect(restored.envelope.state.feesProviderRetryAt).toBe(input.feesProviderRetryAt);
  expect(restored.envelope.state.providerRetryAt).toBe(input.providerRetryAt);
  input.entries.alpha.pending!.archiveVerified = false; delete input.entries.alpha.pending!.archiveUrl;
  const retry = retryOnlyDailyRawQueue(input), retryArchive = prepareDailyRawQueueArchive({ ...archive.envelope, ...retry });
  const retryRestored = await restoreDailyRawQueueArchive(release(retryArchive), vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(retryArchive.bytes))));
  expect(retryRestored.envelope.state.feesProviderRetryAt).toBe(input.feesProviderRetryAt);
  expect(retryRestored.envelope.state.providerRetryAt).toBe(input.providerRetryAt);
});

it("follows only approved public release-asset redirects and never forwards credentials", async () => {
  const archive = prepared(), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/public/file?signature=provider" } })).mockResolvedValueOnce(new Response(new Uint8Array(archive.bytes)));
  expect(await readDailyRawQueueArchive(archive.ref, fetcher)).toEqual(archive.bytes);
  expect(fetcher.mock.calls.every(([, init]) => !init?.headers)).toBe(true);
  const foreign = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://foreign.test/private" } }));
  await expect(readDailyRawQueueArchive(archive.ref, foreign)).rejects.toThrow("redirect"); expect(foreign).toHaveBeenCalledOnce();
});

it("resolves unknown create, upload and promotion outcomes by inspection without replaying writes", async () => {
  const archive = prepared(), remote = publisher(archive);
  remote.createDraft = vi.fn().mockRejectedValue(Error("unknown create")); remote.upload = vi.fn().mockRejectedValue(Error("unknown upload")); remote.publish = vi.fn().mockRejectedValue(Error("unknown promotion"));
  expect(await publishDailyRawQueueArchive(archive, remote)).toEqual(archive.ref);
  expect(remote.createDraft).toHaveBeenCalledOnce(); expect(remote.upload).toHaveBeenCalledOnce(); expect(remote.publish).toHaveBeenCalledOnce(); expect(remote.readback).toHaveBeenCalledOnce();
});

it("does not overwrite a mismatched asset or promote a stale parent", async () => {
  const archive = prepared(), mismatch = publisher(archive);
  mismatch.readRelease = vi.fn().mockResolvedValue({ ...release(archive, true), assetHashes: { [archive.file]: "f".repeat(64) } });
  await expect(publishDailyRawQueueArchive(archive, mismatch)).rejects.toThrow("existing_mismatch"); expect(mismatch.upload).not.toHaveBeenCalled(); expect(mismatch.publish).not.toHaveBeenCalled();
  const stale = publisher(archive); stale.latest = vi.fn().mockResolvedValueOnce(previous).mockResolvedValue({ tag: "daily-raw-queue-concurrent", sha256: "e".repeat(64) });
  await expect(publishDailyRawQueueArchive(archive, stale)).rejects.toThrow("stale_parent"); expect(stale.publish).not.toHaveBeenCalled();
});

it("fails closed when an uncertain write remains unconfirmed, without resetting or re-creating state", async () => {
  const archive = prepared(), remote = publisher(archive);
  remote.readRelease = vi.fn().mockResolvedValue(null); remote.createDraft = vi.fn().mockRejectedValue(Error("unknown"));
  await expect(publishDailyRawQueueArchive(archive, remote)).rejects.toThrow("outcome_unconfirmed");
  expect(remote.createDraft).toHaveBeenCalledOnce(); expect(remote.upload).not.toHaveBeenCalled(); expect(remote.publish).not.toHaveBeenCalled();
});

it("accepts an idempotent published state only after public byte readback", async () => {
  const archive = prepared(), remote = publisher(archive);
  remote.latest = vi.fn().mockResolvedValue(archive.ref); remote.readRelease = vi.fn().mockResolvedValue(release(archive));
  expect(await publishDailyRawQueueArchive(archive, remote)).toEqual(archive.ref);
  expect(remote.createDraft).not.toHaveBeenCalled(); expect(remote.upload).not.toHaveBeenCalled(); expect(remote.publish).not.toHaveBeenCalled();
  remote.readback = vi.fn().mockResolvedValue(Buffer.from("corrupt"));
  await expect(publishDailyRawQueueArchive(archive, remote)).rejects.toThrow("hash_mismatch");
});

it("serializes the daily raw workflow and retains queue archival after failed or paused work", () => {
  const source = readFileSync(new URL("../.github/workflows/daily-history.yml", import.meta.url), "utf8"), workflow = parse(source);
  expect(workflow.on.schedule).toEqual([{ cron: "30 4 * * *" }]);
  expect(workflow.on.workflow_run).toBeUndefined();
  expect(workflow.concurrency).toEqual({ group: "daily-valuation-history", "cancel-in-progress": false });
  expect(source).not.toMatch(/history:sync|history:publish|sync-history\.ts/);
  const steps = workflow.jobs.sync.steps as { name?: string; run?: string; if?: string }[];
  expect(steps.find(step => step.name?.startsWith("Publish the durable queue"))?.if).toBe("always() && steps.restore.outcome == 'success'");
  expect(steps.find(step => step.name?.startsWith("Advance queue progress"))?.if).toContain("always()");
  expect(steps.some(step => step.run?.includes("prepare-daily-history.ts"))).toBe(false);
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  if (existsSync(bash)) for (const step of steps.filter(step => step.run)) expect(() => execFileSync(bash, ["--noprofile", "--norc", "-n"], { input: step.run!, encoding: "utf8", windowsHide: true })).not.toThrow();
});

it("prepares history after the complete raw job even when the import used its entire deadline", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/daily-history.yml", import.meta.url), "utf8")), model = workflow.jobs["prepare-history"];
  expect(model.needs).toBe("sync"); expect(model.if).toBe("needs.sync.result == 'success'"); expect(model["timeout-minutes"]).toBe(30);
  expect(model.permissions).toEqual({ contents: "read" });
  expect(model.concurrency).toEqual({ group: "daily-history-model-preparation", "cancel-in-progress": false });
  expect(model.concurrency.group).not.toBe(workflow.concurrency.group);
  const command = model.steps.find((step: { run?: string }) => step.run?.includes("prepare-daily-history.ts"))?.run;
  expect(command).toContain("--max-estimated-writes 50000"); expect(command).toContain("--time-budget-seconds 900"); expect(command).toContain("--apply");
  expect(command).toContain("daily-history-model-${{ github.run_id }}-${{ github.run_attempt }}");
  expect(command).toContain('--reference "$RUNNER_TEMP/daily-history-model-cache/reference.json"');
  expect(JSON.stringify(model)).not.toMatch(/RAW_DEADLINE|remaining|RAW_RUN_ID|continue-daily-raw|sync-daily-raw|GH_TOKEN|GITHUB_TOKEN/);
  const rawSteps = workflow.jobs.sync.steps as { run?: string }[];
  expect(rawSteps.some(step => step.run?.includes("sync-daily-raw.ts") && step.run.includes('--time-budget-seconds "$remaining"'))).toBe(true);
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  if (existsSync(bash)) for (const step of model.steps.filter((step: { run?: string }) => step.run)) expect(() => execFileSync(bash, ["--noprofile", "--norc", "-n"], { input: step.run, encoding: "utf8", windowsHide: true })).not.toThrow();
});

it("normalizes both allowed checkout remote spellings only after verifying repository and main ref", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/daily-history.yml", import.meta.url), "utf8"));
  const steps = workflow.jobs.sync.steps as { name?: string; run?: string; uses?: string }[], step = steps.find(step => step.name === "Normalize the verified canonical repository remote")!;
  expect(steps.indexOf(step)).toBe(steps.findIndex(step => step.uses === "actions/checkout@v4") + 1);
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash", canonical = `https://github.com/${DAILY_RAW_ARCHIVE_REPOSITORY}.git`;
  if (!existsSync(bash)) return;
  const run = (fetch: string, push = fetch, repository = DAILY_RAW_ARCHIVE_REPOSITORY, ref = "refs/heads/main") => execFileSync(bash, ["--noprofile", "--norc", "-e"], {
    input: `GITHUB_REPOSITORY='${repository}'\nGITHUB_REF='${ref}'\ngit() {\n  case "$*" in\n    'remote get-url origin') printf '%s\\n' '${fetch}';;\n    'remote get-url --push origin') printf '%s\\n' '${push}';;\n    'remote set-url '*) printf '%s\\n' "$*";;\n    *) return 97;;\n  esac\n}\n${step.run}`,
    encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  for (const remote of [canonical, canonical.slice(0, -4)]) expect(run(remote)).toBe(`remote set-url origin ${canonical}\nremote set-url --push origin ${canonical}\n`);
  for (const args of [[canonical, canonical, "other/repo"], [canonical, canonical, DAILY_RAW_ARCHIVE_REPOSITORY, "refs/heads/other"], ["https://github.com/other/repo"], [canonical, "https://github.com/other/repo.git"], [`https://user@github.com/${DAILY_RAW_ARCHIVE_REPOSITORY}`]]) {
    try { run(...args as [string, string?, string?, string?]); throw Error("Expected rejection"); }
    catch (error) { expect(error).toMatchObject({ status: 1, stdout: "" }); }
  }
});
