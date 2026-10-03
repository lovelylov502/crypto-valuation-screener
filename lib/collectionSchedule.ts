// Keep the two UTC slots in sync with daily-snapshot.yml (checked by tests).
export const COLLECTION_UTC_HOURS = [2, 14] as const;
export const COLLECTION_MINUTE = 17;
export const SCHEDULE_GRACE_MS = 90 * 60_000;
export const STATUS_POLL_MS = 10 * 60_000;
const DAY_MS = 86400_000;

function slots(now: number) {
  const day = Math.floor(now / DAY_MS) * DAY_MS;
  return [-1, 0, 1].flatMap(offset => COLLECTION_UTC_HOURS.map(hour => day + offset * DAY_MS + (hour * 60 + COLLECTION_MINUTE) * 60_000));
}

export function collectionSchedule(now: number) {
  const requiredAt = slots(now - SCHEDULE_GRACE_MS).filter(at => at <= now - SCHEDULE_GRACE_MS).at(-1)!;
  return { requiredAt, deadlineAt: requiredAt + SCHEDULE_GRACE_MS, nextAt: slots(now).find(at => at > now)! };
}
