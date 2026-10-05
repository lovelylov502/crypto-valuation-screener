import { afterEach, describe, it, expect, vi } from "vitest";
import registry from "./fundamentalDefinitions.json";
import { completeHistorySource } from "./completeHistorySource";
import { summarizeHolderHistory } from "./holderHistorySource";
import { aggregateHolderValueByGroup } from "./holderValue";
import { definitionReviewed } from "./fundamentalSource";
import type { SourceObservation } from "./types";
import { summarizeRevenueHistory } from "./revenueHistory";
const at=Date.parse("2026-09-20T01:00:00Z"),end=Date.parse("2026-09-19")/1000;
const ethereum={slug:"ethereum",name:"Ethereum",defillamaId:"chain#ethereum",methodology:registry.ethereum.methodology,total30d:300};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("recovering missing overview series",()=>{
  it("retries a transient child timeout without losing its complete period",async()=>{
    vi.useFakeTimers();
    const fetcher=vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValue(new Response(JSON.stringify({...ethereum,totalDataChart:Array.from({length:30},(_,i)=>[end-i*86400,10])})));
    vi.stubGlobal("fetch",fetcher);
    const sources:SourceObservation[]=[];
    const pending=completeHistorySource([ethereum],[],at,"dailyHoldersRevenue",()=>true,sources);
    await vi.runAllTimersAsync();
    expect(summarizeHolderHistory([ethereum],await pending,at).ethereum.periods[30]).toMatchObject({total:300,reportedDays:30});
    expect(sources.map(s=>s.status)).toEqual(["ok"]);
  });
  it("recovers explicit chain burn history without adding a buyback or synthetic zeros",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...ethereum,totalDataChart:Array.from({length:30},(_,i)=>[end-i*86400,10])}))));
    const sources:SourceObservation[]=[];
    const chart=await completeHistorySource([ethereum],[],at,"dailyHoldersRevenue",()=>true,sources);
    const h=summarizeHolderHistory([ethereum],chart,at).ethereum;
    expect(h.periods[30]).toMatchObject({total:300,reportedDays:30});
    expect(h.periods[365].total).toBeNull();
    expect(sources[0].status).toBe("ok");
  });
  it.each(["identity","definition","conflict"])("refuses %s mismatches while retaining original observations",async(problem)=>{
    const summary={...ethereum,name:problem === "identity" ? "Other" : ethereum.name,methodology:problem === "definition" ? {...ethereum.methodology,HoldersRevenue:"Changed recipients"} : ethereum.methodology,totalDataChart:[[end,problem === "conflict" ? 12 : 10],[end-86400,10]]};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(summary))));
    const sources:SourceObservation[]=[];
    const chart=await completeHistorySource([ethereum],[[end,{Ethereum:10}]],at,"dailyHoldersRevenue",()=>true,sources);
    expect(chart).toEqual([[end,{Ethereum:10}]]);
    expect(sources[0]).toMatchObject({status:"withheld",reason:problem === "conflict" ? "value_conflict" : "scope_mismatch",sourceSlugs:[ethereum.slug]});
  });
  it("restores Orca purchases into xORCA only for the exact reviewed definition",()=>{
    const row={slug:"orca-dex",name:"Orca",total30d:100,methodology:registry["orca-dex"].methodology};
    const included=aggregateHolderValueByGroup([row],s=>s,definitionReviewed).get("orca-dex")!;
    expect(included.eligibleCurrent30d).toBe(100);
    expect(included.components[0]).toMatchObject({economicType:"market_buyback",condition:"xORCA 스테이킹"});
    const changed={...row,methodology:{...row.methodology,HoldersRevenue:"Purchases for the team"}};
    expect(aggregateHolderValueByGroup([changed],s=>s,definitionReviewed).get("orca-dex")?.eligibleCurrent30d).toBeNull();
  });
  it("recovers an unreviewed standalone source's explicit zero while preserving genuinely missing dates",async()=>{
    const row={slug:"wbtc",name:"WBTC",defillamaId:"2",methodology:{Revenue:"All fees are revenue."},total30d:0.31};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...row,totalDataChart:[[end-86400,0.31],[end,0]]}))));
    const sources:SourceObservation[]=[];
    const chart=await completeHistorySource([row],[[end-86400,{WBTC:0.31}]],at,"dailyRevenue",()=>true,sources);
    const history=summarizeRevenueHistory([row],chart,at,"overview").wbtc;
    expect(history.periods[1]).toMatchObject({total:0,reportedDays:1});
    expect(history.periods[7]).toMatchObject({total:null,reportedDays:2});
    expect(definitionReviewed(row)).toBe(false);
    expect(sources).toMatchObject([{status:"ok",sourceSlugs:["wbtc"]}]);
  });
  it("rejects conflicting duplicate source dates instead of selecting the last value",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...ethereum,totalDataChart:[[end,0],[end,10]]}))));
    const sources:SourceObservation[]=[];
    expect(await completeHistorySource([ethereum],[],at,"dailyRevenue",()=>true,sources)).toEqual([]);
    expect(sources).toMatchObject([{status:"withheld",reason:"value_conflict"}]);
  });
  it("attempts every raw gap beyond the former fixed request cap",async()=>{
    const protocols=Array.from({length:80},(_,i)=>({slug:`raw-${i}`,name:`Raw ${i}`,defillamaId:String(i),total30d:0,methodology:{Revenue:"Unreviewed receipts"}}));
    const fetcher=vi.fn(async(input:string)=>{
      const slug=new URL(String(input)).pathname.split("/").at(-1);
      return new Response(JSON.stringify({...protocols.find(p=>p.slug===slug),totalDataChart:[[end,0]]}));
    });
    vi.stubGlobal("fetch",fetcher);
    const sources:SourceObservation[]=[];
    const chart=await completeHistorySource(protocols,[],at,"dailyRevenue",()=>true,sources);
    expect(fetcher).toHaveBeenCalledTimes(80);
    expect(sources.filter(s=>s.reason === "request_budget")).toEqual([]);
    const histories=summarizeRevenueHistory(protocols,chart,at,"overview");
    for(const s of sources) {
      expect(s).toMatchObject({status:"ok",sourceSlugs:[expect.any(String)]});
      expect(histories[s.sourceSlugs![0]].periods[1]).toMatchObject({total:0,reportedDays:1});
    }
  });
});
