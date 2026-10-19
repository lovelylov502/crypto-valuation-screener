import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { createClient } from "@libsql/client";
import { acquireDailyRawCsv, acquireDailyRawFeesSummary, archiveDailyRawOriginal, COINGECKO_CSV_CLOSE_SEMANTICS, combineDailyRawAssets, dailyRawAssetFingerprint, dailyRawFeeCandidates, DailyRawInputError, exactDailyRawFeeParentChart, extractDailyRawFundamentals, legacyDailyRawFdv, parseDailyRawCsv, snapshotDailyRaw, verifyDailyRawArchives, visitDailyRawAssets, type DailyRawCsvFile } from "./dailyRawCollection";
import { indexCapturedFdvQuotes } from "./dailyRawFdvValidation";
import type { PublishedSnapshot } from "./publicationTypes";
import { contentHash, type SourceBundle, type SourceReceipt } from "./sourceBundle";
import { getDailyRawCheckpoint, initializeDailyRaw, openDailyRawRun, readDailyRaw, type DailyRawSource } from "./dailyRawDatabase";
import { assertDailyRawSealed, stageDailyRawAsset } from "../scripts/sync-daily-raw";
import type { CoinRaw } from "./types";

let cache: string;
const archive = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/history-test/original.csv";
const asset = { slug: "parent#index", identity: "gecko:index-cooperative" };
const csv = "event_date,close_price_usd,market_cap_usd,volume_usd\r\n2026-10-17 00:00:00 UTC,0.4091250644662566,3000000,10\r\n2026-10-18 00:00:00 UTC,0.3310878894165453,2892878.89276286,11\r\n2026-10-19 00:00:00 UTC,,2341086.5041770716,12\r\n";
const file = (text = csv): DailyRawCsvFile => ({ geckoId: "index-cooperative", path: "original.csv", sha256: contentHash(text), observedAt: "2026-10-19T12:00:00.000Z", url: "https://www.coingecko.com/price_charts/export/index-cooperative/usd.csv", timestampSemantics: COINGECKO_CSV_CLOSE_SEMANTICS });
const receipt = (url: string, data: unknown): SourceReceipt => {
  const body = JSON.stringify(data);
  return { url, body, sha256: contentHash(body), status: 200, requestedAt: "2026-10-19T12:00:00Z", observedAt: "2026-10-19T12:00:01Z", headers: {} };
};
beforeEach(async () => { cache = await mkdtemp(join(tmpdir(), "daily-raw-collection-")); });
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (!resolve(cache).startsWith(resolve(tmpdir()) + "\\daily-raw-collection-") && !resolve(cache).startsWith(resolve(tmpdir()) + "/daily-raw-collection-")) throw Error("Unexpected test cache root");
  await rm(cache, { recursive: true, force: true });
});

it("aligns web CSV price and next label's market cap to the same actual UTC close", () => {
  const result = parseDailyRawCsv(csv, file(), asset), point = result.points.find(point => point.day === "2026-10-18")!;
  expect(point).toMatchObject({ price: { value: .3310878894165453, state: "complete", at: "2026-10-19T00:00:00.000Z" }, mcap: { value: 2341086.5041770716, state: "complete", at: "2026-10-19T00:00:00.000Z" } });
  expect(point.fdv).toBeUndefined(); expect(result.points.some(point => point.day === "2026-10-19")).toBe(false);
  expect(result.sources[0].archiveUrl).toBeUndefined();
});

it("retains unknown CSV time semantics, zero and missing distinctly without invented FDV", () => {
  const text = "event_date,close_price_usd,market_cap_usd\n2020-01-01 00:00:00 UTC,0,\n";
  const result = parseDailyRawCsv(text, { ...file(text), timestampSemantics: undefined }, asset);
  expect(result.points).toEqual([{ day: "2020-01-01", price: { value: 0, state: "complete", source: result.sources[0].key, at: null }, mcap: { value: null, state: "missing", source: result.sources[1].key, at: null } }]);
  expect(result.sources[0].basis).toContain("timestamp_semantics_unverified");
  expect(() => parseDailyRawCsv(text, file(text), { ...asset, identity: "gecko:other" })).toThrow("identity_mismatch");
});

