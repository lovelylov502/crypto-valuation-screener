import legacy from "./fundamentalDefinitions.legacy-b519.json";
import { economicArtifact } from "./economicPolicy";
import type { EconomicDecision, EconomicMetric, EconomicProvenance } from "./economicTypes";
import { sourceEconomicPolicy, sourceEconomicProvenance, sourceFetch, sourceNow, sourceObservedAt, sourceReceipt, recordEconomicProvenance, sourceReplayActive, objectHash } from "./sourceBundle";
import {classifyHolderMethodology} from "./holderMethodology";

type Row = Record<string, unknown>;
const fields = ["Revenue","Fees","HoldersRevenue","ProtocolRevenue","SupplySideRevenue","UserFees"];
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g," ") : null;
export const PROVENANCE_COMMIT_URL = "https://api.github.com/repos/DefiLlama/dimension-adapters/commits/HEAD";
export const provenanceTreeUrl = (sha: string) => `https://api.github.com/repos/DefiLlama/dimension-adapters/git/trees/${sha}?recursive=1`;

/** Two receipt-bound repository reads; no retry, code crawl, or server-execution attestation. */
export async function acquireEconomicProvenance(): Promise<void> {
  if(!sourceEconomicPolicy())return;
  const dependencies = [...new Map(economicArtifact.contracts.flatMap(c=>c.sourceClosure).map(f=>[f.path,f])).values()];
  const result: EconomicProvenance = {state:"unavailable",repository:"DefiLlama/dimension-adapters",observedAt:new Date(sourceNow()).toISOString(),commit:null,tree:null,receiptHashes:[],
    files:dependencies.map(f=>({path:f.path,expected:f.blobSha1,actual:null})),limitation:"provider-execution-revision-unattested"};
  const get = async(url:string) => {
    const response=await sourceFetch(url,{cache:"no-store",redirect:"error",headers:{accept:"application/vnd.github+json",...(process.env.GITHUB_TOKEN?{authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})}}, {timeout:10_000,deadline:Date.now()+20_000});
    const receipt=sourceReceipt(url); if(receipt)result.receiptHashes.push(receipt.sha256);
    result.observedAt=sourceObservedAt(url);
    if(!response.ok)throw new Error("Provenance unavailable");
    if(!receipt||Date.parse(receipt.observedAt)<sourceNow()-300_000||Date.parse(receipt.observedAt)>sourceNow()+9*60_000)throw new Error("Provenance observation outside capture");
    return response.json();
  };
  try {
    const commit=await get(PROVENANCE_COMMIT_URL);
    if(!/^[a-f0-9]{40}$/.test(commit.sha)||!/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha)||!Number.isFinite(Date.parse(commit.commit?.committer?.date))||Date.parse(commit.commit.committer.date)>sourceNow()+300_000)throw new Error("Invalid provenance commit");
    result.commit=commit.sha;result.tree=commit.commit.tree.sha;
    const tree=await get(provenanceTreeUrl(result.tree!));
    if(tree.sha!==result.tree||tree.truncated!==false||!Array.isArray(tree.tree)||tree.url!==`https://api.github.com/repos/DefiLlama/dimension-adapters/git/trees/${result.tree}`)throw new Error("Invalid provenance tree");
    const entries=new Map<string,string>();
    for(const entry of tree.tree) { if(typeof entry.path!=="string"||entries.has(entry.path)||!/^[a-f0-9]{40}$/.test(entry.sha))throw new Error("Invalid provenance dependency identity"); entries.set(entry.path,entry.type==="blob"?entry.sha:""); }
    result.files=result.files.map(f=>({...f,actual:entries.get(f.path)||null}));
    result.state=result.files.every(f=>f.actual===f.expected)?"verified":"changed";
  } catch {
    for(const url of [PROVENANCE_COMMIT_URL,...(result.tree?[provenanceTreeUrl(result.tree)]:[])]) {
      const receipt=sourceReceipt(url);if(receipt&&!result.receiptHashes.includes(receipt.sha256))result.receiptHashes.push(receipt.sha256);
    }
    // Raw amounts remain available; unavailable repository evidence cannot renew an approval.
  }
  if(sourceReplayActive()) {
    if(objectHash(result)!==objectHash(sourceEconomicProvenance()))throw new Error("Economic provenance replay mismatch");
  } else recordEconomicProvenance(result);
}

