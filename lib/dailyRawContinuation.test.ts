import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { createClient } from "@libsql/client";
import { acknowledgeDailyRawQueue, certifyDailyRawFinancialMax, continueDailyRaw, DAILY_RAW_FINANCIAL_MAX_PROOF, establishedDailyRawFinancialAssets, markDailyRawQueueArchives, prepareDailyRawFeesOverview, restoreDailyRawPending, type DailyRawSelection } from "../scripts/continue-daily-raw";
import { stageDailyRawAsset } from "../scripts/sync-daily-raw";
import { planDailyRawQueue, reconcileDailyRawQueue, recordDailyRawAcquired, type DailyRawQueueReceipt, type DailyRawQueueState } from "./dailyRawQueue";
import { COINGECKO_CSV_CLOSE_SEMANTICS, combineDailyRawAssets, extractDailyRawFundamentals, parseDailyRawCsv } from "./dailyRawCollection";
import { copyDailyRaw, getDailyRawCheckpoint, initializeDailyRaw, openDailyRawRun, readDailyRaw, upsertDailyRaw, type DailyRawPoint, type DailyRawSource } from "./dailyRawDatabase";
import { contentHash, type SourceBundle, type SourceReceipt } from "./sourceBundle";
import { gatherDailyRawArchiveReceipts } from "./dailyRawArchive";
import { portableDailyRawQueue } from "./dailyRawQueueArchive";

let cache: string;
const clock = Date.parse("2026-10-19T12:00:00Z"), archive = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/raw-test/receipts.json.gz";
const csv = "event_date,close_price_usd,market_cap_usd\n2026-10-17 00:00:00 UTC,2,10\n2026-10-18 00:00:00 UTC,3,12\n2026-10-19 00:00:00 UTC,,15\n";
const coins = ["a", "b", "c"].map(id => ({ slug: id, geckoId: id, identityStatus: "verified" }));
const pending = (id = "a"): DailyRawQueueReceipt => ({ url: `https://www.coingecko.com/price_charts/export/${id}/usd.csv`, sha256: contentHash(csv), observedAt: new Date(clock).toISOString(), firstDay: "2026-10-16", availableThrough: "2026-10-18" });
const original = (receipt = pending()): SourceReceipt => ({ ...receipt, body: csv, status: 200, headers: {}, requestedAt: receipt.observedAt });
beforeEach(async () => { cache = await mkdtemp(join(tmpdir(), "raw-continuation-")); });
afterEach(async () => { vi.restoreAllMocks(); if (!cache.startsWith(join(tmpdir(), "raw-continuation-"))) throw Error("Unexpected cleanup root"); await rm(cache, { recursive: true, force: true }); });

it("restores an evicted pending CSV only from exact archived receipt membership", async () => {
  const receipt = { ...pending(), archiveUrl: archive, archiveVerified: true };
  const fetcher = vi.fn().mockResolvedValue(new Response(gzipSync(JSON.stringify({ receipts: [original()] }))));
  const file = await restoreDailyRawPending(cache, "a", receipt, fetcher);
  expect(file.path).toMatch(/^originals\/[a-f0-9]{64}\.csv$/); expect(contentHash(await readFile(join(cache, file.path)))).toBe(receipt.sha256);
  await writeFile(join(cache, "csv-manifest.json"), JSON.stringify({ schema: 1, files: [file] }));
  expect(await gatherDailyRawArchiveReceipts(cache)).toMatchObject([{ url: receipt.url, observedAt: receipt.observedAt, requestedAt: original().requestedAt, sha256: receipt.sha256, body: csv }]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(restoreDailyRawPending(cache, "a", { ...receipt, file: undefined, observedAt: "2026-10-19T12:01:00Z" }, vi.fn().mockResolvedValue(new Response(gzipSync(JSON.stringify({ receipts: [original()] })))))).rejects.toThrow("archived_receipt_missing");
  await expect(restoreDailyRawPending(cache, "a", { ...pending(), file: undefined }, fetcher)).rejects.toThrow("original_unarchived");
});

it("marks public archives without falsely advancing the database import checkpoint", async () => {
  const state = reconcileDailyRawQueue(null, coins, "2026-10-18", new Date(clock)); recordDailyRawAcquired(state, "a", pending(), new Date(clock));
  const manifest = join(cache, "archives.json"); await writeFile(manifest, JSON.stringify({ schema: 1, receipts: [{ ...pending(), archiveUrl: archive }] }));
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(gzipSync(JSON.stringify({ receipts: [original()] })))));
  expect(await markDailyRawQueueArchives(state, cache, manifest, fetcher)).toBe(1);
  expect(state.entries.a.pending).toMatchObject({ archiveUrl: archive, archiveVerified: true }); expect(state.entries.a.bindings[0].fullImported).toBe(false);
});

