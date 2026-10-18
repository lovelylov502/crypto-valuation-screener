import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { cachedArchive, fetchHistoricalMarket, historyMarketRetryDue, historyRetrySeconds, historyWorkPlan, HistoryAssetDeferred, HistoryProviderDeferred, HistorySourceIntegrityError, loadArchivedSnapshot, reconcileLatestBeforeBackfill } from "./historyCollection";
import { HISTORY_VERSION, parseMarketChart } from "./dailyHistory";
import { sha256 } from "./snapshotArchive";
import type { PublishedSnapshot } from "./publicationTypes";
import type { SourceReceipt } from "./sourceBundle";

let cache:string;
const archive="https://github.com/lovelylov502/crypto-valuation-screener/releases/download/history-test/market-sources.json.gz";
const point=Date.parse("2026-10-17");
const body={prices:[[point,1]],market_caps:[[point,100]]};
beforeEach(async()=>{cache=await mkdtemp(join(tmpdir(),"history-test-"));});
afterEach(async()=>{
  vi.restoreAllMocks();vi.unstubAllGlobals();
  if(!resolve(cache).startsWith(resolve(tmpdir())+"\\history-test-")&&!resolve(cache).startsWith(resolve(tmpdir())+"/history-test-"))throw Error("Unexpected test cache root");
  await rm(cache,{recursive:true,force:true});
});

it("counts actual network downloads separately from reused cache receipts",async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));vi.stubGlobal("fetch",fetch);
  const onRequest=vi.fn();
  const first=await fetchHistoricalMarket("token",cache,archive,onRequest);
  const resumed=await fetchHistoricalMarket("token",cache,archive,onRequest);
  const afterCheckpointFailure=await fetchHistoricalMarket("token",cache,archive,onRequest,true);
  expect(first.cached).toBe(false);expect(resumed.cached).toBe(true);
  expect(afterCheckpointFailure.cached).toBe(true);
  expect(first.source).toEqual(resumed.source);expect(onRequest).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
});

it("treats forbidden responses as a day-long provider hold and never immediately retries",async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response("forbidden",{status:403,headers:{"retry-after":"1"}}));vi.stubGlobal("fetch",fetch);
  await expect(fetchHistoricalMarket("token",cache,archive)).rejects.toMatchObject({status:403,retryAfter:86400});
  expect(fetch).toHaveBeenCalledTimes(1);
  const now=Date.parse("2026-10-18T00:00:00Z"),retryAt=new Date(now+86400_000).toISOString();
  expect(historyMarketRetryDue(retryAt,now+900_000)).toBe(false);expect(historyMarketRetryDue(retryAt,now+86400_000)).toBe(true);
});

it("honors both Retry-After formats for 429 and distinguishes recoverable asset failures",async()=>{
  const now=Date.parse("2026-10-18T00:00:00Z");
  expect(historyRetrySeconds(429,"120",now)).toBe(120);
  expect(historyRetrySeconds(429,"Sun, 18 Oct 2026 00:05:00 GMT",now)).toBe(300);
  expect(historyRetrySeconds(429,"invalid",now)).toBe(900);
  const fetch=vi.fn().mockResolvedValueOnce(new Response("",{status:429,headers:{"retry-after":"120"}}))
    .mockResolvedValueOnce(new Response("missing",{status:404})).mockRejectedValueOnce(new TypeError("socket closed"));
  vi.stubGlobal("fetch",fetch);
  await expect(fetchHistoricalMarket("rate",cache,archive)).rejects.toBeInstanceOf(HistoryProviderDeferred);
  await expect(fetchHistoricalMarket("missing",cache,archive)).rejects.toMatchObject({retryAfter:86400});
  await expect(fetchHistoricalMarket("network",cache,archive)).rejects.toBeInstanceOf(HistoryAssetDeferred);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("fails closed on malformed or hash-invalid originals without redownloading them",async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response("not JSON"));vi.stubGlobal("fetch",fetch);
  await expect(fetchHistoricalMarket("malformed",cache,archive)).rejects.toBeInstanceOf(HistorySourceIntegrityError);
  fetch.mockResolvedValue(new Response(JSON.stringify(body)));
  const valid=await fetchHistoricalMarket("token",cache,archive);
  const receipt=JSON.parse(gunzipSync(await readFile(valid.file)).toString()) as SourceReceipt;
  await writeFile(valid.file,gzipSync(JSON.stringify({...receipt,body:"changed"})));
  await expect(fetchHistoricalMarket("token",cache,archive,undefined,true)).rejects.toBeInstanceOf(HistorySourceIntegrityError);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps historical archive hash and decoded-snapshot failures fatal",async()=>{
  const url="https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-test/snapshot.json.gz";
  const bytes=Buffer.from("not a verified compressed snapshot");
  const fetch=vi.fn().mockImplementation(async()=>new Response(bytes));vi.stubGlobal("fetch",fetch);
  await expect(cachedArchive(url,"0".repeat(64),cache)).rejects.toBeInstanceOf(HistorySourceIntegrityError);
  await expect(loadArchivedSnapshot({url,sha256:sha256(bytes)} as PublishedSnapshot,cache)).rejects.toBeInstanceOf(HistorySourceIntegrityError);
});

