import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dailyRawQueueState } from "../scripts/daily-raw-queue-state";
import { DAILY_RAW_ARCHIVE_REPOSITORY } from "./dailyRawArchive";
import { prepareDailyRawQueueArchive } from "./dailyRawQueueArchive";
import { reconcileDailyRawQueue } from "./dailyRawQueue";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

let cache: string;
const target = "c".repeat(40), tag = "daily-raw-queue-cli-test", id = 417453847;
const archive = prepareDailyRawQueueArchive({ schema: 1, repository: DAILY_RAW_ARCHIVE_REPOSITORY, tag, target, previous: null,
  state: reconcileDailyRawQueue(null, [], "2026-10-18", new Date("2026-10-19T12:00:00Z")) });
type Remote = { id: number; tag_name: string; target_commitish: string; body: string; draft: boolean; published_at: string | null;
  assets: { name: string; state: string; digest: string }[] };

beforeEach(async () => {
  vi.mocked(spawnSync).mockReset();
  cache = await mkdtemp(join(tmpdir(), "raw-queue-cli-"));
  await writeFile(join(cache, "daily-raw-queue.json"), JSON.stringify(archive.envelope.state));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(new Uint8Array(archive.bytes)))));
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (!cache.startsWith(join(tmpdir(), "raw-queue-cli-"))) throw Error("Unexpected cleanup root");
  await rm(cache, { recursive: true, force: true });
});

function github(mode: "created-id" | "unknown-create" | "existing-draft" | "mismatch" | "missing-published-tag") {
  const draft = (): Remote => ({ id, tag_name: tag, target_commitish: target, body: archive.notes, draft: true, published_at: null, assets: [] });
  let remote: Remote | null = mode === "existing-draft" || mode === "mismatch" ? draft() : null, discovery = 0;
  if (remote && mode === "mismatch") remote.body = "different immutable notes";
  const result = (value: unknown, status = 0, stderr = "") => ({ status, stdout: typeof value === "string" ? value : JSON.stringify(value), stderr, pid: 1, signal: null, output: [] }) as unknown as ReturnType<typeof spawnSync>;
  const mock = vi.mocked(spawnSync).mockImplementation((binary, args = []) => {
    const argv = args as string[];
    if (binary === "git") {
      if (argv[0] === "-C") return result("", 1);
      if (argv[0] === "remote") return result(`https://github.com/${DAILY_RAW_ARCHIVE_REPOSITORY}.git`);
      return result(argv.includes("HEAD") ? target : process.cwd());
    }
    if (binary !== "gh" || argv[0] !== "api") throw Error("Unexpected external command");
    const method = argv.includes("--method") ? argv[argv.indexOf("--method") + 1] : "GET";
    const endpoint = argv.find(value => value.startsWith("repos/") || value.startsWith("https://uploads.github.com/"))!;
    if (method === "POST" && endpoint === `repos/${DAILY_RAW_ARCHIVE_REPOSITORY}/releases`) {
      expect(remote).toBeNull(); expect(argv).toContain("draft=true"); expect(argv).toContain("make_latest=false");
      expect(readFileSync(argv.find(value => value.startsWith("body=@"))!.slice(6), "utf8")).toBe(archive.notes);
      remote = draft();
      return mode === "unknown-create" ? result("", 1, "request outcome unknown") : result(remote);
    }
    if (method === "POST" && endpoint.startsWith("https://uploads.github.com/")) {
      expect(endpoint).toBe(`https://uploads.github.com/repos/${DAILY_RAW_ARCHIVE_REPOSITORY}/releases/${id}/assets?name=${archive.file}`);
      expect(readFileSync(argv[argv.indexOf("--input") + 1])).toEqual(archive.bytes);
      expect(remote!.assets).toEqual([]);
      remote!.assets.push({ name: archive.file, state: "uploaded", digest: `sha256:${archive.ref.sha256}` }); return result(remote!.assets[0]);
    }
    if (method === "PATCH") {
      expect(endpoint).toBe(`repos/${DAILY_RAW_ARCHIVE_REPOSITORY}/releases/${id}`); expect(argv).toContain("make_latest=false");
      remote!.draft = false; remote!.published_at = "2026-10-19T12:01:00Z"; return result(remote);
    }
    if (method !== "GET") throw Error("Unexpected mutation");
    if (endpoint.endsWith(`/commits/${target}`)) return result({ sha: target });
    if (endpoint.includes("/git/ref/tags/")) return remote && !remote.draft && mode !== "missing-published-tag" ? result({ object: { type: "commit", sha: target } }) : result("", 1, "HTTP 404");
    if (endpoint.endsWith(`/releases/${id}`)) return result(remote);
    if (endpoint.includes("/releases/tags/")) return result("", 1, "HTTP 404");
    if (endpoint.includes("/releases?")) {
      if (remote && (!remote.draft || mode === "existing-draft" || mode === "mismatch" || mode === "unknown-create" && discovery++ > 0)) return result([remote]);
      return result([]);
    }
    throw Error("Unexpected GitHub read");
  });
  return { commands: () => mock.mock.calls.filter(([binary]) => binary === "gh").map(([, args]) => args as string[]) };
}

const publish = () => dailyRawQueueState(["--publish", "--cache", cache, "--tag", tag, "--seed"]);
const mutations = (commands: string[][], method: string) => commands.filter(args => args[args.indexOf("--method") + 1] === method);

it("retains the structured create ID when tag and list discovery still cannot see the new draft", async () => {
  const remote = github("created-id"); await publish();
  const commands = remote.commands();
  expect(mutations(commands, "POST")).toHaveLength(2); expect(mutations(commands, "PATCH")).toHaveLength(1);
  expect(commands.filter(args => args.some(value => value.includes("/releases/tags/")))).toHaveLength(1);
  expect(commands.filter(args => args.includes(`repos/${DAILY_RAW_ARCHIVE_REPOSITORY}/releases/${id}`))).toHaveLength(4);
  expect(JSON.parse(await readFile(join(cache, "daily-raw-queue-origin.json"), "utf8"))).toEqual(archive.ref);
  expect(fetch).toHaveBeenCalledOnce();
});

it("discovers an unknown successful create with read-only retries without repeating the create or upload", async () => {
  const remote = github("unknown-create"); await publish();
  expect(mutations(remote.commands(), "POST")).toHaveLength(2); expect(mutations(remote.commands(), "PATCH")).toHaveLength(1);
  expect(remote.commands().filter(args => args.some(value => value.includes("/releases/tags/")))).toHaveLength(3);
});

it("recovers the exact existing draft without creating another release", async () => {
  const remote = github("existing-draft"); await publish();
  expect(mutations(remote.commands(), "POST")).toHaveLength(1); expect(mutations(remote.commands(), "PATCH")).toHaveLength(1);
  expect(JSON.parse(await readFile(join(cache, "daily-raw-queue-origin.json"), "utf8"))).toEqual(archive.ref);
});

it("refuses a discovered draft with different immutable notes before any write", async () => {
  const remote = github("mismatch"); await expect(publish()).rejects.toThrow("existing_mismatch");
  expect(mutations(remote.commands(), "POST")).toHaveLength(0); expect(mutations(remote.commands(), "PATCH")).toHaveLength(0);
});

it("still requires direct tag commit proof after promotion before recording success", async () => {
  github("missing-published-tag"); await expect(publish()).rejects.toThrow("existing_mismatch");
  await expect(readFile(join(cache, "daily-raw-queue-origin.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(fetch).not.toHaveBeenCalled();
});
