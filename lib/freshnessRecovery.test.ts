import { afterEach,expect,it,vi } from "vitest";
import { gzipSync } from "node:zlib";
import registry from "./fundamentalDefinitions.json";
import { captureDataPipeline,encodeSourceBundle,replayDataPipeline } from "./dataPipeline";
import { completedUtcDate,dateIsComplete,publicFreshness } from "./datedFreshness";
import { summarizeRevenueHistory } from "./revenueHistory";
import { protocolMultiple } from "./valuationMetrics";
import { compactRecoveryJournal,finishRecoveryJournal,confirmPublicationAvailability,fourDailySlot,initialRecovery,reconcileRecovery,recoveryDecision,recoveryVerdicts,stageWindow,startRecoveryJournal,updateObligations,type CollectionTrigger } from "./freshnessRecovery";
import { decodeSnapshot,parseJournal,sha256 } from "./snapshotArchive";
import { collectionHealth } from "./collectionHealth";
import { queryScreener } from "./screenerQuery";
import { defaultPreferences } from "./workspacePreferences";
import { publicationVerdicts } from "./publicationVerdicts";
import { stageSchedulerReceipt,signSchedulerReceipt,verifySchedulerReceipt,FOUR_DAILY_CRONS } from "./schedulerDispatch";
import { assertPhaseAProof,phaseBFiles } from "../scripts/prepare-freshness-release.mjs";
import {fetchHolderHistory,HOLDER_HISTORY_URL} from "./holderHistorySource";
import {captureSourceBundle,sourceObservedAt} from "./sourceBundle";
import {scheduledAcceptance,type AcceptanceWindow} from "./scheduledAcceptance";
import type { CollectionAttempt,PublicationJournal,PublishedSnapshot } from "./publicationTypes";
import type { ScreenerResponse } from "./types";

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const iso=(s:string)=>new Date(s).toISOString();
function prior():PublicationJournal { const at=iso("2026-10-07T01:00Z");return {schema:2,id:"data-prior",recovery:{...initialRecovery(),legacyAttemptId:"data-prior",migration:{startedAt:at,firstJournalId:"data-prior",legacyJournalId:"data-seed",legacyPublished:null}},collectionRelease:{writerSchema:2,schedule:"four-daily",phaseADeploymentId:"dpl_fixture"},createdAt:at,trackingStartedAt:at,previousId:null,previousStateUrl:null,published:null,incident:null,recoveredAt:null,
  attempt:{id:"data-prior",startedAt:at,completedAt:at,outcome:"published",errors:[],sourceFailures:[],affected:[],affectedProjects:0,changeCount:0,runUrl:"",reportUrl:""}}; }
