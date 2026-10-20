import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateDailyValuation } from "./dailyValuation";
import { compactDailyHistory, type CompactHistoryEnvelope, type DailyHistoryVersion } from "./dailyValuationCompact";
import { DETAIL_HISTORY_TIMEOUT_MS, DetailHistoryCache, loadCachedDetailHistory, validateDetailHistoryVersion, type CachedDetailHistoryRequest, type DetailHistoryBundle, type DetailHistoryTransport } from "./detailHistoryCache";
import { detailChartPoints, detailSeriesSegments, type DetailHistoryData } from "./detailHistory";
import type { DailyRawSource, DailyRawStoredPoint } from "./dailyRawData";

const now = new Date("2026-10-20T12:00:00Z");
const version: DailyHistoryVersion = { schema: 3, calculationVersion: "daily-raw-same-day-v1", asset: { slug: "aave", identity: "gecko:aave", snapshotId: "snapshot-one" },
  asOf: "2026-10-19", rawRevision: "a".repeat(64), revenueDays: 1, freshness: { status: "current", lagDays: 0, reason: null }, convention: "same completed UTC date" };
const sources: DailyRawSource[] = (["price", "mcap", "fdv", "fees", "revenue", "holders"] as const).map(metric => ({ key: metric, metric,
  provider: ["price", "mcap", "fdv"].includes(metric) ? "CoinGecko" : "DefiLlama", url: `https://example.test/${metric}`, sha256: "b".repeat(64),
  archiveUrl: "https://example.test/archive", observedAt: now.toISOString(), scope: "exact-parent", definition: metric,
  basis: ["price", "mcap", "fdv"].includes(metric) ? "captured_quote;actual_provider_timestamp" : "completed_utc_day_flow;provider_reconstructed;original_dated_observations" }));
const sourceMap = new Map(sources.map(source => [source.key, source]));
const raw = (day: string, extra: Partial<DailyRawStoredPoint> = {}): DailyRawStoredPoint => ({ day,
  price: { value: 1, state: "positive", source: "price", at: `${day}T12:00:00Z` }, mcap: { value: 36500, state: "positive", source: "mcap", at: `${day}T12:00:00Z` },
  fdv: { value: 73000, state: "positive", source: "fdv", at: `${day}T12:00:00Z` }, fees: { value: 100, state: "positive", source: "fees", at: null },
  revenue: { value: 10, state: "positive", source: "revenue", at: null }, holders: { value: 2, state: "positive", source: "holders", at: null }, ...extra });
const rows = [raw("2020-01-01"), raw("2026-10-12", { revenue: { value: 0, state: "zero", source: "revenue", at: null } }),
  raw("2026-10-14", { fdv: { value: null, state: "missing", source: "", at: null } }), raw("2026-10-19")];
