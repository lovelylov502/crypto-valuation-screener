import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {FAILED_FILES,failedRunProof,verifyFailedObservation,importFailedObservations,readFailedEvidence,type FailedEvidenceManifest} from "../lib/failedObservation";
import {sha256,readArchivedJournal,readJournal,readSnapshot} from "../lib/snapshotArchive";
import {JOURNAL_REPOSITORY,stateUrl} from "../lib/publication";
import {objectHash} from "../lib/sourceBundle";
import {archiveEconomicReview} from "../lib/economicReviewArchive";
import {verifyWriterActivation,verifyCorrectionDeployment} from "../lib/pipelineRelease";
import {latestJournal,publishJournal} from "./github-journal";

const api=`https://api.github.com/repos/${JOURNAL_REPOSITORY}`;
export function failedObservationWriteGuard() {
 if(process.env.GITHUB_ACTIONS!=="true"||process.env.GITHUB_REPOSITORY!==JOURNAL_REPOSITORY||process.env.GITHUB_REF!=="refs/heads/main"||process.env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
   process.env.SCREENER_FAILED_OBSERVATION!=="true"||process.env.SCREENER_POINTER_CORRECTION==="true"||!/^\d+$/.test(process.env.GITHUB_RUN_ID??"")||!/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT??""))throw Error("Failed observation commit requires the serialized maintenance workflow");
}
async function get(path:string) {
 if(!process.env.GITHUB_TOKEN)throw Error("Failed execution metadata credential unavailable");
 const response=await fetch(api+path,{redirect:"error",headers:{authorization:`Bearer ${process.env.GITHUB_TOKEN}`,accept:"application/vnd.github+json"},signal:AbortSignal.timeout(15_000)});
 if(!response.ok)throw Error(`Failed execution metadata HTTP ${response.status}`);return response.json();
}
/** Authorization stays on the fixed API host; the signed download URL is transient and credential-free. */
export async function downloadFailedArtifact(artifact:{id:number;size_in_bytes:number;digest:string},fetcher=fetch) {
 if(!Number.isInteger(artifact.id)||artifact.id<1||!Number.isInteger(artifact.size_in_bytes)||artifact.size_in_bytes<1||artifact.size_in_bytes>150_000_000||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest))throw Error("Invalid failed artifact download metadata");
 const redirect=await fetcher(`${api}/actions/artifacts/${artifact.id}/zip`,{redirect:"manual",headers:{authorization:`Bearer ${process.env.GITHUB_TOKEN}`,accept:"application/vnd.github+json"},signal:AbortSignal.timeout(15_000)});
 if(redirect.status!==302)throw Error("Failed artifact download redirect unavailable");
 const location=new URL(redirect.headers.get("location")??"");
 if(location.protocol!=="https:"||location.username||location.password||!(/\.blob\.core\.windows\.net$/.test(location.hostname)||/\.actions\.githubusercontent\.com$/.test(location.hostname)))throw Error("Unexpected failed artifact download host");
 const response=await fetcher(location,{redirect:"error",signal:AbortSignal.timeout(90_000)});
 if(!response.ok||!response.body)throw Error("Failed artifact download unavailable");
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
 try {for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>150_000_000)throw Error("Failed artifact ZIP exceeds evidence budget");parts.push(p.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const zip=Buffer.concat(parts);if(`sha256:${sha256(zip)}`!==artifact.digest)throw Error("Failed artifact ZIP digest mismatch");return zip;
}
async function extract(zip:Uint8Array) {
 const dir=await mkdtemp(join(tmpdir(),"screener-failed-evidence-")),path=join(dir,"original.zip");
 try {
  await writeFile(path,zip,{flag:"wx",mode:0o600});
  const files:Record<string,Uint8Array>={};let total=0;
  for(const name of FAILED_FILES) {
   const result=spawnSync("unzip",["-p",path,`publication/${name}`],{maxBuffer:150_000_000,timeout:30_000});
   if(result.error||result.status!==0||!result.stdout.length)throw Error(`Exact failed artifact member unavailable: ${name}`);
   total+=result.stdout.length;if(total>200_000_000)throw Error("Failed artifact members exceed evidence budget");files[name]=result.stdout;
  }
  return files;
 } finally {await rm(dir,{recursive:true,force:true});}
}
export async function preserveFailedObservation(mode:string,parentId:string,runId:string,attemptText:string,output?:string) {
 const attempt=Number(attemptText);
 if(!["prepare","commit"].includes(mode)||!/^data-[a-zA-Z0-9-]+-start$/.test(parentId)||!/^\d+$/.test(runId)||!Number.isInteger(attempt)||attempt<1||mode==="prepare"&&!output)throw Error("Usage: preserve-failed-observation prepare|commit expected-start-parent failed-run failed-attempt [plan-output]");
 if(mode==="commit"){failedObservationWriteGuard();await verifyWriterActivation();await verifyCorrectionDeployment();}
 const id=mode==="commit"?`data-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-failed-observation`:`data-plan-${Date.now()}-failed-observation`;
 const current=mode==="commit"?await latestJournal():await readJournal();
 // A successful retry of this exact maintenance invocation does not import again.
 if(current?.id===id&&current.publicationFailure?.attemptId===`data-${runId}-${attempt}`&&current.previousId===parentId&&current.published){await readFailedEvidence(current.publicationFailure,current.published);return current;}
 if(!current||current.id!==parentId||current.attempt.outcome!=="running"||current.attempt.completedAt!==null)throw Error("Failed observation parent changed or completed");
 const [run,jobs,artifacts]=await Promise.all([get(`/actions/runs/${runId}/attempts/${attempt}`),get(`/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`),get(`/actions/runs/${runId}/artifacts?per_page=100`)]);
 if(jobs.total_count>100||artifacts.total_count>100)throw Error("Failed execution metadata exceeds bounded selection");
 const matches=artifacts.artifacts.filter((a:any)=>a.name===`screener-${runId}-${attempt}`);if(matches.length!==1)throw Error("Exact failed run artifact unavailable");
 const proof=failedRunProof(run,jobs,matches[0],runId,attempt),files=await extract(await downloadFailedArtifact(matches[0]));
 const verified=await verifyFailedObservation(files,proof),immutableStart=await readArchivedJournal(stateUrl(parentId));
 if(objectHash(immutableStart)!==objectHash(verified.start)||objectHash(archiveEconomicReview(current).journal)!==objectHash(verified.start))throw Error("Failed start differs from immutable current parent");
 const baseline=await readSnapshot(verified.start.published!);
 if(objectHash({...baseline,publication:verified.start})!==objectHash(verified.bundle.baseline))throw Error("Failed capture baseline differs from retained immutable snapshot");
 const at=new Date().toISOString();
 const manifest:FailedEvidenceManifest={schema:1,kind:"failed-publication-observation",journalId:id,attemptId:verified.start.attempt.id,startJournalId:parentId,startParentId:verified.start.previousId!,run:proof,archivedAt:at,
  observedAt:verified.data.updatedAt,reportCompletedAt:verified.report.completedAt,published:verified.start.published!,files:FAILED_FILES.map(name=>({name,bytes:files[name].byteLength,sha256:sha256(files[name])})),unresolvedSha256:objectHash(verified.observations),unresolvedCount:verified.observations.length,replay:verified.replay};
 const manifestBytes=Buffer.from(JSON.stringify(manifest)),journal=importFailedObservations(archiveEconomicReview(current).journal,verified.start,verified.observations,manifest,manifestBytes,id,at);
 if(mode==="prepare")await writeFile(output!,JSON.stringify({mode:"review-only-failed-observations-no-publication",expectedParent:parentId,manifest,journal},null,2),{flag:"wx"});
 else {
  const latest=await latestJournal();if(!latest||objectHash(archiveEconomicReview(latest).journal)!==objectHash(verified.start))throw Error("Failed observation parent changed before promotion");
  await verifyCorrectionDeployment();
  await publishJournal(journal,{"failed-evidence.json":manifestBytes,...Object.fromEntries(FAILED_FILES.map(name=>[`failed-${name}`,files[name]]))});
 }
 console.log(JSON.stringify({mode,journal:id,expectedParent:parentId,failedAttempt:verified.start.attempt.id,retainedPublication:journal.published?.id,unresolved:verified.observations.length}));return journal;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)preserveFailedObservation(process.argv[2],process.argv[3],process.argv[4],process.argv[5],process.argv[6]).catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