it("extracts full pre-730-day Fees, Revenue and Holders histories with exact parent scopes", () => {
  const time = Date.parse("2018-04-01") / 1000;
  const members = [{ slug: "a", name: "A", defillamaId: "1", parentProtocol: "parent#p" }, { slug: "b", name: "B", defillamaId: "2", parentProtocol: "parent#p" }];
  const fees = receipt("https://api.llama.fi/overview/fees?excludeTotalDataChartBreakdown=false", { protocols: members, totalDataChartBreakdown: [[time, { A: 2 }], [time + 86400, { A: 0, B: 0 }], [time + 172800, { A: -2, B: -3 }]] });
  const parent = receipt("https://api.llama.fi/summary/fees/p?dataType=dailyFees", { defillamaId: "parent#p", childProtocols: members, totalDataChart: [[time, 7], [time + 86400, 0], [time + 172800, -5]] });
  const revenue = receipt("https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChartBreakdown=false", { protocols: members, totalDataChartBreakdown: [[time, { A: 1, B: 2 }]] });
  const holders = receipt("https://api.llama.fi/overview/fees?dataType=dailyHoldersRevenue&excludeTotalDataChartBreakdown=false", { protocols: members, totalDataChartBreakdown: [[time, { A: 0, B: 0 }]] });
  const result = extractDailyRawFundamentals({ asOf: "2026-10-19", receipts: [fees, parent, revenue, holders] } as SourceBundle, archive);
  const points = result.series.get("parent#p")!;
  expect(points[0]).toMatchObject({ day: "2018-04-01", fees: { value: 7, state: "complete" }, revenue: { value: 3, state: "complete" }, holders: { value: 0, state: "complete" } });
  expect(points[2].fees).toMatchObject({ value: -5, state: "complete" });
  expect(result.sources.get("parent#p")![0].definition).toContain("dailyFees");
  const badParent = receipt(parent.url, { defillamaId: "parent#p", childProtocols: [members[0]], totalDataChart: [[time, 100]] });
  expect(extractDailyRawFundamentals({ asOf: "2026-10-19", receipts: [fees, badParent] } as SourceBundle, archive).series.get("parent#p")![0].fees).toMatchObject({ value: 2, state: "partial" });
});

it("quarantines duplicate/conflicting values and rejects modified originals", () => {
  const text = "event_date,close_price_usd,market_cap_usd\n2020-01-01,1,2\n2020-01-01,3,2\n";
  expect(parseDailyRawCsv(text, { ...file(text), timestampSemantics: undefined }, asset).points[0]).toMatchObject({ price: { value: null, state: "conflict" }, mcap: { value: 2, state: "complete" } });
  expect(() => parseDailyRawCsv(text + "changed", file(text), asset)).toThrow("hash_mismatch");
  const input = receipt("https://api.llama.fi/overview/fees?excludeTotalDataChartBreakdown=false", { protocols: [], totalDataChartBreakdown: [] });
  input.body += "changed";
  expect(() => extractDailyRawFundamentals({ asOf: "2026-10-19", receipts: [input] } as SourceBundle, archive)).toThrow("receipt_hash_mismatch");
});

it("checkpoints immutable originals before reuse and never requests a cached identity again", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(csv, { headers: { "content-type": "text/csv" } }));
  const first = await acquireDailyRawCsv("index-cooperative", cache, { fetcher });
  const second = await acquireDailyRawCsv("index-cooperative", cache, { fetcher });
  expect(first.status).toBe("fetched"); expect(second.status).toBe("cached"); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(contentHash(await readFile(first.file!.path))).toBe(first.file!.sha256);
  expect((await archiveDailyRawOriginal(cache, Buffer.from(csv), "csv")).path).toBe(first.file!.path);
});