const bundle = (stamp = version, points = rows): DetailHistoryBundle => Object.fromEntries((["mcap", "fdv"] as const).map(capital => [capital, {
  ...stamp, schema: 2, calculationVersion: "daily-raw-same-day-v1", capital, points: points.map(point => calculateDailyValuation({ point, capital, sources: sourceMap, eligible: true, completedThrough: stamp.asOf })), sources, nextCursor: null,
} satisfies DetailHistoryData])) as DetailHistoryBundle;
const envelope = (stamp = version, points = rows): CompactHistoryEnvelope => {
  const data = bundle(stamp, points), body = Buffer.from(JSON.stringify(compactDailyHistory(data.fdv.points, data.mcap.points, sources)));
  return { ...stamp, encoding: "gzip-base64", sha256: createHash("sha256").update(body).digest("hex"), payload: gzipSync(body).toString("base64") };
};
const request = (extra: Partial<CachedDetailHistoryRequest> = {}): CachedDetailHistoryRequest => ({ slug: "aave", identity: "gecko:aave", publicationId: "snapshot-one", snapshotUpdatedAt: now.toISOString(),
  range: "MAX", capital: "mcap", now, signal: new AbortController().signal, ...extra });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function network(initial = version) {
  const current = { version: initial, body: envelope(initial), probeStatus: 200 };
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const params = new URL(String(input), "https://example.test").searchParams;
    if (params.get("format") === "version") return current.probeStatus === 200 ? Response.json(current.version) : new Response(null, { status: current.probeStatus });
    if (params.get("format") !== "compact") throw Error("unexpected history request");
    expect(params.get("expectedRevision")).toBe(current.version.rawRevision);
    expect(params.has("after")).toBe(false); expect(params.has("limit")).toBe(false);
    return Response.json(current.body);
  });
  const count = (format: string) => fetcher.mock.calls.filter(([url]) => new URL(String(url), "https://example.test").searchParams.get("format") === format).length;
  return { current, fetcher, count };
}
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(now.getTime()); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("version-checked compact history reuse", () => {
  it("loads a 2209-date MAX in one compact request without a 1000-date page cap", async () => {
    const cache = new DetailHistoryCache(), net = network();
    const long = Array.from({ length: 2209 }, (_, index) => raw(new Date(Date.parse(version.asOf) - (2208 - index) * 86_400_000).toISOString().slice(0, 10)));
    net.current.body = envelope(version, long);
    const result = await loadCachedDetailHistory({ ...request(), cache, fetcher: net.fetcher });
    expect(result.points).toHaveLength(2209); expect(result.points[0].day).toBe(long[0].day); expect(result.points.at(-1)!.day).toBe(version.asOf);
    const short = await loadCachedDetailHistory({ ...request({ range: "7D", capital: "fdv" }), cache, fetcher: net.fetcher });
    expect(short.points).toHaveLength(7); expect(net.count("compact")).toBe(1); expect(net.count("version")).toBe(2);
  });

  it("fetches one full MAX payload, then changes range and numerator using only light version probes", async () => {
    const cache = new DetailHistoryCache(), net = network();
    const initial = await loadCachedDetailHistory({ ...request(), cache, fetcher: net.fetcher });
    const short = await loadCachedDetailHistory({ ...request({ range: "7D", capital: "fdv" }), cache, fetcher: net.fetcher });
    const month = await loadCachedDetailHistory({ ...request({ range: "1M" }), cache, fetcher: net.fetcher });
    const reopened = await loadCachedDetailHistory({ ...request({ now: new Date(now.getTime() + 50_000) }), cache, fetcher: net.fetcher });
    expect(net.count("version")).toBe(4); expect(net.count("compact")).toBe(1);
    expect(initial.points).toHaveLength(4); expect(reopened.points).toEqual(initial.points);
    expect(short.points.map(point => point.day)).toEqual(["2026-10-14", "2026-10-19"]);
    expect(month.points).toHaveLength(3);
    expect(initial.points.at(-1)!.pr.value).toBe(10); expect(short.points.at(-1)!.pr.value).toBe(20);
    expect(short.points[0].fdv.value).toBeNull(); expect(short.points[0].pr.value).toBeNull();
    expect(month.points[0].revenue).toMatchObject({ value: 0, state: "zero" }); expect(month.points[0].pr.reason).toBe("non_positive_revenue");
    expect(detailSeriesSegments(detailChartPoints(short.points), "mcap").map(segment => segment.length)).toEqual([1, 1]);
    expect(short.sources).toEqual(sources); expect(short.sources.find(source => source.key === "revenue")).toMatchObject({ archiveUrl: "https://example.test/archive", sha256: "b".repeat(64), scope: "exact-parent" });
  });

  it("keeps the original frozen UTC range when a full canonical response covers a later completed date", async () => {
    const cache = new DetailHistoryCache(), net = network();
    const olderRange = new Date("2026-10-19T23:50:00Z");
    const result = await loadCachedDetailHistory({ ...request({ range: "7D", now: olderRange }), cache, fetcher: net.fetcher });
    expect(result.asOf).toBe("2026-10-19"); expect(result.points.map(point => point.day)).toEqual(["2026-10-12", "2026-10-14"]);
    const current = await loadCachedDetailHistory({ ...request({ range: "7D" }), cache, fetcher: net.fetcher });
    expect(current.points.at(-1)!.day).toBe("2026-10-19"); expect(net.count("compact")).toBe(1);
  });

  it("loads a changed raw revision and never silently returns the previous cached numbers", async () => {
    const cache = new DetailHistoryCache(), net = network();
    await loadCachedDetailHistory({ ...request(), cache, fetcher: net.fetcher });
    net.current.version = { ...version, rawRevision: "c".repeat(64) };
    net.current.body = envelope(net.current.version, [raw("2026-10-19", { revenue: { value: 20, state: "positive", source: "revenue", at: null } })]);
    const result = await loadCachedDetailHistory({ ...request(), cache, fetcher: net.fetcher });
    expect(result.rawRevision).toBe("c".repeat(64)); expect(result.points[0].pr.value).toBe(5); expect(net.count("compact")).toBe(2);
  });

  it("rejects a changed publication until the actual full coin carries that publication", async () => {
    const cache = new DetailHistoryCache(), net = network();
    await loadCachedDetailHistory({ ...request(), cache, fetcher: net.fetcher });
    net.current.version = { ...version, asset: { ...version.asset, snapshotId: "snapshot-two" } }; net.current.body = envelope(net.current.version);
    await expect(loadCachedDetailHistory({ ...request(), cache, fetcher: net.fetcher })).rejects.toMatchObject({ status: 409 });
    expect(net.count("compact")).toBe(1);
    const updated = await loadCachedDetailHistory({ ...request({ publicationId: "snapshot-two" }), cache, fetcher: net.fetcher });
    expect(updated.asset.snapshotId).toBe("snapshot-two"); expect(net.count("compact")).toBe(2);
  });

  it("refuses unlinked identities, unfinished asOf, changed calculation and inconsistent capture dates before a large request", async () => {
    for (const changed of [{ ...version, asset: { ...version.asset, identity: "gecko:other" } }, { ...version, asOf: "2026-10-20" }, { ...version, calculationVersion: "different" }, { ...version, asOf: "2026-10-18" }]) {
      const fetcher = vi.fn(async () => Response.json(changed));
      await expect(loadCachedDetailHistory({ ...request(), cache: new DetailHistoryCache(), fetcher })).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    expect(() => validateDetailHistoryVersion(version, request({ snapshotUpdatedAt: "invalid" }))).toThrow();
  });

  it("rejects a compact response from a different revision and admits no partial result", async () => {
    const cache = new DetailHistoryCache(), net = network();
    net.current.body = envelope({ ...version, rawRevision: "c".repeat(64) });
    await expect(loadCachedDetailHistory({ ...request(), cache, fetcher: net.fetcher })).rejects.toMatchObject({ status: 409 });
    expect(cache.stats().entries).toBe(0);
  });

  it("fails closed on a corrupted payload, then allows a clean explicit retry", async () => {
    const cache = new DetailHistoryCache(), net = network();
    net.current.body.sha256 = "d".repeat(64);
    await expect(loadCachedDetailHistory({ ...request(), cache, fetcher: net.fetcher })).rejects.toMatchObject({ status: 502 });
    expect(cache.stats().entries).toBe(0);
    net.current.body = envelope();
    await expect(loadCachedDetailHistory({ ...request({ force: true }), cache, fetcher: net.fetcher })).resolves.toMatchObject({ nextCursor: null });
    expect(net.count("version")).toBe(2); expect(net.count("compact")).toBe(2);
  });

  it("does not use warm history when the current version cannot be checked", async () => {
    const cache = new DetailHistoryCache(), net = network();
    await loadCachedDetailHistory({ ...request(), cache, fetcher: net.fetcher });
    for (const status of [404, 409, 503]) {
      net.current.probeStatus = status;
      await expect(loadCachedDetailHistory({ ...request(), cache, fetcher: net.fetcher })).rejects.toMatchObject({ status });
    }
    expect(net.count("compact")).toBe(1);
  });
});

describe("bounded browser history cache", () => {
  const transport = (stamp = version): DetailHistoryTransport => ({ version: vi.fn(async () => stamp), history: vi.fn(async () => bundle(stamp)) });
  it("expires by absolute TTL without extending history lifetime on warm reads", async () => {
    const cache = new DetailHistoryCache({ entries: 8, bytes: 1_000_000, points: 64_000, ttl: 10 }), wire = transport();
    await cache.load(request(), wire);
    vi.spyOn(Date, "now").mockReturnValue(now.getTime() + 5); await cache.load(request(), wire);
    vi.spyOn(Date, "now").mockReturnValue(now.getTime() + 11); await cache.load(request(), wire);
    expect(wire.version).toHaveBeenCalledTimes(3); expect(wire.history).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used entry and stays within decoded-byte and point budgets", async () => {
    const cache = new DetailHistoryCache({ entries: 2, bytes: 1_000_000, points: 64_000, ttl: 300_000 });
    const load = async (slug: string) => { const stamp = { ...version, asset: { ...version.asset, slug, identity: `gecko:${slug}` } }, wire = transport(stamp); await cache.load(request({ slug, identity: `gecko:${slug}` }), wire); return wire; };
    await load("one"); await load("two"); const reused = await load("one"); expect(reused.history).not.toHaveBeenCalled();
    await load("three"); const evicted = await load("two"); expect(evicted.history).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ entries: 2, points: 16 }); expect(cache.stats().bytes).toBeLessThanOrEqual(1_000_000);
    for (const limits of [{ entries: 8, bytes: 1, points: 64_000, ttl: 300_000 }, { entries: 8, bytes: 1_000_000, points: 1, ttl: 300_000 }]) {
      const bounded = new DetailHistoryCache(limits), wire = transport();
      const result = await bounded.load(request(), wire); await bounded.load(request(), wire);
      expect(result.points).toHaveLength(4); expect(bounded.stats()).toMatchObject({ entries: 0, bytes: 0, points: 0 }); expect(wire.history).toHaveBeenCalledTimes(2);
    }
  });

  it("never admits a cursor-truncated MAX or mismatched source metadata", async () => {
    const partial = bundle(); partial.mcap.nextCursor = "2026-10-19";
    const malformed = bundle(); malformed.fdv = { ...malformed.fdv, sources: [{ ...sources[0], observedAt: "invalid" }, ...sources.slice(1)] };
    for (const value of [partial, malformed]) {
      const cache = new DetailHistoryCache(), wire = { version: async () => version, history: async () => value };
      await expect(cache.load(request(), wire)).rejects.toThrow(); expect(cache.stats().entries).toBe(0);
    }
  });

  it("enforces the aggregate decoded-byte budget even before reaching the entry limit", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(bundle())).byteLength;
    const cache = new DetailHistoryCache({ entries: 8, bytes: bytes + 100, points: 64_000, ttl: 300_000 });
    for (const slug of ["one", "two"]) {
      const stamp = { ...version, asset: { ...version.asset, slug, identity: `gecko:${slug}` } };
      await cache.load(request({ slug, identity: `gecko:${slug}` }), transport(stamp));
    }
    expect(cache.stats()).toMatchObject({ entries: 1, points: 8 }); expect(cache.stats().bytes).toBeLessThanOrEqual(bytes + 100);
  });

  it("deduplicates simultaneous requests and aborts one subscriber without cancelling its peer", async () => {
    const cache = new DetailHistoryCache(), gate = deferred<unknown>(), first = new AbortController(); let sharedSignal: AbortSignal | undefined;
    const wire = { version: vi.fn((signal: AbortSignal) => { sharedSignal = signal; return gate.promise; }), history: vi.fn(async () => bundle()) };
    const a = cache.load(request({ signal: first.signal }), wire), b = cache.load(request({ range: "7D", capital: "fdv" }), wire);
    const aborted = expect(a).rejects.toMatchObject({ name: "AbortError" }); first.abort(); await aborted;
    expect(sharedSignal!.aborted).toBe(false); gate.resolve(version);
    expect((await b).points.at(-1)!.pr.value).toBe(20); expect(wire.version).toHaveBeenCalledTimes(1); expect(wire.history).toHaveBeenCalledTimes(1);
  });

  it("reuses an in-flight MAX when a range-effect cleanup is immediately followed by a new range", async () => {
    const cache = new DetailHistoryCache(), gate = deferred<unknown>(), first = new AbortController();
    const wire = { version: vi.fn(() => gate.promise), history: vi.fn(async () => bundle()) };
    const old = cache.load(request({ signal: first.signal }), wire), aborted = expect(old).rejects.toMatchObject({ name: "AbortError" });
    first.abort(); const next = cache.load(request({ range: "7D" }), wire); gate.resolve(version);
    await aborted; expect((await next).points).toHaveLength(2); expect(wire.version).toHaveBeenCalledTimes(1); expect(wire.history).toHaveBeenCalledTimes(1);
  });

  it("cancels the shared network after its final subscriber closes, then permits a new request", async () => {
    const cache = new DetailHistoryCache(), controller = new AbortController(); let sharedSignal: AbortSignal | undefined;
    const wire = { version: vi.fn((signal: AbortSignal) => { sharedSignal = signal; return new Promise<unknown>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); }), history: vi.fn(async () => bundle()) };
    const loading = cache.load(request({ signal: controller.signal }), wire), aborted = expect(loading).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await aborted; await new Promise(resolve => setTimeout(resolve, 5));
    expect(sharedSignal!.aborted).toBe(true); expect(cache.stats()).toMatchObject({ entries: 0, pending: 0 });
    await expect(cache.load(request(), transport())).resolves.toMatchObject({ nextCursor: null });
  });

  it("bounds a hanging network request and reports a retryable timeout", async () => {
    vi.useFakeTimers();
    const cache = new DetailHistoryCache(), wire = { version: (signal: AbortSignal) => new Promise<unknown>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })), history: vi.fn(async () => bundle()) };
    const loading = cache.load(request(), wire), rejected = expect(loading).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(DETAIL_HISTORY_TIMEOUT_MS); await rejected;
    expect(cache.stats()).toMatchObject({ entries: 0, pending: 0 }); expect(wire.history).not.toHaveBeenCalled();
  });
});
