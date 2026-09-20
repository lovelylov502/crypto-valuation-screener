import { capitalExclusion } from "./capitalEligibility";
import { describe, it, expect } from "vitest";
import { sample } from "./testFixtures";
import { resolveSalesEvidence } from "./salesSource";
import { salesMultiple, holderMultiple, holderScope, protocolMultiple } from "./valuationMetrics";
import { summarizeHolderHistory } from "./holderHistorySource";
import { summarizeRevenueHistory } from "./revenueHistory";
import { findCmc } from "./sources";
import { scoreCoins } from "./valuation";
import { fundamentalErrors } from "./fundamentalContract";
import registry from "./fundamentalDefinitions.json";
import { aggregateHolderValueByGroup } from "./holderValue";
import { combineFundamentals } from "./fundamentalSource";
import { parseWorkspace, defaultPreferences, resetWorkspaceFilters } from "./workspacePreferences";

const at = "2026-09-20T01:00:00Z";
const end = Date.parse("2026-09-19") / 1000;
const rows = [{ slug: "venice", name: "Venice", methodology: registry.venice.methodology, total30d: 3000, total60dto30d: 3000 }];
const chart = Array.from({ length:365 },(_,i)=>[end-i*86400,{Venice:100}]);
function venice() {
  const c = sample({ slug:"venice",symbol:"VVV",geckoId:"venice-token",mcap:1.35e9,fdv:2.27e9, fundamentals:combineFundamentals(undefined,undefined,rows), holderValue:aggregateHolderValueByGroup(rows,s=>s).get("venice")! });
  c.holderHistory=summarizeHolderHistory(rows,chart,Date.parse(at)).venice;
  c.sales=resolveSalesEvidence(c,at);
  return c;
}

describe("sales and dated holder metrics",()=>{
  it("reconciles VVV 12.3 mcap vs 20.6 FDV using the same independently sourced sales estimate",()=>{
    const c=venice();
    expect(salesMultiple(c)).toBeCloseTo(12.272727);
    expect(salesMultiple(c,"fdv")).toBeCloseTo(20.636364);
    expect(holderMultiple(c)).toBeCloseTo(1.35e9/36500);
    expect(protocolMultiple(c)).toBeNull();
    const noSales={...c,sales:null};
    expect(salesMultiple(noSales)).toBeNull();
    expect(salesMultiple({...c,geckoId:"wrong-token"})).toBeNull();
  });
  it("expires external estimates without filling P/S with burns or silently dating estimates as TTM",()=>{
    const c=venice();
    c.sales=resolveSalesEvidence(c,"2026-10-30T00:00:00Z");
    expect(c.sales?.status).toBe("expired");
    expect(salesMultiple(c)).toBeNull();
    expect(holderMultiple(c)).not.toBeNull();
  });
  it("uses four exact dated windows, preserves zero and refuses partial years or missing current days",()=>{
    const c=venice();
    for(const days of [7,30,90,365] as const) expect(holderMultiple(c,days)).toBeCloseTo(1.35e9/36500);
    c.holderHistory=summarizeHolderHistory(rows,chart.slice(0,90),Date.parse(at)).venice;
    expect(holderMultiple(c,365)).toBeNull();
    expect(holderMultiple(c,90)).not.toBeNull();
    c.holderHistory=summarizeHolderHistory(rows,chart.slice(1),Date.parse(at)).venice;
    expect(holderMultiple(c,7)).toBeNull();
    c.holderHistory=summarizeHolderHistory(rows,chart.map(r=>[r[0],{Venice:0}]),Date.parse(at)).venice;
    expect(c.holderHistory.periods[30].total).toBe(0);
    expect(holderMultiple(c)).toBeNull();
  });
  it("fails closed on source definition drift and independently fetched holder composition changes",()=>{
    const c=venice();
    expect(c.holderHistory?.definitionFingerprint).toBe(holderScope(c));
    c.fundamentals.holders[0].definition="A different distribution";
    expect(holderMultiple(c)).toBeNull();
    const changed=rows.map(r=>({...r,methodology:{...r.methodology,HoldersRevenue:"Unknown new policy"}}));
    expect(summarizeHolderHistory(changed,chart,Date.parse(at)).venice).toBeUndefined();
  });
  it("rejects altered computed metrics and incomplete periods in a refresh response",()=>{
    const [c]=scoreCoins([venice()],at);
    expect(fundamentalErrors(c)).toEqual([]);
    expect(fundamentalErrors({...c,multiples:{...c.multiples,psSales:200}})).toContain("psSales basis");
    c.holderHistory!.periods[30].reportedDays=29;
    expect(fundamentalErrors(c)).toContain("period coverage");
  });
  it("keeps native burns and conditional flows out of holder history",()=>{
    const excluded=[{slug:"other",name:"Other",methodology:{HoldersRevenue:"All native transaction fees are burned"}}];
    expect(Object.keys(summarizeHolderHistory(excluded,chart,Date.parse(at)))).toHaveLength(0);
  });
});