function trigger(at:string,stage:"primary"|"catchup1"|"catchup2"="primary",id=at):CollectionTrigger { return {source:"vercel-cron",schedule:null,scheduledFor:iso("2026-10-07T02:00Z"),stage,requestedAt:iso(at),requestId:id,occurrenceKnown:true,authentication:"hmac-sha256-verified"}; }
function claim(previous:PublicationJournal,at:string,t=trigger(at),manual=false) {
  const d=recoveryDecision(previous,Date.parse(at),t,manual);
  const a:CollectionAttempt={...previous.attempt,id:`data-${at.replace(/[^0-9]/g,"")}`,startedAt:iso(at),completedAt:null,outcome:"running",errors:[],sourceFailures:[],manualRepair:manual,scheduledFor:d.slotAt,
    trigger:t,action:{slotAt:d.slotAt,stage:d.stage,receiptKey:d.receiptKey,natural:d.naturalCycle}};
  return startRecoveryJournal(previous,a,a.id+"-start",d);
}
function upstream(at:string,latestPresent:boolean) {
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(at));
  const p={slug:"aave-v2",name:"Aave V2",defillamaId:"aave-v2",gecko_id:"aave",symbol:"AAVE",methodology:registry["aave-v2"].methodology,total24h:10,total7d:70,total30d:300};
  const end=Date.parse(completedUtcDate(Date.parse(at)))/1000;
  const chart=Array.from({length:30},(_,i)=>[end-i*86400,{...(i===0&&!latestPresent?{}:{"Aave V2":10})}]);
  const fetcher=vi.fn(async(input:string|URL|Request)=>{
    const u=new URL(String(input));
    const body=u.hostname==="stablecoins.llama.fi"?{peggedAssets:[{symbol:"USDT",gecko_id:"tether"}]}
      :u.hostname.includes("coinmarketcap.com")?{data:[{id:9999,slug:"unrelated",name:"Unrelated",symbol:"UNR"}]}
      :u.hostname.includes("coingecko")?[{id:"aave",symbol:"aave",current_price:1,market_cap:1000000,last_updated:iso(at)}]
      :u.pathname==="/protocols"?[p]
      :u.pathname==="/config"?{parentProtocols:[{id:"parent#other",name:"Other"}]}
      :u.pathname==="/summary/fees/aave-v2"?{...p,totalDataChart:chart.filter(x=>(x[1] as Record<string,number>)["Aave V2"]!==undefined).map(x=>[x[0],10])}
      :u.searchParams.get("dataType")==="dailyRevenue"?{protocols:[p],totalDataChartBreakdown:chart}
      :{protocols:[{slug:p.slug,name:p.name,defillamaId:p.defillamaId}],totalDataChartBreakdown:[]};
    return Response.json(body);
  });
  vi.stubGlobal("fetch",fetcher);return fetcher;
}
function published(data:ScreenerResponse,id="data-fixture-complete"):PublishedSnapshot {
  const root=`https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${id}/`;
  return {id,url:root+"data.json.gz",dataAt:data.updatedAt,validatedAt:data.updatedAt,publishedAt:data.updatedAt,codeCommit:"test",reportUrl:root+"report.json",witnessUrl:root+"witness.json.gz",witnessSha256:"a".repeat(64),sha256:sha256(gzipSync(JSON.stringify(data))),rawBundleUrl:root+"source-bundle.json.gz",rawBundleSha256:data.pipeline!.rawBundleSha256,normalizedSha256:data.pipeline!.normalizedSha256,replayVerified:true};
}
function finish(j:PublicationJournal,data:ScreenerResponse,completedAt:string) {
  return confirmPublicationAvailability(finishRecoveryJournal(j,{...j.attempt,completedAt:iso(completedAt),outcome:"published",comparisonCompleted:true},published(data,j.attempt.id+"-complete"),j.attempt.id+"-complete",data),iso(completedAt),j.attempt.id+"-confirmed");
}

