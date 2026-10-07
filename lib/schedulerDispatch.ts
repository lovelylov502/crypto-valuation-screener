import { createHmac, timingSafeEqual } from "node:crypto";
import { COLLECTION_MINUTE, COLLECTION_UTC_HOURS, currentCollectionSlot, SCHEDULE_GRACE_MS } from "./collectionSchedule";
import { stageWindow, type CollectionStage } from "./freshnessRecovery";

export const VERCEL_COLLECTION_CRONS = COLLECTION_UTC_HOURS.map(hour => `${COLLECTION_MINUTE} ${hour} * * *`);
export interface SchedulerReceipt {
  schema?: 2;
  stage?: CollectionStage;
  source: "vercel-cron";
  schedule: string;
  scheduledFor: string;
  requestedAt: string;
  requestId: string;
}
export const FOUR_DAILY_CRONS = (["primary","catchup1","catchup2"] as const).flatMap(stage => [2,8,14,20].map(slotHour => {
  const hour=(slotHour+({primary:0,catchup1:2,catchup2:4}[stage]))%24;
  return { stage, slotHour, schedule:`0 ${hour} * * *`, path:`/api/cron/collect?stage=${stage}` };
}));
export function stageSchedulerReceipt(schedule: string, stage: string, now: number, requestId: string): SchedulerReceipt {
  const config=FOUR_DAILY_CRONS.find(c=>c.schedule===schedule&&c.stage===stage);
  if (!config || !/^[a-zA-Z0-9:._-]{8,200}$/.test(requestId)) throw new Error("Invalid scheduler stage");
  const hour=Number(schedule.split(" ")[1]);
  let occurrence=Math.floor(now/86_400_000)*86_400_000+hour*3_600_000;
  if (occurrence>now) occurrence-=86_400_000;
  const slot=occurrence-({primary:0,catchup1:2,catchup2:4}[config.stage])*3_600_000;
  if (now>=stageWindow(slot,config.stage).end) throw new Error("Expired scheduler invocation");
  return {schema:2,source:"vercel-cron",stage:config.stage,schedule,scheduledFor:new Date(slot).toISOString(),requestedAt:new Date(now).toISOString(),requestId};
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
  if (value.schema === 2) {
    const expected=stageSchedulerReceipt(value.schedule,value.stage??"",requestedAt,value.requestId);
    if (JSON.stringify(value)!==JSON.stringify(expected) || requestedAt>now) throw new Error("Invalid scheduler occurrence");
    return expected; // Expiry is accounted as a skip, never relabeled into a new stage.
  }
  const expected = schedulerReceipt(value.schedule, requestedAt, value.requestId);
  if (value.source !== expected.source || value.scheduledFor !== expected.scheduledFor || value.requestedAt !== expected.requestedAt
    || requestedAt > now || Date.parse(value.scheduledFor) !== currentCollectionSlot(now)) throw new Error("Expired or invalid scheduler receipt");
  return expected;
}
