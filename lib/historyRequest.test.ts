import { afterEach, expect, it, vi } from "vitest";
import { completeHistorySource } from "./completeHistorySource";
import { captureSourceBundle, replaySourceBundle } from "./sourceBundle";
import type { SourceObservation } from "./types";
import { readHistorySummary } from "./historyRequest";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("accounts every uncompleted source after a shared abort and replays the failures offline", async () => {
  const at = "2026-10-05T03:00:00.000Z";
  const protocols = Array.from({ length: 80 }, (_, i) => ({ slug: `raw-${i}`, name: `Raw ${i}`, defillamaId: String(i), total30d: 0 }));
  const network = vi.fn(async (_input: string, init?: RequestInit) => {
    expect(init?.signal?.aborted).toBe(true);
    throw new Error("Capture deadline exceeded");
  });
  vi.stubGlobal("fetch", network);
  const run = async () => {
    const observations: SourceObservation[] = [];
    const chart = await completeHistorySource(protocols, [], Date.parse(at), "dailyRevenue", () => true, observations);
    return { chart, observations: observations.sort((a, b) => a.url.localeCompare(b.url)) };
  };
  const captured = await captureSourceBundle(at, null, run, AbortSignal.abort());
  expect(captured.error).toBeUndefined();
  expect(captured.value?.chart).toEqual([]);
  expect(captured.value?.observations).toHaveLength(80);
  expect(captured.value?.observations.every(s => s.status === "error" && s.sourceSlugs?.length === 1)).toBe(true);
  expect(captured.bundle.receipts).toHaveLength(160);
  vi.stubGlobal("fetch", () => { throw new Error("Unexpected network"); });
  expect(await replaySourceBundle(captured.bundle, run)).toEqual(captured.value);
});

const at = "2026-10-05T03:00:00.000Z", url = "https://api.llama.fi/summary/fees/raw?dataType=dailyRevenue";
it.each([
  [null, 5000], ["0", 5000], ["60", 61000], ["Mon, 05 Oct 2026 03:00:10 GMT", 11000], ["invalid", 5000],
] as const)("paces a 429 with Retry-After %s and replays it without sleeping",async(retryAfter,delay)=>{
  vi.useFakeTimers();vi.setSystemTime(at);
  const network=vi.fn().mockResolvedValueOnce(new Response("limited",{status:429,headers:retryAfter===null?{}:{"retry-after":retryAfter}}))
    .mockResolvedValueOnce(new Response(JSON.stringify({slug:"raw",total24h:0})));
  vi.stubGlobal("fetch",network);
  const run=async()=>{const observations:SourceObservation[]=[];return {value:await readHistorySummary(url,Date.now(),Date.now()+120_000,observations,["raw"]),observations};};
  const pending=captureSourceBundle(at,null,run);
  await vi.advanceTimersByTimeAsync(delay-1);
  expect(network).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  const captured=await pending;
  expect(captured.error).toBeUndefined();
  expect(captured.value?.value).toEqual({slug:"raw",total24h:0});
  expect(captured.bundle.receipts).toHaveLength(2);
  expect(Date.parse(captured.bundle.receipts[1].requestedAt)-Date.parse(captured.bundle.receipts[0].observedAt)).toBe(delay);
  vi.stubGlobal("fetch",()=>{throw new Error("Unexpected network");});
  const replay=await replaySourceBundle(captured.bundle,run);
  expect(replay).toEqual(captured.value);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["local deadline","shared abort"])("stops 429 backoff at %s and records a replayable aborted retry",async(kind)=>{
  vi.useFakeTimers();vi.setSystemTime(at);
  const controller=new AbortController();
  const network=vi.fn().mockResolvedValueOnce(new Response("limited",{status:429,headers:{"retry-after":"60"}}))
    .mockImplementationOnce(async(_input:string,init:RequestInit)=>{expect(init.signal?.aborted).toBe(true);throw new Error("aborted");});
  vi.stubGlobal("fetch",network);
  const run=async()=>{const observations:SourceObservation[]=[];return {value:await readHistorySummary(url,Date.now(),Date.now()+(kind==="local deadline"?1000:120_000),observations,["raw"]),observations};};
  const pending=captureSourceBundle(at,null,run,controller.signal);
  await vi.advanceTimersByTimeAsync(999);
  expect(network).toHaveBeenCalledTimes(1);
  if(kind==="shared abort") controller.abort();
  await vi.advanceTimersByTimeAsync(1);
  const captured=await pending;
  expect(captured.error).toBeUndefined();
  expect(captured.value?.observations).toMatchObject([{status:"error",sourceSlugs:["raw"]}]);
  expect(captured.bundle.receipts.map(r=>r.status)).toEqual([429,null]);
  vi.stubGlobal("fetch",()=>{throw new Error("Unexpected network");});
  expect(await replaySourceBundle(captured.bundle,run)).toEqual(captured.value);
  expect(vi.getTimerCount()).toBe(0);
});
