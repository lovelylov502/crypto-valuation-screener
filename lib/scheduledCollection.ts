import { currentCollectionSlot } from "./collectionSchedule";
import { verifySchedulerReceipt } from "./schedulerDispatch";

/** Called inside the sole writer's concurrency lock, using the authoritative journal. */
export function scheduledCollectionDecision(lastStartedAt: string | null, now: number) {
  const lastStart = Date.parse(lastStartedAt ?? "");
  if (!Number.isFinite(now) || !Number.isFinite(lastStart) || lastStart > now) {
    throw new Error("Cannot determine scheduled collection from an absent, invalid or future start record");
  }
  const slot = currentCollectionSlot(now);
  return { collect: lastStart < slot, slotAt: new Date(slot).toISOString(), previousStartedAt: lastStartedAt };
}

export function collectionTriggerDecision(input: {
  event: string | undefined; receipt: string; signature: string; secret: string; bootstrap: boolean;
}, lastStartedAt: string | null, now: number) {
  const { event, receipt, signature, secret, bootstrap } = input;
  if (event !== "schedule" && event !== "workflow_dispatch") throw new Error("Unexpected collection trigger");
  if (event !== "workflow_dispatch" && (receipt || signature)) throw new Error("Unexpected scheduler receipt");
  const external = receipt || signature ? verifySchedulerReceipt(receipt, signature, secret, now) : null;
  if (external && bootstrap) throw new Error("Scheduler cannot bootstrap a publication");
  const decision = !lastStartedAt && event === "workflow_dispatch" && !external && bootstrap
    ? { collect: true, slotAt: "", previousStartedAt: null }
    : scheduledCollectionDecision(lastStartedAt, now);
  const trigger = external ? { ...external, authentication: "hmac-sha256-verified" }
    : { source: event === "schedule" ? "github-schedule" : "manual", scheduledFor: event === "schedule" ? decision.slotAt : null };
  return { ...decision, trigger };
}
