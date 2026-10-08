import contract from "./pipeline-release.json";
import { ECONOMIC_POLICY_IDENTITY as ECONOMIC_POLICY,ECONOMIC_POLICIES,knownEconomicPolicy } from "./economicPolicyIdentity";
import type {EconomicPolicyIdentity} from "./economicTypes";
export function activeEconomicPolicy() { return (contract as { economic?: { active: boolean } }).economic?.active ? ECONOMIC_POLICY : undefined; }

export interface CollectionRelease { writerSchema:1|2; schedule:"legacy"|"four-daily"|"paused"; phaseADeploymentId:string|null; economic?:{policy:EconomicPolicyIdentity;active:boolean;readerDeploymentId:string|null} }
export function parseCollectionRelease(value:unknown):CollectionRelease {
  const r=value as CollectionRelease;
  if(!r||![1,2].includes(r.writerSchema)||!["legacy","four-daily","paused"].includes(r.schedule)||r.schedule==="legacy"&&r.writerSchema!==1||r.schedule!=="legacy"&&r.writerSchema!==2||r.phaseADeploymentId!==null&&!/^dpl_[a-zA-Z0-9]+$/.test(r.phaseADeploymentId))throw new Error("Invalid live collection release");
  if(r.economic&&(!knownEconomicPolicy(r.economic.policy)||typeof r.economic.active!=="boolean"||r.economic.readerDeploymentId!==null&&!/^dpl_[a-zA-Z0-9]+$/.test(r.economic.readerDeploymentId)))throw new Error("Invalid live economic release");
  return {writerSchema:r.writerSchema,schedule:r.schedule,phaseADeploymentId:r.phaseADeploymentId,...(r.economic?{economic:r.economic}:{})};
}

export const READER_COMPATIBILITY = { release: contract.readerRelease, pipelineSchemas: [1, 2], journalSchemas: [1, 2],economicPolicies:["legacy",...ECONOMIC_POLICIES] };
export function readerDeployment() { return { environment:process.env.VERCEL_ENV??"local",codeCommit:process.env.VERCEL_GIT_COMMIT_SHA??null,
  id:process.env.VERCEL_DEPLOYMENT_ID??null,url:process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:null }; }
export const activeWriterSchema = (): 1 | 2 => contract.writerSchema === 2 ? 2 : 1;
export const fourDailyActive = () => contract.schedule === "four-daily";
export const writerPaused = () => contract.schedule === "paused";
export function collectionReleaseState():CollectionRelease { return parseCollectionRelease({ writerSchema:activeWriterSchema(),schedule:contract.schedule,
  phaseADeploymentId:(contract.phaseA as null|{deploymentId:string})?.deploymentId??null,...((contract as EconomicReleaseContract).economic?{economic:{policy:ECONOMIC_POLICY,active:!!activeEconomicPolicy(),readerDeploymentId:(contract as EconomicReleaseContract).economic?.reader?.deploymentId??null}}:{}) }); }
