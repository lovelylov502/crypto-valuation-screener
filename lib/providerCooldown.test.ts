import {afterEach,expect,it,vi} from "vitest";
import {captureSourceBundle,replaySourceBundle,sourceFetch} from "./sourceBundle";
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const at="2026-10-07T02:00:00.000Z",first="https://api.llama.fi/summary/fees/a?dataType=dailyRevenue",second="https://api.llama.fi/summary/fees/b?dataType=dailyRevenue",other="https://api.coingecko.com/api/v3/coins/markets?ids=a";
it("a provider429 pauses sibling scopes while other providers continue, retains original429 after recovery, and replay never waits",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const times:{url:string;at:number}[]=[];
 const network=vi.fn(async(url:any)=>{times.push({url,at:Date.now()});return String(url)===first?new Response("limited",{status:429,headers:{"retry-after":"60"}}):Response.json({value:0});});vi.stubGlobal("fetch",network);
 const run=async()=>{const a=await sourceFetch(first);return [a.status,...await Promise.all([sourceFetch(second).then(r=>r.status),sourceFetch(other).then(r=>r.status)])];};
 const pending=captureSourceBundle(at,null,run,undefined,2);await vi.advanceTimersByTimeAsync(1);expect(times.map(t=>t.url)).toEqual([first,other]);
 await vi.advanceTimersByTimeAsync(60998);expect(times).toHaveLength(2);await vi.advanceTimersByTimeAsync(1);const result=await pending;
 expect(times[2].at-times[0].at).toBe(61000);expect(result.value).toEqual([429,200,200]);expect(result.bundle.requestStats).toMatchObject({requests:3,rateLimited:1,deferred:0});
 vi.stubGlobal("fetch",()=>{throw new Error("Forbidden network");});expect(await replaySourceBundle(result.bundle,run)).toEqual(result.value);expect(vi.getTimerCount()).toBe(0);
});
it("a Retry-After beyond the shared nine-minute budget becomes recorded deferral without an early upstream retry",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const network=vi.fn(async()=>new Response("limited",{status:429,headers:{"retry-after":"600"}}));vi.stubGlobal("fetch",network);
 const run=async()=>{await sourceFetch(first);try{await sourceFetch(second);return "unexpected";}catch(e){return (e as Error).message;}};
 const captured=await captureSourceBundle(at,null,run,undefined,2);expect(network).toHaveBeenCalledTimes(1);expect(captured.value).toContain("deferred");expect(captured.bundle.receipts.map(r=>r.status)).toEqual([429,null]);expect(captured.bundle.requestStats).toMatchObject({rateLimited:1,deferred:1});
 vi.stubGlobal("fetch",()=>{throw new Error("Forbidden network");});expect(await replaySourceBundle(captured.bundle,run)).toBe(captured.value);
});
it("an overlapping429 extends the host cooldown for already-waiting siblings",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const times:{url:string;at:number}[]=[];
 const inFlight="https://api.llama.fi/summary/fees/in-flight?dataType=dailyRevenue";
 const network=vi.fn(async(url:any)=>{times.push({url,at:Date.now()});if(url===inFlight){await new Promise(r=>setTimeout(r,1000));return new Response("limited",{status:429,headers:{"retry-after":"10"}});}return url===first?new Response("limited",{status:429,headers:{"retry-after":"0"}}):Response.json({});});vi.stubGlobal("fetch",network);
 const run=async()=>{const b=sourceFetch(inFlight);await sourceFetch(first);await sourceFetch(second);await b;};
 const pending=captureSourceBundle(at,null,run,undefined,2);await vi.advanceTimersByTimeAsync(5000);expect(times.map(t=>t.url)).toEqual([inFlight,first]);
 await vi.advanceTimersByTimeAsync(6999);expect(times).toHaveLength(2);await vi.advanceTimersByTimeAsync(1);await pending;expect(times[2].at-Date.parse(at)).toBe(12000);
});
it("a request signal expiring during cooldown records a deferral without attempting upstream transport",async()=>{
 vi.useFakeTimers();vi.setSystemTime(at);const controller=new AbortController(),network=vi.fn(async()=>new Response("limited",{status:429,headers:{"retry-after":"60"}}));vi.stubGlobal("fetch",network);
 const run=async()=>{await sourceFetch(first);try{await sourceFetch(second,{signal:controller.signal});}catch{}};
 const pending=captureSourceBundle(at,null,run,undefined,2);await vi.advanceTimersByTimeAsync(15000);controller.abort();await vi.advanceTimersByTimeAsync(0);const captured=await pending;
 expect(network).toHaveBeenCalledTimes(1);expect(captured.bundle.requestStats?.deferred).toBe(1);expect(captured.bundle.receipts[1].error).toContain("deferred");
});
