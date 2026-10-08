import {economicArtifactFor} from "./economicPolicy";
import {knownEconomicPolicy} from "./economicPolicyIdentity";
import type {CoinRaw,ScreenerResponse} from "./types";

/** Consistency gate. Source-economic truth is checked separately by independent fixtures. */
export function economicCoinErrors(c:CoinRaw):string[] {
  const f=c.fundamentals,parts=[...f.revenue.components,...f.fees.components,...f.holders];
  if(!f.economicPolicy)return parts.some(p=>p.decision)?["unbound economic decision"]:[];
  const errors:string[]=[];
  if(!knownEconomicPolicy(f.economicPolicy)||!Number.isFinite(Date.parse(f.economicAsOf??"")))errors.push("economic policy identity");
  for(const [metric,components] of [["Revenue",f.revenue.components],["Fees",f.fees.components],["HoldersRevenue",f.holders]] as const)for(const p of components) {
    const d=p.decision;
    if(!d||!knownEconomicPolicy(d.policy)||d.key!==`DefiLlama:${d.componentId}:${metric}`||d.metric!==metric||d.provider!=="DefiLlama"||!d.reason||!Array.isArray(d.changedFields)||!Array.isArray(d.requiredFields)||!Array.isArray(d.affectedOutputs)||!d.evidence||!Array.isArray(d.limits)||d.kind!==p.kind||!["approved","pending","evidence-unavailable","reviewed-unavailable"].includes(d.disposition)) {errors.push(`economic decision:${p.slug}:${metric}`);continue;}
    const contract=economicArtifactFor(d.policy).contracts.find(r=>r.providerId===d.componentId||r.slug===p.slug),review=contract?.decisions.find(r=>r.metric===metric);
    if(d.basis==="reviewed-code-contract"&&(!contract||d.evidence.limitation!=="provider-execution-revision-unattested"||d.disposition==="approved"&&(contract.providerId!==d.componentId||contract.slug!==p.slug||review?.decision!=="approve_current_economic_kind"||(review as {kind?:string}).kind!==d.kind||!d.evidence.commit||!d.evidence.tree||(d.policy.algorithm==="metric-decisions-v1"?d.evidence.receiptHashes.length!==2:d.evidence.receiptHashes.length<2||d.evidence.receiptHashes.length>6||d.evidence.runtimeContextSha256!==contract.runtimeContext?.sha256||d.evidence.scope!=="adapter-local-with-reviewed-shared-fee-surface"))))errors.push(`unproved economic approval:${p.slug}:${metric}`);
    if(contract&&d.basis!=="reviewed-code-contract")errors.push(`weaker approval fallback:${p.slug}:${metric}`);
    if(metric==="HoldersRevenue") {
      const h=c.holderValue.components.find(h=>h.slug===p.slug);
      if(!h||JSON.stringify(h.decision)!==JSON.stringify(d)||h.eligible!==(d.disposition==="approved"&&d.holderEligible===true))errors.push(`holder decision disagreement:${p.slug}`);
    }
    if(["pending","evidence-unavailable"].includes(d.disposition)&&p.kind!=="unknown")errors.push(`held economic kind:${p.slug}:${metric}`);
  }
  if(f.holderShareReviewed&&parts.some(p=>p.decision?.basis==="reviewed-code-contract"))errors.push("unreviewed scoped holder share");
  return errors;
}
export function economicAccountingErrors(data:ScreenerResponse):string[] {
  const has=data.coins.some(c=>c.fundamentals.economicPolicy);
  if(!has)return data.economicReview||data.pipeline?.economicPolicy?["unbound economic summary"]:[];
  const errors=data.coins.flatMap(c=>economicCoinErrors(c).map(e=>`${c.slug}:${e}`));
  if(!knownEconomicPolicy(data.pipeline?.economicPolicy)||!data.economicReview||!knownEconomicPolicy(data.economicReview.policy)||!Number.isFinite(Date.parse(data.economicReview.trackingStartedAt))||!/^([a-f0-9]{64})$/.test(data.economicReview.stateSha256)||data.economicReview.sample.length>12)errors.push("economic review summary");
  return errors;
}