it("HTTP 200 late daily history publishes safely, schedules automatic catch-up, and restores 30/30 with the reviewed multiple",async()=>{
  const at="2026-10-07T02:01Z";upstream(at,false);
  const primary=claim(prior(),at);
  const first=await captureDataPipeline(null,iso(at),async()=>{},[],2);
  const row=first.data.coins.find(c=>c.slug==="aave-v2")!;
  expect(row.dataQuality?.state).toBe("complete");expect(row.freshness?.revenue).toMatchObject({state:"pending",targetDate:"2026-10-06",latestCompleteDate:"2026-10-05",missingRecentDates:["2026-10-06"]});
  expect(row.revenueHistory?.periods[30]).toMatchObject({reportedDays:29,total:null});expect(protocolMultiple(row,30)).toBeNull();
  const journal=finish(primary,first.data,"2026-10-07T02:04Z");expect(journal.recovery?.obligations).toHaveLength(1);
  const checkAt="2026-10-07T04:01Z",catchup=trigger(checkAt,"catchup1","catchup-one");
  expect(recoveryDecision(journal,Date.parse(checkAt),catchup)).toMatchObject({collect:true,reason:"pending-catchup"});
  const collecting=claim(journal,checkAt,catchup);upstream(checkAt,true);
  const late=await captureDataPipeline(first.data,iso(checkAt),async()=>{},[],2);
  const restored=late.data.coins.find(c=>c.slug==="aave-v2")!;
  expect(restored.revenueHistory?.periods[30]).toMatchObject({reportedDays:30,total:300});expect(protocolMultiple(restored,30)).toBeCloseTo(1000000/(300*365/30));
  const done=finish(collecting,late.data,"2026-10-07T04:05Z");expect(done.recovery?.obligations[0]).toMatchObject({disposition:"resolved",firstMissingAt:iso(at),checks:2});
  expect(done.recovery!.slots[0]).toMatchObject({firstPublicationAt:iso("2026-10-07T02:04Z"),deadlineMissed:false,naturalPrimary:true});
  expect(recoveryDecision(done,Date.parse("2026-10-07T04:06Z"),{...catchup,requestId:"second-catchup"}).reason).toBe("stage-budget-exhausted");
  vi.stubGlobal("fetch",()=>{throw new Error("No network allowed");});expect(await replayDataPipeline(late.bundle,sha256(encodeSourceBundle(late.bundle)))).toEqual(late.data);
  expect(decodeSnapshot(gzipSync(JSON.stringify(late.data)),published(late.data))).toEqual(late.data);
  const prefs=defaultPreferences();prefs.search="other";const page=queryScreener(first.data,prefs,["aave-v2"]);
  expect(page.coins).toHaveLength(1);expect(page.freshness?.pending).toBe(1);expect(page.pagination.favorites).toBe(1);
  expect(Buffer.byteLength(JSON.stringify(queryScreener(late.data,defaultPreferences(),[],1,200)))).toBeLessThan(4_500_000);
  expect(publicationVerdicts({...first.data,publication:journal},Date.parse("2026-10-07T04:02Z"),[])).toMatchObject({integrityPassed:true,freshnessAccountingPassed:true,allApplicableDataCurrent:false,collectionDeadlinePassed:true});
});
it("validation before deadline earns no availability credit when promotion/readback arrives after90 minutes",async()=>{
 const at="2026-10-07T03:25Z";upstream(at,false);const data=(await captureDataPipeline(null,iso(at),async()=>{},[],2)).data,j=claim(prior(),at);
 const completed=finishRecoveryJournal(j,{...j.attempt,completedAt:iso("2026-10-07T03:29:50Z"),outcome:"published",comparisonCompleted:true},published(data),"data-validation-complete",data);
 expect(completed.recovery!.slots[0]).toMatchObject({firstPublicationAt:null,naturalPrimary:false,deadlineMissed:false});
 const confirmed=confirmPublicationAvailability(completed,iso("2026-10-07T03:32Z"),"data-promotion-confirmed");
 expect(confirmed.recovery!.slots[0]).toMatchObject({firstPublicationAt:iso("2026-10-07T03:32Z"),naturalPrimary:false,deadlineMissed:true});
 expect(recoveryVerdicts(confirmed,Date.parse("2026-10-07T03:32Z")).collectionDeadlinePassed).toBe(false);
});

it("a fully clean 20 UTC capture gains midnight acquisition eligibility with zero pending; status changes without mutating its archive or ID",async()=>{
  const at="2026-10-07T20:01Z";upstream(at,true);const data=(await captureDataPipeline(null,iso(at),async()=>{},[],2)).data;
  const t={...trigger(at),scheduledFor:iso("2026-10-07T20:00Z")},j=finish(claim(prior(),at,t),data,"2026-10-07T20:04Z");
  expect(j.recovery?.obligations).toEqual([]);
  const before=JSON.stringify(data),id=j.published?.id,now=Date.parse("2026-10-08T00:01Z");
  expect(publicFreshness(data.freshness,now)).toMatchObject({targetDate:"2026-10-07",assessedTargetDate:"2026-10-06",unassessed:true});
  expect(publicFreshness(data.freshness,now)).toMatchObject({current:0,pending:0,insufficient:0,conflict:0,unknown:data.freshness!.current+data.freshness!.pending+data.freshness!.insufficient+data.freshness!.unknown+data.freshness!.conflict});
  expect(recoveryDecision(j,now,{...t,stage:"catchup2",requestId:"midnight"})).toMatchObject({collect:true,reason:"date-rollover",slotAt:iso("2026-10-07T20:00Z")});
  expect(collectionHealth({...data,publication:j},now).label).toBe("새 완료일 확인 대기");expect(JSON.stringify(data)).toBe(before);expect(j.published?.id).toBe(id);
});

