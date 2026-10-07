import { completedUtcDate, dateIsComplete, freshnessIdentity, UTC_DAY_MS, type DatedFreshness, type FreshnessSummary } from "./datedFreshness";
import type { CollectionAttempt, PublicationJournal, PublishedSnapshot } from "./publicationTypes";
import type { ScreenerResponse } from "./types";

export type CollectionStage = "primary" | "catchup1" | "catchup2";
export interface CollectionTrigger {
  source: "vercel-cron" | "github-recovery-wake" | "manual";
  scheduledFor: string | null; stage: CollectionStage | null; schedule: string | null;
  requestedAt: string; requestId: string; occurrenceKnown: boolean; authentication: string;
  workflowCreatedAt?: string; workflowStartedAt?: string;
}
export interface DateObligation {
  key: string; slug: string; metric: "revenue" | "holders"; identity: string; date: string;
  firstMissingAt: string; lastCheckedAt: string; lastAttemptId: string; checks: number;
  disposition: "pending" | "overdue" | "resolved" | "superseded"; sources: string[];
}
export interface StageLedger {
  claims: number; completed: number; needed: boolean; missed: boolean; interrupted: boolean;
}
export interface SlotLedger {
  slotAt: string; primary: StageLedger; catchup1: StageLedger; catchup2: StageLedger;
  manualClaims: number; firstPublicationAt: string | null; deadlineMissed: boolean; naturalPrimary: boolean;
  signedPrimaryAnchor?: { receiptKey:string; attemptId:string; claimedAt:string };
  cyclePublication?: { publicationId:string; codeCommit:string; attemptId:string; confirmedAt:string };
}
export interface RecoveryState {
  schema: 1; slots: SlotLedger[]; obligations: DateObligation[]; receipts: string[];
  latestTargetDate: string | null; summary?: FreshnessSummary; transient: boolean; retryAt: string | null;
  history?: { slots:number; naturalSlots:number; deadlineMisses:number; missedCatchups:number; interruptedCatchups:number; resolvedDates:number; supersededDates:number; archiveUrl:string };
  legacyAttemptId?: string;
  projectionDiagnostics?: {deadlineMisses:number;missedCatchups:number;interruptedCatchups:number};
}
export const stageWindow = (slot: number, stage: CollectionStage) => ({ start: slot + ({primary:0,catchup1:2,catchup2:4}[stage]) * 3_600_000,
  end: slot + ({primary:2,catchup1:4,catchup2:6}[stage]) * 3_600_000 });
