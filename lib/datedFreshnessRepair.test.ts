import {expect,it} from "vitest";
import {annotateFreshness,freshnessIdentity} from "./datedFreshness";
import {summarizeRevenueHistory} from "./revenueHistory";
import {initialRecovery,updateObligations,validateRecovery,type DateObligation} from "./freshnessRecovery";
import {sample} from "./testFixtures";
import {ECONOMIC_POLICY_IDENTITY} from "./economicPolicyIdentity";
import type {CoinRaw,ScreenerResponse} from "./types";
import type {PublicationJournal} from "./publicationTypes";

// Captured BIM identities/age from the original 12/14UTC publications; amounts below are synthetic.
const at="2026-10-08T14:12:24.018Z",later="2026-10-08T16:01:00.000Z",end=Date.parse("2026-10-07")/1000,slug="parent#bim";
const semantic="22ba579afa5af2a10c8eb26937999b97aca05b8bd45aa1b94a17a8caa827de8c",physical="30f00ebe707fd63b25ed794397d0ed46920df79c912c6ef47a302c9bbd679d1a",legacy="23ef998491bd6c459fa5d2ba0e991ada53a8c4377120df84a6a15a7f4d047de7",hash="a".repeat(64);
function bim(complete=false):CoinRaw {
 const row={slug:"bim-yield",name:"BIM Yield",defillamaId:"6402",parentProtocol:slug};
 const chart=Array.from({length:30},(_,i)=>[end-i*86400,{...(i===0&&!complete?{}:{"BIM Yield":10})}]);
 const history=summarizeRevenueHistory([row],chart,Date.parse(at),"overview",new Map([[slug,{fingerprint:semantic,physicalFingerprint:physical}]]),[row],2)[slug];
 history.freshness!.coverageBasis="exact_parent";
 const fundamentals=structuredClone(sample().fundamentals);fundamentals.economicPolicy=ECONOMIC_POLICY_IDENTITY;fundamentals.revenue={...fundamentals.revenue,fingerprint:semantic,physicalFingerprint:physical,legacyPhysicalFingerprint:legacy};
 return sample({slug,fundamentals,revenueHistory:history,dataQuality:{state:"complete",issues:[]}});
}
function capturedBaseline() {
 const old=bim();old.revenueHistory!.freshness!.definition=semantic;
 return data(annotateFreshness([old],at));
}
function data(coins:CoinRaw[],updatedAt=at):ScreenerResponse {
 return {coins,updatedAt,pipeline:{schema:2,asOf:updatedAt,rawBundleSha256:hash}} as ScreenerResponse;
}
function priorObligation(baseline:ScreenerResponse):DateObligation {
 const identity=freshnessIdentity(baseline.coins[0].freshness!.revenue);
 return {key:JSON.stringify([slug,"revenue",identity,"2026-10-07"]),slug,metric:"revenue",identity,date:"2026-10-07",firstMissingAt:"2026-10-08T01:00:02.798Z",lastCheckedAt:at,lastAttemptId:"actual14",checks:4,disposition:"pending",sources:["overview"],
  failedEvidence:[{manifestUrl:"https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-37740946079-1-failed-observation/failed-evidence.json",manifestSha256:"60cf99e299f0e44ada70893191fc9fbb7474ec9e999176899b7e4db20b6a147e"}],
  identityMigration:{from:JSON.stringify([slug,legacy,["bim-yield@6402"]]),at:"2026-10-08T10:51:37.656Z",rawBundleSha256:"3a35faeb3a2313e09898b407c17db991c8032251002654cf910609206c3c204e",basis:"identical-captured-legacy-metadata"}};
}
function state(baseline:ScreenerResponse){return {...initialRecovery(),obligations:[priorObligation(baseline)]};}
it("BIM pending repair migrates one original obligation without resetting age/evidence, then only real day arrival resolves it",()=>{
 const baseline=capturedBaseline(),original=state(baseline),current=annotateFreshness([bim()],at,baseline),f=current[0].freshness!.revenue;
 expect(f.state).toBe("pending");expect(f.parentIdentityAlias).toEqual({identity:original.obligations[0].identity,basis:"identical-captured-parent-metadata"});
 expect(f.legacyIdentityAlias?.identity).toBe(original.obligations[0].identityMigration!.from);
 const checked=updateObligations(original,data(current),"repair");expect(checked.obligations).toHaveLength(1);
 expect(checked.obligations[0]).toMatchObject({identity:freshnessIdentity(f),firstMissingAt:original.obligations[0].firstMissingAt,checks:5,disposition:"pending",failedEvidence:original.obligations[0].failedEvidence,identityMigration:original.obligations[0].identityMigration,parentIdentityMigration:{from:original.obligations[0].identity,at,rawBundleSha256:hash,basis:"identical-captured-parent-metadata"}});
 const arrived=annotateFreshness([bim(true)],later,data(current)),resolved=updateObligations(checked,data(arrived,later),"real-day-arrival");
 expect(resolved.obligations).toHaveLength(1);expect(resolved.obligations[0]).toMatchObject({firstMissingAt:original.obligations[0].firstMissingAt,checks:6,disposition:"resolved",failedEvidence:original.obligations[0].failedEvidence,identityMigration:original.obligations[0].identityMigration,parentIdentityMigration:checked.obligations[0].parentIdentityMigration});
 expect(original.obligations[0].identity).toBe(f.parentIdentityAlias!.identity);expect(original.obligations[0].checks).toBe(4);
 const journal={schema:2,createdAt:later,attempt:{startedAt:at},recovery:resolved} as PublicationJournal;
 expect(()=>validateRecovery(journal,Date.parse(later))).not.toThrow();
 for(const patch of [{basis:"unknown"},{at:"2026-10-09T00:00:00Z"},{rawBundleSha256:"unknown"}]){const bad=structuredClone(journal);Object.assign(bad.recovery!.obligations[0].parentIdentityMigration!,patch);expect(()=>validateRecovery(bad,Date.parse(later))).toThrow("Invalid date obligation");}
});
it.each(["physical","components","scope","baseline-form","semantic","annotation","missing-baseline"])("%s drift cannot alias or resolve the old parent obligation",problem=>{
 const baseline=capturedBaseline(),original=state(baseline),current=bim(true);
 if(problem==="physical"){current.fundamentals.revenue.physicalFingerprint="b".repeat(64);current.revenueHistory!.freshness!.definition="b".repeat(64);}
 if(problem==="components")current.revenueHistory!.freshness!.components[0].id="different-component@6402";
 if(problem==="scope")current.revenueHistory!.freshness!.scope="parent#other";
 if(problem==="baseline-form")baseline.coins[0].revenueHistory!.freshness!.coverageBasis="components";
 if(problem==="semantic")current.revenueHistory!.definitionFingerprint="different-semantic-series";
 if(problem==="annotation")baseline.coins[0].freshness!.revenue.definition="unproved-prior-identity";
 const repaired=annotateFreshness([current],later,problem==="missing-baseline"?undefined:baseline);
 expect(repaired[0].freshness!.revenue.parentIdentityAlias).toBeUndefined();
 const next=updateObligations(original,data(repaired,later),"different-series");expect(next.obligations).toHaveLength(1);expect(next.obligations[0]).toMatchObject({identity:original.obligations[0].identity,firstMissingAt:original.obligations[0].firstMissingAt,disposition:"pending"});
});
it("a genuine quality conflict permits proved identity bookkeeping but cannot resolve a covered date",()=>{
 const baseline=capturedBaseline(),original=state(baseline),current=bim(true);current.dataQuality={state:"partial",issues:[{scope:"revenue",code:"value_conflict",source:"parent",retryable:false}]};
 const repaired=annotateFreshness([current],later,baseline);expect(repaired[0].freshness!.revenue.state).toBe("conflict");
 const next=updateObligations(original,data(repaired,later),"conflicting-day");expect(next.obligations).toHaveLength(1);expect(next.obligations[0]).toMatchObject({firstMissingAt:original.obligations[0].firstMissingAt,disposition:"pending",identityMigration:original.obligations[0].identityMigration,parentIdentityMigration:{from:original.obligations[0].identity}});
});