type ReaderProof={base:string;readerRelease:string;codeCommit:string;deploymentId:string;deploymentUrl:string};
type EconomicReleaseContract={economic?:{active:boolean;policy:EconomicPolicyIdentity;reader:ReaderProof|null}};
const currentEconomicPolicy=(value:unknown)=>knownEconomicPolicy(value)&&value.algorithm===ECONOMIC_POLICY.algorithm&&value.artifact===ECONOMIC_POLICY.artifact&&value.sha256===ECONOMIC_POLICY.sha256;
export async function verifyCorrectionDeployment(fetcher=fetch) {
  if(!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA??""))throw new Error("Correction executing revision unavailable");
  const response=await fetcher("https://crypto-valuation-screener.vercel.app/api/status",{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10_000)}),live=await response.json();
  if(!response.ok||live.deployment?.environment!=="production"||live.deployment?.codeCommit!==process.env.GITHUB_SHA||!/^dpl_[a-zA-Z0-9]+$/.test(live.deployment?.id??"")||
    live.compatibility?.release!==READER_COMPATIBILITY.release||JSON.stringify(live.compatibility?.pipelineSchemas)!=="[1,2]"||JSON.stringify(live.compatibility?.journalSchemas)!=="[1,2]"||
    live.collectionRelease?.writerSchema!==2||live.collectionRelease?.schedule!=="four-daily"||live.collectionRelease?.phaseADeploymentId!==(contract.phaseA as null|{deploymentId:string})?.deploymentId)throw new Error("Correction active deployment revision changed or paused");
}
export async function verifyWriterActivation(fetcher = fetch) {
  if (writerPaused()) throw new Error("Collection paused by compatible rollback");
  const base = "https://crypto-valuation-screener.vercel.app";
  const economic=(contract as EconomicReleaseContract).economic;
  if(economic) {
    if(!economic.active||!currentEconomicPolicy(economic.policy)||!economic.reader||!fourDailyActive()||activeWriterSchema()!==2)throw new Error("Economic writer requires a verified paused reader and separate activation");
    const historical=contract.phaseA as ReaderProof|null,reader=economic.reader;
    if(!historical||historical.readerRelease!=="four-daily-freshness-v2"||reader.readerRelease!==READER_COMPATIBILITY.release||historical.deploymentId===reader.deploymentId)throw new Error("Economic reader proof is not distinct from historical Phase A");
    for(const p of [historical,reader])if(p.base!==base||!/^[a-f0-9]{40}$/.test(p.codeCommit)||!/^dpl_[a-zA-Z0-9]+$/.test(p.deploymentId)||!/^https:\/\/crypto-valuation-screener-[a-zA-Z0-9-]+\.vercel\.app$/.test(p.deploymentUrl))throw new Error("Invalid economic reader deployment proof");
    const executing=process.env.GITHUB_SHA??process.env.VERCEL_GIT_COMMIT_SHA;
    if(!/^[a-f0-9]{40}$/.test(executing??""))throw new Error("Executing economic revision unavailable");
    const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();if(!bypass)throw new Error("Protected reader proof credential is unavailable");
    const responses=await Promise.all([base,reader.deploymentUrl,historical.deploymentUrl].map((url,i)=>fetcher(`${url}/api/status`,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10_000),...(i?{headers:{"x-vercel-protection-bypass":bypass}}:{})})));
    if(responses.some(r=>!r.ok))throw new Error("Economic reader proof unavailable");
    const [current,pinned,old]=await Promise.all(responses.map(r=>r.json()));
    const identity=(v:any,p?:ReaderProof)=>v.deployment?.environment==="production"&&/^dpl_[a-zA-Z0-9]+$/.test(v.deployment?.id??"")&&/^[a-f0-9]{40}$/.test(v.deployment?.codeCommit??"")&&(!p||v.deployment.id===p.deploymentId&&v.deployment.codeCommit===p.codeCommit&&v.deployment.url===p.deploymentUrl);
    const schemas=(v:any)=>JSON.stringify(v.compatibility?.pipelineSchemas)==="[1,2]"&&JSON.stringify(v.compatibility?.journalSchemas)==="[1,2]";
    const compatible=(v:any)=>v.compatibility?.release===READER_COMPATIBILITY.release&&schemas(v)&&v.compatibility?.economicPolicies?.some((p:unknown)=>currentEconomicPolicy(p));
    if(!identity(current)||!identity(pinned,reader)||!compatible(current)||!compatible(pinned)||pinned.collectionRelease?.schedule!=="paused"||pinned.collectionRelease?.economic?.active!==false||!currentEconomicPolicy(pinned.collectionRelease?.economic?.policy)||
      !identity(old,historical)||!schemas(old)||old.compatibility?.release!==historical.readerRelease)throw new Error("Economic compatible reader deployment unverified");
    if(current.deployment.codeCommit!==executing||current.collectionRelease?.writerSchema!==2||current.collectionRelease?.schedule!=="four-daily"||current.collectionRelease?.economic?.active!==true||!currentEconomicPolicy(current.collectionRelease?.economic?.policy)||current.collectionRelease?.economic?.readerDeploymentId!==reader.deploymentId||current.collectionRelease?.phaseADeploymentId!==historical.deploymentId)throw new Error("Canonical economic writer revision or activation fence changed");
    return;
  }
  if (activeWriterSchema() === 1 && !fourDailyActive()) {
    const response=await fetcher(`${base}/api/status`,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10_000)}),live=await response.json();
    const recognizedLegacy=live.compatibility===undefined&&live.collectionRelease===undefined&&live.schema===1&&live.attempt&&["running","published","blocked"].includes(live.attempt.outcome)&&
      live.published&&/^data-[a-zA-Z0-9-]+$/.test(live.published.id)&&/^[a-f0-9]{64}$/.test(live.published.sha256??"")&&/^[a-f0-9]{40}$/.test(live.published.codeCommit??"")&&
      String(live.published.url??"").startsWith("https://github.com/lovelylov502/crypto-valuation-screener/releases/download/")&&Number.isFinite(Date.parse(live.published.dataAt??""));
    const readerPhase=live.compatibility?.release===READER_COMPATIBILITY.release&&JSON.stringify(live.compatibility.pipelineSchemas)==="[1,2]"&&JSON.stringify(live.compatibility.journalSchemas)==="[1,2]"&&
      live.collectionRelease?.writerSchema===1&&live.collectionRelease?.schedule==="legacy"&&live.deployment?.environment==="production"&&/^dpl_[a-zA-Z0-9]+$/.test(live.deployment.id??"")&&/^[a-f0-9]{40}$/.test(live.deployment.codeCommit??"");
    if(!response.ok||!recognizedLegacy&&!readerPhase)throw new Error("Canonical legacy writer fence is inactive, newer or paused");
    return;
  }
  const proof = contract.phaseA as null | { base: string; readerRelease: string; codeCommit: string; deploymentId:string; deploymentUrl:string };
  if (activeWriterSchema() !== 2 || !fourDailyActive() || !proof || proof.base !== base ||
    proof.readerRelease !== READER_COMPATIBILITY.release || !/^[a-f0-9]{40}$/.test(proof.codeCommit) || !/^dpl_[a-zA-Z0-9]+$/.test(proof.deploymentId) || !/^https:\/\/crypto-valuation-screener-[a-zA-Z0-9-]+\.vercel\.app$/.test(proof.deploymentUrl)) throw new Error("Phase B requires verified canonical Phase A readers");
  // Verify the immutable deployment proof even after canonical alias moves to Phase B.
  const compatible=(live:any)=>live.compatibility?.release===proof.readerRelease&&JSON.stringify(live.compatibility?.pipelineSchemas)==="[1,2]"&&JSON.stringify(live.compatibility?.journalSchemas)==="[1,2]"&&
    live.deployment?.environment==="production"&&/^dpl_[a-zA-Z0-9]+$/.test(live.deployment?.id??"")&&/^[a-f0-9]{40}$/.test(live.deployment?.codeCommit??"")&&/^https:\/\/crypto-valuation-screener-[a-zA-Z0-9-]+\.vercel\.app$/.test(live.deployment?.url??"");
  const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if(!bypass)throw new Error("Protected Phase A reader proof credential is unavailable");
  const responses=await Promise.all([base,proof.deploymentUrl].map((url,i)=>fetcher(`${url}/api/status`,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10_000),...(i===1?{headers:{"x-vercel-protection-bypass":bypass}}:{})})));
  if(responses.some(r=>!r.ok))throw new Error("Canonical compatible reader deployment is unverified");
  const [current,pinned]=await Promise.all(responses.map(r=>r.json()));
  if(responses.some(r=>!r.ok)||!compatible(current)||!compatible(pinned)||pinned.deployment.id!==proof.deploymentId||pinned.deployment.codeCommit!==proof.codeCommit||pinned.deployment.url!==proof.deploymentUrl) throw new Error("Canonical compatible reader deployment is unverified");
  if(current.collectionRelease?.writerSchema!==2||current.collectionRelease?.schedule!=="four-daily"||current.collectionRelease?.phaseADeploymentId!==proof.deploymentId)throw new Error("Canonical writer activation fence is inactive or paused");
}