it("acquires a bounded batch and selects MAX only for new CSV bindings while existing financial rows use 14 days", async () => {
  const universe = join(cache, "universe.json"), knownAssets = join(cache, "known.json");
  await writeFile(universe, JSON.stringify({ coins })); await writeFile(knownAssets, JSON.stringify({ schema: 1, proofVersion: DAILY_RAW_FINANCIAL_MAX_PROOF, remainingEstimatedWrites: 1000000, assets: coins.map(coin => ({ slug: coin.slug, identity: `gecko:${coin.geckoId}` })) }));
  let ticks = 0; const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(csv)));
  const report = await continueDailyRaw({ cache, universe, knownAssets, maxRequests: 2, fetcher, now: () => clock + ticks++ * 2000 });
  expect(report).toMatchObject({ requests: 2, acquired: 2, pending: 2, recommendedMaxEstimatedWrites: 500000 });
  const state = JSON.parse(await readFile(join(cache, "daily-raw-queue.json"), "utf8")) as DailyRawQueueState;
  expect(state.entries.a.bindings[0].fullImported).toBe(false); expect(state.entries.c.pending).toBeNull();
  const selection = JSON.parse(await readFile(join(cache, "queue-selection.json"), "utf8")) as DailyRawSelection;
  expect(selection.assets.find(asset => asset.slug === "a")).toMatchObject({ from: "2026-10-05", csv: { to: "2026-10-18" } });
  expect(selection.assets.find(asset => asset.slug === "a")?.csv?.from).toBeUndefined(); expect(selection.assets.find(asset => asset.slug === "c")?.from).toBe("2026-10-05");
  const held = await continueDailyRaw({ cache, universe, knownAssets, maxRequests: 2, remainingEstimatedWrites: 500000, fetcher, now: () => clock + ticks++ * 2000 });
  expect(held.status).toBe("budget-reserve-paused"); expect(held.requests).toBe(0); expect(fetcher).toHaveBeenCalledTimes(2);
});

it("keeps legacy registry-only knowledge at MAX without requesting a provider", async () => {
  const universe = join(cache, "universe.json"), knownAssets = join(cache, "known.json"), fetcher = vi.fn();
  await writeFile(universe, JSON.stringify({ coins: [coins[0]] }));
  await writeFile(knownAssets, JSON.stringify({ schema: 1, remainingEstimatedWrites: 1000000, assets: [{ slug: "a", identity: "gecko:a" }] }));
  expect(await continueDailyRaw({ cache, universe, knownAssets, maxRequests: 0, fetcher, now: () => clock })).toMatchObject({ requests: 0, selectedAssets: 1, fullAssets: 1 });
  const selection = JSON.parse(await readFile(join(cache, "queue-selection.json"), "utf8")) as DailyRawSelection;
  expect(selection.assets[0].from).toBeUndefined(); expect(fetcher).not.toHaveBeenCalled();
});

