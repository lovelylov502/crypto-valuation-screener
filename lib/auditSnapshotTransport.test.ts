import { afterEach, beforeEach, expect, it, vi } from "vitest";
// These transport fixtures retain the verified legacy snapshot contract.
vi.mock("./pipeline-release.json", () => ({ default: { readerRelease: "four-daily-freshness-v2", writerSchema: 1, schedule: "legacy", phaseA: null } }));
import { gzipSync } from "node:zlib";
import { readAuditSnapshot } from "../scripts/audit-coverage";
import { readSnapshot, sha256 } from "./snapshotArchive";
import { assembleScreener } from "./screener";
import { sample } from "./testFixtures";
import type { PublishedSnapshot } from "./publicationTypes";

const at = "2026-09-29T10:00:00Z", base = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-audit-test-complete/";
function fixture() {
  const paths = ["/protocols", "/config", "/overview/fees", "/overview/fees?dataType=dailyRevenue", "/overview/fees?dataType=dailyHoldersRevenue", "/overview/dexs"];
  const data = assembleScreener([sample({ sourceSlugs: ["sample"], marketSources: { mcap: "CoinGecko", price: "CoinGecko", fdv: "CoinGecko", cmc: null, gecko: { id: "test-token", status: "received", observedAt: at, available: ["mcap", "price", "fdv"], positive: ["mcap", "price", "fdv"] } } })], at, paths.map(path => ({ url: `https://api.llama.fi${path}`, observedAt: at, status: "ok" })));
  const bytes = gzipSync(JSON.stringify(data));
  const ref: PublishedSnapshot = { id: "data-audit-test-complete", url: base + "data.json.gz", sha256: sha256(bytes), dataAt: at, validatedAt: at, publishedAt: at, codeCommit: "test", reportUrl: base + "report.json", witnessUrl: base + "witness.json.gz", witnessSha256: "a".repeat(64) };
  return { data, bytes, ref };
}
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
const reset = () => new TypeError("fetch failed", { cause: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }) });
const response = (bytes: Uint8Array) => new Response(new Uint8Array(bytes));
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("keeps a successful first audit request on the existing runtime 12-second path", async () => {
  const { data, bytes, ref } = fixture(), fetcher = vi.fn().mockResolvedValue(response(bytes)), deadlines = vi.spyOn(AbortSignal, "timeout"); vi.stubGlobal("fetch", fetcher);
  expect(await readAuditSnapshot(ref)).toEqual(data); expect(fetcher).toHaveBeenCalledTimes(1); expect(deadlines.mock.calls).toEqual([[12000]]);
});

it("retries a timed-out audit GET once with the same immutable URL/proof and a fresh 30-second signal", async () => {
  const { data, bytes, ref } = fixture(), fetcher = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValueOnce(response(bytes)), deadlines = vi.spyOn(AbortSignal, "timeout"); vi.stubGlobal("fetch", fetcher);
  const result = expect(readAuditSnapshot(ref)).resolves.toEqual(data); await vi.advanceTimersByTimeAsync(250); await result;
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([ref.url, ref.url]); expect(deadlines.mock.calls).toEqual([[12000], [30000]]);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store" }); expect(fetcher.mock.calls[1][1]).toMatchObject({ cache: "no-store" }); expect(fetcher.mock.calls[0][1].signal).not.toBe(fetcher.mock.calls[1][1].signal);
});

it("recovers a reset during the response body without accepting partially downloaded bytes", async () => {
  const { data, bytes, ref } = fixture(), first = response(bytes);
  vi.spyOn(first, "arrayBuffer").mockRejectedValueOnce(new TypeError("terminated", { cause: Object.assign(new Error("body socket closed"), { code: "UND_ERR_SOCKET" }) }));
  const fetcher = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(response(bytes)); vi.stubGlobal("fetch", fetcher);
  const result = expect(readAuditSnapshot(ref)).resolves.toEqual(data); await vi.advanceTimersByTimeAsync(250); await result; expect(fetcher).toHaveBeenCalledTimes(2);
});

it("bounds both hanging requests and never makes a third attempt after the retry deadline", async () => {
  const { ref } = fixture(), deadlines = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController(); setTimeout(() => controller.abort(timeout()), ms); return controller.signal;
  });
  const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
  })); vi.stubGlobal("fetch", fetcher);
  const result = expect(readAuditSnapshot(ref)).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(11999); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(251); expect(fetcher).toHaveBeenCalledTimes(2); expect(deadlines.mock.calls).toEqual([[12000], [30000]]);
  await vi.advanceTimersByTimeAsync(30000); await result; await vi.advanceTimersByTimeAsync(60000); expect(fetcher).toHaveBeenCalledTimes(2);
});

it("leaves runtime readSnapshot single-attempt after a timeout", async () => {
  const { ref } = fixture(), error = timeout(), fetcher = vi.fn().mockRejectedValue(error); vi.stubGlobal("fetch", fetcher);
  await expect(readSnapshot(ref)).rejects.toBe(error); expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([403, 429, 500, 503])("does not retry snapshot HTTP%s", async status => {
  const { ref } = fixture(), fetcher = vi.fn().mockResolvedValue(new Response("unavailable", { status })); vi.stubGlobal("fetch", fetcher);
  await expect(readAuditSnapshot(ref)).rejects.toThrow(`Snapshot store HTTP ${status}`); expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["hash", "schema", "pipeline", "gzip", "json"])("does not retry a matching-URL %s proof/protocol failure", async failure => {
  const { data, ref } = fixture(); let bytes = gzipSync(JSON.stringify(data));
  if (failure === "schema") { data.sources[0].status = "error"; bytes = gzipSync(JSON.stringify(data)); }
  if (failure === "pipeline") ref.rawBundleSha256 = "b".repeat(64);
  if (failure === "gzip") bytes = Buffer.from("invalid gzip body");
  if (failure === "json") bytes = gzipSync("invalid JSON body");
  ref.sha256 = failure === "hash" ? "0".repeat(64) : sha256(bytes);
  const fetcher = vi.fn().mockResolvedValue(response(bytes)); vi.stubGlobal("fetch", fetcher);
  await expect(readAuditSnapshot(ref)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["http", "hash", "reset"])("does not retry again when the second request fails with %s", async failure => {
  const { bytes, ref } = fixture(), fetcher = vi.fn().mockRejectedValueOnce(timeout());
  if (failure === "http") fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  else if (failure === "hash") fetcher.mockResolvedValueOnce(response(Buffer.from("other bytes")));
  else fetcher.mockRejectedValueOnce(reset());
  vi.stubGlobal("fetch", fetcher); const result = expect(readAuditSnapshot(ref)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(250); await result; expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(call => call[0] === ref.url)).toBe(true); expect(sha256(bytes)).toBe(ref.sha256);
});

it("rejects foreign archive URLs before fetch and unknown transport/protocol failures without retry", async () => {
  const { ref } = fixture(), fetcher = vi.fn().mockRejectedValue(timeout()); vi.stubGlobal("fetch", fetcher);
  await expect(readAuditSnapshot({ ...ref, url: "https://github.com/other/repository/releases/download/data-test/data.json.gz" })).rejects.toThrow("Invalid archive URL"); expect(fetcher).not.toHaveBeenCalled();
  for (const error of [new TypeError("fetch failed"), new TypeError("invalid URL"), Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("bad certificate"), { code: "CERT_HAS_EXPIRED" }) })]) {
    fetcher.mockClear().mockRejectedValue(error); await expect(readAuditSnapshot(ref)).rejects.toBe(error); expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
