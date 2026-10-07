// Keep both schedulers and the browser deadline in sync (checked by tests).
import { fourDailyActive } from "./pipelineRelease";
import type { CollectionRelease } from "./pipelineRelease";
export const FOUR_DAILY_UTC_HOURS = [2, 8, 14, 20] as const;
export const COLLECTION_UTC_HOURS: readonly number[] = fourDailyActive() ? FOUR_DAILY_UTC_HOURS : [2, 14];
export const COLLECTION_MINUTE = 0;
export const SCHEDULE_GRACE_MS = 90 * 60_000;
export const STATUS_POLL_MS = 10 * 60_000;
const DAY_MS = 86400_000;

function slots(now: number, hours=COLLECTION_UTC_HOURS) {
  const day = Math.floor(now / DAY_MS) * DAY_MS;
  return [-1, 0, 1].flatMap(offset => hours.map(hour => day + offset * DAY_MS + (hour * 60 + COLLECTION_MINUTE) * 60_000));
}

export function currentCollectionSlot(now: number) {
  if (!Number.isFinite(now)) throw new Error("Invalid collection time");
  return slots(now).filter(at => at <= now).at(-1)!;
}

export function collectionSchedule(now: number, mode?:CollectionRelease["schedule"]) {
  const hours=mode ? mode==="legacy" ? [2,14] : FOUR_DAILY_UTC_HOURS : COLLECTION_UTC_HOURS;
  const requiredAt = slots(now - SCHEDULE_GRACE_MS,hours).filter(at => at <= now - SCHEDULE_GRACE_MS).at(-1)!;
  return { requiredAt, deadlineAt: requiredAt + SCHEDULE_GRACE_MS, nextAt: slots(now,hours).find(at => at > now)!, paused:mode==="paused" };
}
