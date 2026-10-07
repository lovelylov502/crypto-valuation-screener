import { fourDailySlot, reconcileRecovery, stageWindow, validateRecovery, type SlotLedger } from "./freshnessRecovery";
import type { PublicationJournal } from "./publicationTypes";

export interface AcceptanceWindow {
  schema:1; id:string; recordedAt:string; startsAt:string; endsAt:string; codeCommit:string;
  previousWindow?: {id:string; sha256:string};
}
export function validateAcceptanceWindow(w:AcceptanceWindow) {
  const start=Date.parse(w?.startsAt),end=Date.parse(w?.endsAt),recorded=Date.parse(w?.recordedAt);
  if(w?.schema!==1||!/^[a-zA-Z0-9-]+$/.test(w.id)||!/^[a-f0-9]{40}$/.test(w.codeCommit)||![start,end,recorded].every(Number.isFinite)||fourDailySlot(start)!==start||recorded>start||end-start<72*3_600_000||(end-start)%(6*3_600_000)!==0||w.previousWindow&&(!/^[a-zA-Z0-9-]+$/.test(w.previousWindow.id)||!/^[a-f0-9]{64}$/.test(w.previousWindow.sha256)))throw new Error("Invalid recorded acceptance window");
}
/** The fixed interval includes every slot; aggregate lifetime counters supply no credit or veto. */
export function scheduledAcceptance(w:AcceptanceWindow,j:PublicationJournal,retired:SlotLedger[],now:number) {
  validateAcceptanceWindow(w);
  const recovery=j.recovery?reconcileRecovery(j,now):undefined;
  const all=[...retired,...recovery?.slots??[]],seen=new Set<string>();
  if(recovery)validateRecovery({...j,recovery:{...recovery,slots:all}},now);
  for(const s of all) {if(seen.has(s.slotAt))throw new Error("Duplicate acceptance slot evidence");seen.add(s.slotAt);}
  const start=Date.parse(w.startsAt),end=Date.parse(w.endsAt),slots=[];
  for(let at=start;at<end;at+=6*3_600_000) {
    const slotAt=new Date(at).toISOString(),s=all.find(s=>s.slotAt===slotAt),deadline=at+90*60_000;
    const availabilityPassed=!!s?.firstPublicationAt&&!s.deadlineMissed&&!s.deadlineUnverified&&Date.parse(s.firstPublicationAt)>=at&&Date.parse(s.firstPublicationAt)<=deadline;
    const cyclePassed=availabilityPassed&&!!s?.naturalPrimary&&!!s.signedPrimaryAnchor&&!!s.cyclePublication&&s.cyclePublication.codeCommit===w.codeCommit&&Date.parse(s.cyclePublication.confirmedAt)<=deadline;
    const catchupPassed=!!s&&(["catchup1","catchup2"] as const).every(stage=>!s[stage].unverified&&(!s[stage].needed||!s[stage].missed&&!s[stage].interrupted&&s[stage].claims===s[stage].completed&&now>=stageWindow(at,stage).end));
    slots.push({slotAt,status:now<deadline?"pending":!s||s.deadlineUnverified?"unverified":"observed",availabilityPassed,cyclePassed,catchupPassed});
  }
  const transitions=Math.floor((end-1)/86_400_000)-Math.floor(start/86_400_000);
  return {window:w,checkedAt:new Date(now).toISOString(),elapsedHours:Math.max(0,now-start)/3_600_000,utcTransitions:transitions,
    expectedSlots:slots.length,qualifyingCycles:slots.filter(s=>s.cyclePassed).length,
    evidenceComplete:slots.every(s=>s.status==="observed"),
    acceptancePassed:now>=end&&transitions>=2&&slots.length>=12&&slots.every(s=>s.status==="observed"&&s.cyclePassed&&s.catchupPassed),slots,
    historicalDiagnostics:j.recovery?.history??null};
}
