import { COLLECTION_MINUTE, COLLECTION_UTC_HOURS } from "./collectionSchedule";

/** Called inside the sole writer's concurrency lock, using the authoritative journal. */
export function scheduledCollectionDecision(lastStartedAt: string | null, now: number) {
  const lastStart = Date.parse(lastStartedAt ?? "");
  if (!Number.isFinite(now) || !Number.isFinite(lastStart) || lastStart > now) {
    throw new Error("Cannot determine scheduled collection from an absent, invalid or future start record");
  }
  const day = Math.floor(now / 86400_000) * 86400_000;
  const slot = Math.max(...[-1, 0].flatMap(offset => COLLECTION_UTC_HOURS.map(hour =>
    day + offset * 86400_000 + (hour * 60 + COLLECTION_MINUTE) * 60_000)).filter(at => at <= now));
  return { collect: lastStart < slot, slotAt: new Date(slot).toISOString(), previousStartedAt: lastStartedAt };
}