it("refreshes an explicitly requested later close and never treats malformed HTTP200 as a completed series", async () => {
  let instant = Date.parse("2026-10-19T12:00:00Z"); const now = () => instant, fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(csv)));
  const first = await acquireDailyRawCsv("index-cooperative", cache, { now, fetcher, targetDay: "2026-10-18" });
  expect(first.file).toMatchObject({ firstDay: "2026-10-16", availableThrough: "2026-10-18" });
  await acquireDailyRawCsv("index-cooperative", cache, { now, fetcher, targetDay: "2026-10-18" }); expect(fetcher).toHaveBeenCalledTimes(1);
  instant = Date.parse("2026-10-20T12:00:00Z");
  const refreshed = await acquireDailyRawCsv("index-cooperative", cache, { now, fetcher, targetDay: "2026-10-19" }); expect(refreshed.status).toBe("fetched"); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(contentHash(await readFile(first.file!.path))).toBe(first.file!.sha256);
  const invalid = vi.fn().mockImplementation(() => Promise.resolve(new Response("<html>unavailable</html>")));
  expect(await acquireDailyRawCsv("bad-csv", cache, { now, fetcher: invalid })).toMatchObject({ status: "unavailable", retryAt: "2026-10-20T13:00:00.000Z" });
  expect(await acquireDailyRawCsv("bad-csv", cache, { now, fetcher: invalid })).toMatchObject({ status: "unavailable" }); expect(invalid).toHaveBeenCalledTimes(1);
});

it("automatically withholds only a current FDV contradicted by its exact captured provider record", () => {
  const quoteAt = "2026-10-19T11:59:00Z", observedAt = "2026-10-19T12:00:01Z", fdv = 1e25;
  const source = receipt("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=index-cooperative", [{ id: "index-cooperative", current_price: 2, fully_diluted_valuation: fdv, max_supply: 100, last_updated: quoteAt }]);
  const coin = { slug: asset.slug, identityStatus: "verified", geckoId: "index-cooperative", marketDataUpdatedAt: quoteAt, price: 2, mcap: 100, fdv,
    marketSources: { price: "CoinGecko", mcap: "CoinGecko", fdv: "CoinGecko", gecko: { id: "index-cooperative", observedAt, status: "received" } } } as CoinRaw;
  const reference = { url: archive, sha256: "a".repeat(64), dataAt: "2026-10-19T12:00:00Z", validatedAt: observedAt } as PublishedSnapshot;
  expect(snapshotDailyRaw(coin, coin, reference, indexCapturedFdvQuotes([source])).points[0]).toMatchObject({ price: { value: 2 }, mcap: { value: 100 }, fdv: { value: null, state: "missing" } });
  expect(snapshotDailyRaw(coin, coin, reference, indexCapturedFdvQuotes([source])).issues?.[0].reason).toBe("fdv_exceeds_same_receipt_max_supply_upper_bound");
  const withoutMax = receipt(source.url, [{ id: "index-cooperative", current_price: 2, fully_diluted_valuation: fdv, max_supply: null, last_updated: quoteAt }]);
  expect(snapshotDailyRaw(coin, coin, reference, indexCapturedFdvQuotes([withoutMax])).points[0].fdv?.value).toBe(fdv);
  const absent = snapshotDailyRaw(coin, coin, reference, indexCapturedFdvQuotes([{ ...source, observedAt: "2026-10-19T12:00:02Z" }]));
  expect(absent.points[0].fdv).toMatchObject({ value: null, state: "missing", at: null }); expect(absent.issues?.[0].reason).toBe("fdv_bound_exact_provider_record_unavailable");
});