it("does not let a completed 14-day patch certify an interrupted financial MAX import", async () => {
  const initial = createClient({ url: ":memory:" }), patch = createClient({ url: ":memory:" }), recovered = createClient({ url: ":memory:" }), committed = createClient({ url: ":memory:" });
  const asset = { slug: "a", identity: "gecko:a" }, stageId = "a".repeat(64), patchId = "b".repeat(64), recoveredId = "c".repeat(64);
  try {
    for (const db of [initial, patch, recovered, committed]) await initializeDailyRaw(db);
    const source: DailyRawSource = { key: "full-revenue", metric: "revenue", provider: "DefiLlama", url: "https://api.llama.fi/summary/fees/a?dataType=dailyRevenue", sha256: "d".repeat(64), observedAt: new Date(clock).toISOString(), archiveUrl: archive, scope: "exact-parent-a", definition: "dailyRevenue", basis: "utc_day_flow" };
    const points: DailyRawPoint[] = ["2020-01-01", "2020-01-02", "2020-01-03", "2026-10-18"].map((day, index) => ({ day, revenue: { value: index + 1, state: "complete", source: source.key } }));
    const input = { asset, sources: [source], points };
    await openDailyRawRun(initial, { id: "stage", maxEstimatedWrites: 10000 });
    await stageDailyRawAsset(initial, "stage", input, () => true, true);
    let batches = 0;
    expect(await copyDailyRaw(initial, committed, { runId: "initial", stagingId: stageId, maxEstimatedWrites: 10000, batchSize: 1, hasTime: () => batches === 0, onBatch: () => { batches++; } })).toMatchObject({ assetsCompleted: 0, daysWritten: 1, stopped: true });
    expect(await getDailyRawCheckpoint(committed, "initial", "copy:a:gecko:a")).toMatchObject({ status: "running", cursor: "2020-01-01" });
    expect(await certifyDailyRawFinancialMax(initial, committed, { asset, runId: "initial", stagingId: stageId })).toBeNull();
    expect(await establishedDailyRawFinancialAssets(committed)).toEqual([]);

    const file = { ...pending(), geckoId: "a", path: "a.csv", archiveUrl: archive, timestampSemantics: COINGECKO_CSV_CLOSE_SEMANTICS };
    const bounded = combineDailyRawAssets(asset, [{ ...input, points: points.filter(point => point.day >= "2026-10-05") }, parseDailyRawCsv(csv, file, asset)]);
    await openDailyRawRun(patch, { id: "stage-patch", maxEstimatedWrites: 10000 });
    await stageDailyRawAsset(patch, "stage-patch", bounded, () => true);
    await copyDailyRaw(patch, committed, { runId: "patch", stagingId: patchId, maxEstimatedWrites: 10000, onBatch: async progress => {
      if (progress.complete) expect(await certifyDailyRawFinancialMax(patch, committed, { asset, runId: "patch", stagingId: patchId })).toBeNull();
    } });
    expect(await getDailyRawCheckpoint(committed, "patch", "copy:a:gecko:a")).toMatchObject({ status: "complete" });
    const state = reconcileDailyRawQueue(null, [coins[0]], "2026-10-18", new Date(clock)); recordDailyRawAcquired(state, "a", pending(), new Date(clock));
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(gzipSync(JSON.stringify({ receipts: [original()] })))));
    expect(await acknowledgeDailyRawQueue(state, patch, committed, { runId: "patch", stagingId: patchId, cache, fetcher })).toBe(1);
    expect(state.entries.a.bindings[0].fullImported).toBe(true);
    expect((await readDailyRaw(committed, { asset, from: "2020-01-01", to: "2020-01-03" }))?.points.map(point => point.revenue.value)).toEqual([1]);
    expect(await establishedDailyRawFinancialAssets(committed)).toEqual([]);

    const universe = join(cache, "universe.json"), knownAssets = join(cache, "known.json");
    await writeFile(universe, JSON.stringify({ coins: [coins[0]] })); await writeFile(join(cache, "daily-raw-queue.json"), JSON.stringify(state));
    const prepareKnown = async () => writeFile(knownAssets, JSON.stringify({ schema: 1, proofVersion: DAILY_RAW_FINANCIAL_MAX_PROOF, remainingEstimatedWrites: 1000000, assets: await establishedDailyRawFinancialAssets(committed) }));
    await prepareKnown(); await continueDailyRaw({ cache, universe, knownAssets, maxRequests: 0, fetcher, now: () => clock });
    let selection = JSON.parse(await readFile(join(cache, "queue-selection.json"), "utf8")) as DailyRawSelection;
    expect(selection.assets[0].from).toBeUndefined();
    const selected = { ...input, points: input.points.filter(point => !selection.assets[0].from || point.day >= selection.assets[0].from) };
    await openDailyRawRun(recovered, { id: "stage-full", maxEstimatedWrites: 10000 });
    await stageDailyRawAsset(recovered, "stage-full", selected, () => true, true);
    await copyDailyRaw(recovered, committed, { runId: "recovered", stagingId: recoveredId, maxEstimatedWrites: 10000, onBatch: async progress => {
      if (!progress.complete) return;
      await expect(certifyDailyRawFinancialMax(recovered, committed, { asset, runId: "recovered", stagingId: "e".repeat(64) })).rejects.toThrow("financial_max_staging_not_committed");
      expect(await certifyDailyRawFinancialMax(recovered, committed, { asset, runId: "recovered", stagingId: recoveredId })).not.toBeNull();
    } });
    expect((await readDailyRaw(committed, { asset, from: "2020-01-01", to: "2020-01-03" }))?.points.map(point => point.revenue.value)).toEqual([1, 2, 3]);
    expect(await getDailyRawCheckpoint(committed, "initial", "copy:a:gecko:a")).toMatchObject({ status: "running" });
    expect(await establishedDailyRawFinancialAssets(committed)).toEqual([asset]);
    await prepareKnown(); await continueDailyRaw({ cache, universe, knownAssets, maxRequests: 0, fetcher, now: () => clock });
    selection = JSON.parse(await readFile(join(cache, "queue-selection.json"), "utf8")) as DailyRawSelection;
    expect(selection.assets[0].from).toBe("2026-10-05");
    await upsertDailyRaw(committed, { runId: "recovered", asset: { slug: "a", identity: "gecko:other" }, sources: [], points: [] });
    expect(await establishedDailyRawFinancialAssets(committed)).toEqual([asset]);
    await committed.execute({ sql: "UPDATE daily_raw_checkpoints SET cursor=? WHERE run_id='recovered' AND checkpoint_key='copy:staging'", args: ["f".repeat(64)] });
    expect(await establishedDailyRawFinancialAssets(committed)).toEqual([]);
  } finally { initial.close(); patch.close(); recovered.close(); committed.close(); }
});

