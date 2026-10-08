import {afterEach,expect,it,vi} from "vitest";
import {captureSourceBundle,objectHash,recordEconomicProvenance} from "./sourceBundle";
import {ECONOMIC_POLICY_V3 as ECONOMIC_POLICY,ECONOMIC_POLICY as ECONOMIC_POLICY_V2,economicArtifactV3 as economicArtifact} from "./economicPolicy";
import actualChains from "./fixtures/economic-chains-runtime-v3.json";
import {reviewedRegistryProjection} from "./economicProvenanceV3";
import {economicCoinErrors} from "./economicContract";
import {aggregateDefinitions,combineFundamentals} from "./fundamentalSource";
import {aggregateHolderValueByGroup} from "./holderValue";
import {sample} from "./testFixtures";
import {assembleScreener} from "./screener";
import {summarizeRevenueHistory} from "./revenueHistory";
import {protocolMultiple,holderMultiple} from "./valuationMetrics";
import {metricComparisonAllowed,metricTemporalLabel} from "./fundamentals";
import {makeSnapshot,compareSnapshot} from "./snapshotHistory";
import {annotateFreshness,freshnessIdentity} from "./datedFreshness";
import {initialRecovery,updateObligations} from "./freshnessRecovery";
import {buildEconomicReview,summarizeEconomicReview,validateEconomicReview} from "./economicReview";
import type {EconomicProvenance} from "./economicTypes";
const at="2026-10-07T20:00:00Z",hash="a".repeat(64);
afterEach(()=>vi.useRealTimers());
function proof():EconomicProvenance{return {state:"verified",repository:"DefiLlama/dimension-adapters",observedAt:at,commit:"1".repeat(40),tree:"2".repeat(40),receiptHashes:["b".repeat(64),"c".repeat(64)],files:[...new Map(economicArtifact.contracts.flatMap(c=>c.sourceClosure).map(f=>[f.path,f])).values()].map(f=>({path:f.path,expected:f.blobSha1,actual:f.path===actualChains.path?actualChains.blobSha1:f.blobSha1})),limitation:"provider-execution-revision-unattested",runtime:{scope:"adapter-local-with-reviewed-shared-fee-surface",typeSurface:"matched",contexts:economicArtifact.contracts.map(c=>({slug:c.slug,sha256:c.runtimeContext!.sha256})),rawChangedPaths:[actualChains.path],literalRegistry:{path:actualChains.path,state:"matched",actualBlobSha1:actualChains.blobSha1,rawSha256:actualChains.sha256,...reviewedRegistryProjection,addedMembers:["DERIVE_V3"]}}};}
async function coin(slug="fake-world-assets-v1",p=proof(),policy=ECONOMIC_POLICY) {
  const c=economicArtifact.contracts.find(c=>c.slug===slug)!;
  const row={slug,module:c.expectedModule,defillamaId:c.providerId,name:c.expectedName,parentProtocol:c.expectedParent,methodology:c.expectedDefinitions,total30d:300};
  const r=await captureSourceBundle(at,null,async()=>{recordEconomicProvenance(p);const key=c.expectedParent??slug;
    const defs=aggregateDefinitions([row],()=>key,"Revenue"),fees=aggregateDefinitions([row],()=>key,"Fees");
    const fundamentals=combineFundamentals(defs.get(key) as any,fees.get(key) as any,[row]);
    const chart=Array.from({length:730},(_,i)=>[Date.parse("2026-10-06")/1000-i*86400,{[row.name]:10}]);
    const history=summarizeRevenueHistory([row],chart,Date.parse(at),"fixture",defs,[row],2)[key];
    return sample({slug:key,fundamentals,revenueHistory:history,holderValue:aggregateHolderValueByGroup([row],()=>key).get(key),mcap:36500,fdv:73000});
  },undefined,2,2,policy);return r.value!;
}
it("independent positive USD sums enable P/R while unresolved holders stay null for every window and numerator",async()=>{
  const c=await coin();for(const days of [1,7,30,90,365] as const)for(const basis of ["mcap","fdv"] as const) {
    // Expected arithmetic is direct from the declared ten USD/day fixture.
    expect(protocolMultiple(c,days,basis)).toBe(c[basis]!/(10*365));expect(holderMultiple(c,days,basis)).toBeNull();
  }
  expect(c.fundamentals.holderShareReviewed).toBe(false);
});
it("SSV permits complete mixed-era denominators and holds cross-era growth without hiding raw sums",async()=>{
  const c=await coin("ssv-network");expect(protocolMultiple(c,365)).toBe(10);expect(protocolMultiple(c,90)).toBe(10);
  expect(metricComparisonAllowed(c,"Revenue",30)).toBe(true);
  expect(metricComparisonAllowed(c,"Revenue",90)).toBe(false);expect(metricComparisonAllowed(c,"Revenue",365)).toBe(false);
  expect(c.revenueHistory!.previous![90].start).toBe("2026-04-10");
  expect(metricTemporalLabel(c,"Revenue",c.revenueHistory!.periods[365])).toContain("2026-04-22");
});
it("consecutive captures and unrelated Fees/holder evidence changes retain Revenue comparison, while relevant Revenue changes suppress only its deltas",async()=>{
  const raw=await coin(),data=assembleScreener([raw],at,[]),c=data.coins[0],snapshot=makeSnapshot(data);
  const next=structuredClone(c);next.fundamentals.fingerprint="f".repeat(64);next.fundamentals.fees.fingerprint="d".repeat(64);
  next.fundamentals.holders[0].decision!.evidence.receiptHashes=["e".repeat(64)];
  const same=compareSnapshot(next,snapshot,data.scoreVersion);
  expect(same.state).toBe("comparable");expect(same.revenueComparable).toBe(true);expect(same.revenueDelta).toBe(0);expect(same.scoreDelta).toBeNull();
  next.fundamentals.revenue.fingerprint="0".repeat(64);
  expect(compareSnapshot(next,snapshot,data.scoreVersion).revenueDelta).toBeNull();
  expect(compareSnapshot(next,snapshot,data.scoreVersion).revenueComparable).toBe(false);
  const sales=structuredClone(c);sales.sales={id:"reviewed-sales",amountUsd:100,status:"current"} as any;
  expect(compareSnapshot(sales,snapshot,data.scoreVersion).scoreDelta).toBeNull();
  expect(compareSnapshot(sales,snapshot,data.scoreVersion).revenueComparable).toBe(true);
  const scopedHolder=structuredClone(c);scopedHolder.holderHistory!.definitionFingerprint="different eligible holder scope";
  expect(compareSnapshot(scopedHolder,snapshot,data.scoreVersion).holderDelta).toBeNull();
  expect(compareSnapshot(scopedHolder,snapshot,data.scoreVersion).revenueComparable).toBe(true);
});
it("the first policy migration bridges identical captured raw metadata without resetting missing-date age",async()=>{
  const c=await coin();c.fundamentals.revenue.legacyPhysicalFingerprint="legacy";
  const f=c.revenueHistory!.freshness!;f.state="pending";f.latestCompleteDate="2026-10-05";
  f.coverage=null;f.missingRecentDates=[f.targetDate];
  const current=annotateFreshness([c],at)[0];const old=structuredClone(current);delete old.fundamentals.economicPolicy;old.freshness!.revenue.definition="legacy";delete old.freshness!.revenue.legacyIdentityAlias;
  const first=updateObligations(initialRecovery(),{coins:[old],updatedAt:at} as any,"first");
  const after=updateObligations(first,{coins:[current],updatedAt:"2026-10-08T20:00:00Z",pipeline:{rawBundleSha256:hash}} as any,"second");
  expect(after.obligations).toHaveLength(1);expect(after.obligations[0]).toMatchObject({firstMissingAt:at,checks:2,disposition:"overdue",identity:freshnessIdentity(current.freshness!.revenue),identityMigration:{from:freshnessIdentity(old.freshness!.revenue),rawBundleSha256:hash}});
  const unknown=structuredClone(current);unknown.freshness!.revenue.definition="different-series";delete unknown.freshness!.revenue.legacyIdentityAlias;
  const unproved=updateObligations(first,{coins:[unknown],updatedAt:"2026-10-08T20:00:00Z",pipeline:{rawBundleSha256:hash}} as any,"third");
  expect(unproved.obligations.find(o=>o.firstMissingAt===at)?.disposition).toBe("overdue");
});
it("economic review ages survive dates and proven stable IDs through renames, unavailable evidence and resolution; public counts stay global and bounded",async()=>{
  const c=await coin(),first=buildEconomicReview([c],at,hash,undefined,null,objectHash)!;
  const pending=first.entries.find(e=>e.metric==="HoldersRevenue")!;expect(pending.firstKnownBasis).toBe("tracking-start");
  const next=structuredClone(c);next.slug="renamed-parent";next.fundamentals.holders[0].decision!.disposition="evidence-unavailable";
  const later=buildEconomicReview([next],"2026-10-09T20:00:00Z","d".repeat(64),first,null,objectHash)!;
  const entry=later.entries.find(e=>e.key===pending.key)!;
  expect(entry).toMatchObject({firstKnownAt:at,firstRawBundleSha256:hash,lastRawBundleSha256:"d".repeat(64),observationCount:2,disposition:"evidence-unavailable",projects:["renamed-parent"]});
  expect(summarizeEconomicReview(later,objectHash).summary).toMatchObject({sourceMetrics:3,evidenceUnavailable:1,affectedProjects:1,oldestPendingAt:at});
  next.fundamentals.holders[0].decision!.disposition="reviewed-unavailable";
  const resolved=buildEconomicReview([next],"2026-10-10T20:00:00Z","e".repeat(64),later,null,objectHash)!;
  expect(resolved.entries.find(e=>e.key===pending.key)).toMatchObject({firstKnownAt:at,resolution:{at:"2026-10-10T20:00:00Z",rawBundleSha256:"e".repeat(64)}});
  expect(summarizeEconomicReview(resolved,objectHash).summary.pending).toBe(0);
  const forged=structuredClone(resolved);forged.entries[0].componentId="forged";expect(()=>validateEconomicReview(forged)).toThrow();
  const absent=buildEconomicReview([sample({fundamentals:{...next.fundamentals,revenue:{...next.fundamentals.revenue,components:[]},fees:{...next.fundamentals.fees,components:[]},holders:[]}})],"2026-11-10T20:00:00Z","f".repeat(64),resolved,null,objectHash)!;
  expect(absent.entries).toEqual(resolved.entries);
  const returned=buildEconomicReview([next],"2026-11-11T20:00:00Z","0".repeat(64),absent,null,objectHash)!;
  expect(returned.entries.find(e=>e.key===pending.key)).toMatchObject({firstKnownAt:at,resolution:{at:"2026-10-10T20:00:00Z"},observationCount:4});
});
it("v2 to v3 review migration preserves the exact metric age and dated obligation, recording only the evidenced resolution",async()=>{
  const p=proof();p.state="changed";
  const old=await coin("fake-world-assets-v1",p,ECONOMIC_POLICY_V2),current=await coin("fake-world-assets-v1",p);
  expect(old.fundamentals.revenue.components[0].decision!.disposition).toBe("pending");expect(current.fundamentals.revenue.components[0].decision!.disposition).toBe("approved");
  const first=buildEconomicReview([old],at,hash,undefined,null,objectHash)!;
  const migrated=buildEconomicReview([current],"2026-10-08T20:00:00Z","d".repeat(64),first,null,objectHash)!;
  expect(migrated.trackingStartedAt).toBe(at);expect(migrated.entries.find(e=>e.metric==="Revenue")).toMatchObject({firstKnownAt:at,firstRawBundleSha256:hash,observationCount:2,resolution:{at:"2026-10-08T20:00:00Z",policySha256:ECONOMIC_POLICY.sha256}});
  for(const c of [old,current]) {const f=c.revenueHistory!.freshness!;f.state="pending";f.latestCompleteDate="2026-10-05";f.coverage=null;f.missingRecentDates=[f.targetDate];}
  const before=annotateFreshness([old],at)[0],after=annotateFreshness([current],at)[0];expect(freshnessIdentity(after.freshness!.revenue)).toBe(freshnessIdentity(before.freshness!.revenue));
  const dated=updateObligations(initialRecovery(),{coins:[before],updatedAt:at} as any,"first");
  expect(updateObligations(dated,{coins:[after],updatedAt:"2026-10-08T20:00:00Z"} as any,"next").obligations[0]).toMatchObject({firstMissingAt:at,checks:2,disposition:"overdue"});
});
it("valid v3 consumer evidence passes accounting with seven receipts and rejects detached registry proof or an eighth receipt",async()=>{
 const p=proof();p.receiptHashes=Array.from({length:7},(_,i)=>String(i).repeat(64));const c=await coin("fake-world-assets-v1",p);
 expect(economicCoinErrors(c)).toEqual([]);
 const changed=structuredClone(c);changed.fundamentals.revenue.components[0].decision!.evidence.literalRegistry!.projectionSha256="f".repeat(64);
 expect(economicCoinErrors(changed)).toContain("unproved economic approval:fake-world-assets-v1:Revenue");
 const excess=structuredClone(c);excess.fundamentals.revenue.components[0].decision!.evidence.receiptHashes.push("f".repeat(64));
 expect(economicCoinErrors(excess)).toContain("unproved economic approval:fake-world-assets-v1:Revenue");
});
