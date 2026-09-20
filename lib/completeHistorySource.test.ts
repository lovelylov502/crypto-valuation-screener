import { afterEach, describe, it, expect, vi } from "vitest";
import registry from "./fundamentalDefinitions.json";
import { completeHistorySource } from "./completeHistorySource";
import { summarizeHolderHistory } from "./holderHistorySource";
import { aggregateHolderValueByGroup } from "./holderValue";
import { definitionReviewed } from "./fundamentalSource";
import type { SourceObservation } from "./types";
const at=Date.parse("2026-09-20T01:00:00Z"),end=Date.parse("2026-09-19")/1000;
const ethereum={slug:"ethereum",name:"Ethereum",defillamaId:"chain#ethereum",methodology:registry.ethereum.methodology,total30d:300};
afterEach(()=>vi.unstubAllGlobals());
describe("recovering missing overview series",()=>{
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
    expect(sources[0].status).toBe("error");
  });
  it("restores Orca purchases into xORCA only for the exact reviewed definition",()=>{
    const row={slug:"orca-dex",name:"Orca",total30d:100,methodology:registry["orca-dex"].methodology};
    const included=aggregateHolderValueByGroup([row],s=>s,definitionReviewed).get("orca-dex")!;
    expect(included.eligibleCurrent30d).toBe(100);
    expect(included.components[0]).toMatchObject({economicType:"market_buyback",condition:"xORCA 스테이킹"});
    const changed={...row,methodology:{...row.methodology,HoldersRevenue:"Purchases for the team"}};
    expect(aggregateHolderValueByGroup([changed],s=>s,definitionReviewed).get("orca-dex")?.eligibleCurrent30d).toBeNull();
  });
});
