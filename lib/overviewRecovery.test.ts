import { afterEach, expect, it, vi } from "vitest";
import { recoverOverviewRows } from "./overviewRecovery";
import { assembleScreener } from "./screener";
import { sample } from "./testFixtures";
import registry from "./fundamentalDefinitions.json";
import type { SourceObservation } from "./types";

afterEach(()=>vi.unstubAllGlobals());
const identity={slug:"canton",name:"Canton",id:"7653",category:"Chain",gecko_id:"canton-network",cmcId:"37263"};
const summary={...identity,defillamaId:"chain#canton",methodology:registry.canton.methodology,total30d:48_857_312};
const baseline=()=>assembleScreener([sample({slug:"canton",sourceSlugs:["canton"],revenue30d:123})],"2026-09-28T00:00:00Z",[]);
it.each(["dailyRevenue","dailyFees","dailyHoldersRevenue"] as const)("recovers current individual source amounts when a verified overview row disappears (%s)",async metric=>{
  const before=baseline();before.coins[0].holderValue.rawCurrent30d=123;
  const rows:Record<string,unknown>[]=[],observations:SourceObservation[]=[];
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(summary))));
  const recovery=await recoverOverviewRows([identity],rows,before,metric,observations);
  expect(rows[0].total30d).toBe(48_857_312);
  expect(recovery.get("canton")).toBe(`https://api.llama.fi/summary/fees/canton?dataType=${metric}`);
  expect(observations).toMatchObject([{status:"ok"}]);
});
it.each(["wrong-id","wrong-asset","wrong-name","parent","doublecounted","changed-definition"])("withholds mismatched individual sources (%s)",async scenario=>{
  const altered={...summary,...(scenario==="wrong-id"?{defillamaId:"chain#other"}:scenario==="wrong-asset"?{cmcId:"1"}:scenario==="wrong-name"?{name:"Other"}:scenario==="parent"?{parentProtocol:"parent#other"}:scenario==="doublecounted"?{doublecounted:true}:{methodology:{...summary.methodology,Revenue:"Different scope"}})};
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(altered))));
  const rows:Record<string,unknown>[]=[],observations:SourceObservation[]=[];
  expect((await recoverOverviewRows([identity],rows,baseline(),"dailyRevenue",observations)).size).toBe(0);
  expect(rows).toEqual([]);
  expect(observations).toMatchObject([{status:"withheld",reason:"scope_mismatch"}]);
});
it("retains request failures and skips present rows or fully removed projects",async()=>{
  const mock=vi.fn(async()=>new Response("",{status:403}));vi.stubGlobal("fetch",mock);
  const observations:SourceObservation[]=[],rows:Record<string,unknown>[]=[];
  expect((await recoverOverviewRows([identity],rows,baseline(),"dailyRevenue",observations)).size).toBe(0);
  expect(observations).toMatchObject([{status:"error",httpStatus:403}]);
  expect((await recoverOverviewRows([],rows,baseline(),"dailyRevenue",[])).size).toBe(0);
  expect((await recoverOverviewRows([identity],[summary],baseline(),"dailyRevenue",[])).size).toBe(0);
  expect(mock).toHaveBeenCalledTimes(1);
});
