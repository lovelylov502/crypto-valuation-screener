import {afterEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({journal:null as any}));
vi.mock("./serverScreener",async importOriginal=>({...await importOriginal<typeof import("./serverScreener")>(),getPublication:async()=>state.journal}));
import {GET} from "../app/api/status/route";
import {collectionHealth} from "./collectionHealth";
import {initialRecovery,nextEligibleCheck,recoveryDecision,startRecoveryJournal,updateObligations,type CollectionTrigger} from "./freshnessRecovery";
import {freshnessSummary,type DatedFreshness} from "./datedFreshness";
import {summarizeRevenueHistory} from "./revenueHistory";
import {publicationVerdicts} from "./publicationVerdicts";
import {parseCollectionRelease} from "./pipelineRelease";
import {RULE_VERSION} from "./fundamentals";
import type {PublicationJournal} from "./publicationTypes";
import type {ScreenerResponse} from "./types";
afterEach(()=>{vi.useRealTimers();state.journal=null;});
const at="2026-10-07T02:01:00.000Z",iso=(s:string)=>new Date(s).toISOString();
function data(state:"current"|"pending"|"insufficient"="current"):ScreenerResponse {
 const end=Date.parse("2026-10-06")/1000,p={slug:"a",name:"A",defillamaId:"a"};
 const f=summarizeRevenueHistory([p],[[end-(state==="pending"?1:state==="insufficient"?2:0)*86400,{A:10}]],Date.parse(at),"https://api.llama.fi/overview/fees",undefined,undefined,2).a.freshness!;
 const unsupported:DatedFreshness={...f,state:"unsupported",latestCompleteDate:null,coverage:null,components:[],sources:[]};
 const coins=[{slug:"a",freshness:{revenue:f,holders:unsupported}}] as ScreenerResponse["coins"];
 return {updatedAt:at,scoreVersion:RULE_VERSION,coins,categories:[],marketDataFreshness:{source:"CoinMarketCap",oldestAt:null,newestAt:null,timestampedCoinCount:0},fdvCoverage:0,cmcCoverage:0,verifiedIdentityCount:0,discoveryCandidateCount:0,sources:[{url:"https://api.llama.fi/overview/fees",status:"ok",observedAt:at}],freshness:freshnessSummary(coins,at),
  pipeline:{schema:2,asOf:at,replayVerified:true,rawBundleSha256:"a".repeat(64),normalizedSha256:"b".repeat(64),outputSha256:"c".repeat(64),quality:{affectedProjects:0,issueCount:0}},
  collection:{projects:1,sourceSlugs:1,errors:0,sourceRevenue30d:0,displayedRevenue30d:0,partialRevenue30d:0,marketCap:0,price:0,fdv:0,gecko:{requested:0,received:0,failed:0,notReturned:0},cmc:{requested:0,received:0,failed:0,notReturned:0}}};
}
function journal(d:ScreenerResponse):PublicationJournal {
 const previous={schema:1,id:"data-prior",collectionRelease:{writerSchema:2,schedule:"four-daily",phaseADeploymentId:"dpl_fixture"},createdAt:iso("2026-10-07T01:00Z"),trackingStartedAt:iso("2026-10-07T01:00Z"),previousId:null,previousStateUrl:null,published:null,incident:null,recoveredAt:null,
  attempt:{id:"data-prior",startedAt:iso("2026-10-07T01:00Z"),completedAt:iso("2026-10-07T01:00Z"),outcome:"published",errors:[],sourceFailures:[],affected:[],affectedProjects:0,changeCount:0,runUrl:"",reportUrl:""}} as PublicationJournal;
 const t:CollectionTrigger={source:"vercel-cron",scheduledFor:iso("2026-10-07T02:00Z"),stage:"primary",schedule:null,requestedAt:at,requestId:"signed",occurrenceKnown:true,authentication:"hmac-sha256-verified"},decision=recoveryDecision(previous,Date.parse(at),t);
 const j=startRecoveryJournal(previous,{...previous.attempt,id:"data-now",startedAt:at,completedAt:at,outcome:"running",scheduledFor:decision.slotAt,trigger:t,action:{slotAt:decision.slotAt,stage:decision.stage,receiptKey:decision.receiptKey,natural:true}},"data-now",decision);
 j.attempt.outcome="published";j.attempt.comparisonCompleted=true;j.recovery=updateObligations(j.recovery!,d,j.attempt.id);j.recovery.slots[0].firstPublicationAt=at;j.recovery.slots[0].primary.completed=1;
 j.published={id:"data-publication",dataAt:at,publishedAt:at,validatedAt:at,codeCommit:"a".repeat(40),url:"",reportUrl:"",witnessUrl:"",sha256:"a".repeat(64),witnessSha256:"b".repeat(64)};
 return j;
}
it("same publication ID follows live legacy ->four-daily ->paused status without reload, including cadence/deadline/next-check behavior",()=>{
 const d=data(),j=journal(d);d.publication=j;const now=Date.parse("2026-10-07T09:31Z"),id=j.published!.id;
 j.collectionRelease=parseCollectionRelease({writerSchema:1,schedule:"legacy",phaseADeploymentId:null});
 expect(collectionHealth(d,now)).toMatchObject({stale:false,release:{schedule:"legacy"},schedule:{nextAt:Date.parse("2026-10-07T14:00Z")}});
 j.collectionRelease=parseCollectionRelease({writerSchema:2,schedule:"four-daily",phaseADeploymentId:"dpl_reader"});
 expect(collectionHealth(d,now)).toMatchObject({stale:true,release:{schedule:"four-daily"},schedule:{requiredAt:Date.parse("2026-10-07T08:00Z")}});
 j.collectionRelease=parseCollectionRelease({writerSchema:2,schedule:"paused",phaseADeploymentId:"dpl_reader"});
 expect(collectionHealth(d,now)).toMatchObject({state:"warning",label:"자동 수집 일시 중지",stale:false,scheduledRunMissing:false,schedule:{paused:true}});
 expect(j.published!.id).toBe(id);expect(()=>parseCollectionRelease({writerSchema:1,schedule:"four-daily",phaseADeploymentId:null})).toThrow();
});
it("insufficient-only latest-day absence warns even with clean collection; old holes alone create no supplemental obligation",()=>{
 const d=data("insufficient"),j=journal(d);d.publication=j;
 expect(d.coins[0].freshness!.revenue).toMatchObject({state:"insufficient",targetDate:"2026-10-06",latestCompleteDate:"2026-10-04"});
 expect(collectionHealth(d,Date.parse(at))).toMatchObject({state:"warning",label:"최신 일별 이력 부족"});
 expect(publicationVerdicts(d,Date.parse(at),[])).toMatchObject({freshnessAccountingPassed:true,allApplicableDataCurrent:false});
 expect(j.recovery!.obligations).toEqual([]);expect(nextEligibleCheck(j.recovery!,Date.parse("2026-10-07T04:01Z"))).toBeNull();
});
it("read-only status advances overdue age/UTC target with the same ID and leaves the archived ledger unchanged; exhausted catch-ups promise no further check",async()=>{
 const d=data("pending"),j=journal(d);d.publication=j;state.journal=j;
 j.recovery!.slots[0].catchup1={claims:1,completed:1,needed:true,missed:false,interrupted:false};j.recovery!.slots[0].catchup2={claims:1,completed:1,needed:true,missed:false,interrupted:false};
 const original=JSON.stringify(j),now=Date.parse("2026-10-08T02:02Z");vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
 const status=await (await GET()).json();expect(status.id).toBe(j.id);expect(status.published.id).toBe(j.published!.id);expect(status.publicRecovery.obligations[0]).toMatchObject({disposition:"overdue",firstMissingAt:at});
 expect(status.publicFreshness).toMatchObject({targetDate:"2026-10-07",assessedTargetDate:"2026-10-06",unassessed:true,current:0,pending:0,unknown:1});expect(JSON.stringify(j)).toBe(original);
 expect(publicationVerdicts(d,now,[]).unresolvedDateObligations[0].disposition).toBe("overdue");
 const h=collectionHealth(d,Date.parse("2026-10-07T06:01Z"));expect(h.recovery!.slots[0].catchup2.claims).toBe(1);expect(nextEligibleCheck(h.recovery!,Date.parse("2026-10-07T06:01Z"))).toBeNull();expect(h.summary).not.toContain("다음 보완 수집에서 다시 확인");
});