describe("canonical market identity",()=>{
  const rows=[{id:1,slug:"sky",name:"Sky",symbol:"SKY"},{id:2,slug:"solana",name:"Solana",symbol:"SOL"},{id:3,slug:"magic-token",name:"Treasure",symbol:"MAGIC"},{id:4,slug:"old-magic",name:"Magic Land",symbol:"MAGIC"}];
  const index={byId:new Map(rows.map(r=>[r.id,r])),bySlug:new Map(rows.map(r=>[r.slug,r])),byNameSymbol:new Map<string, typeof rows>(),bySymbol:new Map(rows.map(r=>[r.symbol.toLowerCase(),rows.filter(a=>a.symbol===r.symbol)]))};
  const match=(name:string,symbol:string,groupKey:string,geckoId:string|null=null,cmcIds:number[]=[])=>findCmc({name,symbol,groupKey,geckoId,cmcIds,cmc:index});
  it("never matches an unrelated project by substring or just a shared ticker",()=>{
    expect(match("Skydrome","SKY","skydrome","skydrome")).toBeUndefined();
    expect(match("Solana Farm","SOL","solana-farm")).toBeUndefined();
    expect(match("SKY Treasury Scam","SKY","unrelated")).toBeUndefined();
    expect(match("Sky","SKY","sky")?.id).toBe(1);
  });
  it("prefers canonical numeric IDs and rejects conflicting IDs, unavailable IDs and symbol disagreement",()=>{
    expect(match("Magic Land","MAGIC","magic-land","magic-token",[4])?.id).toBe(4);
    expect(match("Magic Land","MAGIC","magic-land","magic-token",[9])).toBeUndefined();
    expect(match("Magic","MAGIC","magic",null,[3,4])).toBeUndefined();
    expect(match("Sky","SKY","sky",null,[2])).toBeUndefined();
  });
});

describe("comparison preferences",()=>{
  it("preserves chosen metric order through filter resets and storage reload",()=>{
    const p={...defaultPreferences(),columns:["psSales","phr1y","phr90d","phr","phr7d"] as const,view:"favorites" as const,search:"VVV",maxPhr:200,capital:"fdv" as const};
    const saved=parseWorkspace(JSON.stringify(p)), reset=resetWorkspaceFilters(saved);
    expect(saved.columns).toEqual(p.columns);
    expect(reset.columns).toEqual(p.columns);
    expect(reset.capital).toBe("fdv");
    expect(reset.search).toBe("");
    expect(reset.maxPhr).toBe(0);
  });
  it("recovers malformed preferences without emptying the comparison table",()=>{
    expect(parseWorkspace('{"columns":["missing"],"maxPs":-2}')).toEqual(defaultPreferences());
    expect(parseWorkspace("broken")).toEqual(defaultPreferences());
  });
});



describe("capital and history scope safeguards", () => {
  it("rejects stablecoin issued supply as issuer value without rejecting its separate governance token", () => {
    const assets = [{gecko_id:"usdd",symbol:"USDD"},{gecko_id:"sperax-usd",symbol:"USDs"}];
    const reason = capitalExclusion("usdd","USDD",assets);
    expect(reason).not.toBeNull();
    expect(capitalExclusion("sperax","SPA",assets)).toBeNull();
    expect(capitalExclusion("sperax-usd","SPA",assets)).toBeNull();
    const [c] = scoreCoins([sample({capitalExclusionReason:reason})],at);
    expect(Object.values(c.multiples).every(v=>v===null)).toBe(true);
    expect(c.valueScore).toBeNull();
    expect(c.opportunities.business || c.opportunities.holder || c.opportunities.transition).toBe(false);
    expect(fundamentalErrors(c)).toEqual([]);
  });
  it("does not assign a shared chart name to the eligible project when another project is excluded", () => {
    const collision = [...rows, {slug:"unreviewed",name:"Venice",methodology:{HoldersRevenue:"Unreviewed flow"}}];
    const h = summarizeHolderHistory(collision,chart,Date.parse(at)).venice;
    expect(h.periods[30].total).toBeNull();
    expect(h.periods[30].reportedDays).toBe(0);
  });
  it("invalidates holder history when source names or economic scope change", () => {
    const c = venice();
    c.holderValue.components[0].name = "Renamed source series";
    expect(holderMultiple(c)).toBeNull();
  });
});
