import contract from "./pipeline-release.json";

export interface CollectionRelease { writerSchema:1|2; schedule:"legacy"|"four-daily"|"paused"; phaseADeploymentId:string|null }
export function parseCollectionRelease(value:unknown):CollectionRelease {
  const r=value as CollectionRelease;
  if(!r||![1,2].includes(r.writerSchema)||!["legacy","four-daily","paused"].includes(r.schedule)||r.schedule==="legacy"&&r.writerSchema!==1||r.schedule!=="legacy"&&r.writerSchema!==2||r.phaseADeploymentId!==null&&!/^dpl_[a-zA-Z0-9]+$/.test(r.phaseADeploymentId))throw new Error("Invalid live collection release");
  return {writerSchema:r.writerSchema,schedule:r.schedule,phaseADeploymentId:r.phaseADeploymentId};
}

export const READER_COMPATIBILITY = { release: contract.readerRelease, pipelineSchemas: [1, 2], journalSchemas: [1, 2] };
export function readerDeployment() { return { environment:process.env.VERCEL_ENV??"local",codeCommit:process.env.VERCEL_GIT_COMMIT_SHA??null,
  id:process.env.VERCEL_DEPLOYMENT_ID??null,url:process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:null }; }
export const activeWriterSchema = (): 1 | 2 => contract.writerSchema === 2 ? 2 : 1;
export const fourDailyActive = () => contract.schedule === "four-daily";
export const writerPaused = () => contract.schedule === "paused";
export function collectionReleaseState():CollectionRelease { return parseCollectionRelease({ writerSchema:activeWriterSchema(),schedule:contract.schedule,
  phaseADeploymentId:(contract.phaseA as null|{deploymentId:string})?.deploymentId??null }); }
export async function verifyWriterActivation(fetcher = fetch) {
  if (writerPaused()) throw new Error("Collection paused by compatible rollback");
  const base = "https://crypto-valuation-screener.vercel.app";
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
