import { afterEach, expect, it, vi } from "vitest";
import { assessPipelineCandidate, captureDataPipeline, replayDataPipeline, encodeSourceBundle } from "./dataPipeline";
import { pipelineIntegrityErrors } from "./pipelineIntegrity";
import { revenueReading } from "./revenueReading";
import { apiArchiveErrors, auditArchivedPipeline } from "../scripts/audit-coverage";
import { queryScreener } from "./screenerQuery";
import type { PublishedSnapshot } from "./publicationTypes";
import { decodeSnapshot, sha256 } from "./snapshotArchive";
import { gzipSync } from "node:zlib";
import { contentHash } from "./sourceBundle";

function publication(data: Awaited<ReturnType<typeof captureDataPipeline>>["data"]): PublishedSnapshot {
  const url = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-test-complete/";
  return { id: "data-test-complete", url: url + "data.json.gz", sha256: "a".repeat(64), dataAt: data.updatedAt, validatedAt: data.updatedAt,
    publishedAt: data.updatedAt, codeCommit: "test", reportUrl: url + "report.json", witnessUrl: url + "witness.json.gz", witnessSha256: "b".repeat(64),
    rawBundleUrl: url + "source-bundle.json.gz", rawBundleSha256: data.pipeline!.rawBundleSha256, normalizedSha256: data.pipeline!.normalizedSha256, replayVerified: true };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const at = "2026-10-04T14:00:00.000Z", day = Date.parse("2026-10-03") / 1000;
function upstream(failWbtc = false) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  const wbtc = { slug: "wbtc", name: "WBTC", defillamaId: "2", methodology: { Revenue: "All fees are revenue." }, total24h: 0, total7d: 0.31, total30d: 0.31 };
  const sat = { slug: "sat-rush", name: "Sat Rush", defillamaId: "test-sat", methodology: { Revenue: "Test unreviewed revenue" }, total24h: 5, total7d: 35, total30d: 150 };
  const protocols = [wbtc, sat];
  const charts = Array.from({ length: 30 }, (_, i) => [day - i * 86400, { "Sat Rush": 5, ...(i === 1 ? { WBTC: 0.31 } : {}) }]);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/summary/fees/wbtc") return failWbtc ? new Response("unavailable", { status: 503 }) : new Response(JSON.stringify({ ...wbtc, totalDataChart: [[day - 86400, 0.31], [day, 0]] }));
    const body = url.hostname === "stablecoins.llama.fi" ? { peggedAssets: [{ gecko_id: "tether", symbol: "USDT" }] }
      : url.hostname.includes("coinmarketcap.com") ? { data: [{ id: 99999, name: "Unrelated", symbol: "ZZZ", slug: "unrelated" }] }
      : url.pathname === "/protocols" ? protocols
      : url.pathname === "/config" ? { parentProtocols: [{ id: "parent#unrelated", name: "Unrelated Parent" }] }
      : url.searchParams.get("dataType") === "dailyRevenue" ? { protocols, totalDataChartBreakdown: charts }
      : { protocols: protocols.map(({ slug, name, defillamaId }) => ({ slug, name, defillamaId })), totalDataChartBreakdown: [] };
    return new Response(JSON.stringify(body));
  }));
}

