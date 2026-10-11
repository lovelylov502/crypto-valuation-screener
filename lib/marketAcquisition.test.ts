import {afterEach,expect,it,vi} from "vitest";
import {captureSourceBundle,replaySourceBundle,sourceFetch,validateSourceBundle} from "./sourceBundle";
import {fetchCmc,getJson,collectCoinInputs} from "./sources";
import type {SourceObservation} from "./types";
import {readHistorySummary} from "./historyRequest";

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const at="2026-10-07T20:51:50.000Z",listing="https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/listings/latest?start=1&limit=5000&convert=USD";
it("default60s cooldown consumes elapsed budget but not10s transport timeout or retry allowance",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const times:number[]=[];
 vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{times.push(Date.now());expect(init?.signal?.aborted).toBe(false);return times.length===1?new Response("limited",{status:429}):Response.json({data:[{id:1027,slug:"ethereum"}]});}));
 const observations:SourceObservation[]=[];
 const run=()=>fetchCmc(observations,Date.now()+180_000).then(c=>[...c.byId.keys()]);
 const pending=captureSourceBundle(at,null,run,undefined,2,2);
 await vi.advanceTimersByTimeAsync(59_999);expect(times).toHaveLength(1);await vi.advanceTimersByTimeAsync(1);
 const captured=await pending;expect(captured.value).toEqual([1027]);expect(times[1]-times[0]).toBe(60_000);
 expect(captured.bundle.requestStats).toMatchObject({rateLimited:1,deferred:0,requests:2});
 vi.stubGlobal("fetch",()=>{throw new Error("Offline only");});expect(await replaySourceBundle(captured.bundle,run)).toEqual([1027]);
});
it("exhausted provider budget records one deferral and leaves another provider runnable",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const network=vi.fn(async()=>new Response("limited",{status:429,headers:{"retry-after":"600"}}));vi.stubGlobal("fetch",network);
 const observations:SourceObservation[]=[];
 const run=async()=>{try{await getJson(listing,observations,{timeout:10_000,deadline:Date.now()+180_000});}catch{}return (await sourceFetch("https://api.llama.fi/protocols")).status;};
 const pending=captureSourceBundle(at,null,run,undefined,2,2);await vi.runAllTimersAsync();const captured=await pending;
 expect(captured.value).toBe(429);expect(network).toHaveBeenCalledTimes(2);
 expect(captured.bundle.receipts.filter(r=>r.url===listing).map(r=>r.status)).toEqual([429,null]);
 expect(observations).toContainEqual(expect.objectContaining({status:"error",reason:"request_budget"}));
 vi.stubGlobal("fetch",()=>{throw new Error("Offline only");});expect(await replaySourceBundle(captured.bundle,run)).toBe(429);
});
it("overlapping cooldown extension still caps a transport by provider deadline",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const other=listing.replace("start=1","start=2");
 vi.stubGlobal("fetch",async()=>new Response("limited",{status:429,headers:{"retry-after":"90"}}));
 const captured=await captureSourceBundle(at,null,async()=>{await sourceFetch(listing);try{await sourceFetch(other,{}, {timeout:10_000,deadline:Date.now()+60_000});}catch{}},undefined,2,2);
 expect(captured.bundle.receipts.map(r=>r.status)).toEqual([429,null]);expect(captured.bundle.requestStats?.deferred).toBe(1);
});
it("rejects unknown acquisition semantics rather than replaying with current behavior",async()=>{
 vi.stubGlobal("fetch",async()=>Response.json({}));const captured=await captureSourceBundle(at,null,()=>sourceFetch(listing),undefined,2,2);
 expect(()=>validateSourceBundle({...captured.bundle,acquisitionRevision:4})).not.toThrow();
 expect(()=>validateSourceBundle({...captured.bundle,acquisitionRevision:5})).not.toThrow();
 expect(()=>validateSourceBundle({...captured.bundle,acquisitionRevision:6} as any)).toThrow("Invalid source bundle");
 expect(()=>validateSourceBundle({...captured.bundle,pipelineSchema:undefined})).toThrow("Invalid source bundle");
});
it("history transport also begins its15s timeout after cooldown and preserves historical retry semantics",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const url="https://api.llama.fi/summary/fees/a?dataType=dailyRevenue",times:number[]=[];
 vi.stubGlobal("fetch",async()=>{times.push(Date.now());return times.length===1?new Response("limited",{status:429}):Response.json({totalDataChart:[[1,0]]});});
 const run=()=>readHistorySummary(url,Date.now(),Date.now()+90_000,[]);
 const pending=captureSourceBundle(at,null,run,undefined,2,2);await vi.advanceTimersByTimeAsync(60_000);const result=await pending;
 expect(result.value).toEqual({totalDataChart:[[1,0]]});expect(times[1]-times[0]).toBe(60_000);expect(result.bundle.requestStats).toMatchObject({rateLimited:1,deferred:0});
 vi.stubGlobal("fetch",()=>{throw new Error("Offline only");});expect(await replaySourceBundle(result.bundle,run)).toEqual(result.value);
});
it("persistent CMC429 shares one180s budget across discovery and quotes, without spending retries on deferrals",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const cmcTimes:number[]=[],p={slug:"token",name:"Token",symbol:"T",cmcId:123};
 vi.stubGlobal("fetch",async(input:string|URL|Request)=>{
  const u=new URL(String(input));if(u.hostname.includes("coinmarketcap")){cmcTimes.push(Date.now());return new Response("limited",{status:429});}
  return Response.json(u.hostname.includes("stablecoins")?{peggedAssets:[{gecko_id:"tether",symbol:"USDT"}]}:u.pathname==="/protocols"?[p]:u.pathname==="/config"?{parentProtocols:[{id:"parent#unrelated",name:"Unrelated"}]}:{protocols:[p],totalDataChartBreakdown:[]});
 });
 const run=()=>collectCoinInputs();const pending=captureSourceBundle(at,null,run,undefined,2,2);await vi.runAllTimersAsync();const captured=await pending;
 expect(captured.error).toBeUndefined();expect(cmcTimes.slice(0,3).map(t=>t-Date.parse(at))).toEqual([0,60_000,120_000]);
 expect(Math.max(...cmcTimes)-Date.parse(at)).toBeLessThan(180_000);expect(captured.bundle.receipts.filter(r=>r.url.includes("coinmarketcap")&&r.status===null)).toHaveLength(1);
 expect(captured.value!.cmcLookups[0][1].status).toBe("error");
 vi.stubGlobal("fetch",()=>{throw new Error("Offline only");});expect(await replaySourceBundle(captured.bundle,run)).toEqual(captured.value);
});
