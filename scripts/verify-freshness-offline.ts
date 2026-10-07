import {readFile,mkdir,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {gzipSync,gunzipSync} from "node:zlib";
import {replayDataPipeline,encodeSourceBundle} from "../lib/dataPipeline";
import {pipelineIntegrityErrors,pipelineOutputHash} from "../lib/pipelineIntegrity";
import {contentHash,objectHash,type SourceBundle} from "../lib/sourceBundle";
import {queryScreener} from "../lib/screenerQuery";
import {initialRecovery,publicRecovery,updateObligations} from "../lib/freshnessRecovery";
import {parseJournal} from "../lib/snapshotArchive";
import {READER_COMPATIBILITY} from "../lib/pipelineRelease";
import {snapshotErrors} from "../lib/publication";

async function main(){
 const [rawPath,dataPath,outputPath]=process.argv.slice(2);
 if(!rawPath||!dataPath||!outputPath)throw new Error("Usage: npx tsx scripts/verify-freshness-offline.ts <preserved-bundle.gz> <preserved-data.gz> <external-qa-directory>");
 const output=resolve(outputPath);if(output.startsWith(resolve(".")+"\\")||output.startsWith(resolve(".")+"/"))throw new Error("QA evidence must stay outside the checkout");
 const bytes=await readFile(rawPath),bundle=JSON.parse(gunzipSync(bytes).toString()) as SourceBundle;
 const archived=JSON.parse(gunzipSync(await readFile(dataPath)).toString());
 globalThis.fetch=async()=>{throw new Error("Offline QA forbids provider networking");};
 const original=await replayDataPipeline(bundle,contentHash(bytes));
 const originalErrors=[...snapshotErrors(original),...pipelineIntegrityErrors(original)];
 if(pipelineOutputHash(original)!==pipelineOutputHash(archived)||objectHash(original.pipeline)!==objectHash(archived.pipeline))originalErrors.push("Original archive hash replay differs");
 const derivedBundle={...bundle,pipelineSchema:2 as const},derivedBytes=encodeSourceBundle(derivedBundle);
 const derived=await replayDataPipeline(derivedBundle,contentHash(derivedBytes)),errors=[...snapshotErrors(derived),...pipelineIntegrityErrors(derived)];
 let maximumPageBytes=0;
 for(let page=1;page<=Math.ceil(derived.coins.length/200);page++)maximumPageBytes=Math.max(maximumPageBytes,Buffer.byteLength(JSON.stringify(queryScreener(derived,undefined,[],page,200))));
 const recovery=updateObligations(initialRecovery(),derived,"data-offline-reinterpretation");
 const legacyJournal=parseJournal(JSON.parse(await readFile(join(dirname(dataPath),"status.json"),"utf8")));
 const journal={...legacyJournal,schema:2 as const,recovery:{...recovery,legacyAttemptId:legacyJournal.attempt.id}};
 const status={...journal,compatibility:READER_COMPATIBILITY,collectionRelease:{writerSchema:2,schedule:"four-daily",phaseADeploymentId:"dpl_offlineFixture"},publicRecovery:publicRecovery(journal,Date.parse(journal.createdAt))};
 const derivedData=gzipSync(JSON.stringify(derived));
 const report={mode:"offline-legacy-replay-and-retrospective-schema2-reinterpretation",original:{schema:original.pipeline?.schema,rawHash:contentHash(bytes),pipeline:original.pipeline,rows:original.coins.length,receipts:bundle.receipts.length,errors:originalErrors},
  derived:{schema:2,rawHash:contentHash(derivedBytes),pipeline:derived.pipeline,freshness:derived.freshness,rows:derived.coins.length,errors,maximumPageBytes,recoveryBytes:Buffer.byteLength(JSON.stringify(recovery)),pendingDates:recovery.obligations.length,
   requests:bundle.receipts.length,rateLimited:bundle.receipts.filter(r=>r.status===429).length,snapshotBytes:Buffer.byteLength(JSON.stringify(derived)),snapshotGzipBytes:derivedData.byteLength,journalBytes:Buffer.byteLength(JSON.stringify(journal)),retrospectiveStatusProjectionBytes:Buffer.byteLength(JSON.stringify(status))},limitations:"Schema2 and its status-size fixture are offline reinterpretations of preserved bytes, not a live schema2 capture or operational acceptance."};
 await mkdir(output,{recursive:true});await writeFile(join(output,"schema2-derived-data.json.gz"),derivedData);await writeFile(join(output,"schema2-derived-source-bundle.json.gz"),derivedBytes);await writeFile(join(output,"schema2-status-size-fixture.json"),JSON.stringify(status));await writeFile(join(output,"offline-freshness-report.json"),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));if(originalErrors.length||errors.length||maximumPageBytes>=4_500_000)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
