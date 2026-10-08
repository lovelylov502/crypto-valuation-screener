import {gunzipSync} from "node:zlib";
import {objectHash,witnessFromBundle,type SourceBundle} from "./sourceBundle";
import {replayDataPipeline} from "./dataPipeline";
import {pipelineIntegrityErrors,pipelineOutputHash} from "./pipelineIntegrity";
import {snapshotErrors,stateUrl,JOURNAL_DOWNLOAD,JOURNAL_REPOSITORY} from "./publication";
import {parseJournal,sha256} from "./snapshotArchive";
import {updateObligations,type DateObligation} from "./freshnessRecovery";
import {UTC_DAY_MS} from "./datedFreshness";
import type {PublicationJournal,PublishedSnapshot} from "./publicationTypes";
import type {ScreenerResponse} from "./types";

export const FAILED_FILES=["start.json","report.json","source-bundle.json.gz","data.json.gz","witness.json.gz","inputs.json.gz","trigger.json"] as const;
export interface FailedRunProof {runId:string;runAttempt:number;codeCommit:string;workflowPath:string;failedAt:string;jobId:number;artifactId:number;artifactName:string;artifactDigest:string;conclusion:"failure";failedStep:"Archive result and atomically publish only a passing candidate"}
export interface FailedEvidenceManifest {
 schema:1;kind:"failed-publication-observation";journalId:string;attemptId:string;startJournalId:string;startParentId:string;
 run:FailedRunProof;archivedAt:string;observedAt:string;reportCompletedAt:string;published:PublishedSnapshot;
 files:{name:string;bytes:number;sha256:string}[];unresolvedSha256:string;unresolvedCount:number;
 replay:{rawBundleSha256:string;normalizedSha256:string;outputSha256:string};
}
export interface PublicationFailure {schema:1;journalId:string;attemptId:string;runId:string;runAttempt:number;failedAt:string;archivedAt:string;manifestUrl:string;manifestSha256:string}
const time=(value:unknown):value is string=>typeof value==="string"&&Number.isFinite(Date.parse(value));
const hash=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
export const failedManifestUrl=(id:string)=>`${JOURNAL_DOWNLOAD}${id}/failed-evidence.json`;
/** Actual failed execution, not the candidate report's successful validation outcome. */
export function failedRunProof(run:any,jobs:any,artifact:any,runId:string,attempt:number):FailedRunProof {
 const job=jobs.jobs?.find((j:any)=>j.name==="capture"&&j.conclusion==="failure"&&j.status==="completed");
 const step=job?.steps?.find((s:any)=>s.name==="Archive result and atomically publish only a passing candidate"&&s.conclusion==="failure"&&s.status==="completed");
 if(!/^\d+$/.test(runId)||!Number.isInteger(attempt)||attempt<1||String(run.id)!==runId||run.run_attempt!==attempt||run.status!=="completed"||run.conclusion!=="failure"||
   run.path!==".github/workflows/daily-snapshot.yml"||run.head_branch!=="main"||!/^[a-f0-9]{40}$/.test(run.head_sha??"")||run.repository?.full_name!==JOURNAL_REPOSITORY||
   !job||!step||!Number.isInteger(job.id??job.databaseId)||!time(step.completed_at??step.completedAt)||!job.steps.some((s:any)=>s.name==="Collect and validate candidate against the published baseline"&&s.conclusion==="success")||
   !time(artifact.created_at)||!time(run.run_started_at)||!time(run.updated_at)||Date.parse(artifact.created_at)<Date.parse(run.run_started_at)||Date.parse(artifact.created_at)>Date.parse(run.updated_at)||!Number.isInteger(artifact.id)||artifact.expired!==false||artifact.name!==`screener-${runId}-${attempt}`||
   artifact.workflow_run?.id!==Number(runId)||artifact.workflow_run?.head_sha!==run.head_sha||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest??""))throw Error("Failed workflow/artifact identity unavailable or mismatched");
 return {runId,runAttempt:attempt,codeCommit:run.head_sha,workflowPath:run.path,failedAt:step.completed_at??step.completedAt,jobId:job.id??job.databaseId,artifactId:artifact.id,artifactName:artifact.name,artifactDigest:artifact.digest,conclusion:"failure",failedStep:step.name};
}
export function validatePublicationFailure(p:PublicationFailure) {
 if(!p||p.schema!==1||!/^data-[a-zA-Z0-9-]+-failed-observation$/.test(p.journalId)||p.attemptId!==`data-${p.runId}-${p.runAttempt}`||!/^[0-9]+$/.test(p.runId)||!Number.isInteger(p.runAttempt)||p.runAttempt<1||
  !time(p.failedAt)||!time(p.archivedAt)||Date.parse(p.archivedAt)<Date.parse(p.failedAt)||p.manifestUrl!==failedManifestUrl(p.journalId)||!hash(p.manifestSha256))throw Error("Invalid failed publication evidence reference");
}
export function validateFailedManifest(m:FailedEvidenceManifest) {
 if(!m||m.schema!==1||m.kind!=="failed-publication-observation"||!/^data-[a-zA-Z0-9-]+-failed-observation$/.test(m.journalId)||m.attemptId!==`data-${m.run?.runId}-${m.run?.runAttempt}`||m.startJournalId!==`${m.attemptId}-start`||
  !/^data-[a-zA-Z0-9-]+$/.test(m.startParentId)||!time(m.archivedAt)||!time(m.observedAt)||!time(m.reportCompletedAt)||!time(m.run.failedAt)||
  Date.parse(m.archivedAt)<Date.parse(m.run.failedAt)||Date.parse(m.reportCompletedAt)>Date.parse(m.run.failedAt)||Date.parse(m.observedAt)>Date.parse(m.reportCompletedAt)||
  !/^\d+$/.test(m.run.runId)||!Number.isInteger(m.run.runAttempt)||m.run.runAttempt<1||!/^[a-f0-9]{40}$/.test(m.run.codeCommit)||m.run.workflowPath!==".github/workflows/daily-snapshot.yml"||m.run.conclusion!=="failure"||m.run.failedStep!=="Archive result and atomically publish only a passing candidate"||
  ![m.run.jobId,m.run.artifactId].every(n=>Number.isInteger(n)&&n>0)||m.run.artifactName!==`screener-${m.run.runId}-${m.run.runAttempt}`||!/^sha256:[a-f0-9]{64}$/.test(m.run.artifactDigest)||
  !Array.isArray(m.files)||m.files.length!==FAILED_FILES.length||new Set(m.files.map(f=>f.name)).size!==FAILED_FILES.length||m.files.some(f=>!FAILED_FILES.includes(f.name as any)||!Number.isInteger(f.bytes)||f.bytes<1||f.bytes>150_000_000||!hash(f.sha256))||
  !Number.isInteger(m.unresolvedCount)||m.unresolvedCount<1||!hash(m.unresolvedSha256)||!m.published||!m.replay||![m.replay.rawBundleSha256,m.replay.normalizedSha256,m.replay.outputSha256].every(hash))throw Error("Invalid failed observation manifest");
}
async function evidenceBytes(url:string,max:number,fetcher:typeof fetch) {
 const response=await fetcher(url,{cache:"no-store",redirect:"follow",signal:AbortSignal.timeout(90_000)});
 if(!response.ok||!response.body)throw Error("Failed immutable evidence unavailable");
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let count=0;
 try{for(;;){const p=await reader.read();if(p.done)break;count+=p.value.byteLength;if(count>max)throw Error("Failed immutable evidence exceeds byte bound");parts.push(p.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}return Buffer.concat(parts);
}
/** Dedicated storage-failure audit: original successful report.errors=[] must remain unchanged. */
export async function readFailedEvidence(failure:PublicationFailure,published:PublishedSnapshot,fetcher=fetch) {
 validatePublicationFailure(failure);
 const bytes=await evidenceBytes(failure.manifestUrl,50_000,fetcher);
 if(sha256(bytes)!==failure.manifestSha256)throw Error("Failed evidence manifest hash mismatch");
 const manifest=JSON.parse(bytes.toString()) as FailedEvidenceManifest;validateFailedManifest(manifest);
 if(manifest.journalId!==failure.journalId||manifest.attemptId!==failure.attemptId||manifest.run.runId!==failure.runId||manifest.run.runAttempt!==failure.runAttempt||manifest.run.failedAt!==failure.failedAt||manifest.archivedAt!==failure.archivedAt||objectHash(manifest.published)!==objectHash(published))throw Error("Failed evidence manifest lineage mismatch");
 if(manifest.files.reduce((sum,f)=>sum+f.bytes,0)>200_000_000)throw Error("Failed evidence file set exceeds byte bound");
 const files:Record<string,Uint8Array>={};
 for(const f of manifest.files){const value=await evidenceBytes(`${JOURNAL_DOWNLOAD}${failure.journalId}/failed-${f.name}`,f.bytes,fetcher);if(value.byteLength!==f.bytes||sha256(value)!==f.sha256)throw Error("Failed immutable evidence hash or length mismatch");files[f.name]=value;}
 const verified=await verifyFailedObservation(files,manifest.run);
 if(verified.start.id!==manifest.startJournalId||verified.start.previousId!==manifest.startParentId||verified.data.updatedAt!==manifest.observedAt||verified.report.completedAt!==manifest.reportCompletedAt||objectHash(verified.observations)!==manifest.unresolvedSha256||verified.observations.length!==manifest.unresolvedCount||objectHash(verified.replay)!==objectHash(manifest.replay))throw Error("Failed evidence observation/replay mismatch");
 return {manifest,...verified};
}
/** Original archived inputs alone must reproduce the reported unresolved observations. */
export async function verifyFailedObservation(files:Record<string,Uint8Array>,run:FailedRunProof) {
 if(FAILED_FILES.some(name=>!files[name]?.byteLength||files[name].byteLength>150_000_000))throw Error("Failed publication evidence files unavailable");
 const json=(name:string)=>JSON.parse(Buffer.from(files[name]).toString("utf8"));
 const start=parseJournal(json("start.json")),report=json("report.json"),trigger=json("trigger.json"),attemptId=`data-${run.runId}-${run.runAttempt}`;
 if(start.schema!==2||start.id!==`${attemptId}-start`||start.attempt.id!==attemptId||start.attempt.outcome!=="running"||start.attempt.completedAt!==null||!start.published||!start.previousId||start.previousStateUrl!==stateUrl(start.previousId)||
  start.attempt.runUrl!==`https://github.com/${JOURNAL_REPOSITORY}/actions/runs/${run.runId}`||report.codeCommit!==run.codeCommit||report.startedAt!==start.attempt.startedAt||
  !time(report.completedAt)||Date.parse(report.completedAt)>Date.parse(run.failedAt)||report.comparisonCompleted!==true||!Array.isArray(report.errors)||report.errors.length||
  objectHash(report.baseline)!==objectHash(start.published)||objectHash(report.trigger??null)!==objectHash(trigger)||objectHash(trigger)!==objectHash(start.attempt.trigger??null))throw Error("Failed attempt/report/start binding mismatch");
 for(const name of FAILED_FILES.filter(n=>n.endsWith(".gz"))) {
  const binding=report.artifacts?.find((f:any)=>f.name===name);
  if(!binding||binding.bytes!==files[name].byteLength||binding.sha256!==sha256(files[name]))throw Error("Failed candidate artifact hash mismatch");
 }
 const data=JSON.parse(gunzipSync(files["data.json.gz"],{maxOutputLength:150_000_000}).toString()) as ScreenerResponse;
 const bundle=JSON.parse(gunzipSync(files["source-bundle.json.gz"],{maxOutputLength:500_000_000}).toString()) as SourceBundle;
 const witness=JSON.parse(gunzipSync(files["witness.json.gz"],{maxOutputLength:150_000_000}).toString());
 if(!data.pipeline||data.pipeline.schema!==2||report.dataAt!==data.updatedAt||bundle.asOf!==data.updatedAt||Date.parse(data.updatedAt)<Date.parse(start.attempt.startedAt)||
  objectHash(report.pipeline)!==objectHash(data.pipeline)||objectHash(report.sources)!==objectHash(data.sources)||objectHash(report.collection)!==objectHash(data.collection)||
  objectHash(bundle.baseline?.publication)!==objectHash(start)||objectHash(witness)!==objectHash(witnessFromBundle(bundle)))throw Error("Failed candidate source/witness binding mismatch");
 const replayed=await replayDataPipeline(bundle,sha256(files["source-bundle.json.gz"]));
 if([...snapshotErrors(data),...pipelineIntegrityErrors(data)].length||objectHash(data.pipeline)!==objectHash(replayed.pipeline)||pipelineOutputHash(data)!==pipelineOutputHash(replayed))throw Error("Failed candidate immutable replay mismatch");
 const observations=updateObligations(start.recovery!,data,attemptId).obligations.filter(o=>o.disposition!=="resolved").map(o=>o.disposition==="pending"&&Date.parse(report.completedAt)-Date.parse(o.firstMissingAt)>=UTC_DAY_MS?{...o,disposition:"overdue" as const}:o);
 if(!observations.length||objectHash(observations)!==objectHash(report.verdicts?.unresolvedDateObligations))throw Error("Failed report unresolved observations differ from replay");
 return {start,report,data,bundle,observations,replay:{rawBundleSha256:data.pipeline.rawBundleSha256,normalizedSha256:data.pipeline.normalizedSha256,outputSha256:data.pipeline.outputSha256}};
}
/** Import missing-date evidence only. No candidate resolutions, values or successful execution credit. */
export function importFailedObservations(current:PublicationJournal,original:PublicationJournal,observations:DateObligation[],manifest:FailedEvidenceManifest,manifestBytes:Uint8Array,id:string,at:string) {
 validateFailedManifest(manifest);
 if(manifest.journalId!==id||manifest.archivedAt!==at||objectHash(JSON.parse(Buffer.from(manifestBytes).toString()))!==objectHash(manifest)||
   current.id!==original.id||objectHash(current)!==objectHash(original)||current.attempt.outcome!=="running"||current.attempt.completedAt!==null||
   current.id!==manifest.startJournalId||current.previousId!==manifest.startParentId||objectHash(current.published)!==objectHash(manifest.published)||
   !current.recovery||!current.attempt.action||id===current.id||!time(at)||Date.parse(at)<Date.parse(manifest.run.failedAt)||manifest.unresolvedCount!==observations.length||objectHash(observations)!==manifest.unresolvedSha256)throw Error("Failed observation parent or manifest changed");
 const r=structuredClone(current.recovery),s=r.slots.find(s=>s.slotAt===current.attempt.action!.slotAt)!,stage=current.attempt.action.stage;
 if(!s||s[stage].completed>=s[stage].claims||current.attempt.manualRepair)throw Error("Failed stage already completed or changed");
 const marker={manifestUrl:failedManifestUrl(id),manifestSha256:sha256(manifestBytes)},existing=new Map(r.obligations.map(o=>[o.key,o]));
 for(const o of observations) {
  if(!["pending","overdue","superseded"].includes(o.disposition))throw Error("Failed evidence cannot import resolutions");
  if(o.disposition==="superseded")continue;
  const old=existing.get(o.key);
  if(old&&["resolved","superseded"].includes(old.disposition))continue;
  const entry=old??structuredClone(o);
  if(old&&Date.parse(o.firstMissingAt)<Date.parse(old.firstMissingAt))entry.firstMissingAt=o.firstMissingAt;
  entry.disposition=Date.parse(at)-Date.parse(entry.firstMissingAt)>=UTC_DAY_MS?"overdue":"pending";
  entry.failedEvidence=[...(entry.failedEvidence??[]),marker].filter((m,i,a)=>a.findIndex(v=>objectHash(v)===objectHash(m))===i);
  existing.set(entry.key,entry);
 }
 r.obligations=[...existing.values()];s[stage].interrupted=true;r.transient=true;
 const failure:PublicationFailure={schema:1,journalId:id,attemptId:current.attempt.id,runId:manifest.run.runId,runAttempt:manifest.run.runAttempt,failedAt:manifest.run.failedAt,archivedAt:at,...marker};
 const journal:PublicationJournal={...current,id,createdAt:at,previousId:current.id,previousStateUrl:stateUrl(current.id),recovery:r,publicationFailure:failure,
  attempt:{...current.attempt,outcome:"blocked",completedAt:manifest.run.failedAt,comparisonCompleted:false,failureClass:"transient",errors:["publication_storage_failed"]},
  incident:{firstFailureObservedAt:current.incident?.firstFailureObservedAt??manifest.run.failedAt,lastFailureObservedAt:manifest.run.failedAt,lastGoodDataAt:current.published?.dataAt??null}};
 parseJournal(journal);return journal;
}
