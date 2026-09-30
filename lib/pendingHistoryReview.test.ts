import { afterEach, expect, it, vi } from "vitest";
import { assembleScreener } from "./screener";
import { sample, fixtureFundamentals } from "./testFixtures";
import { reviewPendingHistory } from "./pendingHistoryReview";
import { assessCandidate } from "./publication";
import { reviewedSourceChanges, sourceChangeSignature, sourceReviewHash } from "./reviewedSourceChanges";
import type { RevenueHistory, RevenueWindowDays } from "./revenueHistory";

afterEach(() => vi.unstubAllGlobals());
const at = "2026-09-30T10:00:00Z", day = Date.parse("2026-09-29") / 1000;
const member = { slug: "sample", name: "Sample", defillamaId: "123", methodology: { Revenue: "Protocol receipts" } };
const witness = [null,null,null,{protocols:[member]}];
function data(time: string, missing = false, holder = false) {
  const end = Math.floor(Date.parse(time) / 86400000) * 86400 - 86400;
  const period = (days:number) => ({days,start:new Date((end-(days-1)*86400)*1000).toISOString().slice(0,10),end:new Date(end*1000).toISOString().slice(0,10),reportedDays:days-(missing?1:0),total:missing?null:days});
  const history: RevenueHistory = { definitionFingerprint:fixtureFundamentals.revenue.fingerprint,source:"source",observedAt:time,
    periods:Object.fromEntries([1,7,30,90,365].map(d=>[d,period(d)])) as Record<RevenueWindowDays, ReturnType<typeof period>>,
    previous30:period(30),weeks:[] };
  const paths=["/protocols","/config","/overview/fees","/overview/fees?dataType=dailyRevenue","/overview/fees?dataType=dailyHoldersRevenue","/overview/dexs"];
  return assembleScreener([sample({name:"Sample",sourceSlugs:["sample"],revenueHistory:history,...(holder?{holderHistory:history}:{})})],time,paths.map(p=>({url:"https://api.llama.fi"+p,status:"ok",observedAt:time})));
}
it.each(["latest", "older", "multiple", "wrong-scope", "empty", "failure"])("independently distinguishes the latest pending day from invalid loss evidence (%s)", async scenario => {
  const before=data("2026-09-29T10:00:00Z"), after=data(at,true);
  const points=Array.from({length:365},(_,i)=>[day-(i+1)*86400,1]);
  if (scenario==="older") {points.splice(1,1);points.push([day,1]);}
  if (scenario==="multiple") {points.splice(1,1);after.coins[0].revenueHistory!.periods[30].reportedDays=28;}
  vi.stubGlobal("fetch",vi.fn(async()=>scenario==="failure" ? new Response("",{status:503}) : new Response(JSON.stringify({
    ...member,defillamaId:scenario==="wrong-scope"?"other":member.defillamaId,totalDataChart:scenario==="empty"?[]:points,
  }))));
  const review=await reviewPendingHistory(after,before,witness);
  const gate=assessCandidate(after,before,at,at,review.keys);
  if(scenario==="latest") {
    expect(review.keys.has("sample:revenue_30d_history_lost")).toBe(true);
    expect(gate.unreviewedChanges).toEqual([]);
    expect(after.coins[0].revenueHistory?.periods[30].total).toBeNull();
    expect(after.coins[0].multiples.pr).toBeNull();
  } else if(scenario==="multiple") {
    expect(review.keys.has("sample:revenue_30d_history_lost")).toBe(false);
    expect(gate.unreviewedChanges.some(c=>c.issue==="revenue_30d_history_lost")).toBe(true);
  } else expect(review.keys.size).toBe(0);
  if(scenario==="failure") expect(gate.errors).toContain("source_request_failed:503");
});
it("reviews the latest completed UTC day again after a month rollover",async()=>{
  const time="2026-10-01T00:02:00Z", before=data(at), after=data(time,true);
  const end=Date.parse("2026-09-30")/1000;
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...member,totalDataChart:Array.from({length:365},(_,i)=>[end-(i+1)*86400,1])}))));
  const review=await reviewPendingHistory(after,before,witness);
  expect(review.keys.has("sample:revenue_30d_history_lost")).toBe(true);
  expect(review.proofs[0].missingDate).toBe("2026-09-30");
  expect(after.coins[0].revenueHistory!.periods[30].total).toBeNull();
});
it.each(["latest","older","wrong-scope","failure"])("requires separate holder-return source evidence (%s)",async scenario=>{
  const before=data("2026-09-29T10:00:00Z",false,true),after=data(at,true,true);
  const fetchMock=vi.fn(async(input:string)=>{
    const holder=input.includes("dailyHoldersRevenue");
    if(holder && scenario==="failure") return new Response("",{status:503});
    const points=Array.from({length:365},(_,i)=>[day-(i+1)*86400,1]);
    if(holder && scenario==="older") {points.splice(1,1);points.push([day,1]);}
    return new Response(JSON.stringify({...member,defillamaId:holder && scenario==="wrong-scope"?"other":member.defillamaId,totalDataChart:points}));
  });
  vi.stubGlobal("fetch",fetchMock);
  const review=await reviewPendingHistory(after,before,[...witness,{protocols:[member]}]);
  expect(fetchMock.mock.calls.some(([url])=>url.endsWith("dataType=dailyHoldersRevenue"))).toBe(true);
  expect(review.keys.has("sample:holder_30d_history_lost")).toBe(scenario==="latest");
  expect(after.coins[0].multiples.phr).toBeNull();
  if(scenario==="failure") expect(assessCandidate(after,before,at,at,review.keys).errors).toContain("source_request_failed:503");
});
it("binds an explicit reviewed change to its baseline, UTC date, scope and missing-day count",()=>{
  const before=data("2026-09-29T10:00:00Z"), after=data(at,true), change={slug:"sample",issue:"revenue_30d_history_lost"};
  const review={baselineHash:sourceReviewHash(before),collectionDate:"2026-09-30",reviewedAt:at,evidenceHash:"a".repeat(64),entries:[{...change,signature:sourceChangeSignature(after,change),reason:"Independent source review",source:"https://api.llama.fi/summary/fees/sample"}]};
  expect(reviewedSourceChanges(after,before,review)).toHaveLength(1);
  expect(reviewedSourceChanges(after,data(at),review)).toHaveLength(0);
  expect(reviewedSourceChanges({...after,updatedAt:"2026-10-01T10:00:00Z"},before,review)).toHaveLength(0);
  const changed=structuredClone(after);changed.coins[0].revenueHistory!.periods[30].reportedDays=28;
  expect(reviewedSourceChanges(changed,before,review)).toHaveLength(0);
  changed.coins[0].sourceSlugs=["different-component"];
  expect(reviewedSourceChanges(changed,before,review)).toHaveLength(0);
  after.sources.push({url:"https://api.coingecko.com/api/v3/coins/markets",observedAt:at,status:"error",httpStatus:403});
  expect(assessCandidate(after,before,at,at,new Set(["sample:revenue_30d_history_lost"])).errors).toContain("source_request_failed:403");
});
