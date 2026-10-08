import type {EconomicDecision,EconomicPolicyIdentity,EconomicDisposition} from "./economicTypes";
import type {CoinRaw,ScreenerResponse} from "./types";
import {knownEconomicPolicy} from "./economicPolicyIdentity";

export interface EconomicReviewEntry {
  key:string;componentId:string;metric:EconomicDecision["metric"];slug:string;projects:string[];
  firstKnownAt:string;firstKnownBasis:"captured-baseline"|"tracking-start";firstRawBundleSha256:string;
  lastObservedAt:string;lastRawBundleSha256:string;observationCount:number;
  disposition:EconomicDisposition|"superseded";decision:EconomicDecision;
  previousDecisionHash?:string;resolution?:{at:string;rawBundleSha256:string;policySha256:string};
  supersededBy?:string;
}
export interface EconomicReviewState {schema:1;policy:EconomicPolicyIdentity;trackingStartedAt:string;entries:EconomicReviewEntry[];retired:{count:number;archives:{rawBundleSha256:string;entries:number}[]} }
export interface EconomicReviewSummary {
  schema:1;policy:EconomicPolicyIdentity;trackingStartedAt:string;stateSha256:string;
  summary:{sources:number;sourceMetrics:number;pending:number;evidenceUnavailable:number;reviewedUnavailable:number;approved:number;affectedProjects:number;oldestPendingAt:string|null;retired:number};
  sample:EconomicReviewEntry[];
}
const pending=(d: string)=>["pending","evidence-unavailable"].includes(d);
export function validateEconomicSummary(s:EconomicReviewSummary) {
  if(s?.schema!==1||!knownEconomicPolicy(s.policy)||!Number.isFinite(Date.parse(s.trackingStartedAt))||!/^[a-f0-9]{64}$/.test(s.stateSha256)||!Array.isArray(s.sample)||s.sample.length>12||
    !["sources","sourceMetrics","pending","evidenceUnavailable","reviewedUnavailable","approved","affectedProjects","retired"].every(k=>Number.isInteger(s.summary?.[k as keyof EconomicReviewSummary["summary"]])&&(s.summary[k as keyof EconomicReviewSummary["summary"]] as number)>=0)||
    s.summary.sourceMetrics!==s.summary.pending+s.summary.evidenceUnavailable+s.summary.reviewedUnavailable+s.summary.approved||s.summary.oldestPendingAt!==null&&!Number.isFinite(Date.parse(s.summary.oldestPendingAt)))throw Error("Invalid economic review summary");
}
export function validateEconomicReview(state:EconomicReviewState) {
  if(state?.schema!==1||!knownEconomicPolicy(state.policy)||!Number.isFinite(Date.parse(state.trackingStartedAt))||!Array.isArray(state.entries)||new Set(state.entries.map(e=>e.key)).size!==state.entries.length||!Number.isInteger(state.retired?.count)||!Array.isArray(state.retired?.archives))throw new Error("Invalid economic review ledger");
  for(const e of state.entries)if(e.key!==`DefiLlama:${e.componentId}:${e.metric}`||e.decision.key!==e.key||e.decision.componentId!==e.componentId||e.decision.metric!==e.metric||!knownEconomicPolicy(e.decision.policy)||!Array.isArray(e.projects)||!e.projects.length||!Number.isFinite(Date.parse(e.firstKnownAt))||!Number.isFinite(Date.parse(e.lastObservedAt))||Date.parse(e.firstKnownAt)>Date.parse(e.lastObservedAt)||![e.firstRawBundleSha256,e.lastRawBundleSha256].every(h=>/^[a-f0-9]{64}$/.test(h))||!Number.isInteger(e.observationCount)||e.observationCount<1||!["approved","pending","evidence-unavailable","reviewed-unavailable","superseded"].includes(e.disposition)||e.disposition!=="superseded"&&e.disposition!==e.decision.disposition||e.resolution&&(!Number.isFinite(Date.parse(e.resolution.at))||!/[a-f0-9]{64}/.test(e.resolution.rawBundleSha256)||!/[a-f0-9]{64}/.test(e.resolution.policySha256)))throw new Error("Invalid economic review entry");
}

