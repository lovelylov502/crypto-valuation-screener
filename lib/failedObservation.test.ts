import {afterEach,expect,it,vi} from "vitest";
import {gzipSync} from "node:zlib";
import {objectHash} from "./sourceBundle";
import {sha256,parseJournal} from "./snapshotArchive";
import {initialRecovery,type DateObligation} from "./freshnessRecovery";
import {stateUrl,JOURNAL_REPOSITORY} from "./publication";
import {FAILED_FILES,failedRunProof,validateFailedManifest,importFailedObservations,verifyFailedObservation,type FailedEvidenceManifest} from "./failedObservation";
import {downloadFailedArtifact,failedObservationWriteGuard} from "../scripts/preserve-failed-observation";
import type {PublicationJournal} from "./publicationTypes";

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const started="2026-10-08T00:59:56.040Z",failed="2026-10-08T01:05:37Z",archived="2026-10-09T02:00:00Z",id="data-99-1-failed-observation";
function original():PublicationJournal {
 const stage=()=>({claims:0,completed:0,needed:false,missed:false,interrupted:false});
 return {schema:2,id:"data-10-1-start",createdAt:started,trackingStartedAt:started,previousId:"data-9-confirmed",previousStateUrl:stateUrl("data-9-confirmed"),published:{id:"data-9-complete",url:stateUrl("data-9-complete").replace("state.json","data.json.gz"),sha256:"a".repeat(64),dataAt:"2026-10-07T22:30:00Z",validatedAt:started,publishedAt:started,codeCommit:"b".repeat(40),reportUrl:stateUrl("data-9-complete").replace("state.json","report.json"),witnessUrl:stateUrl("data-9-complete").replace("state.json","witness.json.gz"),witnessSha256:"c".repeat(64)},
  attempt:{id:"data-10-1",startedAt:started,completedAt:null,outcome:"running",scheduledFor:"2026-10-07T20:00:00.000Z",action:{slotAt:"2026-10-07T20:00:00.000Z",stage:"catchup2",receiptKey:"vercel-cron:10",natural:false},runUrl:`https://github.com/${JOURNAL_REPOSITORY}/actions/runs/10`,reportUrl:stateUrl("data-10-1-complete").replace("state.json","report.json"),errors:[],sourceFailures:[],affectedProjects:0,changeCount:0,affected:[]},incident:null,recoveredAt:null,
  recovery:{...initialRecovery(),receipts:["vercel-cron:10"],slots:[{slotAt:"2026-10-07T20:00:00.000Z",primary:{...stage(),claims:1,completed:1},catchup1:stage(),catchup2:{...stage(),claims:1,needed:true},manualClaims:0,firstPublicationAt:"2026-10-07T20:16:00Z",deadlineMissed:false,naturalPrimary:false}]}};
}
function observation(slug="pending",firstMissingAt=started):DateObligation{return {key:JSON.stringify([slug,"revenue","same-source","2026-10-07"]),slug,metric:"revenue",identity:"same-source",date:"2026-10-07",firstMissingAt,lastCheckedAt:started,lastAttemptId:"data-10-1",checks:1,disposition:"pending",sources:["https://api.llama.fi/overview/fees"]};}
function manifest(start=original(),observations=[observation()]):FailedEvidenceManifest {
 return {schema:1,kind:"failed-publication-observation",journalId:id,attemptId:"data-10-1",startJournalId:start.id,startParentId:start.previousId!,run:{runId:"10",runAttempt:1,codeCommit:"b".repeat(40),workflowPath:".github/workflows/daily-snapshot.yml",failedAt:failed,jobId:11,artifactId:12,artifactName:"screener-10-1",artifactDigest:`sha256:${"d".repeat(64)}`,conclusion:"failure",failedStep:"Archive result and atomically publish only a passing candidate"},archivedAt:archived,observedAt:started,reportCompletedAt:"2026-10-08T01:05:25Z",published:start.published!,files:FAILED_FILES.map(name=>({name,bytes:10,sha256:"f".repeat(64)})),unresolvedCount:observations.length,unresolvedSha256:objectHash(observations),replay:{rawBundleSha256:"e".repeat(64),normalizedSha256:"e".repeat(64),outputSha256:"e".repeat(64)}};
}
function merge(start:PublicationJournal,observations:DateObligation[],m=manifest(start,observations)){return importFailedObservations(start,structuredClone(start),observations,m,Buffer.from(JSON.stringify(m)),id,archived);}

