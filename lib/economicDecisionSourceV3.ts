import legacy from "./fundamentalDefinitions.legacy-b519.json";
import { economicArtifactV3 as economicArtifact } from "./economicPolicy";
import type { EconomicDecision, EconomicMetric, EconomicProvenance } from "./economicTypes";
import { sourceEconomicPolicy, sourceEconomicProvenance } from "./sourceBundle";
import {classifyHolderMethodology} from "./holderMethodology";
import {registryContinuityMatches} from "./economicProvenanceV3";
import artifact from "./economic-policy-v3.json";

type Row = Record<string, unknown>;
const fields = ["Revenue","Fees","HoldersRevenue","ProtocolRevenue","SupplySideRevenue","UserFees"];
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g," ") : null;

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
  const codeMatch=provenance?.state!=="unavailable"&&provenance?.runtime?.typeSurface==="matched"&&registryContinuityMatches(provenance)&&contract?.runtimeContext?.sha256===provenance?.runtime?.contexts.find(c=>c.slug===contract?.slug)?.sha256&&contract?.sourceClosure.filter(f=>f.role==="runtime"&&f.path!==artifact.context.literalRegistry.path).every(f=>provenance?.files.some(p=>p.path===f.path&&p.actual===f.blobSha1));
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
      receiptHashes:contract?provenance?.receiptHashes??[]:[],dependencyPaths:contract?.sourceClosure.map(f=>f.path)??[],limitation:contract?"provider-execution-revision-unattested":"legacy-definition-only",...(contract?{runtimeContextSha256:provenance?.runtime?.contexts.find(c=>c.slug===contract.slug)?.sha256??null,scope:"adapter-local-with-reviewed-shared-fee-and-literal-registry-surfaces",literalRegistry:provenance?.runtime?.literalRegistry}:{})}};
}

/** Receipt dates and unrelated registry entries do not change one metric's meaning. */
export function metricSemanticIdentity(row:Row,decision:EconomicDecision):unknown {
  const contract=economicArtifact.contracts.find(c=>c.providerId===decision.componentId&&c.slug===row.slug);
  const method=(row.methodology??{}) as Row;
  return [decision.componentId,decision.metric,decision.basis,decision.disposition,decision.kind,decision.holderEligible,
    decision.requiredFields.map(f=>[f,text(method[f])]),contract?[contract.sourceClosure.filter(f=>f.role==="runtime").map(f=>[f.path,f.blobSha1]),contract.runtimeContext?.sha256]:null,
    decision.recipient,decision.funding,decision.temporal,decision.comparabilityBoundary??null];
}
