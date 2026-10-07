import { readFile,writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const base="https://crypto-valuation-screener.vercel.app";
const stages=["primary","catchup1","catchup2"];
export function assertPhaseAProof(value,expectedCommit) {
  if (!value || value.base!==base || value.compatibility?.release!=="four-daily-freshness-v2" ||
    JSON.stringify(value.compatibility.pipelineSchemas)!=="[1,2]" || JSON.stringify(value.compatibility.journalSchemas)!=="[1,2]" ||
    value.collectionRelease?.writerSchema!==1 || value.collectionRelease?.schedule!=="legacy" || value.collectionRelease?.phaseADeploymentId!==null ||
    value.deployment?.environment!=="production" || value.deployment.codeCommit!==expectedCommit || !/^[a-f0-9]{40}$/.test(expectedCommit) ||
    !/^dpl_[a-zA-Z0-9]+$/.test(value.deployment.id) || !/^https:\/\/crypto-valuation-screener-[a-zA-Z0-9-]+\.vercel\.app$/.test(value.deployment.url)) throw new Error("Exact canonical Phase A reader/deployment proof required");
  return {base,readerRelease:value.compatibility.release,codeCommit:expectedCommit,deploymentId:value.deployment.id,deploymentUrl:value.deployment.url};
}
export async function readPhaseAProof(expectedCommit,fetcher=fetch) {
  const response=await fetcher(`${base}/api/status`,{cache:"no-store",signal:AbortSignal.timeout(15_000),redirect:"error"});
  if(!response.ok) throw new Error("Canonical reader unavailable");
  const value={...await response.json(),base},proof=assertPhaseAProof(value,expectedCommit);
  const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if(!bypass)throw new Error("Protected Phase A reader proof credential is unavailable");
  const pinned=await fetcher(`${proof.deploymentUrl}/api/status`,{cache:"no-store",signal:AbortSignal.timeout(15_000),redirect:"error",headers:{"x-vercel-protection-bypass":bypass}});
  if(!pinned.ok) throw new Error("Phase A deployment proof unavailable");
  const pinnedProof=assertPhaseAProof({...await pinned.json(),base},expectedCommit);
  if(JSON.stringify(proof)!==JSON.stringify(pinnedProof)) throw new Error("Canonical and immutable deployment identities differ");
  return proof;
}
export function phaseBFiles(contract,workflow,proof) {
  if(contract.writerSchema!==1||contract.schedule!=="legacy"||contract.phaseA!==null) throw new Error("Activation requires the inactive Phase A contract");
  const scheduleBlock='  schedule:\n    # Native occurrences are recovery wakes; only authenticated receipts prove regular slots.\n    - cron: "0 2,8,14,20 * * *"\n    - cron: "30 2,8,14,20 * * *"\n    - cron: "0 3,9,15,21 * * *"\n    - cron: "0 4,10,16,22 * * *"\n    - cron: "0 0,6,12,18 * * *"\n';
  if(!/  schedule:\r?\n[\s\S]*?  workflow_dispatch:/.test(workflow)) throw new Error("Workflow schedule block missing");
  return {contract:{...contract,writerSchema:2,schedule:"four-daily",phaseA:proof},workflow:workflow.replace(/  schedule:\r?\n[\s\S]*?(?=  workflow_dispatch:)/,scheduleBlock),
    vercel:{$schema:"https://openapi.vercel.sh/vercel.json",crons:stages.flatMap((stage,i)=>[2,8,14,20].map(hour=>({path:`/api/cron/collect?stage=${stage}`,schedule:`0 ${(hour+i*2)%24} * * *`})))} };
}
async function main() {
  const mode=process.argv[2],expectedCommit=process.argv[3];
  const paths={contract:resolve("lib/pipeline-release.json"),workflow:resolve(".github/workflows/daily-snapshot.yml"),vercel:resolve("vercel.json")};
  const contract=JSON.parse(await readFile(paths.contract,"utf8")),workflow=await readFile(paths.workflow,"utf8");
  if (mode==="pause") {
    if(contract.writerSchema!==2||!contract.phaseA) throw new Error("Paused rollback requires existing schema-2 compatible readers");
    await writeFile(paths.contract,JSON.stringify({...contract,schedule:"paused"},null,2)+"\n");
    await writeFile(paths.vercel,JSON.stringify({$schema:"https://openapi.vercel.sh/vercel.json",crons:[]},null,2)+"\n");
    // Scheduled GitHub jobs also stop; explicit signed stale cron paths return inactive-stage.
    await writeFile(paths.workflow,workflow.replace(/  schedule:\r?\n[\s\S]*?(?=  workflow_dispatch:)/,""));
    console.log("Prepared compatible paused rollback. Review, commit and deploy only through the canonical production wrapper.");return;
  }
  if(mode!=="activate") throw new Error("Usage: node scripts/prepare-freshness-release.mjs activate <verified-phase-a-commit> | pause");
  const proof=await readPhaseAProof(expectedCommit);
  const prepared=phaseBFiles(contract,workflow,proof);
  await writeFile(paths.contract,JSON.stringify(prepared.contract,null,2)+"\n");
  await writeFile(paths.workflow,prepared.workflow);await writeFile(paths.vercel,JSON.stringify(prepared.vercel,null,2)+"\n");
  console.log("Prepared Phase B after exact canonical reader/deployment verification. This command does not deploy or collect.");
}
if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