it("component freshness uses the actual common complete set, preserves zero/negative days, and excludes unfinished UTC days",()=>{
  const at=Date.parse("2026-10-07T02:00Z"),end=Date.parse("2026-10-06")/1000;
  const ps=[{slug:"a",name:"A",defillamaId:"1",parentProtocol:"parent#p"},{slug:"b",name:"B",defillamaId:"2",parentProtocol:"parent#p"}];
  const h=summarizeRevenueHistory(ps,[[end,{A:0}],[end-86400,{B:1}],[end-2*86400,{A:-1,B:0}],[end+86400,{A:100,B:100}]],at,"source",undefined,undefined,2)["parent#p"];
  expect(h.freshness).toMatchObject({state:"insufficient",latestCompleteDate:"2026-10-04"});expect(dateIsComplete(h.freshness!,"2026-10-06")).toBe(false);expect(dateIsComplete(h.freshness!,"2026-10-04")).toBe(true);
  expect(h.periods[1].total).toBeNull();expect(h.freshness?.components).toHaveLength(2);
  const zero=summarizeRevenueHistory([ps[0]],[[end,{A:0}],[end-86400,{A:-1}]],at,"source",undefined,undefined,2)["parent#p"];
  expect(zero.freshness?.state).toBe("current");expect(zero.periods[1].total).toBe(0);
});

it("expired known receipts, duplicate dispatch, setup delay and ambiguous GitHub wakes cannot steal later stages or natural credit",()=>{
  const at="2026-10-07T02:01Z",j=claim(prior(),at),original=trigger(at);
  expect(recoveryDecision(j,Date.parse("2026-10-07T02:02Z"),original).reason).toBe("duplicate-receipt");
  expect(recoveryDecision(j,Date.parse("2026-10-07T04:00Z"),original).reason).toBe("expired-stage");
  expect(recoveryDecision(j,Date.parse("2026-10-07T09:00Z"),original)).toMatchObject({collect:false,reason:"expired-stage",stage:"primary",slotAt:iso("2026-10-07T02:00Z")});
  const wake:CollectionTrigger={...original,source:"github-recovery-wake",occurrenceKnown:false,scheduledFor:null,stage:null,requestId:"delayed-7h",authentication:"github-native-occurrence-unknown"};
  const d=recoveryDecision(j,Date.parse("2026-10-07T09:00Z"),wake);expect(d).toMatchObject({collect:true,slotAt:iso("2026-10-07T08:00Z"),stage:"primary"});
  const a={...j.attempt,id:"data-new",startedAt:iso("2026-10-07T10:00Z"),action:{slotAt:d.slotAt,stage:d.stage,receiptKey:d.receiptKey,natural:false}};
  expect(()=>startRecoveryJournal(j,a,"data-new-start",d)).toThrow("expired before claim");
  expect(recoveryVerdicts(j,Date.parse("2026-10-07T09:00Z"))).toMatchObject({collectionDeadlinePassed:false,catchupExecutionPassed:false});
});

