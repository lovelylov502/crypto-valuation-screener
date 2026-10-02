import { afterEach, expect, it, vi } from "vitest";
import { sample } from "./testFixtures";
import { assembleScreener } from "./screener";
import { summarizeRevenueHistory } from "./revenueHistory";
import { reviewUpstreamChanges } from "./upstreamChangeReview";
import { assessCandidate } from "./publication";
import { aggregateDefinitions, combineFundamentals } from "./fundamentalSource";
import type { CoinRaw } from "./types";

afterEach(() => vi.unstubAllGlobals());
const at = "2026-10-02T10:00:00Z", end = Date.parse("2026-10-01") / 1000;
const member = { slug: "sample", name: "Sample", defillamaId: "123", methodology: { Revenue: "Protocol receipts" } };
function snapshot(missing: number[] = [], overrides: Partial<CoinRaw> = {}, time = at) {
  const points = Array.from({ length: 365 }, (_, i) => [end-i*86400, { Sample: 1 }] as const).filter((_, i) => !missing.includes(i));
  const definitions = aggregateDefinitions([member], () => "sample", "Revenue");
  const revenueHistory = summarizeRevenueHistory([member], points, Date.parse(at), "source", definitions).sample;
  return assembleScreener([sample({ name: "Sample", symbol: null, geckoId: null, cmcId: null, sourceSlugs: ["sample"], revenueHistory,
    fundamentals: combineFundamentals(definitions.get("sample") as any, undefined, []), revenue24h: null, revenue7d: null, revenue30d: null, revenue1y: null, holderHistory: null, ...overrides })], time, []);
}
const witness = () => [[member], { parentProtocols: [] }, { protocols: [member] }, { protocols: [member] }, { protocols: [member] }, { protocols: [member] }];
function summary(missing: number[] = [], extra = {}) { return { ...member, totalDataChart: Array.from({ length: 365 }, (_, i) => [end-i*86400, 1]).filter((_,i) => !missing.includes(i)), ...extra }; }

it.each([{ missing: [0, 1] }, { missing: [5, 20] }, { missing: [0, 29] }])("accepts independently confirmed missing dates $missing after a date change without filling amounts", async ({ missing }) => {
  const before = snapshot([], {}, "2026-09-30T10:00:00Z"), after = snapshot(missing);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(summary(missing)))));
  const review = await reviewUpstreamChanges(after, before, witness());
  expect(review.keys.has("sample:revenue_30d_history_lost")).toBe(true);
  expect(after.coins[0].revenueHistory!.periods[30].total).toBeNull();
  expect(after.coins[0].multiples.pr).toBeNull();
  expect(assessCandidate(after, before, at, at, review.keys).unreviewedChanges).toEqual([]);
});
it.each(["available-date", "wrong-identity", "wrong-definition", "failed-request"])("still blocks a collector gap with %s evidence", async scenario => {
  const before = snapshot(), after = snapshot([0, 1]);
  vi.stubGlobal("fetch", vi.fn(async () => scenario === "failed-request" ? new Response("", { status: 403 }) : new Response(JSON.stringify(summary(scenario === "available-date" ? [] : [0,1], scenario === "wrong-identity" ? {defillamaId:"other"} : scenario === "wrong-definition" ? {methodology:{Revenue:"Other accounting"}} : {})))));
  const review = await reviewUpstreamChanges(after, before, witness());
  expect(review.keys.has("sample:revenue_30d_history_lost")).toBe(false);
  if (scenario === "failed-request") expect(after.sources.some(s => s.status === "error")).toBe(true);
});
it("verifies each selected parent child, without using a wider parent total", async () => {
  const before = snapshot(), after = snapshot([0,1]);
  for (const d of [before, after]) { d.coins[0].slug = "parent#sample"; d.coins[0].isParent = true; d.coins[0].sourceSlugs = ["parent#sample","sample"]; }
  const w = witness(); (w[1] as any).parentProtocols = [{id:"parent#sample",name:"Sample"}];
  const fetcher = vi.fn(async (url: string) => { expect(url).toContain("/sample?dataType="); return new Response(JSON.stringify(summary([0,1]))); });
  vi.stubGlobal("fetch",fetcher);
  const review = await reviewUpstreamChanges(after,before,w);
  expect(review.keys.has("parent#sample:revenue_30d_history_lost")).toBe(true);
});
it("only accepts source removals when the complete independent universe also omits them", async () => {
  const before = snapshot(), after = snapshot(); before.coins.push({...before.coins[0],slug:"removed",sourceSlugs:["removed"]});
  const review = await reviewUpstreamChanges(after,before,witness());
  expect(review.keys.has("removed:project_removed")).toBe(true);
  const w = witness(); (w[0] as any[]).push({...member,slug:"removed"});
  expect((await reviewUpstreamChanges(after,before,w)).keys.size).toBe(0);
  expect((await reviewUpstreamChanges(after,before,[])).keys.size).toBe(0);
});
it("does not approve a disappeared rolling amount that the independent source still reports", async () => {
  const before = snapshot([0],{revenue24h:10}), after = snapshot([0]);
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(summary([0],{total24h:10})))));
  expect((await reviewUpstreamChanges(after,before,witness())).keys.has("sample:revenue_1d_lost")).toBe(false);
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(summary([0],{total24h:null})))));
  expect((await reviewUpstreamChanges(after,before,witness())).keys.has("sample:revenue_1d_lost")).toBe(true);
});
it.each([true,false])("requires independent quote absence, never just the candidate's missing field (available=%s)", async available => {
  const before = snapshot([],{geckoId:"asset",cmcId:null}), after = snapshot([],{geckoId:"asset",cmcId:null,price:null});
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify([{id:"asset",current_price:available?2:null}]))));
  const review = await reviewUpstreamChanges(after,before,witness());
  expect(review.keys.has("sample:price_lost")).toBe(!available);
});
it("rejects a new optional CMC identity not corroborated by the independent asset", async () => {
  const before = snapshot([],{cmcId:1}), after = snapshot([],{cmcId:2});
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({data:[{id:2,slug:"unrelated",name:"Unrelated",symbol:"OTHER"}]}))));
  expect((await reviewUpstreamChanges(after,before,witness())).keys.has("sample:identity_changed")).toBe(false);
});
it.each([true,false])("requires explicit upstream withdrawal before dropping an existing token link (%s)",async withdrawn=>{
  const before=snapshot([],{geckoId:"old-asset",cmcId:1}),after=snapshot([],{geckoId:null,cmcId:null,identityStatus:"review",mcap:null,price:null,fdv:null});
  const w=witness(); (w[0] as any[])[0]={...member,...(withdrawn?{gecko_id:null,cmcId:null}:{})};
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({data:[{id:1,slug:"old-asset",symbol:"OLD",quote:[{symbol:"USD",price:5}]}]}))));
  const review=await reviewUpstreamChanges(after,before,w);
  expect(review.keys.has("sample:identity_changed")).toBe(withdrawn);
  expect(review.keys.has("sample:price_lost")).toBe(withdrawn);
});