it("advances imported bindings only after the exact sealed copy and complete asset checkpoint exist", async () => {
  const staged = createClient({ url: ":memory:" }), committed = createClient({ url: ":memory:" }), asset = { slug: "a", identity: "gecko:a" };
  try {
    await initializeDailyRaw(staged); await initializeDailyRaw(committed); await openDailyRawRun(staged, { id: "stage", maxEstimatedWrites: 1000 });
    const file = { ...pending(), geckoId: "a", path: "a.csv", archiveUrl: archive, timestampSemantics: COINGECKO_CSV_CLOSE_SEMANTICS };
    const input = parseDailyRawCsv(csv, file, asset); await upsertDailyRaw(staged, { runId: "stage", ...input });
    const state = reconcileDailyRawQueue(null, coins, "2026-10-18", new Date(clock)); recordDailyRawAcquired(state, "a", pending(), new Date(clock));
    const stagingId = "c".repeat(64), fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(gzipSync(JSON.stringify({ receipts: [original()] })))));
    await expect(acknowledgeDailyRawQueue(state, staged, committed, { runId: "import", stagingId, cache, fetcher })).rejects.toThrow("staging_not_committed");
    expect(state.entries.a.bindings[0].fullImported).toBe(false);
    await copyDailyRaw(staged, committed, { runId: "import", stagingId, maxEstimatedWrites: 1000 });
    expect(await acknowledgeDailyRawQueue(state, staged, committed, { runId: "import", stagingId, cache, fetcher })).toBe(1);
    expect(state.entries.a.pending).toBeNull(); expect(state.entries.a.bindings[0]).toMatchObject({ fullImported: true, closedThrough: "2026-10-18" });
    await expect(acknowledgeDailyRawQueue(state, staged, committed, { runId: "import", stagingId: "d".repeat(64), cache, fetcher })).rejects.toThrow("staging_not_committed");
  } finally { staged.close(); committed.close(); }
});