it("persists provider 403 and Retry-After holds across different assets", async () => {
  const now = () => Date.parse("2026-10-19T12:00:00Z"), fetcher = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403, headers: { "retry-after": "1" } }));
  expect(await acquireDailyRawCsv("one", cache, { now, fetcher })).toMatchObject({ status: "deferred", httpStatus: 403, retryAt: "2026-10-20T12:00:00.000Z" });
  expect(await acquireDailyRawCsv("two", cache, { now, fetcher })).toMatchObject({ status: "deferred", httpStatus: 403 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("requires archived raw bytes or an exact original receipt inside a verified bundle", async () => {
  const result = parseDailyRawCsv(csv, { ...file(), archiveUrl: archive }, asset);
  const fetcher = vi.fn().mockResolvedValue(new Response(csv));
  await expect(verifyDailyRawArchives(result.sources, fetcher)).resolves.toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(verifyDailyRawArchives([{ ...result.sources[0], archiveUrl: undefined }], fetcher)).rejects.toThrow("archive_pending");
  const original = receipt("https://api.llama.fi/summary/fees/p?dataType=dailyRevenue", {}), source: DailyRawSource = { ...result.sources[0], url: original.url, observedAt: original.observedAt, sha256: original.sha256 };
  fetcher.mockResolvedValue(new Response(gzipSync(JSON.stringify({ receipts: [original] }))));
  await expect(verifyDailyRawArchives([source], fetcher)).resolves.toBeUndefined();
});

it("skips unchanged receipt-only captures and continues after per-asset input failures", async () => {
  const result = parseDailyRawCsv(csv, file(), asset);
  expect(dailyRawAssetFingerprint(result)).toBe(dailyRawAssetFingerprint({ ...result, sources: result.sources.map(s => ({ ...s, observedAt: "2026-10-20" })) }));
  const visited: string[] = [], failures: string[] = [];
  const pending = await visitDailyRawAssets(["a", "bad", "c"], { hasTime: () => true, visit: async slug => { visited.push(slug); if (slug === "bad") throw new DailyRawInputError("bad"); }, failed: slug => { failures.push(slug); } });
  expect(visited).toEqual(["a", "bad", "c"]); expect(failures).toEqual(["bad"]); expect(pending).toBe(0);
});

it("selects a verified close before an intraday quote and preserves actual legacy FDV", () => {
  const close = parseDailyRawCsv(csv, file(), asset), source = { ...close.sources[0], key: "snapshot", basis: "captured_quote;actual_provider_timestamp" };
  const input = { asset, sources: [source], points: [{ day: "2026-10-18", price: { value: 123, state: "complete" as const, source: source.key, at: "2026-10-18T12:00:00Z" } }] };
  expect(combineDailyRawAssets(asset, [close, input]).points.find(p => p.day === "2026-10-18")?.price?.value).toBe(.3310878894165453);
  const legacy = legacyDailyRawFdv({ schema: 1, sources: [{ id: "s", url: archive, observedAt: "2026-10-18T00:00:00Z", archiveUrl: archive, sha256: "a".repeat(64) }], assets: [{ ...asset, points: [
    { day: "2026-10-18", fdv: 1e20, fdvAt: "2026-10-18T12:00:00Z", observedAt: "2026-10-18T12:01:00Z", sourceId: "s", verification: "verified" },
    { day: "2026-10-17", fdv: 1, fdvAt: "2026-10-17T12:00:00Z", sourceId: "s", verification: "unavailable" },
  ] }] }, [{ slug: asset.slug, identityStatus: "verified", geckoId: "index-cooperative" } as CoinRaw]);
  expect(legacy[0].points).toHaveLength(1); expect(legacy[0].points[0].fdv?.value).toBe(1e20);
  expect(legacy[0].sources[0].observedAt).toBe("2026-10-18T12:01:00Z");
});

it("resumes a partially staged asset from the committed date and skips its unchanged full history", async () => {
  const db = createClient({ url: ":memory:" });
  try {
    await initializeDailyRaw(db); await openDailyRawRun(db, { id: "stage", maxEstimatedWrites: 10000 });
    const parsed = parseDailyRawCsv(csv, file(), asset), source = parsed.sources[0];
    const input = { asset, sources: [source], points: Array.from({ length: 1100 }, (_, i) => ({ day: new Date(Date.parse("2020-01-01") + i * 86400_000).toISOString().slice(0, 10), price: { value: i + 1, state: "complete" as const, source: source.key, at: null } })) };
    let checks = 0;
    const partial = await stageDailyRawAsset(db, "stage", input, () => checks++ === 0);
    expect(partial).toMatchObject({ paused: true, daysWritten: 1000 });
    expect((await getDailyRawCheckpoint(db, "stage", `stage:${asset.slug}:${asset.identity}`))?.status).toBe("running");
    await expect(assertDailyRawSealed(db)).rejects.toThrow("daily_raw_staging_incomplete");
    expect(await stageDailyRawAsset(db, "stage", input, () => true)).toMatchObject({ paused: false, daysWritten: 100 });
    await expect(assertDailyRawSealed(db)).resolves.toBeUndefined();
    expect(await stageDailyRawAsset(db, "stage", input, () => true)).toMatchObject({ skipped: true, rowsWritten: 0, estimatedWrites: 0 });
    const page = await readDailyRaw(db, { asset, limit: 1000 }); expect(page?.points).toHaveLength(1000); expect(page?.nextCursor).toBeTruthy();
  } finally { db.close(); }
});

it("extends Fees from every exact source summary rather than imposing an overview or date cap", async () => {
  const members = [{ slug: "a", name: "A", defillamaId: "1", parentProtocol: "parent#p", linkedProtocols: ["Parent P"] }];
  const overview = receipt("https://api.llama.fi/overview/fees?excludeTotalDataChartBreakdown=false", { protocols: members, totalDataChartBreakdown: [] });
  const candidates = dailyRawFeeCandidates({ asOf: "2026-10-19", receipts: [overview] } as SourceBundle);
  expect(candidates).toHaveLength(1); expect(candidates[0].url).toContain("/summary/fees/parent-p?dataType=dailyFees");
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ defillamaId: "parent#p", childProtocols: members, totalDataChart: [[Date.parse("2015-01-01") / 1000, 7]] })));
  const first = await acquireDailyRawFeesSummary(candidates[0], cache, { fetcher }), second = await acquireDailyRawFeesSummary(candidates[0], cache, { fetcher });
  expect(first.status).toBe("fetched"); expect(second.status).toBe("cached"); expect(fetcher).toHaveBeenCalledTimes(1);
  const result = extractDailyRawFundamentals({ asOf: "2026-10-19", receipts: [overview, first.receipt!] } as SourceBundle, archive);
  expect(result.series.get("parent#p")?.[0]).toMatchObject({ day: "2015-01-01", fees: { value: 7, state: "complete" } });
});