it("imports only missing dates with original ages, preserving pointer, slot claims, all prior evidence and interrupted execution",()=>{
 const start=original(),prior=observation("prior","2026-10-07T23:00:00Z");prior.failedEvidence=[{manifestUrl:stateUrl("data-earlier-failed-observation").replace("state.json","failed-evidence.json"),manifestSha256:"1".repeat(64)}];start.recovery!.obligations=[prior];
 const earlier={...prior,firstMissingAt:"2026-10-07T22:00:00Z"},observations=[earlier,observation()],j=merge(start,observations);
 expect(j.published).toEqual(start.published);expect(j.trackingStartedAt).toBe(start.trackingStartedAt);expect(j.recovery!.receipts).toEqual(start.recovery!.receipts);
 expect(j.recovery!.slots[0]).toEqual({...start.recovery!.slots[0],catchup2:{...start.recovery!.slots[0].catchup2,interrupted:true}});
 expect(j.recovery!.obligations[0]).toMatchObject({firstMissingAt:earlier.firstMissingAt,lastAttemptId:prior.lastAttemptId,checks:prior.checks,disposition:"overdue"});
 expect(j.recovery!.obligations[0].failedEvidence).toHaveLength(2);expect(j.recovery!.obligations[1].firstMissingAt).toBe(started);
 expect(j.attempt).toMatchObject({outcome:"blocked",completedAt:failed,errors:["publication_storage_failed"],comparisonCompleted:false});expect(j.publicationFailure?.archivedAt).toBe(archived);
 expect(()=>parseJournal(j)).not.toThrow();expect(()=>merge(j,observations)).toThrow();
});
it("never reopens resolved/superseded obligations or imports candidate resolutions",()=>{
 const start=original(),resolved={...observation("resolved"),disposition:"resolved" as const},superseded={...observation("superseded"),disposition:"superseded" as const};start.recovery!.obligations=[resolved,superseded];
 const j=merge(start,[{...resolved,disposition:"pending"},{...superseded,disposition:"pending"},observation()]);
 expect(j.recovery!.obligations.slice(0,2)).toEqual([resolved,superseded]);expect(()=>merge(start,[resolved])).toThrow("cannot import resolutions");
});
it("rejects changed parents, completion, missing action, altered observation hash and malformed provenance",()=>{
 const start=original(),m=manifest(start),bytes=Buffer.from(JSON.stringify(m));
 for(const change of [(s:PublicationJournal)=>s.id="data-later-start",(s:PublicationJournal)=>s.attempt.outcome="published",(s:PublicationJournal)=>s.recovery!.slots[0].catchup2.completed=1,(s:PublicationJournal)=>s.attempt.action=undefined]){const s=structuredClone(start);change(s);expect(()=>importFailedObservations(s,start,[observation()],m,bytes,id,archived)).toThrow();}
 expect(()=>merge(start,[{...observation(),firstMissingAt:"2026-10-07T21:00:00Z"}],m)).toThrow();
 const j=merge(start,[observation()]);j.recovery!.obligations[0].failedEvidence![0].manifestUrl="https://example.com/latest";expect(()=>parseJournal(j)).toThrow();
});
it("binds exact failed workflow attempt, original SHA and failed archive step to the immutable artifact",()=>{
 const run={id:10,run_attempt:1,status:"completed",conclusion:"failure",path:".github/workflows/daily-snapshot.yml",head_branch:"main",head_sha:"b".repeat(40),repository:{full_name:JOURNAL_REPOSITORY},run_started_at:started,updated_at:failed};
 const jobs={jobs:[{id:11,name:"capture",conclusion:"failure",status:"completed",steps:[{name:"Collect and validate candidate against the published baseline",conclusion:"success"},{name:"Archive result and atomically publish only a passing candidate",conclusion:"failure",status:"completed",completed_at:failed}]}]},artifact={id:12,name:"screener-10-1",created_at:failed,expired:false,workflow_run:{id:10,head_sha:run.head_sha},digest:`sha256:${"d".repeat(64)}`};
 expect(failedRunProof(run,jobs,artifact,"10",1)).toMatchObject({failedAt:failed,codeCommit:run.head_sha});
 for(const patch of [{run_attempt:2},{head_sha:"a".repeat(40)},{conclusion:"success"},{path:".github/workflows/other.yml"}])expect(()=>failedRunProof({...run,...patch},jobs,artifact,"10",1)).toThrow();
 expect(()=>failedRunProof(run,{jobs:[]},artifact,"10",1)).toThrow();expect(()=>failedRunProof(run,jobs,{...artifact,name:"screener-10-2"},"10",1)).toThrow();
});
it("keeps original report errors empty while requiring saved files/hashes and a proved source replay",async()=>{
 const start=original(),report={startedAt:started,codeCommit:"b".repeat(40),completedAt:"2026-10-08T01:05:25Z",comparisonCompleted:true,errors:[],baseline:start.published,artifacts:FAILED_FILES.filter(n=>n.endsWith(".gz")).map(name=>({name,bytes:1,sha256:"0".repeat(64)}))};
 const files=Object.fromEntries(FAILED_FILES.map(name=>[name,name==="start.json"?Buffer.from(JSON.stringify(start)):name==="report.json"?Buffer.from(JSON.stringify(report)):name==="trigger.json"?Buffer.from("null"):gzipSync("corrupt")]));
 await expect(verifyFailedObservation(files,manifest().run)).rejects.toThrow("artifact hash mismatch");
 delete files["witness.json.gz"];await expect(verifyFailedObservation(files,manifest().run)).rejects.toThrow("files unavailable");
 const malformed=manifest();malformed.files[0].sha256="no";expect(()=>validateFailedManifest(malformed)).toThrow();
});
it("restricts maintenance writes to the genuine CI context without inheriting ambient authorization",()=>{
 const env={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:JOURNAL_REPOSITORY,GITHUB_REF:"refs/heads/main",GITHUB_EVENT_NAME:"workflow_dispatch",SCREENER_FAILED_OBSERVATION:"true",SCREENER_POINTER_CORRECTION:"false",GITHUB_RUN_ID:"99",GITHUB_RUN_ATTEMPT:"1"};
 for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);expect(()=>failedObservationWriteGuard()).not.toThrow();
 for(const key of Object.keys(env).filter(k=>k!=="SCREENER_POINTER_CORRECTION")){vi.stubEnv(key,"");expect(()=>failedObservationWriteGuard()).toThrow();vi.stubEnv(key,env[key as keyof typeof env]);}
 vi.stubEnv("SCREENER_POINTER_CORRECTION","true");expect(()=>failedObservationWriteGuard()).toThrow();
});
it("downloads exact digest via transient signed redirect without forwarding authorization",async()=>{
 vi.stubEnv("GITHUB_TOKEN","test-only");const bytes=Buffer.from("original zip"),artifact={id:12,size_in_bytes:bytes.length,digest:`sha256:${sha256(bytes)}`};
 const calls:any[]=[],fetcher=vi.fn(async(url:any,init:any)=>{calls.push({url:String(url),init});return calls.length===1?new Response(null,{status:302,headers:{location:"https://productionresultsa.blob.core.windows.net/original.zip?sig=never-persist"}}):new Response(bytes);});
 expect(await downloadFailedArtifact(artifact,fetcher)).toEqual(bytes);expect(calls[0].init.headers.authorization).toBe("Bearer test-only");expect(calls[1].init.headers).toBeUndefined();expect(calls[1].init.redirect).toBe("error");
 await expect(downloadFailedArtifact(artifact,async()=>new Response(null,{status:302,headers:{location:"https://evil.invalid/file"}}))).rejects.toThrow("host");
 let count=0;await expect(downloadFailedArtifact({...artifact,digest:`sha256:${"f".repeat(64)}`},async()=>++count===1?new Response(null,{status:302,headers:{location:"https://productionresultsa.blob.core.windows.net/file"}}):new Response(bytes))).rejects.toThrow("digest mismatch");
});