it.each([
  { name: "blank CSV mcap", tail: "", price: 3, acknowledge: true },
  { name: "negative CSV mcap sentinel", tail: "-1", price: 3, acknowledge: true },
  { name: "different numeric price", tail: "-1", price: 3, storedPrice: 4, acknowledge: false },
  { name: "different reported zero price", tail: "", price: 0, storedPrice: 1, acknowledge: false },
  { name: "different actual observation time", tail: "-1", price: 3, storedAt: "2026-10-18T23:59:00Z", acknowledge: false },
  { name: "CSV conflict replaced by an amount", tail: "15", price: 3, duplicate: true, storedPrice: 100, acknowledge: false },
  { name: "invalid declared coverage", tail: "", price: 3, invalidCoverage: true, acknowledge: false },
])("acknowledges actual CSV claims without requiring missing cells to clear independent quotes: $name", async test => {
  const staged = createClient({ url: ":memory:" }), committed = createClient({ url: ":memory:" }), asset = { slug: "a", identity: "gecko:a" };
  try {
    await initializeDailyRaw(staged); await initializeDailyRaw(committed); await openDailyRawRun(staged, { id: "stage", maxEstimatedWrites: 1000 });
    const text = `event_date,close_price_usd,market_cap_usd\n2026-10-17 00:00:00 UTC,2,10\n2026-10-18 00:00:00 UTC,${test.price},12\n${test.duplicate ? "2026-10-18 00:00:00 UTC,4,12\n" : ""}2026-10-19 00:00:00 UTC,,${test.tail}\n`;
    const receipt = { ...pending(), ...(test.invalidCoverage ? { firstDay: "2010-01-01" } : {}), sha256: contentHash(text) }, file = { ...receipt, geckoId: "a", path: "a.csv", archiveUrl: archive, timestampSemantics: COINGECKO_CSV_CLOSE_SEMANTICS };
    const parsed = parseDailyRawCsv(text, file, asset), csvMcap = parsed.sources.find(source => source.metric === "mcap")!;
    const captured = { ...csvMcap, key: "independent-captured-mcap", url: archive.replace("receipts.json.gz", "snapshot.json.gz"), observedAt: "2026-10-18T12:01:00Z", sha256: "b".repeat(64), basis: "captured_quote;actual_provider_timestamp" };
    const input = combineDailyRawAssets(asset, [parsed, { asset, sources: [captured], points: [{ day: "2026-10-18", mcap: { value: 100, state: "complete", source: captured.key, at: "2026-10-18T12:00:00Z" } }] }]);
    const point = input.points.find(point => point.day === "2026-10-18")!;
    expect(point.mcap).toMatchObject(test.tail === "15" ? { value: 15, state: "complete", at: "2026-10-19T00:00:00.000Z" } : { value: 100, state: "complete", at: "2026-10-18T12:00:00Z" });
    if (test.storedPrice !== undefined || test.storedAt) point.price = { value: test.storedPrice ?? point.price!.value, state: "complete", source: point.price!.source, at: test.storedAt ?? point.price!.at };
    await upsertDailyRaw(staged, { runId: "stage", ...input });
    const stagingId = "c".repeat(64); await copyDailyRaw(staged, committed, { runId: "import", stagingId, maxEstimatedWrites: 1000 });
    const state = reconcileDailyRawQueue(null, [coins[0]], "2026-10-18", new Date(clock)); recordDailyRawAcquired(state, "a", receipt, new Date(clock));
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(gzipSync(JSON.stringify({ receipts: [{ ...original(receipt), body: text }] })))));
    const result = acknowledgeDailyRawQueue(state, staged, committed, { runId: "import", stagingId, cache, fetcher });
    if (test.invalidCoverage) await expect(result).rejects.toThrow("daily_raw_queue_coverage_mismatch");
    else expect(await result).toBe(test.acknowledge ? 1 : 0);
    expect(state.entries.a.bindings[0].fullImported).toBe(test.acknowledge); expect(state.entries.a.pending === null).toBe(test.acknowledge);
    if (test.acknowledge) {
      const next = new Date("2026-10-20T12:00:00Z"), refreshed = reconcileDailyRawQueue(state, [coins[0]], "2026-10-19", next);
      expect(planDailyRawQueue(refreshed, { now: next, maxRequests: 1 })[0]).toMatchObject({ action: "acquire", mode: "patch", geckoId: "a" });
    }
  } finally { staged.close(); committed.close(); }
});

