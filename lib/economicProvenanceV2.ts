import rawArtifact from "./economic-policy-v2.json";
import type {EconomicContract} from "./economicPolicy";
import type {EconomicProvenance} from "./economicTypes";
import {sourceFetch,sourceNow,sourceObservedAt,sourceReceipt,sourceReplayActive,sourceEconomicProvenance,recordEconomicProvenance,objectHash} from "./sourceBundle";
import {contextHash,gitBlobHash,projectEconomicContext,CONTEXT_FILE_LIMIT,CONTEXT_TOTAL_LIMIT} from "./economicContext";
import {typeSurfaceMatches,type ReviewedDimensionAddition} from "./economicTypeSurface";
import {PROVENANCE_COMMIT_URL,provenanceTreeUrl} from "./economicDecisionSourceV1";
export const provenanceBlobUrl=(sha:string)=>`https://api.github.com/repos/DefiLlama/dimension-adapters/git/blobs/${sha}`;
type ContextFile={path:string;blobSha1:string;sha256:string;body:string};
const artifact=rawArtifact as unknown as {contracts:(EconomicContract&{runtimeContext:{roots:string[];sha256:string}})[];context:{files:ContextFile[];typeSurface:ContextFile&{additions:ReviewedDimensionAddition[]}}};
const files=[...new Map([...artifact.contracts.flatMap(c=>c.sourceClosure),...artifact.context.files].map(f=>[f.path,f])).values()];

/** Two tree reads and at most four changed fixed-file reads; raw content and tree identities stay receipt-bound. */
export async function acquireEconomicProvenanceV2() {
 const result:EconomicProvenance={state:"unavailable",repository:"DefiLlama/dimension-adapters",observedAt:new Date(sourceNow()).toISOString(),commit:null,tree:null,receiptHashes:[],files:files.map(f=>({path:f.path,expected:f.blobSha1,actual:null})),limitation:"provider-execution-revision-unattested",
  runtime:{scope:"adapter-local-with-reviewed-shared-fee-surface",typeSurface:"unavailable",contexts:[],rawChangedPaths:[]}};
 const get=async(url:string,blob=false)=>{const response=await sourceFetch(url,{cache:"no-store",redirect:"error",headers:{accept:"application/vnd.github+json",...(process.env.GITHUB_TOKEN?{authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})}},{timeout:10_000,deadline:Date.now()+20_000,...(blob?{maxBytes:1_500_000}:{})});const receipt=sourceReceipt(url);if(receipt&&!result.receiptHashes.includes(receipt.sha256))result.receiptHashes.push(receipt.sha256);result.observedAt=sourceObservedAt(url);
  if(!response.ok||!receipt||Date.parse(receipt.observedAt)<sourceNow()-300_000||Date.parse(receipt.observedAt)>sourceNow()+9*60_000)throw Error("Economic provenance unavailable");return response.json();};
 try {
  const commit=await get(PROVENANCE_COMMIT_URL);if(!/^[a-f0-9]{40}$/.test(commit.sha)||!/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha)||!Number.isFinite(Date.parse(commit.commit?.committer?.date))||Date.parse(commit.commit.committer.date)>sourceNow()+300_000)throw Error("Invalid economic commit");result.commit=commit.sha;result.tree=commit.commit.tree.sha;
  const tree=await get(provenanceTreeUrl(result.tree!));if(tree.sha!==result.tree||tree.truncated!==false||tree.url!==`https://api.github.com/repos/DefiLlama/dimension-adapters/git/trees/${result.tree}`||!Array.isArray(tree.tree))throw Error("Invalid economic tree");
  const entries=new Map<string,string>();for(const f of tree.tree){if(typeof f.path!=="string"||entries.has(f.path)||!/^[a-f0-9]{40}$/.test(f.sha))throw Error("Invalid economic tree entry");entries.set(f.path,f.type==="blob"?f.sha:"");}
  result.files=result.files.map(f=>({...f,actual:entries.get(f.path)||null}));result.runtime!.rawChangedPaths=result.files.filter(f=>f.actual!==f.expected).map(f=>f.path);
  let total=0;
  const content=async(f:{path:string;blobSha1:string;sha256:string;body:string})=>{
   const actual=entries.get(f.path);if(!actual)throw Error("Missing fixed economic context");let body=f.body;
   if(actual!==f.blobSha1){const blob=await get(provenanceBlobUrl(actual),true);if(blob.sha!==actual||blob.url!==provenanceBlobUrl(actual)||blob.encoding!=="base64"||!Number.isInteger(blob.size)||blob.size<0||blob.size>CONTEXT_FILE_LIMIT||typeof blob.content!=="string")throw Error("Invalid economic context blob");const encoded=blob.content.replace(/\s/g,"");if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw Error("Invalid context encoding");const bytes=Buffer.from(encoded,"base64");if(bytes.byteLength!==blob.size)throw Error("Context length mismatch");body=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
   const bytes=Buffer.byteLength(body);if(bytes>CONTEXT_FILE_LIMIT||(total+=bytes)>CONTEXT_TOTAL_LIMIT||gitBlobHash(body)!==actual)throw Error("Context hash/size mismatch");return body;
  };
  const contexts={} as Record<"package.json"|"pnpm-lock.yaml"|"tsconfig.json",string>;
  for(const f of artifact.context.files)contexts[f.path as keyof typeof contexts]=await content(f);
  const typeBody=await content(artifact.context.typeSurface);
  try {result.runtime!.typeSurface=typeSurfaceMatches(artifact.context.typeSurface.body,typeBody,artifact.context.typeSurface.additions)?"matched":"changed";}catch{result.runtime!.typeSurface="changed";}
  for(const c of artifact.contracts){let sha256:string|null=null;try{sha256=contextHash(projectEconomicContext(contexts,c.runtimeContext.roots));}catch{}result.runtime!.contexts.push({slug:c.slug,sha256});}
  result.state=result.runtime!.typeSurface==="matched"&&artifact.contracts.every(c=>c.runtimeContext.sha256===result.runtime!.contexts.find(r=>r.slug===c.slug)?.sha256&&c.sourceClosure.filter(f=>f.role==="runtime").every(f=>entries.get(f.path)===f.blobSha1))?"verified":"changed";
 } catch {
  // Unavailable, oversized or unbound evidence cannot renew an approval.
 }
 // Failed responses are evidence too; the selected fixed URL set is bounded by the source session.
 for(const url of [PROVENANCE_COMMIT_URL,...(result.tree?[provenanceTreeUrl(result.tree)]:[]),...result.files.filter(f=>f.actual&&f.actual!==f.expected&&[...artifact.context.files.map(f=>f.path),artifact.context.typeSurface.path].includes(f.path)).map(f=>provenanceBlobUrl(f.actual!))]){const r=sourceReceipt(url);if(r&&!result.receiptHashes.includes(r.sha256))result.receiptHashes.push(r.sha256);}
 if(sourceReplayActive()){if(objectHash(result)!==objectHash(sourceEconomicProvenance()))throw Error("Economic provenance replay mismatch");}else recordEconomicProvenance(result);
}
