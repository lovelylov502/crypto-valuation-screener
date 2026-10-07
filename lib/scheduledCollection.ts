import { currentCollectionSlot } from "./collectionSchedule";
import { verifySchedulerReceipt } from "./schedulerDispatch";
import type { CollectionAttempt, PublicationJournal } from "./publicationTypes";
import { recoveryDecision, type CollectionTrigger } from "./freshnessRecovery";
import { fourDailyActive } from "./pipelineRelease";

export const MAX_AUTOMATIC_ATTEMPTS = 3;
export const MAX_MANUAL_REPAIRS = 2;
export const COLLECTION_LEASE_MS = 15 * 60_000;
export const RETRY_DELAY_MS = 5 * 60_000;

/** Unknown/semantic failures require explicit repair, never an automatic exception. */
export function classifyAttemptFailure(attempt: CollectionAttempt) {
  if (attempt.failureClass) return attempt.failureClass;
  const failures = attempt.sourceFailures;
  const transient = (status?: number) => status === undefined || status === 408 || status === 429 || status >= 500;
  if (failures.length && failures.every(s => transient(s.httpStatus))) {
    if (attempt.errors.every(e => /source_request_failed|_failed:|timeout|timed out|network|transport failure|fetch|HTTP (408|429|5\d\d)|budget|deadline|collector_did_not_complete|candidate_artifacts_missing|comparison_not_completed/i.test(e))) return "transient" as const;
  }
  if (attempt.errors.length && attempt.errors.every(e => /^(timeout|collector_did_not_complete|candidate_artifacts_missing|comparison_not_completed)$|timed out|fetch failed|network|Recorded source transport failure|HTTP (408|429|5\d\d)|deadline exceeded/i.test(e))) return "transient" as const;
  return attempt.errors.length ? "validation" as const : "unknown" as const;
}

/** Called inside the sole writer's concurrency lock, using the authoritative journal. */
export function scheduledCollectionDecision(previous: PublicationJournal | null, now: number, manualRepair = false) {
  const lastStartedAt = previous?.attempt.startedAt ?? null;
  const lastStart = Date.parse(lastStartedAt ?? "");
  if (!previous || !Number.isFinite(now) || !Number.isFinite(lastStart) || lastStart > now) {
    throw new Error("Cannot determine scheduled collection from an absent, invalid or future start record");
  }
  const slot = currentCollectionSlot(now);
  const slotAt = new Date(slot).toISOString();
  const result = (collect: boolean, reason: string) => ({ collect, reason, slotAt, previousStartedAt: lastStartedAt, manualRepair });
  // A lease survives a slot boundary. The workflow lock prevents concurrent writers;
  // this also protects future callers from replacing a still-running attempt.
  if (previous.attempt.outcome === "running" && now - lastStart < COLLECTION_LEASE_MS) return result(false, "running");
  if (lastStart < slot) return result(true, "new-slot");
  const schedule = previous.schedule;
  if (schedule && (schedule.scheduledFor !== slotAt || !Number.isInteger(schedule.attemptCount) || schedule.attemptCount < 1
    || !Number.isInteger(schedule.manualRepairCount) || schedule.manualRepairCount < 0 || schedule.manualRepairCount > schedule.attemptCount
    || schedule.lastAttemptId !== previous.attempt.id || typeof schedule.settled !== "boolean"
    || (schedule.nextRetryAt !== null && !Number.isFinite(Date.parse(schedule.nextRetryAt))))) throw new Error("Invalid collection slot state");
  const count = schedule?.attemptCount ?? 1, manualCount = schedule?.manualRepairCount ?? 0;
  if (manualRepair) return result(manualCount < MAX_MANUAL_REPAIRS, manualCount < MAX_MANUAL_REPAIRS ? "manual-repair" : "manual-budget-exhausted");
  const settled = schedule?.settled ?? (previous.attempt.outcome === "published" && (!previous.attempt.partial || classifyAttemptFailure(previous.attempt) !== "transient"));
  if (settled) return result(false, "published");
  if (count - manualCount >= MAX_AUTOMATIC_ATTEMPTS) return result(false, "retry-budget-exhausted");
  if (previous.attempt.outcome !== "running" && classifyAttemptFailure(previous.attempt) !== "transient") return result(false, "review-required");
  const retryAt = schedule?.nextRetryAt ? Date.parse(schedule.nextRetryAt) : Date.parse(previous.attempt.completedAt ?? previous.attempt.startedAt) + RETRY_DELAY_MS;
  if (!Number.isFinite(retryAt)) throw new Error("Invalid collection retry time");
  return result(now >= retryAt, now >= retryAt ? "retry" : "retry-backoff");
}

export function collectionTriggerDecision(input: {
  event: string | undefined; receipt: string; signature: string; secret: string; bootstrap: boolean;
  requestId?: string; requestedAt?: string; schedule?: string;
}, previous: PublicationJournal | null, now: number) {
  const { event, receipt, signature, secret, bootstrap } = input;
  if (event !== "schedule" && event !== "workflow_dispatch") throw new Error("Unexpected collection trigger");
  if (event !== "workflow_dispatch" && (receipt || signature)) throw new Error("Unexpected scheduler receipt");
  const external = receipt || signature ? verifySchedulerReceipt(receipt, signature, secret, now) : null;
  if (external && bootstrap) throw new Error("Scheduler cannot bootstrap a publication");
  const manualRepair = event === "workflow_dispatch" && !external;
  if (fourDailyActive()) {
    if (bootstrap) throw new Error("Phase B cannot bootstrap a journal");
    if (external && external.schema !== 2) throw new Error("Legacy occurrence cannot claim new scheduling allowance");
    const trigger: CollectionTrigger = external ? {source:"vercel-cron",scheduledFor:external.scheduledFor,stage:external.stage!,schedule:external.schedule,requestedAt:external.requestedAt,requestId:external.requestId,occurrenceKnown:true,authentication:"hmac-sha256-verified"}
      : {source:manualRepair?"manual":"github-recovery-wake",scheduledFor:null,stage:null,schedule:input.schedule??null,requestedAt:input.requestedAt??new Date(now).toISOString(),requestId:input.requestId??"",occurrenceKnown:false,authentication:manualRepair?"github-manual":"github-native-occurrence-unknown"};
    return recoveryDecision(previous,now,trigger,manualRepair);
  }
  if (external?.schema===2 || previous?.schema===2) throw new Error("Schema-2 journal requires compatible scheduling; use paused rollback");
  const decision = !previous && manualRepair && bootstrap
    ? { collect: true, reason: "bootstrap", slotAt: new Date(currentCollectionSlot(now)).toISOString(), previousStartedAt: null, manualRepair: false }
    : scheduledCollectionDecision(previous, now, manualRepair);
  const trigger = external ? { ...external, authentication: "hmac-sha256-verified" }
    : { source: event === "schedule" ? "github-schedule" : "manual", scheduledFor: decision.slotAt };
  return { ...decision, trigger };
}