it("leases span slots, expired crash allowances survive, primary and catch-up budgets are independent, and manual repairs report separately",()=>{
  const t={...trigger("2026-10-07T07:55Z","catchup2"),requestId:"cross-slot"};
  const j=claim(prior(),"2026-10-07T07:55Z",t);
  const wake={...t,source:"github-recovery-wake" as const,occurrenceKnown:false,scheduledFor:null,stage:null,requestId:"next-slot"};
  expect(recoveryDecision(j,Date.parse("2026-10-07T08:01Z"),wake).reason).toBe("running");
  const next=recoveryDecision(j,Date.parse("2026-10-07T08:11Z"),wake);expect(next.reason).toBe("awaiting-signed-primary");expect(next.recovery.slots.find(s=>s.slotAt===t.scheduledFor)?.catchup2.interrupted).toBe(true);
  const complete={...j,schema:2 as const,attempt:{...j.attempt,outcome:"blocked" as const,completedAt:iso("2026-10-07T07:57Z")},recovery:{...j.recovery!,transient:true}};
  expect(recoveryDecision(complete,Date.parse("2026-10-07T09:01Z"),wake).collect).toBe(true);
  const manual=claim(complete,"2026-10-07T08:01Z",{...wake,source:"manual",requestId:"repair"},true);expect(manual.recovery!.slots.at(-1)?.manualClaims).toBe(1);expect(manual.recovery!.slots.at(-1)?.primary.claims).toBe(0);
});
it("three failed primary captures retain independent one-attempt catch-ups and exactly two separately budgeted manual repairs",()=>{
 let j=prior();
 const block=(claimed:PublicationJournal,at:string)=>finishRecoveryJournal(claimed,{...claimed.attempt,outcome:"blocked",completedAt:iso(at),failureClass:"transient",comparisonCompleted:false,errors:["timeout"]},null,claimed.attempt.id+"-blocked");
 for(const [start,end] of [["02:01","02:02"],["02:08","02:09"],["02:15","02:16"]])j=block(claim(j,`2026-10-07T${start}Z`,trigger(`2026-10-07T${start}Z`)),`2026-10-07T${end}Z`);
 expect(recoveryDecision(j,Date.parse("2026-10-07T02:30Z"),trigger("2026-10-07T02:30Z")).reason).toBe("stage-budget-exhausted");
 j=block(claim(j,"2026-10-07T04:01Z",trigger("2026-10-07T04:01Z","catchup1")),"2026-10-07T04:02Z");
 expect(recoveryDecision(j,Date.parse("2026-10-07T04:10Z"),trigger("2026-10-07T04:10Z","catchup1")).reason).toBe("stage-budget-exhausted");
 j=block(claim(j,"2026-10-07T06:01Z",trigger("2026-10-07T06:01Z","catchup2")),"2026-10-07T06:02Z");
 for(const start of ["06:10","06:20"])j=block(claim(j,`2026-10-07T${start}Z`,{...trigger(`2026-10-07T${start}Z`,"catchup2"),source:"manual",occurrenceKnown:false,scheduledFor:null,stage:null},true),`2026-10-07T${start}:30Z`);
 const s=j.recovery!.slots[0];expect([s.primary.claims,s.catchup1.claims,s.catchup2.claims,s.manualClaims]).toEqual([3,1,1,2]);
 expect(recoveryDecision(j,Date.parse("2026-10-07T06:30Z"),{...trigger("2026-10-07T06:30Z"),source:"manual",occurrenceKnown:false,scheduledFor:null,stage:null},true).reason).toBe("manual-budget-exhausted");
});
it("raw holder freshness independently retains exact-parent day/provenance despite economic withholding",async()=>{
 const at="2026-10-07T02:00:00.000Z",end=Date.parse("2026-10-06")/1000;
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(at);
 const p={slug:"raw-child",name:"Raw Child",defillamaId:"raw-id",parentProtocol:"parent#raw",linkedProtocols:["Raw Parent"],methodology:{HoldersRevenue:"Unreviewed raw distribution"},total30d:300};
 const parentUrl="https://api.llama.fi/summary/fees/raw-parent?dataType=dailyHoldersRevenue";
 const network=vi.fn(async(url:any)=>{
  const body=String(url)===HOLDER_HISTORY_URL?{protocols:[p],totalDataChartBreakdown:[[end-86400,{"Raw Child":10}]]}
   :String(url)===parentUrl?{defillamaId:"parent#raw",childProtocols:[p],totalDataChart:[[end-86400,10],[end,10]]}
   :{...p,totalDataChart:[[end-86400,10]]};
  vi.setSystemTime(new Date(Date.now()+1000));return Response.json(body);
 });vi.stubGlobal("fetch",network);
 const captured=await captureSourceBundle(at,null,()=>fetchHolderHistory([]),undefined,2);
 expect(captured.error).toBeUndefined();const h=captured.value!["parent#raw"];
 expect(h.periods[1].total).toBeNull();expect(h.rawFreshness).toMatchObject({state:"current",targetDate:"2026-10-06",latestCompleteDate:"2026-10-06",coverageBasis:"exact_parent"});
 expect(h.rawFreshness?.sources).toContain(parentUrl);expect(h.rawFreshness?.components[0].targetPresent).toBe(false);
 expect(Date.parse(h.rawFreshness!.observedAt)).toBeGreaterThan(Date.parse(at));
});

