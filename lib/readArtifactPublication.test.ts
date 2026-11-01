import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gh, publish } from "../scripts/publish-read-artifacts";
import type { ArtifactManifest } from "./readArtifacts";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }));
const repo = "lovelylov502/crypto-valuation-screener", api = `repos/${repo}`;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ok = (stdout = "") => ({ status: 0, signal: null, stdout, stderr: "" });
const prefix = join(tmpdir(), "tovenit-publication-test-");
let directory: string | undefined;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => {
  vi.unstubAllGlobals();
  if (directory) { if (!resolve(directory).startsWith(resolve(prefix))) throw Error("Unexpected test directory"); await rm(directory, { recursive: true, force: true }); directory = undefined; }
});

it.each([false, true])("rejects truncated GitHub output even for an optional lookup (%s)", optional => {
  mocks.spawn.mockReturnValue({ status: null, signal: "SIGTERM", error: Object.assign(new Error("buffer exceeded"), { code: "ENOBUFS" }), stdout: '{"partial":', stderr: "" });
  expect(() => gh(["api", `${api}/contents/current.json`], optional)).toThrow("ENOBUFS");
});
it("rejects a terminated child process without an exit code", () => {
  mocks.spawn.mockReturnValue({ status: null, signal: "SIGTERM", stdout: "{}", stderr: "" });
  expect(() => gh(["release", "view", "tag"], true)).toThrow("SIGTERM");
});
it("preserves optional nonzero lookup handling and rejects required failures", () => {
  mocks.spawn.mockReturnValue({ ...ok(), status: 1 });
  expect(gh(["release", "view", "missing"], true)).toBeNull();
  expect(() => gh(["release", "upload", "tag"])).toThrow("read_artifact_github_failed:release:1");
});

async function fixture(options: { badDigest?: boolean; wrongTag?: boolean; changedPointer?: boolean } = {}) {
  directory = await mkdtemp(prefix);
  const tag = "screener-read-test", base = `https://github.com/${repo}/releases/download/${tag}/`;
  const manifest = { schema: 1, version: 1, inputKey: "a".repeat(64), createdAt: "2026-11-01T06:00:00Z", publication: { id: "data-test-complete", sha256: "b".repeat(64) }, files: {}, history: {}, remoteDatabase: { reads: 0, writes: 0 } } as ArtifactManifest;
  const assets: { name: string; digest: string; state: string }[] = [];
  for (const name of ["catalog.json.gz", "publication.json.gz", "map.json.gz", "comparisons.json.gz", "history.sqlite.gz"]) {
    const bytes = Buffer.from(name); await writeFile(join(directory, name), bytes);
    manifest.files[name] = { url: base + name, sha256: hash(bytes) };
    assets.push({ name, digest: `sha256:${hash(bytes)}`, state: "uploaded" });
  }
  const bytes = Buffer.from(JSON.stringify(manifest)); await writeFile(join(directory, "manifest.json"), bytes);
  assets.push({ name: "manifest.json", digest: `sha256:${hash(bytes)}`, state: "uploaded" });
  if (options.badDigest) assets[1].digest = `sha256:${"0".repeat(64)}`;
  const before = { pointer: { url: base + "manifest.json", sha256: "c".repeat(64) }, manifest };
  let pointer = { ...before.pointer, ...(options.changedPointer ? { sha256: "d".repeat(64) } : {}) };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
  mocks.spawn.mockImplementation((command: string, args: string[]) => {
    if (command === "git") return ok(args[0] === "remote" ? `https://github.com/${repo}.git` : "e".repeat(40));
    if (args[0] === "release" && args[1] === "view") return ok(JSON.stringify({ databaseId: 123, isDraft: true, tagName: options.wrongTag ? "other-tag" : tag }));
    if (args[0] === "release") return ok();
    // Reproduce the real failure if publication regresses to listing all releases.
    if (args[1] === `${api}/releases?per_page=100`) return { status: null, signal: "SIGTERM", error: Object.assign(new Error("buffer exceeded"), { code: "ENOBUFS" }), stdout: "[" };
    if (args[1] === `${api}/releases/123/assets?per_page=100`) return ok(JSON.stringify([assets.slice(0, 3), assets.slice(3)]));
    if (args.includes("PUT")) {
      const request = JSON.parse(readFileSync(args[args.indexOf("--input") + 1], "utf8"));
      expect(request.sha).toBe("previous-file-sha");
      pointer = JSON.parse(Buffer.from(request.content, "base64").toString()); return ok("{}");
    }
    if (args[1] === `${api}/contents/current.json?ref=read-model-index`) return ok(JSON.stringify({ sha: "previous-file-sha", content: Buffer.from(JSON.stringify(pointer)).toString("base64") }));
    throw Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });
  return { tag, manifest, before, output: directory, pointer: { url: base + "manifest.json", sha256: hash(bytes) } };
}
it("publishes a verified draft by its exact tag even when the release list exceeds the buffer", async () => {
  const f = await fixture(); await publish(f.output, f.manifest, f.tag, f.before);
  const calls = mocks.spawn.mock.calls.map(([, args]) => args as string[]);
  expect(calls.some(args => args.includes(`${api}/releases?per_page=100`))).toBe(false);
  expect(calls.some(args => args[1] === "view" && args.includes("databaseId,isDraft,tagName"))).toBe(true);
  expect(calls.find(args => args[1] === "edit")).toEqual(["release", "edit", f.tag, "--repo", repo, "--draft=false", "--latest=false"]);
  expect(JSON.parse(readFileSync(join(f.output, "published-pointer.json"), "utf8"))).toEqual(f.pointer);
});
it.each([{ badDigest: true }, { wrongTag: true }])("does not publish an unverified draft: %j", async options => {
  const f = await fixture(options); await expect(publish(f.output, f.manifest, f.tag, f.before)).rejects.toThrow();
  expect(mocks.spawn.mock.calls.some(([, args]) => args[1] === "edit" || args.includes("PUT"))).toBe(false);
});
it("does not overwrite a pointer advanced by another writer", async () => {
  const f = await fixture({ changedPointer: true });
  await expect(publish(f.output, f.manifest, f.tag, f.before)).rejects.toThrow("read_artifact_pointer_changed");
  expect(mocks.spawn.mock.calls.some(([, args]) => args.includes("PUT"))).toBe(false);
});
