import {expect,it} from "vitest";
import {reconcileRecovery,recoveryDecision,recoveryVerdicts,startRecoveryJournal,withMigrationEvidence,publicRecovery,validateRecovery} from "./freshnessRecovery";
import {collectionHealth} from "./collectionHealth";
import {assembleScreener} from "./screener";
import {sample} from "./testFixtures";
import type {PublicationJournal} from "./publicationTypes";

const root="https://github.com/lovelylov502/crypto-valuation-screener/releases/download/",slotAt="2026-10-07T14:00:00.000Z",startedAt="2026-10-07T16:20:01.874Z";
function legacy():PublicationJournal {
 const id="data-37634378958-1-complete",at="2026-10-07T14:15:32.477Z";
 return {schema:1,id,createdAt:at,trackingStartedAt:"2026-09-29T11:56:17.010Z",previousId:null,previousStateUrl:null,incident:null,recoveredAt:null,
  published:{id,url:root+id+"/data.json.gz",sha256:"a".repeat(64),dataAt:"2026-10-07T14:10:21.165Z",validatedAt:at,publishedAt:"2026-10-07T14:15:33.037Z",codeCommit:"56a300bd0cf7f998d314f35fec2b90e24c5d8efb",reportUrl:root+id+"/report.json",witnessUrl:root+id+"/witness.json.gz",witnessSha256:"b".repeat(64)},
  attempt:{id:"data-37634378958-1",startedAt:"2026-10-07T14:10:13.785Z",completedAt:at,outcome:"published",errors:[],sourceFailures:[],affected:[],affectedProjects:0,changeCount:0,runUrl:"",reportUrl:""}};
}
// Exact first-production migration IDs/times and the faulty already-written slot flags (2026-10-07).
function writtenStart():PublicationJournal {
 const previous=legacy(),id="data-37651128538-1-start",receiptKey="vercel-cron:iad1::wrvqv-1791389968187-cea4fd8174ba";
 const empty={claims:0,completed:0,needed:false,missed:false,interrupted:false};
 return {...previous,schema:2,id,createdAt:startedAt,previousId:previous.id,previousStateUrl:root+previous.id+"/state.json",
  collectionRelease:{writerSchema:2,schedule:"four-daily",phaseADeploymentId:"dpl_9ytRpXsNY5WHE311xmjsmiRG1Poh"},
  attempt:{...previous.attempt,id:"data-37651128538-1",startedAt,completedAt:null,outcome:"running",scheduledFor:slotAt,action:{slotAt,stage:"catchup1",receiptKey,natural:false}},
  recovery:{schema:1,slots:[{slotAt,primary:{...empty,needed:true,missed:true},catchup1:{...empty,claims:1,needed:true},catchup2:{...empty},manualClaims:0,firstPublicationAt:null,deadlineMissed:true,naturalPrimary:false}],obligations:[],receipts:[receiptKey],latestTargetDate:null,transient:false,retryAt:null,legacyAttemptId:previous.attempt.id}};
}
function confirmedLineage() {
 const start=writtenStart(),complete={...structuredClone(start),id:"data-37651128538-1-complete",createdAt:"2026-10-07T16:25:56.458Z",previousId:start.id,previousStateUrl:root+start.id+"/state.json"};
 complete.attempt.outcome="published";complete.attempt.completedAt=complete.createdAt;complete.attempt.comparisonCompleted=true;
 complete.published={...complete.published!,id:complete.id,dataAt:"2026-10-07T16:20:08.489Z",publishedAt:"2026-10-07T16:25:57.143Z"};
 complete.recovery!.slots[0].catchup1.completed=1;complete.recovery!.latestTargetDate="2026-10-06";
 complete.recovery!.obligations=[{key:JSON.stringify(["a","revenue","scope-a","2026-10-06"]),slug:"a",metric:"revenue",identity:"scope-a",date:"2026-10-06",firstMissingAt:complete.published.dataAt,lastCheckedAt:complete.published.dataAt,lastAttemptId:complete.attempt.id,checks:1,disposition:"pending",sources:[]}];
 const confirmed={...structuredClone(complete),id:"data-37651128538-1-confirmed",createdAt:"2026-10-07T16:26:10.799Z",previousId:complete.id,previousStateUrl:root+complete.id+"/state.json"};
 confirmed.recovery!.slots[0].firstPublicationAt=confirmed.createdAt;
 const states=[legacy(),start,complete],read=async(url:string)=>{const state=states.find(j=>url===root+j.id+"/state.json");if(!state)throw Error("Missing immutable state");return state;};
 return {start,complete,confirmed,read};
}
it("first schema2 tracking after an expired primary records legacy provenance, unverified expiry and eligible catch-up without legacy on-time/cycle credit",()=>{
 const previous=legacy(),t={source:"vercel-cron" as const,scheduledFor:slotAt,stage:"catchup1" as const,schedule:"0 16 * * *",requestedAt:startedAt,requestId:"signed-catchup",occurrenceKnown:true,authentication:"verified"};
 const decision=recoveryDecision(previous,Date.parse(startedAt),t);
 expect(decision).toMatchObject({collect:true,stage:"catchup1",naturalCycle:false});
 const journal=startRecoveryJournal(previous,{...writtenStart().attempt,action:{slotAt,stage:"catchup1",receiptKey:decision.receiptKey,natural:false}},"data-first-start",decision);
 expect(journal.recovery!.migration).toMatchObject({startedAt,firstJournalId:journal.id,legacyJournalId:previous.id,legacyPublished:previous.published});
 expect(journal.recovery!.slots[0]).toMatchObject({primary:{claims:0,missed:false,unverified:true},catchup1:{claims:1,needed:true},firstPublicationAt:null,deadlineMissed:false,deadlineUnverified:true,naturalPrimary:false});
 expect(journal.recovery!.slots[0].signedPrimaryAnchor).toBeUndefined();expect(recoveryVerdicts(journal,Date.parse(startedAt))).toMatchObject({collectionDeadlinePassed:false,collectionDeadlineUnverified:true});
});
it("repairs the already-written real first migration flags only with immutable legacy lineage and retains the original journal/slot unchanged",async()=>{
 const start=writtenStart(),original=JSON.stringify(start),j=await withMigrationEvidence(start,async()=>legacy()),r=reconcileRecovery(j,Date.parse("2026-10-07T16:24Z"));
 expect(JSON.stringify(start)).toBe(original);expect(j.recovery!.migration!.correction).toMatchObject({rule:"pre-tracking-expiry",journalId:start.id,journalUrl:root+start.id+"/state.json",originalSlot:{deadlineMissed:true,primary:{missed:true}}});
 expect(r.slots[0]).toMatchObject({deadlineMissed:false,deadlineUnverified:true,primary:{missed:false,unverified:true},catchup1:{needed:true,claims:1,completed:0}});
 expect(r.migration!.legacyPublished!.publishedAt).toBe("2026-10-07T14:15:33.037Z");expect(r.slots[0].firstPublicationAt).toBeNull();
});
it("confirmed ->complete ->start ->legacy lineage keeps real v2 availability/pending dates, corrects only pre-tracking expiry and exposes honest current UI/API verdicts",async()=>{
 const {confirmed,read}=confirmedLineage(),original=JSON.stringify(confirmed),j=await withMigrationEvidence(confirmed,read),now=Date.parse("2026-10-07T16:27Z"),r=publicRecovery(j,now)!;
 expect(JSON.stringify(confirmed)).toBe(original);expect(r.slots[0]).toMatchObject({firstPublicationAt:confirmed.createdAt,deadlineMissed:false,deadlineUnverified:true,naturalPrimary:false,primary:{unverified:true},catchup1:{completed:1}});
 expect(r.obligations).toEqual(confirmed.recovery!.obligations);expect(r.projectionDiagnostics!.deadlineMisses).toBe(0);expect(recoveryVerdicts(j,now)).toMatchObject({collectionDeadlinePassed:false,collectionDeadlineUnverified:true,catchupExecutionPassed:true});
 const paused=publicRecovery(j,Date.parse("2026-10-08T16:27Z"),true)!;expect(paused.slots).toHaveLength(1);expect(paused.slots[0].deadlineMissed).toBe(false);expect(paused.obligations[0].disposition).toBe("overdue");
 const data=assembleScreener([sample()],confirmed.published!.dataAt,[{url:"https://api.llama.fi/overview/fees",observedAt:confirmed.published!.dataAt,status:"ok"}]);data.publication=j;
 expect(collectionHealth(data,now)).toMatchObject({state:"warning",label:"전환 전 기한 미확인",stale:false});
});
it("missing, mismatched or non-initial lineage cannot erase any written miss; a later genuine missed slot remains sticky",async()=>{
 const {confirmed,read}=confirmedLineage();
 expect(await withMigrationEvidence(confirmed,async()=>{throw Error("Unavailable");})).toBe(confirmed);
 expect(await withMigrationEvidence(confirmed,async()=>({...legacy(),id:"data-unrelated"}))).toBe(confirmed);
 const j=await withMigrationEvidence(confirmed,read),future=reconcileRecovery(j,Date.parse("2026-10-07T22:01Z")),next={...j,createdAt:"2026-10-07T22:01:00.000Z",recovery:future};
 expect(future.slots.find(s=>s.slotAt==="2026-10-07T20:00:00.000Z")).toMatchObject({deadlineMissed:true,primary:{missed:true}});
 expect(reconcileRecovery(next,Date.parse("2026-10-08T02:01Z")).slots.find(s=>s.slotAt==="2026-10-07T20:00:00.000Z")).toMatchObject({deadlineMissed:true,primary:{missed:true}});
 expect(recoveryVerdicts(next,Date.parse(next.createdAt))).toMatchObject({collectionDeadlinePassed:false,collectionDeadlineUnverified:false});
});
it("one, two or many skipped wake wrappers use at most two exact start/legacy reads and cannot strand a valid migration correction",async()=>{
 const {confirmed,read}=confirmedLineage();
 for(const count of [1,2,20]) {
  let wrapped=structuredClone(confirmed);
  for(let n=0;n<count;n++)wrapped={...wrapped,id:`data-skipped-${n}-wake`,previousId:wrapped.id,previousStateUrl:root+wrapped.id+"/state.json"};
  const urls:string[]=[],j=await withMigrationEvidence(wrapped,async url=>{urls.push(url);return read(url);});
  expect(urls).toEqual([root+confirmed.attempt.id+"-start/state.json",root+legacy().id+"/state.json"]);
  expect(reconcileRecovery(j,Date.parse("2026-10-07T16:27Z")).slots[0]).toMatchObject({deadlineMissed:false,deadlineUnverified:true,primary:{missed:false,unverified:true}});
  expect(j.recovery!.migration!.correction!.journalId).toBe(wrapped.id);
 }
});
it("an immutable start with a different time, action or legacy identity cannot authorize correction",async()=>{
 const {confirmed,start,read}=confirmedLineage();
 for(const change of ["time","action","legacy","parent","outcome","claims"] as const) {
  const bad=structuredClone(start);
  if(change==="time")bad.attempt.startedAt="2026-10-07T16:21:00.000Z";
  if(change==="action")bad.attempt.action!.natural=true;
  if(change==="legacy")bad.recovery!.legacyAttemptId="data-foreign";
  if(change==="parent")bad.previousStateUrl=root+"data-foreign/state.json";
  if(change==="outcome")bad.attempt.outcome="published";
  if(change==="claims")bad.recovery!.slots[0].catchup1.claims=0;
  expect(await withMigrationEvidence(confirmed,url=>url===root+start.id+"/state.json"?Promise.resolve(bad):read(url))).toBe(confirmed);
 }
});
it("a queued old writer's reasserted pre-migration flags remain readable and project as unverified; claimed/future/malformed markers still fail closed",async()=>{
 const {confirmed,read}=confirmedLineage(),now=Date.parse("2026-10-07T16:27Z"),j=await withMigrationEvidence(confirmed,read);
 j.recovery=reconcileRecovery(j,now);
 // f0e3a97 preserves new metadata, but its old reconciliation reasserts these exact flags.
 j.recovery.slots[0].primary.missed=true;j.recovery.slots[0].deadlineMissed=true;
 const original=JSON.stringify(j);expect(()=>validateRecovery(j,now)).not.toThrow();
 expect(publicRecovery(j,now)!.slots[0]).toMatchObject({primary:{missed:false,unverified:true},deadlineMissed:false,deadlineUnverified:true,naturalPrimary:false});
 expect(recoveryVerdicts(j,now)).toMatchObject({collectionDeadlinePassed:false,collectionDeadlineUnverified:true});expect(JSON.stringify(j)).toBe(original);
 const claimed=structuredClone(j);claimed.recovery!.slots[0].primary.claims=1;expect(()=>validateRecovery(claimed,now)).toThrow("Invalid pre-migration stage");
 const interrupted=structuredClone(j);interrupted.recovery!.slots[0].primary.interrupted=true;expect(()=>validateRecovery(interrupted,now)).toThrow("Invalid pre-migration stage");
 const future={...j,createdAt:"2026-10-07T22:01:00.000Z",recovery:reconcileRecovery(j,Date.parse("2026-10-07T22:01Z"))};
 const s=future.recovery.slots.at(-1)!;expect(s.deadlineMissed).toBe(true);s.deadlineUnverified=true;expect(()=>validateRecovery(future,Date.parse(future.createdAt))).toThrow("Invalid pre-migration deadline");
 s.deadlineUnverified=false;s.primary.unverified=true;expect(()=>validateRecovery(future,Date.parse(future.createdAt))).toThrow("Invalid pre-migration stage");
 const malformed=structuredClone(j);malformed.recovery!.migration!.startedAt="unknown";expect(()=>validateRecovery(malformed,now)).toThrow("Invalid migration boundary");
});