it("new slots preserve 24-hour age, definition changes preserve versioned lineage, and missed stages/deadlines stay failed",async()=>{
  upstream("2026-10-07T02:01Z",false);const data=(await captureDataPipeline(null,iso("2026-10-07T02:01Z"),async()=>{},[],2)).data;
  const r=updateObligations(initialRecovery(),data,"data-first"),aged=structuredClone(data);aged.updatedAt=iso("2026-10-08T02:02Z");
  const checked=updateObligations(r,aged,"data-later");expect(checked.obligations[0]).toMatchObject({disposition:"overdue",firstMissingAt:iso("2026-10-07T02:01Z")});
  aged.coins.find(c=>c.slug==="aave-v2")!.freshness!.revenue.definition="changed";
  const changed=updateObligations(checked,aged,"data-changed").obligations[0];
  // Legacy history used supersession; a new-policy scope change cannot retire an unproved dated obligation.
  expect(changed.disposition).toBe(aged.pipeline?.economicPolicy?"overdue":"superseded");
  expect(changed.firstMissingAt).toBe(checked.obligations[0].firstMissingAt);
  upstream("2026-10-07T03:35Z",false);const late=(await captureDataPipeline(null,iso("2026-10-07T03:35Z"),async()=>{},[],2)).data;
  const j=finish(claim(prior(),"2026-10-07T03:35Z",trigger("2026-10-07T03:35Z")),late,"2026-10-07T03:40Z");expect(j.recovery!.slots[0].deadlineMissed).toBe(true);
  const next=reconcileRecovery(j,Date.parse("2026-10-07T06:02Z"));expect(next.slots[0].catchup1.missed).toBe(true);
  const done={...j,recovery:{...next,obligations:r.obligations}};
  expect(recoveryVerdicts(done,Date.parse("2026-10-07T06:02Z"))).toEqual({collectionDeadlinePassed:false,collectionDeadlineUnverified:false,catchupExecutionPassed:false});
  expect(()=>recoveryDecision(null,Date.now(),trigger("2026-10-07T02:01Z"))).toThrow();
  expect(()=>parseJournal({...done,recovery:{...done.recovery,slots:[{...next.slots[0],catchup1:{...next.slots[0].catchup1,claims:2}}]}})).toThrow("stage allowance");
});

it("all twelve concrete Vercel stage occurrences retain original identity and signed expiry becomes an accountable skip",()=>{
  const secret="test-only-scheduler-secret-32-characters";
  expect(FOUR_DAILY_CRONS).toHaveLength(12);
  for(const c of FOUR_DAILY_CRONS) {
    const hour=Number(c.schedule.split(" ")[1]),now=Date.parse("2026-10-07")+hour*3600000+59000;
    const receipt=stageSchedulerReceipt(c.schedule,c.stage,now,"test-receipt-12345"),text=JSON.stringify(receipt),signature=signSchedulerReceipt(text,secret);
    expect(verifySchedulerReceipt(text,signature,secret,now+7*3600000)).toEqual(receipt);
    const slot=Date.parse(receipt.scheduledFor);expect(fourDailySlot(slot)).toBe(slot);expect(now).toBeGreaterThanOrEqual(stageWindow(slot,c.stage).start);expect(now).toBeLessThan(stageWindow(slot,c.stage).end);
  }
});

it("Phase B refuses stale/preview/incompatible identities and prepares actual bounded wakes only from exact canonical Phase A proof",()=>{
  const commit="a".repeat(40),proof={base:"https://crypto-valuation-screener.vercel.app",compatibility:{release:"four-daily-freshness-v2",pipelineSchemas:[1,2],journalSchemas:[1,2]},collectionRelease:{writerSchema:1,schedule:"legacy",phaseADeploymentId:null},deployment:{environment:"production",codeCommit:commit,id:"dpl_12345",url:"https://crypto-valuation-screener-reader-vercel.vercel.app"}};
  const accepted=assertPhaseAProof(proof,commit);
  for(const bad of [{...proof,base:"https://preview.vercel.app"},{...proof,deployment:{...proof.deployment,environment:"preview"}},{...proof,deployment:{...proof.deployment,codeCommit:"b".repeat(40)}},{...proof,compatibility:{...proof.compatibility,journalSchemas:[1]}}]) expect(()=>assertPhaseAProof(bad,commit)).toThrow();
  const files=phaseBFiles({writerSchema:1,schedule:"legacy",phaseA:null},"on:\n  schedule:\n    - cron: old\n  workflow_dispatch:\n",accepted);
  expect(files.vercel.crons).toHaveLength(12);expect(files.workflow).toContain('cron: "0 0,6,12,18 * * *"');expect(files.contract).toMatchObject({writerSchema:2,schedule:"four-daily"});
});

