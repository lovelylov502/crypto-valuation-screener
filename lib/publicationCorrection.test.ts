import {afterEach,expect,it,vi} from "vitest";
import {preparePublicationCorrection} from "./publicationCorrection";
import {correctionWriteGuard,correctPublication} from "../scripts/correct-publication";
import {initialRecovery} from "./freshnessRecovery";
import {sample} from "./testFixtures";
import {JOURNAL_DOWNLOAD,stateUrl} from "./publication";
import {parseJournal} from "./snapshotArchive";
import type {PublicationJournal,PublishedSnapshot} from "./publicationTypes";
import type {ScreenerResponse} from "./types";
import {verifyCorrectionDeployment} from "./pipelineRelease";
import contract from "./pipeline-release.json";
import {collectionHealth} from "./collectionHealth";

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const goodAt="2026-10-07T20:11:00.000Z",badAt="2026-10-07T20:51:50.000Z",now="2026-10-07T21:35:00.000Z";
function ref(id:string,at:string):PublishedSnapshot {return {id,url:JOURNAL_DOWNLOAD+id+"/data.json.gz",reportUrl:JOURNAL_DOWNLOAD+id+"/report.json",witnessUrl:JOURNAL_DOWNLOAD+id+"/witness.json.gz",dataAt:at,validatedAt:at,publishedAt:at,availabilityConfirmedAt:at,codeCommit:"a".repeat(40),sha256:"a".repeat(64),witnessSha256:"b".repeat(64)};}
function journal(id:string,at:string):PublicationJournal {return {schema:2,id:id+"-confirmed",createdAt:at,trackingStartedAt:goodAt,previousId:id+"-complete",previousStateUrl:stateUrl(id+"-complete"),published:ref(id+"-complete",at),incident:null,recoveredAt:null,recovery:{...initialRecovery(),legacyAttemptId:id},attempt:{id,startedAt:at,completedAt:at,outcome:"published",errors:[],sourceFailures:[],affected:[],affectedProjects:0,changeCount:0,comparisonCompleted:true,runUrl:"",reportUrl:""}};}
function data(failed:boolean):ScreenerResponse {const q={id:"1027",status:failed?"error" as const:"received" as const,observedAt:failed?badAt:goodAt,available:failed?[]:["mcap","price","fdv"] as ("mcap"|"price"|"fdv")[]};return {updatedAt:failed?badAt:goodAt,coins:[sample({slug:"ethereum",sourceSlugs:["ethereum"],cmcId:1027,geckoId:null,identityStatus:"verified",price:failed?null:1,mcap:failed?null:100,fdv:failed?null:200,marketSources:{cmc:q,gecko:null,mcap:failed?null:"CoinMarketCap",price:failed?null:"CoinMarketCap",fdv:failed?null:"CoinMarketCap"}})]} as ScreenerResponse;}
it("append-only correction keeps original attempt/ledger/tracking unchanged and invents no success or cycle",()=>{
 const current=journal("data-bad",badAt),target=journal("data-good",goodAt),before=JSON.stringify(current);
 const r=preparePublicationCorrection(current,target,data(true),data(false),target.published,"data-maintenance-correction",now,null);
 expect(JSON.stringify(current)).toBe(before);expect(r.journal.attempt).toBe(current.attempt);expect(r.journal.recovery).toBe(current.recovery);expect(r.journal.trackingStartedAt).toBe(current.trackingStartedAt);
 expect(r.journal.published).toBe(target.published);expect(r.journal.attempt.outcome).toBe("published");expect(r.journal.previousId).toBe(current.id);expect(r.journal.incident?.lastGoodDataAt).toBe(goodAt);expect(parseJournal(JSON.parse(JSON.stringify(r.journal))).correction?.from).toEqual(current.published);
 expect(collectionHealth(null,Date.parse(now),"",false,r.journal).label).toBe("이전 검증본 복원");
});
it("completed blocked wrappers preserve latest failed attempt while proving originalbad publication; running or changed publicref cannot restore",()=>{
 const original=journal("data-bad",badAt),current=structuredClone(original),target=journal("data-good",goodAt);
 current.id="data-later-complete";current.createdAt=now;current.attempt={...current.attempt,id:"data-later",outcome:"blocked",errors:["market_acquisition_failed:cmc:zero_usable"],completedAt:now};current.recovery!.legacyAttemptId="data-later";
 const r=preparePublicationCorrection(current,target,data(true),data(false),target.published,"data-maintenance-correction",now,null,original);
 expect(r.journal.attempt).toBe(current.attempt);expect(r.journal.recovery).toBe(current.recovery);expect(r.correction.originalJournalUrl).toBe(stateUrl(original.id));expect(r.correction.parentJournalUrl).toBe(stateUrl(current.id));expect(parseJournal(r.journal).attempt.outcome).toBe("blocked");
 for(const patch of ["running","healthy","wrong original"]) {
  const c=structuredClone(current),o=structuredClone(original);
  if(patch==="running")c.attempt.outcome="running";
  if(patch==="healthy")c.published=target.published;
  if(patch==="wrong original")o.published!.sha256="f".repeat(64);
  expect(()=>preparePublicationCorrection(c,target,data(true),data(false),target.published,"data-maintenance-correction",now,null,o)).toThrow("lineage");
 }
});
it.each(["running","wrong baseline","no failure","unconfirmed target","healthy later"])("refuses correction with %s evidence",reason=>{
 const c=journal("data-bad",badAt),t=journal("data-good",goodAt);let b=data(true),baseline=t.published;
 if(reason==="running")c.attempt.outcome="running";
 if(reason==="wrong baseline")baseline=c.published;
 if(reason==="no failure")b=data(false);
 if(reason==="unconfirmed target")delete t.published!.availabilityConfirmedAt;
 if(reason==="healthy later")t.published!.dataAt="2026-10-07T22:00:00Z";
 expect(()=>preparePublicationCorrection(c,t,b,data(false),baseline,"data-maintenance-correction",now,null)).toThrow();
});
it("local commit is rejected before any network request; expected parent changes fail before archive or promotion",async()=>{
 vi.stubEnv("GITHUB_ACTIONS","false");vi.stubEnv("SCREENER_POINTER_CORRECTION","false");
 const network=vi.fn();vi.stubGlobal("fetch",network);expect(()=>correctionWriteGuard()).toThrow("serialized maintenance");
 await expect(correctPublication("commit","data-old","data-good")).rejects.toThrow("serialized maintenance");expect(network).not.toHaveBeenCalled();
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json(journal("data-new",badAt))));
 await expect(correctPublication("prepare","data-old","data-good","unused")).rejects.toThrow("parent changed");expect(fetch).toHaveBeenCalledTimes(1);
});
it("serialized maintenance context is explicitly authorized and each required context field remains enforced",()=>{
 const maintenance={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:"lovelylov502/crypto-valuation-screener",GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"workflow_dispatch",SCREENER_POINTER_CORRECTION:"true",GITHUB_RUN_ID:"12345",GITHUB_RUN_ATTEMPT:"1"};
 for(const [key,value] of Object.entries(maintenance))vi.stubEnv(key,value);
 const network=vi.fn();vi.stubGlobal("fetch",network);expect(()=>correctionWriteGuard()).not.toThrow();
 for(const [key,value] of Object.entries(maintenance)) {
  vi.stubEnv(key,"");expect(()=>correctionWriteGuard()).toThrow("serialized maintenance");vi.stubEnv(key,value);
 }
 expect(network).not.toHaveBeenCalled();
});
it("correction rejects a changed live revision or pause even in canonical GH context",async()=>{
 vi.stubEnv("GITHUB_SHA","a".repeat(40));
 const live={deployment:{environment:"production",id:"dpl_live",codeCommit:"a".repeat(40)},compatibility:{release:contract.readerRelease,pipelineSchemas:[1,2],journalSchemas:[1,2]},collectionRelease:{writerSchema:2,schedule:"four-daily",phaseADeploymentId:contract.phaseA?.deploymentId}};
 const network=vi.fn(async(_url,init)=>{expect(init?.redirect).toBe("error");expect(init?.headers).toBeUndefined();return Response.json(live);});
 await expect(verifyCorrectionDeployment(network)).resolves.toBeUndefined();
 live.deployment.codeCommit="b".repeat(40);await expect(verifyCorrectionDeployment(network)).rejects.toThrow("revision changed");
 live.deployment.codeCommit="a".repeat(40);live.collectionRelease.schedule="paused";await expect(verifyCorrectionDeployment(network)).rejects.toThrow("paused");
});
