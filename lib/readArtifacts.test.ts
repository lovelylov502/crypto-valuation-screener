import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { buildTableCatalog } from "./tableCatalog";
import { tableFixture, tableReference } from "./tableTestFixtures";
import { defaultPreferences } from "./workspacePreferences";
import type { ArtifactManifest } from "./readArtifacts";
const mocks = vi.hoisted(() => ({ connect: vi.fn(), snapshot: vi.fn(), publication: vi.fn() }));
vi.mock("./historyDatabase", async original => ({ ...await original<typeof import("./historyDatabase")>(), connectHistory: mocks.connect }));
vi.mock("./serverScreener", () => ({ getScreener: mocks.snapshot, getPublication: mocks.publication, publicPublication: (value: unknown) => value }));
const index = "https://raw.githubusercontent.com/lovelylov502/crypto-valuation-screener/read-model-index/current.json", base = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/screener-read-test/";
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
let files: Map<string, Buffer>, fetcher: ReturnType<typeof vi.fn>, manifest: ArtifactManifest;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.unstubAllEnvs(); files = new Map();
  const data = tableFixture(15), ref = tableReference(data), built = buildTableCatalog(data, ref);
  manifest = { schema: 1, version: 1, inputKey: "b".repeat(64), createdAt: data.updatedAt, publication: ref, files: {}, history: {}, remoteDatabase: { reads: 0, writes: 0 } };
  const put = (name: string, data: unknown) => { const bytes = gzipSync(JSON.stringify(data)); files.set(base + name, bytes); manifest.files[name] = { url: base + name, sha256: hash(bytes) }; };
  put("catalog.json.gz", built.catalog); put("publication.json.gz", { published: ref }); put("map.json.gz", {}); put("comparisons.json.gz", {}); put("history.sqlite.gz", {});
  for (const [sha, shard] of built.shards) put(`detail-${sha}.json.gz`, shard);
  const raw = { schema: 1, sources: [], definitions: [], points: [] }, json = Buffer.from(JSON.stringify(raw));
  const envelope = { schema: 3, calculationVersion: "daily-raw-same-day-v1", asset: { slug: "coin-001", identity: "gecko:token-1", snapshotId: ref.id }, asOf: "2026-10-18", rawRevision: "c".repeat(64), revenueDays: 1, freshness: { lagDays: 0, status: "current", reason: null }, convention: "same-day", encoding: "gzip-base64", sha256: hash(json), payload: gzipSync(json).toString("base64") };
  put("history-00.json.gz", { "coin-001": envelope }); manifest.history["coin-001"] = { file: "history-00.json.gz", identity: "gecko:token-1", revision: envelope.rawRevision };
  const bytes = Buffer.from(JSON.stringify(manifest)); files.set(base + "manifest.json", bytes); files.set(index, Buffer.from(JSON.stringify({ url: base + "manifest.json", sha256: hash(bytes) })));
  fetcher = vi.fn(async (url: string) => new Response(files.get(String(url)) as unknown as BodyInit, { status: files.has(String(url)) ? 200 : 404 })); vi.stubGlobal("fetch", fetcher);
  mocks.connect.mockImplementation(() => { throw Error("Unexpected hosted SQL"); }); mocks.snapshot.mockRejectedValue(Error("Unexpected full snapshot fallback"));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
it("shares a cold load and serves table, detail, map and history version requests with zero hosted connections", async () => {
  const { currentArtifactSet } = await import("./readArtifacts");
  const sets = await Promise.all(Array.from({ length: 12 }, () => currentArtifactSet()));
  expect(new Set(sets).size).toBe(1); expect(fetcher.mock.calls.filter(([url]) => url === index)).toHaveLength(1);
  const { readTablePage, readTableDetail } = await import("./tableRead");
  expect((await readTablePage(defaultPreferences(), [], 1, 100)).publicationId).toBe(manifest.publication.id);
  const detail = await readTableDetail("coin-001", manifest.publication.id, "gecko:token-1"); expect(detail?.coin.name).toBe("Coin 1");
  const { readDiscovery } = await import("./discoveryRead");
  for (const capital of ["fdv", "mcap"] as const) expect((await readDiscovery({ ...defaultPreferences(), capital }, [], 1, "map")).historyStatus).toBe("ready");
  const { GET } = await import("../app/api/history/route");
  for (const format of ["version", "compact"]) {
    const response = await GET(new Request(`https://test/api/history?slug=coin-001&expectedIdentity=gecko:token-1&format=${format}`));
    expect(response.status).toBe(200); expect((await response.json()).rawRevision).toBe("c".repeat(64));
  }
  expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
});
it("retains the complete last verified version when a new pointer or asset is corrupt", async () => {
  const { currentArtifactSet } = await import("./readArtifacts"), original = await currentArtifactSet();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000); files.set(index, Buffer.from('{"url":"https://untrusted.invalid/manifest.json","sha256":"bad"}'));
  expect(await currentArtifactSet()).toBe(original); expect(mocks.connect).not.toHaveBeenCalled(); vi.restoreAllMocks();
});
it("rejects a changed history identity and revision before returning a prepared blob", async () => {
  const { GET } = await import("../app/api/history/route");
  const request = (query: string) => new Request(`https://test/api/history?slug=coin-001&format=compact&${query}`);
  expect((await GET(request("expectedIdentity=gecko:old"))).status).toBe(409);
  expect((await GET(request("expectedIdentity=gecko:token-1&expectedRevision=outdated"))).status).toBe(409);
  expect(mocks.connect).not.toHaveBeenCalled();
});
it("fails closed on corrupt cold data rather than contacting the hosted database", async () => {
  files.set(base + "catalog.json.gz", Buffer.from("bad"));
  await expect((await import("./readArtifacts")).currentArtifactSet()).rejects.toThrow("hash_mismatch");
  expect(mocks.connect).not.toHaveBeenCalled();
});