it("compaction bounds public slot metadata and preserves retired failures and unresolved ages in an immutable history asset",()=>{
  const j=claim(prior(),"2026-10-07T02:01Z");j.createdAt=iso("2026-11-07T02:01Z");j.recovery=reconcileRecovery(j,Date.parse(j.createdAt));
  const c=compactRecoveryJournal(j);expect(c.journal.recovery!.slots).toHaveLength(17);expect(c.journal.recovery!.history!.deadlineMisses).toBeGreaterThan(90);expect(c.history?.byteLength).toBeGreaterThan(0);
  expect(()=>parseJournal(c.journal)).not.toThrow();
  expect(JSON.parse(new TextDecoder().decode(c.history)).slots.length).toBeGreaterThan(90);expect(Buffer.byteLength(JSON.stringify(c.journal))).toBeLessThan(25_000);
  expect(recoveryVerdicts(c.journal,Date.parse(j.createdAt)).collectionDeadlinePassed).toBe(false);
});

it("reserves an unanchored primary for signed dispatch until60m; an automatic retry inherits real signed cycle proof without changing its unknown trigger",async()=>{
 const at="2026-10-07T02:31Z",wake:CollectionTrigger={...trigger(at),source:"github-recovery-wake",scheduledFor:null,stage:null,occurrenceKnown:false,requestId:"native-first",authentication:"github-native-occurrence-unknown"};
 expect(recoveryDecision(prior(),Date.parse(at),wake)).toMatchObject({collect:false,reason:"awaiting-signed-primary",naturalCycle:false});
 expect(recoveryDecision(prior(),Date.parse("2026-10-07T03:00Z"),wake)).toMatchObject({collect:true,naturalCycle:false});
 const signed=claim(prior(),"2026-10-07T02:01Z");
 const failed=finishRecoveryJournal(signed,{...signed.attempt,outcome:"blocked",completedAt:iso("2026-10-07T02:02Z"),failureClass:"transient",errors:["timeout"],comparisonCompleted:false},null,"data-failed");
 expect(recoveryDecision(failed,Date.parse(at),wake)).toMatchObject({collect:true,naturalCycle:true});
 upstream(at,true);const data=(await captureDataPipeline(null,iso(at),async()=>{},[],2)).data;
 const retry=claim(failed,at,wake),done=finish(retry,data,"2026-10-07T02:35Z");
 expect(done.attempt.trigger).toMatchObject({source:"github-recovery-wake",occurrenceKnown:false});expect(done.recovery!.slots[0]).toMatchObject({naturalPrimary:true,signedPrimaryAnchor:{attemptId:signed.attempt.id},cyclePublication:{attemptId:retry.attempt.id}});
});

it("on-time unknown-origin success followed by a signed skip receives no retrospective cycle credit or false deadline miss, including retired metadata",async()=>{
 const at="2026-10-07T03:00Z",wake:CollectionTrigger={...trigger(at),source:"github-recovery-wake",scheduledFor:null,stage:null,occurrenceKnown:false,requestId:"native-wins",authentication:"github-native-occurrence-unknown"};
 upstream(at,true);const data=(await captureDataPipeline(null,iso(at),async()=>{},[],2)).data;
 const j=finish(claim(prior(),at,wake),data,"2026-10-07T03:04Z");
 const d=recoveryDecision(j,Date.parse("2026-10-07T03:05Z"),trigger("2026-10-07T03:05Z"));expect(d).toMatchObject({collect:false,reason:"no-pending-work"});
 expect(j.recovery!.slots[0]).toMatchObject({deadlineMissed:false,naturalPrimary:false});expect(j.recovery!.slots[0].signedPrimaryAnchor).toBeUndefined();
 expect(recoveryVerdicts(j,Date.parse("2026-10-07T03:31Z")).collectionDeadlinePassed).toBe(true);
 const later={...j,id:"data-later",createdAt:iso("2026-10-12T02:01Z"),recovery:reconcileRecovery(j,Date.parse("2026-10-12T02:01Z"))};
 // Simulate a newer owned attempt so the original slot can be retired.
 const owned=later.recovery.slots.at(-1)!;owned.primary.claims=1;later.attempt={...j.attempt,id:"data-owned",startedAt:later.createdAt,completedAt:later.createdAt,scheduledFor:owned.slotAt,action:{slotAt:owned.slotAt,stage:"primary",receiptKey:"github-recovery-wake:new-owned",natural:false}};later.recovery.receipts.push(later.attempt.action!.receiptKey);
 const c=compactRecoveryJournal(later),retired=JSON.parse(new TextDecoder().decode(c.history!)).slots;
 expect(retired.find((s:any)=>s.slotAt===iso("2026-10-07T02:00Z"))).toMatchObject({deadlineMissed:false,naturalPrimary:false});
 expect(c.journal.recovery!.history!.deadlineMisses).toBe(retired.filter((s:any)=>s.deadlineMissed).length);
});

