import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { collectionSchedule } from "./collectionSchedule";
import { scheduledCollectionDecision } from "./scheduledCollection";

it.each(["2026-10-03T14:47:00Z", "2026-10-03T15:17:00Z"])("recovers a missed primary wake at %s", now => {
  expect(scheduledCollectionDecision("2026-10-03T03:13:06.437Z", Date.parse(now))).toEqual({
    collect: true, slotAt: "2026-10-03T14:17:00.000Z", previousStartedAt: "2026-10-03T03:13:06.437Z",
  });
});

it("performs only two collections across all six wakes in a day", () => {
  let lastStartedAt = "2026-10-02T14:18:00Z";
  const starts: string[] = [];
  for (const hour of [2, 14]) {
    for (const offset of [0, 30, 60]) {
      const now = Date.UTC(2026, 9, 3, hour, 17 + offset);
      const decision = scheduledCollectionDecision(lastStartedAt, now);
      if (decision.collect) {
        starts.push(decision.slotAt);
        lastStartedAt = new Date(now).toISOString();
      }
    }
  }
  expect(starts).toEqual(["2026-10-03T02:17:00.000Z", "2026-10-03T14:17:00.000Z"]);
});

it("skips a recorded start even without a successful publication, then permits the next slot", () => {
  const lastStart = "2026-10-03T14:17:00Z";
  expect(scheduledCollectionDecision(lastStart, Date.parse("2026-10-03T15:17:00Z")).collect).toBe(false);
  expect(scheduledCollectionDecision(lastStart, Date.parse("2026-10-04T02:17:00Z")).collect).toBe(true);
});

it("does not let a UTC date rollover start another collection before the next slot", () => {
  const lastStart = "2026-12-31T14:18:00Z";
  expect(scheduledCollectionDecision(lastStart, Date.parse("2027-01-01T00:01:00Z"))).toMatchObject({
    collect: false, slotAt: "2026-12-31T14:17:00.000Z",
  });
  expect(scheduledCollectionDecision(lastStart, Date.parse("2027-01-01T02:17:00Z"))).toMatchObject({
    collect: true, slotAt: "2027-01-01T02:17:00.000Z",
  });
});

it("allows a late natural wake without moving the missed deadline", () => {
  const now = Date.parse("2026-10-03T16:00:00Z");
  const decision = scheduledCollectionDecision("2026-10-03T03:13:06Z", now);
  expect(decision.collect).toBe(true);
  expect(collectionSchedule(now).deadlineAt).toBe(Date.parse("2026-10-03T15:47:00Z"));
});

it.each([null, "invalid", "2026-10-03T17:00:00Z"])("refuses to collect from an untrusted start time %s", lastStart => {
  expect(() => scheduledCollectionDecision(lastStart, Date.parse("2026-10-03T16:00:00Z"))).toThrow("Cannot determine");
});

it("keeps all collection steps behind the due guard and the existing writer lock", () => {
  const workflow = readFileSync(new URL("../.github/workflows/daily-snapshot.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  expect(workflow).toContain("group: screener-publication\n  cancel-in-progress: false");
  expect(workflow).toMatch(/id: due\s+run: npx tsx scripts\/publication-job.ts due/);
  for (const step of ["Persist collection start", "Collect and validate candidate"]) {
    const block = workflow.split(`- name: ${step}`)[1].split("\n      - ")[0];
    expect(block).toContain("if: steps.due.outputs.collect == 'true'");
  }
  expect(workflow).toContain("SCREENER_SCHEDULED_FOR: ${{ steps.due.outputs.slot_at }}");
});