it("stores both conflict witnesses and their immutable source references", async () => {
  const db = createClient({ url: ":memory:" });
  try {
    await initializeDailyRaw(db); await openDailyRawRun(db, { id: "conflict", maxEstimatedWrites: 1000 });
    const original = parseDailyRawCsv(csv, file(), asset), source = original.sources[0], nextSource = { ...source, key: "different-receipt", sha256: "b".repeat(64) };
    const first = { asset, sources: [source], points: [{ day: "2026-10-18", price: { value: 1, state: "complete" as const, source: source.key, at: "2026-10-19T00:00:00Z" } }] };
    const next = { asset, sources: [nextSource], points: [{ day: "2026-10-18", price: { value: 2, state: "complete" as const, source: nextSource.key, at: "2026-10-19T00:00:00Z" } }] };
    const combined = combineDailyRawAssets(asset, [first, next]);
    expect(combined.sources).toHaveLength(2); expect(combined.points[0].price?.witnesses).toHaveLength(2);
    await stageDailyRawAsset(db, "conflict", combined, () => true);
    const stored = await readDailyRaw(db, { asset }); expect(stored?.points[0].price.state).toBe("conflict");
    expect(Number((await db.execute("SELECT COUNT(*) AS n FROM daily_raw_revisions")).rows[0].n)).toBe(1);
  } finally { db.close(); }
});

it("keeps independent daily flows and valid market cells when a CSV market cell is negative", async () => {
  const db = createClient({ url: ":memory:" });
  try {
    await initializeDailyRaw(db); await openDailyRawRun(db, { id: "negative-cell", maxEstimatedWrites: 1000 });
    const text = "event_date,close_price_usd,market_cap_usd\n2026-10-17 00:00:00 UTC,2,10\n2026-10-18 00:00:00 UTC,-1,12\n2026-10-19 00:00:00 UTC,,15\n";
    const market = parseDailyRawCsv(text, file(text), asset), revenueSource = { ...market.sources[0], key: "negative-revenue", metric: "revenue" as const, definition: "provider_reported_dailyRevenue", basis: "completed_utc_day_flow" };
    const flow = { asset, sources: [revenueSource], points: [{ day: "2026-10-18", revenue: { value: -7, state: "complete" as const, source: revenueSource.key, at: null } }] };
    const combined = combineDailyRawAssets(asset, [flow, market]);
    expect(combined.points.find(point => point.day === "2026-10-17")?.price?.value).toBe(2);
    expect(combined.points.find(point => point.day === "2026-10-18")).toMatchObject({ price: { value: null, state: "missing" }, mcap: { value: 15, state: "complete" }, revenue: { value: -7, state: "complete" } });
    expect(combined.issues).toEqual([{ scope: asset.slug, metric: "price", day: "2026-10-18", reason: "daily_raw_csv_negative_market_cell_missing" }]);
    await stageDailyRawAsset(db, "negative-cell", combined, () => true);
    const stored = await readDailyRaw(db, { asset });
    expect(stored?.points.find(point => point.day === "2026-10-18")).toMatchObject({ price: { value: null, state: "missing" }, mcap: { value: 15, state: "positive" }, revenue: { value: -7, state: "negative" } });
  } finally { db.close(); }
});

