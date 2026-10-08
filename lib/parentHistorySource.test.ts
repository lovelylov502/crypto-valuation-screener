import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchParentHistorySources, mergeParentHistories, sameParentScope } from "./parentHistorySource";
import { summarizeRevenueHistory } from "./revenueHistory";
import type { SourceObservation, ScreenerResponse } from "./types";
import {captureSourceBundle} from "./sourceBundle";
import {annotateFreshness,freshnessIdentity} from "./datedFreshness";
import {initialRecovery,updateObligations} from "./freshnessRecovery";
import {sample} from "./testFixtures";
import {ECONOMIC_POLICY_IDENTITY} from "./economicPolicyIdentity";

const now = Date.parse("2026-09-27T12:00:00Z"), end = Date.parse("2026-09-26") / 1000;
const key = "parent#old-name";
const members = [
  { slug: "v1", name: "V1", defillamaId: "1", parentProtocol: key, total30d: 300, linkedProtocols: ["New Name", "V1", "V2"], methodology: { Revenue: "Team fees" } },
  { slug: "v2", name: "V2", defillamaId: "2", parentProtocol: key, total30d: 18, linkedProtocols: ["New Name", "V1", "V2"], methodology: { Revenue: "Team fees" } },
];
const chart = Array.from({ length: 30 }, (_, i) => [end - i * 86400, i < 9 ? { V1: 10, V2: 2 } : { V1: 10 }]);
const summary = () => ({ defillamaId: key, parentProtocol: null, childProtocols: members.map(({ name, defillamaId, methodology }) => ({ name, defillamaId, methodology })), totalDataChart: Array.from({ length: 30 }, (_, i) => [end - i * 86400, i < 9 ? 12 : 10]) });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function mergedFreshness(revision:2|3|4|undefined,missing:number[]=[],problem?:"scope"|"value") {
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
  const s=summary();s.totalDataChart=s.totalDataChart.filter(([t])=>!missing.includes(t));
  s.totalDataChart.push([end+86400,99999]); // Partial today cannot repair a completed-day gap.
  if(problem==="scope")s.childProtocols[0].methodology={Revenue:"A different reported series"};
  if(problem==="value")s.totalDataChart[0][1]=99;
  vi.stubGlobal("fetch",async()=>Response.json(s));
  const rows=chart.filter(([t])=>!missing.includes(t as number));
  return captureSourceBundle(new Date(now).toISOString(),null,async()=>{
    const histories=summarizeRevenueHistory(members,rows,now,"overview",new Map([[key,{fingerprint:"economic-semantic",physicalFingerprint:"reported-physical"}]]),members,2);
    const before=structuredClone(histories[key]),sources:SourceObservation[]=[];
    const parents=await fetchParentHistorySources(members,rows,now,"dailyRevenue",()=>true,sources);
    mergeParentHistories(histories,rows,parents,now,sources);
    const fundamentals=structuredClone(sample().fundamentals);fundamentals.revenue={...fundamentals.revenue,fingerprint:"economic-semantic",physicalFingerprint:"reported-physical"};fundamentals.economicPolicy=ECONOMIC_POLICY_IDENTITY;
    const coin=annotateFreshness([sample({slug:key,fundamentals,revenueHistory:histories[key],dataQuality:{state:"complete",issues:[]}})],new Date(now).toISOString())[0];
    return {before,history:histories[key],coin,sources};
  },undefined,2,revision);
}