it("prepares one fresh full Fees original and exposes its latest completed date independently of an older bundle", async () => {
  const member = { slug: "one", name: "One", defillamaId: "one" }, day = Date.parse("2026-10-19") / 1000;
  const body = JSON.stringify({ protocols: [member], totalDataChartBreakdown: [[day - 86400, { One: 2 }], [day, { One: 9 }]] }), now = () => Date.parse("2026-10-20T12:00:00Z"), fetcher = vi.fn().mockResolvedValue(new Response(body));
  const report = await prepareDailyRawFeesOverview(cache, { now, fetcher }); expect(report).toMatchObject({ status: "ready", sha256: contentHash(body) }); expect(fetcher).toHaveBeenCalledTimes(1);
  const bytes = await readFile(join(cache, report.receiptPath!)), fresh = JSON.parse(gunzipSync(bytes).toString()) as SourceReceipt;
  expect(fresh).toMatchObject({ body, sha256: contentHash(body), status: 200, requestedAt: "2026-10-20T12:00:00.000Z", observedAt: "2026-10-20T12:00:00.000Z" });
  const oldBody = JSON.stringify({ protocols: [member], totalDataChartBreakdown: [[day - 86400, { One: 1 }]] }), old: SourceReceipt = { ...fresh, body: oldBody, sha256: contentHash(oldBody), requestedAt: "2026-10-19T12:00:00Z", observedAt: "2026-10-19T12:00:00Z" };
  const revenue = { ...old, url: "https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChartBreakdown=false" };
  const extracted = extractDailyRawFundamentals({ asOf: "2026-10-19", receipts: [old, fresh, revenue] } as SourceBundle, archive).series.get("one")!;
  expect(extracted.find(point => point.day === "2026-10-19")?.fees).toMatchObject({ value: 9, state: "complete" });
  expect(extracted.find(point => point.day === "2026-10-18")?.revenue).toMatchObject({ value: 1, state: "complete" });
  expect(extracted.find(point => point.day === "2026-10-19")?.revenue).toBeUndefined();
  const failed = await prepareDailyRawFeesOverview(cache, { now, fetcher: vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })) });
  expect(failed).toMatchObject({ status: "unavailable", reason: "daily_raw_fees_overview_http_503" }); expect(failed.originalPath).toMatch(/^originals\/.+\.receipt\.json\.gz$/);
  const malformed = await prepareDailyRawFeesOverview(cache, { now, fetcher: vi.fn().mockResolvedValue(new Response("{}")) });
  expect(malformed).toMatchObject({ status: "unavailable", reason: "daily_raw_fees_overview_schema_unavailable", receiptPath: null });
  expect(contentHash(await readFile(join(cache, report.receiptPath!)))).toBe(contentHash(bytes));
});

it("persists a Fees authentication cooldown separately from the CoinGecko queue", async () => {
  const state = reconcileDailyRawQueue(null, coins, "2026-10-18", new Date(clock)), now = () => clock, fetcher = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403, headers: { "retry-after": "1" } }));
  expect(await prepareDailyRawFeesOverview(cache, { now, fetcher, state })).toMatchObject({ status: "unavailable", retryAt: "2026-10-20T12:00:00.000Z" });
  expect(await prepareDailyRawFeesOverview(cache, { now, fetcher, state })).toMatchObject({ status: "provider-paused" }); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(state.providerRetryAt).toBeNull(); expect(portableDailyRawQueue(state).feesProviderRetryAt).toBe("2026-10-20T12:00:00.000Z");
});
