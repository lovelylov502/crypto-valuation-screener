import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { collectionSchedule, COLLECTION_UTC_HOURS } from "./collectionSchedule";
import {collectionReleaseState} from "./pipelineRelease";
import {FOUR_DAILY_CRONS} from "./schedulerDispatch";

it.each([
  ["2026-10-03T00:00:00Z", "2026-10-02T14:00:00Z", "2026-10-03T02:00:00Z"],
  ["2026-10-03T03:29:59Z", "2026-10-02T14:00:00Z", "2026-10-03T14:00:00Z"],
  ["2026-10-03T03:30:00Z", "2026-10-03T02:00:00Z", "2026-10-03T14:00:00Z"],
  ["2026-10-03T15:30:00Z", "2026-10-03T14:00:00Z", "2026-10-04T02:00:00Z"],
  ["2026-12-31T23:59:59Z", "2026-12-31T14:00:00Z", "2027-01-01T02:00:00Z"],
])("preserves schema-1 due and next slots at %s", (now, required, next) => {
  const actual = collectionSchedule(Date.parse(now),"legacy");
  expect(actual.requiredAt).toBe(Date.parse(required));expect(actual.nextAt).toBe(Date.parse(next));
});
it.each([
 ["2026-10-03T00:00:00Z","2026-10-02T20:00:00Z","2026-10-03T02:00:00Z"],
 ["2026-10-03T03:29:59Z","2026-10-02T20:00:00Z","2026-10-03T08:00:00Z"],
 ["2026-10-03T03:30:00Z","2026-10-03T02:00:00Z","2026-10-03T08:00:00Z"],
 ["2026-10-03T09:30:00Z","2026-10-03T08:00:00Z","2026-10-03T14:00:00Z"],
 ["2026-12-31T23:59:59Z","2026-12-31T20:00:00Z","2027-01-01T02:00:00Z"],
])("computes four-daily due and next slots at %s without extending a deadline",(now,required,next)=>{
 const actual=collectionSchedule(Date.parse(now),"four-daily");expect(actual.requiredAt).toBe(Date.parse(required));expect(actual.nextAt).toBe(Date.parse(next));
});
it("keeps the actual release's browser cadence, Vercel stage entries and fallback wakes consistent", () => {
  const workflow = readFileSync(new URL("../.github/workflows/daily-snapshot.yml", import.meta.url), "utf8");
  const crons = [...workflow.matchAll(/cron:\s*"([^"]+)"/g)].map(match => match[1]);
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")),mode=collectionReleaseState().schedule;
  if(mode==="paused") {expect(crons).toEqual([]);expect(vercel.crons).toEqual([]);return;}
  const hours=mode==="four-daily"?[2,8,14,20]:[2,14];expect(COLLECTION_UTC_HOURS).toEqual(hours);
  expect(crons).toEqual([
    "0 "+hours.join(",")+" * * *",
    "30 "+hours.join(",")+" * * *",
    "0 "+hours.map(hour=>hour+1).join(",")+" * * *",
    ...(mode==="four-daily"?["0 4,10,16,22 * * *","0 0,6,12,18 * * *"]:[]),
  ]);
  expect(vercel.crons).toEqual(mode==="four-daily"?FOUR_DAILY_CRONS.map(({path,schedule})=>({path,schedule})):hours.map(hour=>({path:"/api/cron/collect",schedule:"0 "+hour+" * * *"})));
});