it("prefers approved Coin Metrics closing FDV over an earlier captured quote in either input order", () => {
  const base = parseDailyRawCsv(csv, file(), asset).sources[0];
  const captured = { ...base, key: "captured-fdv", metric: "fdv" as const, provider: "CoinGecko", basis: "captured_quote;actual_provider_timestamp" };
  const close = { ...base, key: "closing-fdv", metric: "fdv" as const, provider: "CoinMetrics", basis: "utc_daily_close_verified_total_supply" };
  const old = { asset, sources: [captured], points: [{ day: "2026-10-18", fdv: { value: 100, state: "complete" as const, source: captured.key, at: "2026-10-18T12:00:00Z" } }] };
  const next = { asset, sources: [close], points: [{ day: "2026-10-18", fdv: { value: 200, state: "complete" as const, source: close.key, at: "2026-10-19T00:00:00Z" } }] };
  for (const input of [[old, next], [next, old]]) expect(combineDailyRawAssets(asset, input).points[0].fdv).toMatchObject({ value: 200, source: close.key });
  const unapproved = { ...next, sources: [{ ...close, basis: "utc_daily_close_total_issued_unverified" }] };
  expect(combineDailyRawAssets(asset, [old, unapproved]).points[0].fdv?.value).toBe(100);
  const earlier = { ...next, points: [{ ...next.points[0], fdv: { ...next.points[0].fdv, at: "2026-10-18T00:00:00Z" } }] };
  expect(combineDailyRawAssets(asset, [old, earlier]).points[0].fdv?.state).toBe("conflict");
});

it("recovers only source-proved parent totals after excluding explicitly double-counted children", () => {
  const time = Date.parse("2020-01-01") / 1000, member = { slug: "a", name: "A", defillamaId: "1", parentProtocol: "parent#p", methodology: { Fees: "trading fees" } };
  const duplicate = { slug: "duplicate", name: "Duplicate", defillamaId: "2", parentProtocol: "parent#p", doublecounted: true, methodology: { Fees: "subset of A" } };
  const summary = { defillamaId: "parent#p", childProtocols: [member, { name: duplicate.name, defillamaId: duplicate.defillamaId, methodology: duplicate.methodology }],
    totalDataChart: [[time, 10], [time + 86400, 12]], totalDataChartBreakdown: [[time, { Ethereum: { A: 10, Duplicate: 3 } }], [time + 86400, { Ethereum: { A: 11, Duplicate: 1 } }]] };
  expect(exactDailyRawFeeParentChart("parent#p", [member], summary, [duplicate])).toEqual([]);
  expect(exactDailyRawFeeParentChart("parent#p", [member], summary, [])).toBeNull();
  expect(exactDailyRawFeeParentChart("parent#p", [member], summary, [{ ...duplicate, doublecounted: false }])).toBeNull();
  expect(exactDailyRawFeeParentChart("parent#p", [member], { ...summary, totalDataChartBreakdown: [[time, { Ethereum: { Unknown: 10 } }]] }, [duplicate])).toEqual([]);
  const other = { ...member, slug: "b", name: "B", defillamaId: "3" };
  const partial = { ...summary, childProtocols: [...summary.childProtocols, other], totalDataChartBreakdown: [[time, { Ethereum: { A: 10, Duplicate: 3 } }]] };
  expect(exactDailyRawFeeParentChart("parent#p", [member, other], partial, [duplicate])).toEqual([]);
  const overview = receipt("https://api.llama.fi/overview/fees?excludeTotalDataChartBreakdown=false", { protocols: [member, other, duplicate], totalDataChartBreakdown: [] });
  const parent = receipt("https://api.llama.fi/summary/fees/p?dataType=dailyFees", { ...partial, totalDataChart: [[time, 13], [time + 86400, 15]], totalDataChartBreakdown: [[time, { Ethereum: { A: 10, Duplicate: 3 } }], [time + 86400, { Ethereum: { A: 10, B: 2, Duplicate: 3 } }]] });
  expect(extractDailyRawFundamentals({ asOf: "2026-10-19", receipts: [overview, parent] } as SourceBundle, archive).series.get("parent#p")).toMatchObject([
    { day: "2020-01-01", fees: { value: 10, state: "partial" } }, { day: "2020-01-02", fees: { value: 12, state: "complete" } },
  ]);
});

