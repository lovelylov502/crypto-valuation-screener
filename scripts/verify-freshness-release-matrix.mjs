import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,relative,join} from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {phaseBFiles} from "./prepare-freshness-release.mjs";

// Pure local configuration fixtures. This never verifies a live proof, dispatches or collects.
const output=resolve(process.argv[2]??"");
if(!process.argv[2]||!relative(process.cwd(),output).startsWith(".."))throw new Error("Provide an evidence directory outside the repository");
mkdirSync(output,{recursive:true});
const paths=["lib/pipeline-release.json",".github/workflows/daily-snapshot.yml","vercel.json"],original=new Map(paths.map(p=>[p,readFileSync(p)]));
const hash=b=>createHash("sha256").update(b).digest("hex"),before=Object.fromEntries([...original].map(([p,b])=>[p,hash(b)]));
const contract=JSON.parse(original.get(paths[0])),workflow=original.get(paths[1]).toString("utf8");
const fixture={base:"https://crypto-valuation-screener.vercel.app",readerRelease:"four-daily-freshness-v2",codeCommit:"a".repeat(40),deploymentId:"dpl_offlinePhaseAFixture",deploymentUrl:"https://crypto-valuation-screener-offline-fixture.vercel.app"};
const report={startedAt:new Date().toISOString(),mode:"offline-configuration-fixtures-only",before,phases:[],restored:false};
function gates(phase) {
  const commands=[["tests","node_modules/vitest/vitest.mjs","run"],["typecheck","node_modules/typescript/bin/tsc","--noEmit"],["build","node_modules/next/dist/bin/next","build"],["deploy-contract","--test","scripts/deploy-contract.test.mjs"]];
  const result={phase,commands:[]};report.phases.push(result);
  for(const [label,...args] of commands) {console.log(`[offline-matrix] ${phase}: ${label}`);const r=spawnSync(process.execPath,args,{stdio:"inherit",env:process.env});result.commands.push({label,args,exitCode:r.status});if(r.status!==0)throw new Error(`${phase} ${label} failed`);}
}
try {
  const b=phaseBFiles(contract,workflow,fixture);
  writeFileSync(paths[0],JSON.stringify(b.contract,null,2)+"\n");writeFileSync(paths[1],b.workflow);writeFileSync(paths[2],JSON.stringify(b.vercel,null,2)+"\n");gates("PhaseB");
  writeFileSync(paths[0],JSON.stringify({...b.contract,schedule:"paused"},null,2)+"\n");writeFileSync(paths[1],b.workflow.replace(/  schedule:\r?\n[\s\S]*?(?=  workflow_dispatch:)/,""));writeFileSync(paths[2],JSON.stringify({$schema:"https://openapi.vercel.sh/vercel.json",crons:[]},null,2)+"\n");gates("CompatiblePausedRollback");
} catch(e) {report.error=e.message;process.exitCode=1;}
finally {for(const [p,b] of original)writeFileSync(p,b);report.after=Object.fromEntries(paths.map(p=>[p,hash(readFileSync(p))]));report.restored=JSON.stringify(report.before)===JSON.stringify(report.after);if(!report.restored)process.exitCode=1;console.log("[offline-matrix] PhaseA configuration restored byte-for-byte.");}
if(report.restored&&!report.error)try {gates("PhaseA");}catch(e){report.error=e.message;process.exitCode=1;}
report.completedAt=new Date().toISOString();writeFileSync(join(output,"release-matrix.json"),JSON.stringify(report,null,2)+"\n");