/** Same provider component/metric survives names, slots, UTC dates and review revisions. */
export function buildEconomicReview(coins:CoinRaw[],at:string,rawHash:string,previous:EconomicReviewState|undefined,baseline:ScreenerResponse|null,hash:(v:unknown)=>string):EconomicReviewState|undefined {
  const policy=coins.find(c=>c.fundamentals.economicPolicy)?.fundamentals.economicPolicy;if(!policy)return;
  if(previous)validateEconomicReview(previous);
  const old=new Map((previous?.entries??[]).map(e=>[e.key,structuredClone(e)]));
  const current=new Map<string,{decision:EconomicDecision;slug:string;projects:Set<string>;definition:string|null}>();
  for(const c of coins)for(const part of [...c.fundamentals.revenue.components,...c.fundamentals.fees.components,...c.fundamentals.holders]) {
    const d=part.decision;if(!d)throw new Error("Missing scoped economic decision");
    const existing=current.get(d.key);if(existing&&hash(existing.decision)!==hash(d))throw new Error(`Conflicting economic decision:${d.key}`);
    if(existing)existing.projects.add(c.slug);else current.set(d.key,{decision:d,slug:part.slug,projects:new Set([c.slug]),definition:part.definition});
  }
  for(const [key,item] of current) {
    const existing=old.get(key),d=item.decision;
    const baselineCoin=baseline?.pipeline?baseline.coins.find(c=>item.projects.has(c.slug)&&(d.metric==="Revenue"?c.fundamentals.revenue.components:d.metric==="Fees"?c.fundamentals.fees.components:c.fundamentals.holders).some(p=>p.slug===item.slug&&p.definition===item.definition&&p.status!=="matched")&&
      [c.freshness?.revenue,c.freshness?.holders].some(f=>f?.components.some(p=>p.id===`${item.slug}@${d.componentId}`))):undefined;
    const firstKnownAt=existing?.firstKnownAt??(baselineCoin?baseline!.updatedAt:at);
    const entry:EconomicReviewEntry={key,componentId:d.componentId,metric:d.metric,slug:item.slug,projects:[...item.projects].sort(),firstKnownAt,
      firstKnownBasis:existing?.firstKnownBasis??(baselineCoin?"captured-baseline":"tracking-start"),firstRawBundleSha256:existing?.firstRawBundleSha256??(baselineCoin?baseline!.pipeline!.rawBundleSha256:rawHash),lastObservedAt:at,lastRawBundleSha256:rawHash,observationCount:(existing?.observationCount??0)+1,disposition:d.disposition,decision:structuredClone(d),
      ...(existing?.previousDecisionHash?{previousDecisionHash:existing.previousDecisionHash}:{}),...(existing?.resolution?{resolution:existing.resolution}:{})};
    if(existing&&hash(existing.decision)!==hash(d))entry.previousDecisionHash=hash(existing.decision);
    if(existing&&pending(existing.disposition)&&!pending(d.disposition))entry.resolution={at,rawBundleSha256:rawHash,policySha256:policy.sha256};
    old.set(key,entry);
  }
  // Absent or renamed scopes are retained until a proved linkage resolves them.
  const state:EconomicReviewState={schema:1,policy,trackingStartedAt:previous?.trackingStartedAt??at,entries:[...old.values()].sort((a,b)=>a.key.localeCompare(b.key)),retired:structuredClone(previous?.retired??{count:0,archives:[]})};
  // Absent approved identities also retain their age and resolution. Only the public sample is bounded.
  validateEconomicReview(state);return state;
}
export function summarizeEconomicReview(state:EconomicReviewState,hash:(v:unknown)=>string):EconomicReviewSummary {
  const entries=state.entries,unresolved=entries.filter(e=>pending(e.disposition));
  return {schema:1,policy:state.policy,trackingStartedAt:state.trackingStartedAt,stateSha256:hash(state),summary:{sources:new Set(entries.map(e=>e.componentId)).size,sourceMetrics:entries.length,pending:entries.filter(e=>e.disposition==="pending").length,
    evidenceUnavailable:entries.filter(e=>e.disposition==="evidence-unavailable").length,reviewedUnavailable:entries.filter(e=>e.disposition==="reviewed-unavailable").length,approved:entries.filter(e=>e.disposition==="approved").length,
    affectedProjects:new Set(unresolved.flatMap(e=>e.projects)).size,oldestPendingAt:unresolved.map(e=>e.firstKnownAt).sort()[0]??null,retired:state.retired.count},
    sample:unresolved.sort((a,b)=>a.firstKnownAt.localeCompare(b.firstKnownAt)||a.key.localeCompare(b.key)).slice(0,12)};
}