it("replays the full raw-to-display path offline, recovers explicit zero without approving its valuation", async () => {
  upstream();
  const result = await captureDataPipeline(null, at, async () => {});
  const wbtc = result.data.coins.find(c => c.slug === "wbtc")!;
  expect(wbtc.revenueHistory?.periods[1]).toMatchObject({ total: 0, reportedDays: 1 });
  expect(wbtc.fundamentals.revenue.kind).toBe("unknown"); expect(wbtc.multiples.pr).toBeNull();
  expect(revenueReading(result.data.coins.find(c => c.slug === "sat-rush")!, 1).amount).toBe(5);
  vi.stubGlobal("fetch", () => { throw new Error("Unexpected network"); });
  const replayed = await replayDataPipeline(JSON.parse(JSON.stringify(result.bundle)));
  expect(replayed).toEqual(result.data);
  expect(assessPipelineCandidate(result.data, result.bundle, null, at, at, replayed).errors).toEqual([]);
  expect(assessPipelineCandidate(result.data, result.bundle, result.data, at, at, replayed).errors).toContain("candidate_baseline_mismatch");
  const bytes = gzipSync(JSON.stringify(result.data)), ref = { ...publication(result.data), sha256: sha256(bytes) };
  expect(decodeSnapshot(bytes, ref)).toEqual(result.data);
  delete ref.rawBundleUrl; delete ref.rawBundleSha256; delete ref.normalizedSha256; delete ref.replayVerified;
  expect(() => decodeSnapshot(bytes, ref)).toThrow("archive_source_proof_mismatch");
  const archivedAudit = await auditArchivedPipeline(result.data, publication(result.data), encodeSourceBundle(result.bundle), result.witness);
  expect(archivedAudit.errors).toEqual([]);
  // Compression is a container detail; replay binds the bytes actually archived,
  // even when another runtime/zlib uses a different valid encoding.
  const alternateBytes = gzipSync(JSON.stringify(result.bundle), { level: 1 });
  expect(contentHash(alternateBytes)).not.toBe(result.data.pipeline!.rawBundleSha256);
  const alternate = await replayDataPipeline(result.bundle, contentHash(alternateBytes));
  expect((await auditArchivedPipeline(alternate, publication(alternate), alternateBytes, result.witness)).errors).toEqual([]);
  expect(assessPipelineCandidate(alternate, result.bundle, null, at, at, alternate, alternateBytes).errors).toEqual([]);
  expect(apiArchiveErrors(queryScreener(result.data), result.data.coins, result.data)).toEqual([]);
  await expect(auditArchivedPipeline(result.data, publication(result.data), Buffer.from("corrupt"), result.witness)).rejects.toThrow("raw source proof mismatch");
  const alteredWitness = structuredClone(result.witness); alteredWitness[0] = [];
  expect((await auditArchivedPipeline(result.data, publication(result.data), encodeSourceBundle(result.bundle), alteredWitness)).errors).toContain("archived witness differs from original source bundle");
  const forged = structuredClone(result.data);
  forged.coins.find(c => c.slug === "wbtc")!.revenueHistory!.periods[1].total = 123456789;
  expect(pipelineIntegrityErrors(forged)).toContain("pipeline_normalized_values_changed");
  expect(assessPipelineCandidate(forged, result.bundle, null, at, at, replayed).errors).toContain("candidate_source_lineage_mismatch");
  expect(apiArchiveErrors(queryScreener(forged), forged.coins, result.data)).toContain("published bytes changed:wbtc");
});

it("publishes current healthy rows while an exactly scoped failed source remains explicitly partial", async () => {
  upstream(true);
  const result = await captureDataPipeline(null, at, async () => {});
  const wbtc = result.data.coins.find(c => c.slug === "wbtc")!;
  expect(wbtc.revenueHistory?.periods[1].total).toBeNull();
  expect(wbtc.dataQuality?.issues).toContainEqual(expect.objectContaining({ scope: "revenue", code: "request_failed", retryable: true }));
  expect(result.data.coins.find(c => c.slug === "sat-rush")!.dataQuality?.state).toBe("complete");
  expect(assessPipelineCandidate(result.data, result.bundle, null, at, at, result.data).errors).toEqual([]);
  vi.stubGlobal("fetch", () => { throw new Error("Fresh source reads are forbidden during archive audit"); });
  expect((await auditArchivedPipeline(result.data, publication(result.data), encodeSourceBundle(result.bundle), result.witness)).errors).toEqual([]);
  const unaccounted = structuredClone(result.data); unaccounted.coins.find(c => c.slug === "wbtc")!.dataQuality!.issues = [];
  expect(apiArchiveErrors(queryScreener(unaccounted), unaccounted.coins, result.data).some(e => e.startsWith("unaccounted_source_error:"))).toBe(true);
});