export function fourDailySlot(now: number) {
  const day = Math.floor(now / UTC_DAY_MS) * UTC_DAY_MS;
  return [-1,0].flatMap(d => [2,8,14,20].map(h => day + d * UTC_DAY_MS + h * 3_600_000)).filter(t => t <= now).at(-1)!;
}
export function currentStage(slot: number, now: number): CollectionStage { return now < slot + 2 * 3_600_000 ? "primary" : now < slot + 4 * 3_600_000 ? "catchup1" : "catchup2"; }
const freshStage = (): StageLedger => ({ claims:0, completed:0, needed:false, missed:false, interrupted:false });
const freshSlot = (slotAt: string): SlotLedger => ({ slotAt, primary:freshStage(), catchup1:freshStage(), catchup2:freshStage(), manualClaims:0, firstPublicationAt:null, deadlineMissed:false, naturalPrimary:false });
export const initialRecovery = (): RecoveryState => ({ schema:1, slots:[], obligations:[], receipts:[], latestTargetDate:null, transient:false, retryAt:null });
const finiteTime = (t: unknown) => typeof t === "string" && Number.isFinite(Date.parse(t));
export function validateRecovery(j: PublicationJournal, now = Infinity) {
  if (!finiteTime(j.attempt?.startedAt) || Date.parse(j.attempt.startedAt) > now || !finiteTime(j.createdAt) || Date.parse(j.createdAt)>now) throw new Error("Invalid or future collection journal");
  if (j.schema === 1) return;
  const r = j.recovery;
  if (j.schema !== 2 || !r || r.schema !== 1 || !Array.isArray(r.slots) || !Array.isArray(r.obligations) || !Array.isArray(r.receipts) ||
    new Set(r.receipts).size !== r.receipts.length || typeof r.transient !== "boolean" || (r.retryAt !== null && !finiteTime(r.retryAt)) ||
    (r.latestTargetDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(r.latestTargetDate))) throw new Error("Invalid recovery journal");
  if (new Set(r.slots.map(s => s.slotAt)).size !== r.slots.length || new Set(r.obligations.map(o => o.key)).size !== r.obligations.length) throw new Error("Duplicate recovery state");
  if(r.history&&(!Object.entries(r.history).filter(([key])=>key!=="archiveUrl").every(([,v])=>typeof v==="number"&&Number.isInteger(v)&&v>=0)||!/^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/data-[a-zA-Z0-9-]+\/recovery-history\.json$/.test(r.history.archiveUrl)))throw new Error("Invalid recovery history summary");
  for (const s of r.slots) {
    if (!finiteTime(s.slotAt) || Date.parse(s.slotAt)>now || fourDailySlot(Date.parse(s.slotAt)) !== Date.parse(s.slotAt) || !Number.isInteger(s.manualClaims) || s.manualClaims < 0 || s.manualClaims > 2 ||
      typeof s.deadlineMissed !== "boolean" || typeof s.naturalPrimary !== "boolean" || (s.firstPublicationAt !== null && (!finiteTime(s.firstPublicationAt)||Date.parse(s.firstPublicationAt)<Date.parse(s.slotAt)||Date.parse(s.firstPublicationAt)>now))) throw new Error("Invalid recovery slot");
    if(s.signedPrimaryAnchor&&(!s.signedPrimaryAnchor.receiptKey.startsWith("vercel-cron:")||!s.signedPrimaryAnchor.attemptId||!finiteTime(s.signedPrimaryAnchor.claimedAt)||Date.parse(s.signedPrimaryAnchor.claimedAt)<Date.parse(s.slotAt)||Date.parse(s.signedPrimaryAnchor.claimedAt)>=stageWindow(Date.parse(s.slotAt),"primary").end||s.primary.claims<1))throw new Error("Invalid signed primary anchor");
    if(s.cyclePublication&&(!s.signedPrimaryAnchor||!s.naturalPrimary||!s.cyclePublication.publicationId||!s.cyclePublication.codeCommit||!s.cyclePublication.attemptId||!finiteTime(s.cyclePublication.confirmedAt)||Date.parse(s.cyclePublication.confirmedAt)<Date.parse(s.signedPrimaryAnchor.claimedAt)||Date.parse(s.cyclePublication.confirmedAt)>Date.parse(s.slotAt)+90*60_000))throw new Error("Invalid automatic cycle proof");
    for (const stage of ["primary","catchup1","catchup2"] as const) {
      const l = s[stage];
      if (!l || !Number.isInteger(l.claims) || l.claims < 0 || l.claims > (stage === "primary" ? 3 : 1) || !Number.isInteger(l.completed) || l.completed < 0 || l.completed > l.claims ||
        [l.needed,l.missed,l.interrupted].some(v => typeof v !== "boolean")) throw new Error("Invalid stage allowance");
    }
  }
  for (const o of r.obligations) if (!o || !o.key || !o.slug || !["revenue","holders"].includes(o.metric) || !o.identity || !/^\d{4}-\d{2}-\d{2}$/.test(o.date) || !Number.isFinite(Date.parse(o.date)) ||
    o.key!==JSON.stringify([o.slug,o.metric,o.identity,o.date]) || !o.lastAttemptId ||
    !finiteTime(o.firstMissingAt) || !finiteTime(o.lastCheckedAt) || Date.parse(o.firstMissingAt) > Date.parse(o.lastCheckedAt) || Date.parse(o.lastCheckedAt)>now ||
    !Number.isInteger(o.checks) || o.checks < 1 || !["pending","overdue","resolved","superseded"].includes(o.disposition) || !Array.isArray(o.sources)) throw new Error("Invalid date obligation");
  const a=j.attempt;
  if(a.action) {
    const s=r.slots.find(s=>s.slotAt===a.action!.slotAt),stage=a.action.stage;
    if(!s||!["primary","catchup1","catchup2"].includes(stage)||typeof a.action.natural!=="boolean"||typeof a.action.receiptKey!=="string"||!r.receipts.includes(a.action.receiptKey)||
      (a.manualRepair?s.manualClaims===0:s[stage].claims===0)||a.scheduledFor!==a.action.slotAt||Date.parse(a.startedAt)<stageWindow(Date.parse(a.action.slotAt),stage).start||Date.parse(a.startedAt)>=stageWindow(Date.parse(a.action.slotAt),stage).end)throw new Error("Invalid recovery action/claim");
  } else if(r.legacyAttemptId!==a.id)throw new Error("Missing recovery action evidence");
}
export function recoveryWork(r: RecoveryState, now: number) {
  return r.transient || r.latestTargetDate !== completedUtcDate(now) || r.obligations.some(o => o.disposition === "pending" && now - Date.parse(o.firstMissingAt) < UTC_DAY_MS);
}
export function nextEligibleCheck(r:RecoveryState,now:number):string|null {
  const slot=fourDailySlot(now),s=r.slots.find(s=>Date.parse(s.slotAt)===slot);
  for(const stage of ["primary","catchup1","catchup2"] as const) {
    const w=stageWindow(slot,stage),at=Math.max(now,w.start,r.retryAt?Date.parse(r.retryAt):0);
    if(at>=w.end||(s?.[stage].claims??0)>=(stage==="primary"?3:1))continue;
    if(stage==="primary"&&!(s?.primary.claims??0)||recoveryWork(r,at))return new Date(at).toISOString();
  }
  return null;
}
/** Metadata only; every check uses the newly acquired map, never old amounts. */
export function updateObligations(r: RecoveryState, data: ScreenerResponse, attemptId: string): RecoveryState {
  const now = Date.parse(data.updatedAt), old = new Map(r.obligations.map(o => [o.key,{...o}]));
  const scopes = new Map<string,DatedFreshness>();
  for (const c of data.coins) for (const metric of ["revenue","holders"] as const) {
    const f = c.freshness?.[metric]; if (!f) continue;
    const identity = freshnessIdentity(f); scopes.set(`${c.slug}:${metric}`,f);
    if (f.state === "pending") {
      const key = JSON.stringify([c.slug,metric,identity,f.targetDate]);
      if (!old.has(key)) old.set(key,{key,slug:c.slug,metric,identity,date:f.targetDate,firstMissingAt:data.updatedAt,lastCheckedAt:data.updatedAt,lastAttemptId:attemptId,checks:0,disposition:"pending",sources:f.sources});
    }
  }
  for (const o of old.values()) {
    if (["resolved","superseded"].includes(o.disposition)) continue;
    const f = scopes.get(`${o.slug}:${o.metric}`);
    o.lastCheckedAt=data.updatedAt; o.lastAttemptId=attemptId; o.checks++;
    if (!f || freshnessIdentity(f) !== o.identity) o.disposition="superseded";
    else if (f.state !== "conflict" && dateIsComplete(f,o.date)) o.disposition="resolved";
    else o.disposition=now-Date.parse(o.firstMissingAt) >= UTC_DAY_MS ? "overdue" : "pending";
  }
  return {...r,obligations:[...old.values()],latestTargetDate:completedUtcDate(now),summary:data.freshness};
}
/** Expired required stages and first-publication failures are sticky across later recovery. */
export function reconcileRecovery(previous: PublicationJournal, now: number): RecoveryState {
  validateRecovery(previous,now);
  const r = structuredClone(previous.recovery ?? {...initialRecovery(),legacyAttemptId:previous.attempt.id});
  for (const o of r.obligations) if (o.disposition === "pending" && now-Date.parse(o.firstMissingAt) >= UTC_DAY_MS) o.disposition="overdue";
  // Include intervening due slots even if every scheduler failed to wake.
  const last = r.slots.at(-1)?.slotAt;
  if (last) for (let s=Date.parse(last)+6*3_600_000;s<=fourDailySlot(now);s+=6*3_600_000) r.slots.push(freshSlot(new Date(s).toISOString()));
  if (!r.slots.length) r.slots.push(freshSlot(new Date(fourDailySlot(now)).toISOString()));
  for (const s of r.slots) {
    const slot=Date.parse(s.slotAt);
    for (const stage of ["primary","catchup1","catchup2"] as const) {
      const window=stageWindow(slot,stage), l=s[stage];
      if (window.start > now) continue;
      const observationTime = Math.min(now,window.end-1);
      const obligationWork = r.obligations.some(o => Date.parse(o.firstMissingAt)<window.end && Date.parse(o.firstMissingAt)+UTC_DAY_MS>window.start && !["resolved","superseded"].includes(o.disposition));
      // Rollover is known from the calendar; it creates an acquisition obligation even after a clean capture.
      const rollover = r.latestTargetDate !== null && r.latestTargetDate < completedUtcDate(observationTime);
      const transientKnown=r.transient&&Date.parse(previous.attempt.completedAt??previous.attempt.startedAt)<window.end;
      l.needed ||= stage === "primary" ? !s.firstPublicationAt : obligationWork || rollover || transientKnown || r.latestTargetDate===null;
      if (now >= window.end && l.needed && l.claims === 0) l.missed=true;
      if (now >= slot+90*60_000 && (!s.firstPublicationAt || Date.parse(s.firstPublicationAt)>slot+90*60_000)) s.deadlineMissed=true;
    }
  }
  const a=previous.attempt;
  if (a.outcome === "running" && now-Date.parse(a.startedAt)>=15*60_000 && a.action && !a.manualRepair) {
    const s=r.slots.find(s=>s.slotAt===a.action!.slotAt); if(s) s[a.action.stage].interrupted=true;
    r.transient=true;
  }
  return r;
}
/** Read-only age/health projection. Paused scheduling creates no new expected slots. */
export function publicRecovery(previous:PublicationJournal,now:number,paused=false):RecoveryState|undefined {
  if(!previous.recovery)return undefined;
  const r=paused?structuredClone(previous.recovery):reconcileRecovery(previous,now);
  if(paused)for(const o of r.obligations)if(o.disposition==="pending"&&now-Date.parse(o.firstMissingAt)>=UTC_DAY_MS)o.disposition="overdue";
  const projectionDiagnostics={deadlineMisses:(r.history?.deadlineMisses??0)+r.slots.filter(s=>s.deadlineMissed).length,
    missedCatchups:(r.history?.missedCatchups??0)+r.slots.reduce((n,s)=>n+Number(s.catchup1.missed)+Number(s.catchup2.missed),0),
    interruptedCatchups:(r.history?.interruptedCatchups??0)+r.slots.reduce((n,s)=>n+Number(s.catchup1.interrupted)+Number(s.catchup2.interrupted),0)};
  return {...r,slots:r.slots.filter((s,i)=>i>=r.slots.length-16||s.slotAt===previous.attempt.action?.slotAt),projectionDiagnostics};
}
export function recoveryDecision(previous: PublicationJournal | null, now: number, trigger: CollectionTrigger, manualRepair=false) {
  if (!previous || !Number.isFinite(now)) throw new Error("Authoritative collection journal required");
  const recovery=reconcileRecovery(previous,now);
  const slotAt=trigger.occurrenceKnown ? trigger.scheduledFor! : new Date(fourDailySlot(now)).toISOString();
  const stage=trigger.occurrenceKnown ? trigger.stage! : currentStage(Date.parse(slotAt),now);
  const receiptKey=`${trigger.source}:${trigger.requestId}`;
  const result=(collect:boolean,reason:string)=>({collect,reason,slotAt,stage,receiptKey,manualRepair,trigger,recovery,naturalCycle:!manualRepair&&stage==="primary"&&(trigger.occurrenceKnown||!!recovery.slots.find(s=>s.slotAt===slotAt)?.signedPrimaryAnchor),previousStartedAt:previous.attempt.startedAt});
  const window=stageWindow(Date.parse(slotAt),stage);
  if (!finiteTime(slotAt) || !trigger.requestId || trigger.occurrenceKnown && !trigger.stage) throw new Error("Invalid collection occurrence");
  if (now<window.start || now>=window.end) return result(false,"expired-stage");
  if (recovery.receipts.includes(receiptKey)) return result(false,"duplicate-receipt");
  if (previous.attempt.outcome === "running" && now-Date.parse(previous.attempt.startedAt)<15*60_000) return result(false,"running");
  let s=recovery.slots.find(s=>s.slotAt===slotAt); if (!s) { s=freshSlot(slotAt); recovery.slots.push(s); }
  if (manualRepair) return result(s.manualClaims<2,s.manualClaims<2?"manual-repair":"manual-budget-exhausted");
  if(stage==="primary"&&!trigger.occurrenceKnown&&!s.signedPrimaryAnchor&&now<Date.parse(slotAt)+60*60_000)return result(false,"awaiting-signed-primary");
  const l=s[stage],limit=stage==="primary"?3:1;
  if (l.claims>=limit) return result(false,"stage-budget-exhausted");
  const work=recoveryWork(recovery,now);
  if (stage === "primary" && !l.claims || work) {
    if (recovery.retryAt && Date.parse(recovery.retryAt)>now) return result(false,"retry-backoff");
    l.needed=true;
    return result(true,stage === "primary" ? l.claims ? "retry" : "new-slot" : recovery.latestTargetDate !== completedUtcDate(now) ? "date-rollover" : "pending-catchup");
  }
  return result(false,"no-pending-work");
}
export function startRecoveryJournal(previous: PublicationJournal, attempt: CollectionAttempt, id: string, decision: ReturnType<typeof recoveryDecision>): PublicationJournal {
  if (!decision.collect || !attempt.action || Date.parse(attempt.startedAt)<stageWindow(Date.parse(decision.slotAt),decision.stage).start || Date.parse(attempt.startedAt)>=stageWindow(Date.parse(decision.slotAt),decision.stage).end) throw new Error("Collection stage expired before claim");
  const r=structuredClone(decision.recovery),s=r.slots.find(s=>s.slotAt===decision.slotAt)!;
  if(attempt.action.natural!==decision.naturalCycle)throw new Error("Invalid automatic cycle claim");
  if (attempt.manualRepair) s.manualClaims++; else {
    s[decision.stage].claims++;
    if(decision.stage==="primary"&&decision.trigger.occurrenceKnown&&decision.trigger.source==="vercel-cron")s.signedPrimaryAnchor??={receiptKey:decision.receiptKey,attemptId:attempt.id,claimedAt:attempt.startedAt};
  }
  r.receipts.push(decision.receiptKey);
  return {...previous,schema:2,id,createdAt:attempt.startedAt,previousId:previous.id,previousStateUrl:`https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${previous.id}/state.json`,
    attempt,recovery:r,schedule:undefined};
}
export function finishRecoveryJournal(current: PublicationJournal, attempt: CollectionAttempt, published: PublishedSnapshot | null, id: string, data?: ScreenerResponse): PublicationJournal {
  const a=current.attempt;
  if (a.id!==attempt.id || a.outcome!=="running" || !a.action || !attempt.completedAt || Date.parse(attempt.completedAt)<Date.parse(a.startedAt)) throw new Error("Superseded or invalid completion");
  const accepted=attempt.outcome==="published";
  if (accepted && Date.parse(attempt.completedAt)-Date.parse(a.startedAt)>15*60_000) throw new Error("Publication exceeded original collection lease");
  if (accepted && (!published || !data || attempt.errors.length || !attempt.comparisonCompleted || data.pipeline?.schema!==2 || data.updatedAt!==published.dataAt || current.published && Date.parse(published.dataAt)<=Date.parse(current.published.dataAt))) throw new Error("Unverified recovery publication");
  if (!accepted && published) throw new Error("Blocked capture cannot replace snapshot");
  let r=structuredClone(current.recovery!);
  const s=r.slots.find(s=>s.slotAt===a.action!.slotAt)!;
  if (!a.manualRepair) {
    if(attempt.comparisonCompleted)s[a.action.stage].completed++;
    else s[a.action.stage].interrupted=true;
  }
  if (accepted) {
    r=updateObligations(r,data!,attempt.id);
    if(published?.availabilityConfirmedAt) {
      s.firstPublicationAt??=published.availabilityConfirmedAt;
      if (a.action.natural && s.signedPrimaryAnchor && !a.manualRepair && a.action.stage==="primary" && Date.parse(published.availabilityConfirmedAt)<=Date.parse(s.slotAt)+90*60_000) { s.naturalPrimary=true; s.cyclePublication??={publicationId:published.id,codeCommit:published.codeCommit,attemptId:a.id,confirmedAt:published.availabilityConfirmedAt}; }
    }
  }
  // s remains in r's cloned ledger after metadata-only obligation update.
  if (!s.firstPublicationAt && Date.parse(attempt.completedAt)>=Date.parse(s.slotAt)+90*60_000 || s.firstPublicationAt && Date.parse(s.firstPublicationAt)>Date.parse(s.slotAt)+90*60_000) s.deadlineMissed=true;
  r.transient=attempt.failureClass==="transient";
  r.retryAt=r.transient?new Date(Date.parse(attempt.completedAt)+5*60_000).toISOString():null;
  return {...current,id,createdAt:attempt.completedAt,previousId:current.id,previousStateUrl:`https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${current.id}/state.json`,published:accepted?published:current.published,attempt:{...attempt,action:a.action,trigger:a.trigger},recovery:r,
    incident:accepted?null:{firstFailureObservedAt:current.incident?.firstFailureObservedAt??attempt.completedAt,lastFailureObservedAt:attempt.completedAt,lastGoodDataAt:current.published?.dataAt??null},recoveredAt:accepted&&current.incident?attempt.completedAt:current.recoveredAt};
}
/** Availability is credited only after remote promotion and canonical journal readback. */
export function confirmPublicationAvailability(current:PublicationJournal,confirmedAt:string,id:string):PublicationJournal {
  if(!current.published||current.attempt.outcome!=="published"||!current.attempt.action||!finiteTime(confirmedAt)||Date.parse(confirmedAt)<Date.parse(current.attempt.completedAt??""))throw new Error("Invalid publication availability confirmation");
  const r=structuredClone(current.recovery!),a=current.attempt,s=r.slots.find(s=>s.slotAt===a.action!.slotAt)!;
  s.firstPublicationAt??=confirmedAt;
  if(Date.parse(s.firstPublicationAt)>Date.parse(s.slotAt)+90*60_000)s.deadlineMissed=true;
  if(a.action!.natural&&s.signedPrimaryAnchor&&!a.manualRepair&&a.action!.stage==="primary"&&Date.parse(confirmedAt)<=Date.parse(s.slotAt)+90*60_000){s.naturalPrimary=true;s.cyclePublication??={publicationId:current.published.id,codeCommit:current.published.codeCommit,attemptId:a.id,confirmedAt};}
  return {...current,id,createdAt:confirmedAt,previousId:current.id,previousStateUrl:`https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${current.id}/state.json`,published:{...current.published,availabilityConfirmedAt:confirmedAt},recovery:r};
}
export function recoveryVerdicts(j: PublicationJournal | undefined, now: number) {
  if (!j?.recovery) return {collectionDeadlinePassed:false,catchupExecutionPassed:false};
  const r=reconcileRecovery(j,now);
  const due=r.slots.filter(s=>now>=Date.parse(s.slotAt)+90*60_000).at(-1);
  // Current health is independent of historical diagnostics and cycle provenance.
  const dueStages=(["catchup1","catchup2"] as const).map(stage=>r.slots.filter(s=>now>=stageWindow(Date.parse(s.slotAt),stage).end).at(-1)?.[stage]);
  return { collectionDeadlinePassed:!!due&&!!due.firstPublicationAt&&!due.deadlineMissed&&Date.parse(due.firstPublicationAt)<=Date.parse(due.slotAt)+90*60_000,
    catchupExecutionPassed:dueStages.every(l=>!l?.needed||!l.missed&&!l.interrupted&&l.claims===l.completed) };
}
/** Publish bounded current state together with the full immutable retired metadata. */
export function compactRecoveryJournal(j:PublicationJournal): {journal:PublicationJournal; history?:Uint8Array} {
  const r=j.recovery; if(!r)return {journal:j};
  const expired=r.obligations.filter(o=>["resolved","superseded"].includes(o.disposition)&&Date.parse(j.createdAt)-Date.parse(o.lastCheckedAt)>UTC_DAY_MS);
  const kept=r.slots.filter((s,i)=>i>=r.slots.length-16||s.slotAt===j.attempt.action?.slotAt);
  const retired=r.slots.filter(s=>!kept.includes(s));
  const receipts=r.receipts.filter((key,i)=>i>=r.receipts.length-128||key===j.attempt.action?.receiptKey);
  if(!retired.length&&!expired.length)return {journal:{...j,recovery:{...r,receipts}}};
  const history={...(r.history??{slots:0,naturalSlots:0,deadlineMisses:0,missedCatchups:0,interruptedCatchups:0,resolvedDates:0,supersededDates:0,archiveUrl:""}),
    archiveUrl:`https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${j.id}/recovery-history.json`};
  history.slots+=retired.length;history.naturalSlots+=retired.filter(s=>s.naturalPrimary).length;
  history.deadlineMisses+=retired.filter(s=>s.deadlineMissed).length;
  history.missedCatchups+=retired.reduce((n,s)=>n+Number(s.catchup1.missed)+Number(s.catchup2.missed),0);
  history.interruptedCatchups+=retired.reduce((n,s)=>n+Number(s.catchup1.interrupted)+Number(s.catchup2.interrupted),0);
  history.resolvedDates+=expired.filter(o=>o.disposition==="resolved").length;history.supersededDates+=expired.filter(o=>o.disposition==="superseded").length;
  const bytes=new TextEncoder().encode(JSON.stringify({schema:1,previousHistory:r.history?.archiveUrl??null,slots:retired,obligations:expired}));
  const expiredKeys=new Set(expired.map(o=>o.key));
  return {journal:{...j,recovery:{...r,history,slots:kept,receipts,obligations:r.obligations.filter(o=>!expiredKeys.has(o.key))}},history:bytes};
}