it("retains a valid empty receipt and permits a later fresh retry without losing the original",async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({prices:[],market_caps:[]}))).mockResolvedValueOnce(new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch",fetch);
  const empty=await fetchHistoricalMarket("new-token",cache,archive);
  expect(parseMarketChart(empty.data,empty.source.id,Date.now())).toEqual([]);
  const refreshed=await fetchHistoricalMarket("new-token",cache,archive,undefined,true);
  expect(parseMarketChart(refreshed.data,refreshed.source.id,Date.now())).toHaveLength(1);
  const files=(await readdir(cache)).filter(f=>/^market-[a-f0-9]{64}\.json\.gz$/.test(f));
  expect(files).toHaveLength(2);expect(fetch).toHaveBeenCalledTimes(2);
  const receipts=await Promise.all(files.map(async f=>JSON.parse(gunzipSync(await readFile(join(cache,f))).toString()) as SourceReceipt));
  expect(receipts.some(r=>r.sha256===empty.receipt.sha256)).toBe(true);
});

it("finishes latest reconciliation before historical downloads, and resumes only unfinished assets",async()=>{
  const coins=[{slug:"a",geckoId:"same"},{slug:"b",geckoId:"same"},{slug:"c",geckoId:"c"}];
  const assets=new Map<string,{payload:Record<string,unknown>}>(),events:string[]=[];
  const reconcile=async(coin:typeof coins[number])=>{events.push(`latest:${coin.slug}`);assets.set(coin.slug,{payload:{snapshotId:"new",calculationVersion:HISTORY_VERSION,reconciliationState:"ready"}});};
  const backfill=vi.fn(async()=>{events.push("backfill");});
  expect(await reconcileLatestBeforeBackfill(historyWorkPlan(coins,assets,"new").latest,()=>events.length<2,reconcile,backfill)).toBe(1);
  expect(events).toEqual(["latest:a","latest:b"]);expect(backfill).not.toHaveBeenCalled();
  expect(await reconcileLatestBeforeBackfill(historyWorkPlan(coins,assets,"new").latest,()=>true,reconcile,backfill)).toBe(0);
  expect(events).toEqual(["latest:a","latest:b","latest:c","backfill"]);
  expect(historyWorkPlan(coins,assets,"newer").latest).toHaveLength(3);
  assets.get("a")!.payload.marketHistoryId="gecko:same";
  expect(historyWorkPlan(coins,assets,"new").backfill.map(c=>c.slug)).toEqual(["b","c"]);
  expect(historyWorkPlan(coins,assets,"new",true).latest).toHaveLength(3);
});

it("does not enter historical backfill after a fatal database or integrity failure",async()=>{
  const backfill=vi.fn();
  await expect(reconcileLatestBeforeBackfill(["a","b"],()=>true,async()=>{throw new Error("unknown database write outcome");},backfill)).rejects.toThrow("unknown database write outcome");
  expect(backfill).not.toHaveBeenCalled();
  const assets=new Map([["a",{payload:{snapshotId:"new",reconciliationState:"updating",calculationVersion:HISTORY_VERSION}}]]);
  expect(historyWorkPlan([{slug:"a"}],assets,"new").latest).toHaveLength(1);
  expect(historyMarketRetryDue(undefined)).toBe(true);
  expect(historyMarketRetryDue("invalid")).toBe(false);
});
