import {writeFile} from "node:fs/promises";
import {gunzipSync} from "node:zlib";
import {pathToFileURL} from "node:url";
import {readJournal,readArchivedJournal,readSnapshot,sha256,checkArchiveUrl} from "../lib/snapshotArchive";
import {stateUrl,JOURNAL_REPOSITORY} from "../lib/publication";
import {objectHash,type SourceBundle} from "../lib/sourceBundle";
import {replayDataPipeline} from "../lib/dataPipeline";
import {pipelineOutputHash} from "../lib/pipelineIntegrity";
import {preparePublicationCorrection} from "../lib/publicationCorrection";
import {verifyWriterActivation,verifyCorrectionDeployment} from "../lib/pipelineRelease";
import {latestJournal,publishJournal} from "./github-journal";
import type {PublishedSnapshot} from "../lib/publicationTypes";

export function correctionWriteGuard() {
 if(process.env.GITHUB_ACTIONS!=="true"||process.env.GITHUB_REPOSITORY!==JOURNAL_REPOSITORY||process.env.GITHUB_REF!=="refs/heads/main"||
  process.env.GITHUB_EVENT_NAME!=="workflow_dispatch"||process.env.SCREENER_POINTER_CORRECTION!=="true"||!/^\d+$/.test(process.env.GITHUB_RUN_ID??"")||!/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT??""))throw new Error("Correction commit requires the serialized maintenance workflow");
}
async function original(ref:PublishedSnapshot) {
 const data=await readSnapshot(ref);if(!ref.rawBundleUrl||!ref.rawBundleSha256)throw new Error("Correction requires original source proof");
 checkArchiveUrl(ref.rawBundleUrl);const response=await fetch(ref.rawBundleUrl,{cache:"no-store",signal:AbortSignal.timeout(90_000)});
 if(!response.ok)throw new Error(`Correction source archive HTTP ${response.status}`);
 const bytes=new Uint8Array(await response.arrayBuffer());if(sha256(bytes)!==ref.rawBundleSha256)throw new Error("Correction raw source hash mismatch");
 const bundle=JSON.parse(gunzipSync(bytes,{maxOutputLength:500_000_000}).toString()) as SourceBundle,replayed=await replayDataPipeline(bundle,sha256(bytes));
 if(objectHash(data.pipeline)!==objectHash(replayed.pipeline))throw new Error("Correction archive replay mismatch");
 return {data,bundle};
}
export async function correctPublication(mode:string,parentId:string,targetId:string,output?:string) {
 if(!["prepare","commit"].includes(mode)||![parentId,targetId].every(id=>/^data-[a-zA-Z0-9-]+$/.test(id))||mode==="prepare"&&!output)throw new Error("Usage: correct-publication prepare|commit expected-parent target-confirmed-journal [plan-output]");
 if(mode==="commit"){correctionWriteGuard();await verifyWriterActivation();await verifyCorrectionDeployment();}
 const current=mode==="commit"?await latestJournal():await readJournal();
 if(!current||current.id!==parentId||!["published","blocked"].includes(current.attempt.outcome)||!current.published||!Number.isFinite(Date.parse(current.attempt.completedAt??"")))throw new Error("Correction parent changed or is not a completed publication");
 const originalId=current.published.availabilityConfirmedAt?current.published.id.replace(/-complete$/,"-confirmed"):current.published.id;
 const originalJournal=await readArchivedJournal(stateUrl(originalId));
 const target=await readArchivedJournal(stateUrl(targetId));if(!target.published)throw new Error("Correction target has no publication");
 const [bad,good]=await Promise.all([original(current.published),original(target.published)]);
 if(!bad.bundle.baseline||pipelineOutputHash(bad.bundle.baseline)!==pipelineOutputHash(good.data))throw new Error("Correction target differs from original captured baseline");
 const id=mode==="commit"?`data-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-correction`:`data-plan-${Date.now()}-correction`;
 const result=preparePublicationCorrection(current,target,bad.data,good.data,bad.bundle.baseline?.publication?.published,id,new Date().toISOString(),good.bundle.baseline,originalJournal);
 if(mode==="prepare")await writeFile(output!,JSON.stringify({mode:"review-only-no-collection",expectedParent:parentId,...result},null,2),{flag:"wx"});
 else {
  if((await latestJournal())?.id!==parentId)throw new Error("Correction parent changed before promotion");
  await publishJournal(result.journal,{"correction.json":Buffer.from(JSON.stringify(result.correction))});
 }
 console.log(JSON.stringify({mode,journal:id,expectedParent:parentId,restoredPublication:target.published.id,readiness:result.correction.readiness}));
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)correctPublication(process.argv[2],process.argv[3],process.argv[4],process.argv[5]).catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