it("a later fixed72-hour window can pass with all12 proven cycles while old failures remain; missing retired evidence or manual-only success cannot pass",()=>{
 const j=claim(prior(),"2026-10-07T02:01Z"),template=j.recovery!.slots[0],commit="c".repeat(40),start=Date.parse("2026-10-09T02:00Z");
 const w:AcceptanceWindow={schema:1,id:"new-window",recordedAt:iso("2026-10-09T01:59Z"),startsAt:iso("2026-10-09T02:00Z"),endsAt:iso("2026-10-12T02:00Z"),codeCommit:commit,previousWindow:{id:"old-window",sha256:"a".repeat(64)}};
 const slots=Array.from({length:12},(_,i)=>{const s=structuredClone(template);s.slotAt=new Date(start+i*6*3600000).toISOString();s.signedPrimaryAnchor={receiptKey:`vercel-cron:cycle-${i}`,attemptId:`data-cycle-${i}`,claimedAt:new Date(Date.parse(s.slotAt)+60000).toISOString()};s.firstPublicationAt=new Date(Date.parse(s.slotAt)+5*60000).toISOString();s.naturalPrimary=true;s.cyclePublication={publicationId:`data-cycle-${i}-complete`,codeCommit:commit,attemptId:`data-cycle-${i}`,confirmedAt:s.firstPublicationAt};return s;});
 template.deadlineMissed=true;
 j.createdAt=iso("2026-10-12T02:00Z");j.recovery!.slots.push(...slots.slice(-4));j.recovery!.latestTargetDate="2026-10-11";j.recovery!.history={slots:9,naturalSlots:8,deadlineMisses:1,missedCatchups:1,interruptedCatchups:0,resolvedDates:0,supersededDates:0,archiveUrl:"https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-retired/recovery-history.json"};
 const now=Date.parse(j.createdAt);expect(scheduledAcceptance(w,j,slots.slice(0,8),now)).toMatchObject({acceptancePassed:true,evidenceComplete:true,qualifyingCycles:12,expectedSlots:12,utcTransitions:3,historicalDiagnostics:{deadlineMisses:1}});
 expect(scheduledAcceptance(w,j,slots.slice(1,8),now)).toMatchObject({acceptancePassed:false,evidenceComplete:false});
 const manual=structuredClone(slots.slice(0,8));manual[0].naturalPrimary=false;delete manual[0].cyclePublication;delete manual[0].signedPrimaryAnchor;manual[0].manualClaims=1;
 expect(scheduledAcceptance(w,j,manual,now)).toMatchObject({acceptancePassed:false,qualifyingCycles:11});
 expect(recoveryVerdicts(j,now).collectionDeadlinePassed).toBe(true);
 expect(()=>scheduledAcceptance({...w,recordedAt:iso("2026-10-09T02:01Z")},j,slots.slice(0,8),now)).toThrow("Invalid recorded acceptance window");
 const stopped=structuredClone(j);stopped.createdAt=slots.at(-1)!.firstPublicationAt!;stopped.recovery!.latestTargetDate="2026-10-10";
 const before=JSON.stringify(stopped);const noMidnightWake=scheduledAcceptance(w,stopped,slots.slice(0,8),now);
 expect(noMidnightWake).toMatchObject({acceptancePassed:false});expect(noMidnightWake.slots.at(-1)).toMatchObject({cyclePassed:true,catchupPassed:false});expect(JSON.stringify(stopped)).toBe(before);
});