export function economicDecision(row: Row, metric: EconomicMetric): EconomicDecision | undefined {
  const policy=sourceEconomicPolicy();if(!policy)return;
  const slug=String(row.slug), componentId=String(row.defillamaId??`unknown:${slug}`), method=(row.methodology??{}) as Row;
  const old=(legacy as Record<string,Record<string,any>>)[slug];
  const contract=economicArtifact.contracts.find(c=>c.providerId===componentId||c.slug===slug);
  const approval=contract?.decisions.find(d=>d.metric===metric);
  const expected=contract?.expectedDefinitions??old?.methodology??{};
  const changedFields=fields.filter(f=>text(method[f])!==text(old?.methodology?.[f]??expected[f]));
  const requiredFields=approval?.requiredDefinitionFields??fields;
  const provenance=sourceEconomicProvenance();
  const legacyMatch=!!old&&(!old.defillamaId||old.defillamaId===componentId)&&fields.every(f=>text(method[f])===text(old.methodology[f]));
  const identity=!!contract&&contract.providerId===componentId&&contract.slug===slug&&row.name===contract.expectedName&&row.module===contract.expectedModule&&(row.parentProtocol??null)===contract.expectedParent;
  const requiredMatch=requiredFields.every(f=>text(method[f])===text((expected as Row)[f]));
  const codeMatch=provenance?.state!=="unavailable"&&contract?.sourceClosure.every(f=>provenance?.files.some(p=>p.path===f.path&&p.actual===f.blobSha1));
  const approved=approval?.decision==="approve_current_economic_kind"&&identity&&requiredMatch&&codeMatch;
  const legacyKind=metric==="Revenue"?old?.revenueKind:metric==="Fees"?old?.feeKind:"holder_return";
  const kind=contract?(approved?(approval as {kind?:string}).kind??"unknown":"unknown"):legacyMatch?legacyKind:"unknown";
  const holder=metric==="HoldersRevenue"&&!contract&&legacyMatch?(old.holderType?{economicType:old.holderType,eligible:old.holderType!=="unclear_other",reason:old.holderReason??"원천 환원 방식 검토"}:classifyHolderMethodology(method)):undefined;
  const disposition=contract?(!provenance||provenance.state==="unavailable"?"evidence-unavailable":approved?"approved":"pending"):
    legacyMatch?(kind==="unknown"||holder?.eligible===false?"reviewed-unavailable":"approved"):"pending";
  return {key:`DefiLlama:${componentId}:${metric}`,provider:"DefiLlama",componentId,metric,policy,basis:contract?"reviewed-code-contract":old?"legacy-definition-only":"unreviewed",disposition,kind,
    ...(metric==="HoldersRevenue"?{holderEligible:holder?.eligible??false,holderType:holder?.economicType??"unclear_other",holderReason:holder?.reason}:{}),
    changedFields,requiredFields,affectedOutputs:approval?.affectedOutputs??(metric==="Revenue"?["P/R","revenue growth","score"]:metric==="Fees"?["P/F","fee growth","score"]:["eligible holder history","P/HR","holder signals","holder share"]),
    recipient:approval?.recipient??null,funding:approval?.funding??null,temporal:approval?.temporal??null,limits:approval?.limits??[],...(approval?.comparabilityBoundary?{comparabilityBoundary:approval.comparabilityBoundary}:{}),
    ...(approval?.missingProof?{missingProof:approval.missingProof}:{}),
    reason:approved?"검토된 지표 정의와 코드 의존 범위 일치":contract?(!identity?"원천 구성 식별·범위 재검토 필요":!requiredMatch?"지표 의존 정의 변경 · 재검토 필요":!codeMatch?"원천 계산 근거 미확인·변경":metric==="HoldersRevenue"?"홀더 환원 실행 근거 검토 대기":"수익 귀속·재원 검토 대기"):
      legacyMatch?(kind==="unknown"?"기존 검토에서 경제적 분류 미확정":"기존 여섯 정의 일치 · 코드 연속성 미검증"):old?"기존 검토 정의 변경 · 재검토 필요":"경제적 귀속 검토 대기",
    evidence:{reviewedAt:contract?.reviewedAt??(legacyMatch?old.reviewedAt:null),commit:contract?provenance?.commit??null:null,tree:contract?provenance?.tree??null:null,
      receiptHashes:contract?provenance?.receiptHashes??[]:[],dependencyPaths:contract?.sourceClosure.map(f=>f.path)??[],limitation:contract?"provider-execution-revision-unattested":"legacy-definition-only"}};
}

/** Receipt dates and unrelated registry entries do not change one metric's meaning. */
export function metricSemanticIdentity(row:Row,decision:EconomicDecision):unknown {
  const contract=economicArtifact.contracts.find(c=>c.providerId===decision.componentId&&c.slug===row.slug);
  const method=(row.methodology??{}) as Row;
  return [decision.componentId,decision.metric,decision.basis,decision.disposition,decision.kind,decision.holderEligible,
    decision.requiredFields.map(f=>[f,text(method[f])]),contract?.sourceClosure.map(f=>[f.path,f.blobSha1])??null,
    decision.recipient,decision.funding,decision.temporal,decision.comparabilityBoundary??null];
}