describe("verified parent histories", () => {
  it.each([undefined,2,3,4] as const)("revision %s preserves the separate semantic and physical identity contract",async revision=>{
    const result=await mergedFreshness(revision),value=result.value!;
    expect(result.error).toBeUndefined();expect(value.history.definitionFingerprint).toBe("economic-semantic");
    expect(value.history.periods[30]).toMatchObject({total:318,reportedDays:30});expect(value.history.periods[365].total).toBeNull();
    expect(value.history.freshness!.definition).toBe(revision===4?"reported-physical":"economic-semantic");
    expect(value.coin.freshness!.revenue.state).toBe(revision===4?"current":"conflict");
    expect(value.history.freshness!.components).toEqual(value.before.freshness!.components);
    if(revision===4)expect(freshnessIdentity(value.history.freshness!)).toBe(freshnessIdentity(value.before.freshness!));
  });
  it.each(["scope","value"] as const)("revision 4 retains a true parent %s conflict",async problem=>{
    const result=await mergedFreshness(4,[],problem),value=result.value!;
    expect(result.error).toBeUndefined();expect(value.history).toEqual(value.before);
    expect(value.sources.at(-1)).toMatchObject({status:"withheld",reason:problem==="scope"?"scope_mismatch":"value_conflict"});
    const coin=annotateFreshness([{...value.coin,dataQuality:{state:"partial",issues:[{scope:"revenue",code:problem==="scope"?"scope_mismatch":"value_conflict",source:"parent",retryable:false}]}}],new Date(now).toISOString())[0];
    expect(coin.freshness!.revenue.state).toBe("conflict");
  });
  it("revision 4 preserves missing days and overdue obligation age; genuine physical drift cannot retire it",async()=>{
    const result=await mergedFreshness(4,[end,end-5*86400]),coin=result.value!.coin,f=coin.freshness!.revenue;
    expect(result.error).toBeUndefined();expect(f.state).toBe("pending");expect(f.missingRecentDates).toEqual(["2026-09-21","2026-09-26"]);
    expect(coin.revenueHistory!.periods[7]).toMatchObject({total:null,reportedDays:5});
    const identity=freshnessIdentity(f),firstMissingAt="2026-09-24T12:00:00.000Z",state=initialRecovery();
    state.obligations=[{key:JSON.stringify([coin.slug,"revenue",identity,"2026-09-21"]),slug:coin.slug,metric:"revenue",identity,date:"2026-09-21",firstMissingAt,lastCheckedAt:firstMissingAt,lastAttemptId:"prior",checks:2,disposition:"overdue",sources:["overview"]}];
    const data={updatedAt:new Date(now).toISOString(),coins:[coin],pipeline:{schema:2,rawBundleSha256:"a".repeat(64)}} as ScreenerResponse;
    const next=updateObligations(state,data,"corrected");
    expect(next.obligations.find(o=>o.date==="2026-09-21")).toMatchObject({identity,firstMissingAt,checks:3,disposition:"overdue"});
    const changed=structuredClone(data);changed.coins[0].fundamentals.revenue.physicalFingerprint="different-reported-series";changed.coins[0].freshness=annotateFreshness(changed.coins,changed.updatedAt)[0].freshness;
    expect(changed.coins[0].freshness!.revenue.state).toBe("conflict");
    expect(updateObligations(next,changed,"drifted").obligations.find(o=>o.date==="2026-09-21")).toMatchObject({identity,firstMissingAt,checks:4,disposition:"overdue"});
    expect(state.obligations[0].checks).toBe(2);
  });
  it("attempts every parent gap beyond the former fixed request cap", async () => {
    const protocols = Array.from({ length: 40 }, (_, i) => ({ slug: `child-${i}`, name: `Child ${i}`, defillamaId: String(i), parentProtocol: `parent#group-${i}`, total30d: 0 }));
    const fetcher = vi.fn(async (input: string) => {
      const key = `parent#${new URL(String(input)).pathname.split("/").at(-1)}`;
      const child = protocols.find(p => p.parentProtocol === key)!;
      return Response.json({ defillamaId: key, childProtocols: [child], totalDataChart: [[end, 0]] });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchParentHistorySources(protocols, [], now, "dailyRevenue", () => true, [])).toHaveLength(40);
    expect(fetcher).toHaveBeenCalledTimes(40);
  });
  it.each([503, 429, "network"])("recovers transient %s failures instead of discarding a previously complete history", async failure => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementationOnce(async () => {
      if (typeof failure !== "number") throw new TypeError("fetch failed");
      return new Response("", {status: failure, headers:{"retry-after":"1"}});
    }).mockImplementation(async () => new Response(JSON.stringify(summary())));
    vi.stubGlobal("fetch", fetcher);
    const observations: SourceObservation[] = [];
    const pending = fetchParentHistorySources(members, chart, now, "dailyRevenue", () => true, observations);
    await vi.runAllTimersAsync();
    expect(await pending).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(observations).toEqual([]);
  });
  it("recovers the provider's full parent without fabricating a child's missing observations", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(summary())));
    vi.stubGlobal("fetch", fetcher);
    const observations: SourceObservation[] = [];
    const histories = summarizeRevenueHistory(members, chart, now, "overview", new Map([[key, { fingerprint: "scope" }]]));
    expect(histories[key].periods[30].reportedDays).toBe(9);
    const parents = await fetchParentHistorySources(members, chart, now, "dailyRevenue", () => true, observations);
    mergeParentHistories(histories, chart, parents, now, observations);
    expect(histories[key].periods[30]).toMatchObject({ total: 318, reportedDays: 30 });
    expect(histories[key].periods[365].total).toBeNull();
    expect(histories[key].definitionFingerprint).toBe("scope");
    expect(histories[key].source).toContain("/new-name?dataType=dailyRevenue");
    expect(chart[29][1]).toEqual({ V1: 10 });
    expect(observations.at(-1)?.status).toBe("ok");
  });
  it.each(["id", "definition", "extra", "duplicate", "doublecounted"])("rejects a parent with %s scope drift", problem => {
    const s = summary();
    if (problem === "id") s.defillamaId = "parent#other";
    if (problem === "definition") s.childProtocols[0].methodology = { Revenue: "All customer deposits" };
    if (problem === "extra") s.childProtocols.push({ ...s.childProtocols[0], defillamaId: "3" });
    if (problem === "duplicate") s.childProtocols[1] = s.childProtocols[0];
    if (problem === "doublecounted") Object.assign(s.childProtocols[0], { doublecounted: true });
    expect(sameParentScope(key, members, s)).toBe(false);
  });
  it("does not use an entire parent for an eligible holder subset", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(summary()))));
    const sources: SourceObservation[] = [];
    // A complete eligible child needs no recovery; a parent cannot add the ineligible second child.
    expect(sameParentScope(key, members.slice(0, 1), summary())).toBe(false);
    expect(await fetchParentHistorySources(members, chart, now, "dailyHoldersRevenue", p => p.slug === "v1", sources)).toEqual([]);
  });
  it("retains the old history on conflicting overlaps and ignores partial today", async () => {
    const s = summary();
    s.totalDataChart[0][1] = 99;
    s.totalDataChart.push([end + 86400, 99999]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(s))));
    const sources: SourceObservation[] = [];
    const histories = summarizeRevenueHistory(members, chart, now, "overview");
    const before = structuredClone(histories);
    const parents = await fetchParentHistorySources(members, chart, now, "dailyRevenue", () => true, sources);
    mergeParentHistories(histories, chart, parents, now, sources);
    expect(histories).toEqual(before);
    expect(sources.at(-1)).toMatchObject({ status: "withheld", reason: "value_conflict" });
  });
  it("distinguishes a received scope mismatch from a failed source request", async () => {
    const s = summary();
    s.childProtocols.push({ ...s.childProtocols[0], defillamaId: "extra" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(s))));
    const sources: SourceObservation[] = [];
    expect(await fetchParentHistorySources(members, chart, now, "dailyRevenue", () => true, sources)).toEqual([]);
    expect(sources[0]).toMatchObject({ status: "withheld", reason: "scope_mismatch" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await fetchParentHistorySources(members, chart, now, "dailyRevenue", () => true, sources);
    expect(sources[1]).toMatchObject({status:"error",httpStatus:503});
  });
});
