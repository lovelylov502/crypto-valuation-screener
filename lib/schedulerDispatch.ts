import { createHmac, timingSafeEqual } from "node:crypto";
import { COLLECTION_MINUTE, COLLECTION_UTC_HOURS, currentCollectionSlot, SCHEDULE_GRACE_MS } from "./collectionSchedule";

export const VERCEL_COLLECTION_CRONS = COLLECTION_UTC_HOURS.map(hour => `${COLLECTION_MINUTE} ${hour} * * *`);
export interface SchedulerReceipt {
  source: "vercel-cron";
  schedule: string;
  scheduledFor: string;
  requestedAt: string;
  requestId: string;
}

export function secretMatches(actual: string, expected: string) {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function schedulerReceipt(schedule: string, now: number, requestId: string): SchedulerReceipt {
  const slot = currentCollectionSlot(now);
  const expected = `${COLLECTION_MINUTE} ${new Date(slot).getUTCHours()} * * *`;
  if (!VERCEL_COLLECTION_CRONS.includes(schedule) || schedule !== expected || now - slot >= SCHEDULE_GRACE_MS
    || !/^[a-zA-Z0-9:._-]{8,200}$/.test(requestId)) throw new Error("Invalid scheduler invocation");
  return { source: "vercel-cron", schedule, scheduledFor: new Date(slot).toISOString(), requestedAt: new Date(now).toISOString(), requestId };
}

export function signSchedulerReceipt(receipt: string, secret: string) {
  if (secret.length < 32) throw new Error("Scheduler signing secret is missing or too short");
  return createHmac("sha256", secret).update(receipt).digest("hex");
}

export function verifySchedulerReceipt(receipt: string, signature: string, secret: string, now: number): SchedulerReceipt {
  if (receipt.length > 2048 || !/^[a-f0-9]{64}$/.test(signature)
    || !secretMatches(signature, signSchedulerReceipt(receipt, secret))) throw new Error("Invalid scheduler signature");
  const value = JSON.parse(receipt) as SchedulerReceipt;
  const requestedAt = Date.parse(value.requestedAt);
  const expected = schedulerReceipt(value.schedule, requestedAt, value.requestId);
  if (value.source !== expected.source || value.scheduledFor !== expected.scheduledFor || value.requestedAt !== expected.requestedAt
    || requestedAt > now || Date.parse(value.scheduledFor) !== currentCollectionSlot(now)) throw new Error("Expired or invalid scheduler receipt");
  return expected;
}
