import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { collectionSchedule, COLLECTION_MINUTE, COLLECTION_UTC_HOURS } from "./collectionSchedule";

it.each([
  ["2026-10-03T00:00:00Z", "2026-10-02T14:00:00Z", "2026-10-03T02:00:00Z"],
  ["2026-10-03T03:29:59Z", "2026-10-02T14:00:00Z", "2026-10-03T14:00:00Z"],
  ["2026-10-03T03:30:00Z", "2026-10-03T02:00:00Z", "2026-10-03T14:00:00Z"],
  ["2026-10-03T15:30:00Z", "2026-10-03T14:00:00Z", "2026-10-04T02:00:00Z"],
  ["2026-12-31T23:59:59Z", "2026-12-31T14:00:00Z", "2027-01-01T02:00:00Z"],
])("computes due and next slots at %s without extending a missed deadline", (now, required, next) => {
  const actual = collectionSchedule(Date.parse(now));
  expect(actual.requiredAt).toBe(Date.parse(required));
  expect(actual.nextAt).toBe(Date.parse(next));
});

it("keeps the production cron and browser deadline on the same twice-daily schedule", () => {
  const workflow = readFileSync(new URL("../.github/workflows/daily-snapshot.yml", import.meta.url), "utf8");
  const crons = [...workflow.matchAll(/cron:\s*"([^"]+)"/g)].map(match => match[1]);
  expect(crons).toEqual([
    `${COLLECTION_MINUTE} ${COLLECTION_UTC_HOURS.join(",")} * * *`,
    `${COLLECTION_MINUTE + 30} ${COLLECTION_UTC_HOURS.join(",")} * * *`,
    `${COLLECTION_MINUTE} ${COLLECTION_UTC_HOURS.map(hour => hour + 1).join(",")} * * *`,
  ]);
  expect(COLLECTION_UTC_HOURS[1] - COLLECTION_UTC_HOURS[0]).toBe(12);
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  expect(vercel.crons).toEqual(COLLECTION_UTC_HOURS.map(hour => ({ path: "/api/cron/collect", schedule: `${COLLECTION_MINUTE} ${hour} * * *` })));
});