it("keeps exact-scope parent totals despite child rounding and withholds real duplicate totals", () => {
  const time = Date.parse("2026-10-16") / 1000, member = { slug: "aave-v3", name: "Aave V3", defillamaId: "aave-3", parentProtocol: "parent#aave", methodology: { Fees: "borrow interest" } };
  const overview = receipt("https://api.llama.fi/overview/fees?excludeTotalDataChartBreakdown=false", { protocols: [member], totalDataChartBreakdown: [[time, { "Aave V3": 1142559 }]] });
  const summary = receipt("https://api.llama.fi/summary/fees/aave?dataType=dailyFees", { defillamaId: "parent#aave", childProtocols: [member],
    totalDataChart: [[time, 1142559], [time + 86400, 10], [time + 86400, 11]],
    totalDataChartBreakdown: [[time, { Ethereum: { "Aave V3": 1142559.3599999999 } }], [time + 86400, { Ethereum: { "Aave V3": 10.5 } }], [time + 2 * 86400, { Ethereum: { "Aave V3": 12.25 } }]] });
  const result = extractDailyRawFundamentals({ asOf: "2026-10-19", receipts: [overview, summary] } as SourceBundle, archive).series.get("parent#aave")!;
  expect(result[0].fees).toMatchObject({ value: 1142559, state: "complete" });
  expect(result[1].fees).toMatchObject({ value: null, state: "conflict", witnesses: [{ value: 10 }, { value: 11 }] });
  expect(result[2].fees).toMatchObject({ value: 12.25, state: "complete" });
});

it("uses later exact-scope Fees receipts as restatements while retaining same-time and Revenue conflicts", () => {
  const time = Date.parse("2026-10-18") / 1000, member = { slug: "near", name: "Near", defillamaId: "near", methodology: { Fees: "network fees", Revenue: "network revenue" } };
  const overview = { ...receipt("https://api.llama.fi/overview/fees?excludeTotalDataChartBreakdown=false", { protocols: [member], totalDataChartBreakdown: [[time, { Near: 12315 }]] }), observedAt: "2026-10-19T13:17:00Z" };
  const summary = { ...receipt("https://api.llama.fi/summary/fees/near?dataType=dailyFees", { ...member, totalDataChart: [[time, 252093]] }), observedAt: "2026-10-19T13:54:00Z" };
  const older = { ...receipt(summary.url, { ...member, totalDataChart: [[time, 10000]] }), observedAt: "2026-10-19T13:00:00Z" };
  const extract = (receipts: SourceReceipt[]) => extractDailyRawFundamentals({ asOf: "2026-10-19", receipts } as SourceBundle, archive);
  expect(extract([overview, summary, older]).series.get("near")?.[0].fees).toMatchObject({ value: 252093, state: "complete" });
  expect(extract([overview, { ...summary, observedAt: overview.observedAt }]).series.get("near")?.[0].fees?.state).toBe("conflict");
  const unknownScope = { ...summary, body: JSON.stringify({ ...member, defillamaId: "other", totalDataChart: [[time, 252093]] }) }; unknownScope.sha256 = contentHash(unknownScope.body);
  expect(extract([overview, unknownScope]).series.get("near")?.[0].fees).toMatchObject({ value: 12315, state: "complete" });
  const revenueOverview = { ...overview, url: "https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChartBreakdown=false" }, revenueSummary = { ...summary, url: "https://api.llama.fi/summary/fees/near?dataType=dailyRevenue" };
  expect(extract([revenueOverview, revenueSummary]).series.get("near")?.[0].revenue?.state).toBe("conflict");
});
