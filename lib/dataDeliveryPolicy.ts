// Quota exhaustion is not a reason to upgrade or retry hosted SQL from a request.
export const HOSTED_DATABASE_ENABLED = false;
export const COLLECTION_CADENCE_HOURS = 12;
export const CADENCE_EFFECTIVE_AT = Date.parse("2026-10-24T02:00:00Z");
export const ACTIVE_COLLECTION_HOURS = [2, 14] as const;
export function activeCollectionHours(now: number): readonly number[] { return now < CADENCE_EFFECTIVE_AT ? [2, 8, 14, 20] : ACTIVE_COLLECTION_HOURS; }
export function activeCollectionSlot(now: number) {
  const day = Math.floor(now / 86400000) * 86400000;
  return [-1, 0].flatMap(offset => [2, 8, 14, 20].map(hour => day + offset * 86400000 + hour * 3600000))
    .filter(at => at <= now && activeCollectionHours(at).includes(new Date(at).getUTCHours())).at(-1)!;
}
