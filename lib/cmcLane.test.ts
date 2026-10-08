import {afterEach,expect,it,vi} from "vitest";
import {captureSourceBundle,replaySourceBundle,sourceFetch} from "./sourceBundle";
import {getJson} from "./sources";
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const at="2026-10-08T08:00:00Z",base="https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/",listing=base+"listings/latest?start=1",quote=base+"quotes/latest?id=1",other=base+"quotes/latest?id=2";
it.each([3,4] as const)("revision%s serializes listings, quotes and actual retries, reserving starts after the latest cooldown",async revision=>{
 vi.useFakeTimers();vi.setSystemTime(at);const starts:{url:string;at:number}[]=[];let active=0,max=0;
 vi.stubGlobal("fetch",async(url:string)=>{starts.push({url,at:Date.now()});max=Math.max(max,++active);await new Promise(r=>setTimeout(r,100));active--;return starts.length===2?new Response("limited",{status:429,headers:{"retry-after":"10"}}):Response.json({ok:true});});
 const run=()=>Promise.all([listing,quote,other].map(url=>getJson(url,[],{timeout:1000,deadline:Date.now()+180_000})));
 const pending=captureSourceBundle(at,null,run,undefined,2,revision);await vi.advanceTimersByTimeAsync(30_000);const result=await pending;
 expect(result.error).toBeUndefined();expect(max).toBe(1);expect(starts.map(s=>s.at-Date.parse(at))).toEqual([0,6000,17100,23100]);
 expect(result.bundle.requestStats).toMatchObject({requests:4,rateLimited:1,deferred:0});
 vi.stubGlobal("fetch",()=>{throw new Error("Offline only");});expect(await replaySourceBundle(result.bundle,run)).toEqual(result.value);
});
it("a second queued429 extends cooldown before its successor can reserve a start",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const starts:number[]=[];
 vi.stubGlobal("fetch",async()=>{starts.push(Date.now());return starts.length===1?new Response("limited",{status:429,headers:{"retry-after":"0"}}):starts.length===2?new Response("limited",{status:429,headers:{"retry-after":"10"}}):Response.json({});});
 const run=()=>Promise.all([listing,quote,other].map(url=>sourceFetch(url,{}, {timeout:1000,deadline:Date.now()+180_000})));
 const pending=captureSourceBundle(at,null,run,undefined,2,3);await vi.advanceTimersByTimeAsync(16999);expect(starts.map(t=>t-Date.parse(at))).toEqual([0,6000]);await vi.advanceTimersByTimeAsync(1);await pending;expect(starts[2]-Date.parse(at)).toBe(17000);
});
it("queued abort emits no HTTP and cannot release a successor ahead of an active transport",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const aborted=new AbortController(),starts:string[]=[];let finish!:(r:Response)=>void;
 vi.stubGlobal("fetch",async(url:string)=>{starts.push(url);return url===listing?new Promise<Response>(resolve=>{finish=resolve;}):Response.json({});});
 const run=()=>Promise.allSettled([sourceFetch(listing,{}, {timeout:10_000,deadline:Date.now()+180_000}),sourceFetch(quote,{signal:aborted.signal},{timeout:10_000,deadline:Date.now()+180_000}),sourceFetch(other,{}, {timeout:10_000,deadline:Date.now()+180_000})]);
 const pending=captureSourceBundle(at,null,run,undefined,2,3);await vi.advanceTimersByTimeAsync(0);aborted.abort();await vi.advanceTimersByTimeAsync(7000);expect(starts).toEqual([listing]);finish(Response.json({}));await vi.advanceTimersByTimeAsync(0);const result=await pending;
 expect(starts).toEqual([listing,other]);expect(result.bundle.receipts.find(r=>r.url===quote)).toMatchObject({status:null,error:"Recorded source request deferred by provider cooldown"});expect(result.bundle.requestStats?.deferred).toBe(1);
});
it("provider deadline remains fixed across queue and cooldown; deferred calls spend no transport retry",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const starts:number[]=[];vi.stubGlobal("fetch",async()=>{starts.push(Date.now());return new Response("limited",{status:429});});
 const run=()=>Promise.allSettled([listing,quote,other].map(url=>getJson(url,[],{timeout:10_000,deadline:Date.now()+180_000})));
 const pending=captureSourceBundle(at,null,run,undefined,2,3);await vi.advanceTimersByTimeAsync(180_000);const result=await pending;
 expect(starts.map(t=>t-Date.parse(at))).toEqual([0,60000,120000]);expect(result.bundle.requestStats).toMatchObject({requests:6,rateLimited:3,deferred:3});expect(result.bundle.receipts.filter(r=>r.status===null)).toHaveLength(3);
});
it("holds its reservation through a slow429 body before applying cooldown to the waiting quote",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const starts:number[]=[];let finish!:()=>void;
 vi.stubGlobal("fetch",async()=>{starts.push(Date.now());if(starts.length>1)return Response.json({});return new Response(new ReadableStream({start(controller){finish=()=>{controller.enqueue(new TextEncoder().encode("limited"));controller.close();};}}),{status:429,headers:{"retry-after":"10"}});});
 const run=()=>Promise.all([listing,quote].map(url=>sourceFetch(url,{}, {timeout:30_000,deadline:Date.now()+180_000})));
 const pending=captureSourceBundle(at,null,run,undefined,2,3);await vi.advanceTimersByTimeAsync(7000);expect(starts).toHaveLength(1);finish();await vi.advanceTimersByTimeAsync(10999);expect(starts).toHaveLength(1);await vi.advanceTimersByTimeAsync(1);await pending;expect(starts[1]-Date.parse(at)).toBe(18000);
});
