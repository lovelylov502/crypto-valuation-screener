import {readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import identity from "../lib/economic-policy-v2.identity.json" with {type:"json"};
const base="https://crypto-valuation-screener.vercel.app",release="metric-economic-decisions-v2";
function proof(value,expectedCommit) {
  if(value?.compatibility?.release!==release||JSON.stringify(value.compatibility.pipelineSchemas)!=="[1,2]"||JSON.stringify(value.compatibility.journalSchemas)!=="[1,2]"||!value.compatibility.economicPolicies?.some(p=>JSON.stringify(p)===JSON.stringify(identity))||
    value.collectionRelease?.schedule!=="paused"||value.collectionRelease?.writerSchema!==2||value.collectionRelease?.economic?.active!==false||JSON.stringify(value.collectionRelease?.economic?.policy)!==JSON.stringify(identity)||
    value.deployment?.environment!=="production"||value.deployment.codeCommit!==expectedCommit||!/^[a-f0-9]{40}$/.test(expectedCommit)||!/^dpl_[a-zA-Z0-9]+$/.test(value.deployment.id)||!/^https:\/\/crypto-valuation-screener-[a-zA-Z0-9-]+\.vercel\.app$/.test(value.deployment.url))throw new Error("Exact compatible paused economic reader proof required");
  return {base,readerRelease:release,codeCommit:expectedCommit,deploymentId:value.deployment.id,deploymentUrl:value.deployment.url};
}
export async function readEconomicReaderProof(expectedCommit,fetcher=fetch) {
  const response=await fetcher(base+"/api/status",{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error("Canonical paused reader unavailable");
  const value=await response.json(),reader=proof(value,expectedCommit),bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if(!bypass)throw new Error("Protected economic reader proof credential unavailable");
  const pinned=await fetcher(reader.deploymentUrl+"/api/status",{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15_000),headers:{"x-vercel-protection-bypass":bypass}});
  if(!pinned.ok)throw new Error("Protected paused reader unavailable");
  if(JSON.stringify(reader)!==JSON.stringify(proof(await pinned.json(),expectedCommit)))throw new Error("Canonical and pinned economic reader identities differ");
  return reader;
}
export function economicActivationFile(contract,reader) {
  if(contract.readerRelease!==release||contract.writerSchema!==2||contract.schedule!=="paused"||contract.economic?.active!==false||JSON.stringify(contract.economic.policy)!==JSON.stringify(identity)||contract.economic.reader!==null||contract.phaseA?.readerRelease!=="four-daily-freshness-v2"||reader.readerRelease!==release||reader.deploymentId===contract.phaseA.deploymentId)throw new Error("Activation requires distinct inactive economic readers");
  return {...contract,schedule:"four-daily",economic:{...contract.economic,active:true,reader}};
}
export function economicPauseFile(contract) {
  if(contract.readerRelease!==release||!contract.economic)throw new Error("Compatible economic reader required");
  return {...contract,schedule:"paused",economic:{...contract.economic,active:false,reader:null}};
}
async function main(){
  const mode=process.argv[2],path=resolve("lib/pipeline-release.json"),contract=JSON.parse(await readFile(path,"utf8"));
  if(mode==="pause") { await writeFile(path,JSON.stringify(economicPauseFile(contract),null,2)+"\n");return; }
  if(mode!=="activate")throw new Error("Usage: node scripts/prepare-economic-release.mjs activate <verified-paused-reader-commit> | pause");
  const reader=await readEconomicReaderProof(process.argv[3]);await writeFile(path,JSON.stringify(economicActivationFile(contract,reader),null,2)+"\n");
  console.log("Prepared separate economic-policy activation. Review and deploy through the canonical production wrapper; no collection was run.");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
