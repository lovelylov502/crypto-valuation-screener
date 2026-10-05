import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { collectionSchedule } from "./collectionSchedule";
import { scheduledCollectionDecision, collectionTriggerDecision, classifyAttemptFailure } from "./scheduledCollection";
import { startJournal, finishJournal } from "./publication";
import type { PublicationJournal, CollectionAttempt } from "./publicationTypes";

function journal(startedAt: string, outcome: CollectionAttempt["outcome"] = "published"): PublicationJournal {
  return { schema: 1, id: "data-previous", createdAt: startedAt, trackingStartedAt: startedAt, previousId: null, previousStateUrl: null,
    published: null, incident: null, recoveredAt: null,
    attempt: { id: "data-previous", startedAt, completedAt: outcome === "running" ? null : startedAt, outcome,
      errors: outcome === "blocked" ? ["timeout"] : [], sourceFailures: [], runUrl: "", reportUrl: "", affectedProjects: 0, changeCount: 0, affected: [] } };
}

it.each(["2026-10-03T14:30:00Z", "2026-10-03T15:00:00Z"])("recovers a missed primary wake at %s", now => {
  expect(scheduledCollectionDecision(journal("2026-10-03T03:13:06.437Z"), Date.parse(now))).toMatchObject({
    collect: true, reason: "new-slot", slotAt: "2026-10-03T14:00:00.000Z",
  });
});

it("performs only two successful collections across six automatic wakes", () => {
  let previous = journal("2026-10-02T14:18:00Z");
  const starts: string[] = [];
  for (const hour of [2, 14]) for (const offset of [0, 30, 60]) {
    const now = Date.UTC(2026, 9, 3, hour, offset);
    const decision = scheduledCollectionDecision(previous, now);
    if (decision.collect) { starts.push(decision.slotAt); previous = journal(new Date(now).toISOString()); }
  }
  expect(starts).toEqual(["2026-10-03T02:00:00.000Z", "2026-10-03T14:00:00.000Z"]);
});

it("retries transient failures with a persistent backoff and bounded budget", () => {
  let previous = journal("2026-10-03T02:00:00Z");
  for (let index = 0; index < 3; index++) {
    const startedAt = new Date(Date.parse("2026-10-03T14:00:00Z") + index * 10 * 60_000).toISOString();
    expect(scheduledCollectionDecision(previous, Date.parse(startedAt)).collect).toBe(true);
    const attempt = { ...previous.attempt, id: `data-${index}`, startedAt, completedAt: null, outcome: "running" as const, errors: [], scheduledFor: "2026-10-03T14:00:00.000Z" };
    const running = startJournal(previous, attempt, `${attempt.id}-start`);
    previous = finishJournal(running, { ...attempt, completedAt: startedAt, outcome: "blocked", errors: ["timeout"] }, null, `${attempt.id}-complete`);
    expect(previous.schedule?.attemptCount).toBe(index + 1);
    expect(scheduledCollectionDecision(JSON.parse(JSON.stringify(previous)), Date.parse(startedAt) + 60_000).collect).toBe(false);
  }
  expect(scheduledCollectionDecision(previous, Date.parse("2026-10-03T15:00:00Z"))).toMatchObject({ collect: false, reason: "retry-budget-exhausted" });
  expect(scheduledCollectionDecision(previous, Date.parse("2026-10-04T02:00:00Z")).collect).toBe(true);
});

it("preserves a running lease across a slot boundary and recovers an expired lease", () => {
  const previous = journal("2026-10-03T13:59:00Z", "running");
  expect(scheduledCollectionDecision(previous, Date.parse("2026-10-03T14:00:00Z"), true)).toMatchObject({ collect: false, reason: "running" });
  expect(scheduledCollectionDecision(previous, Date.parse("2026-10-03T14:14:00Z")).collect).toBe(true);
  expect(scheduledCollectionDecision(journal("2026-10-03T14:00:00Z", "running"), Date.parse("2026-10-03T14:15:00Z")).collect).toBe(true);
});

it("requires explicit repair for validation failures and permits it after automatic budget exhaustion", () => {
  const previous = journal("2026-10-03T14:00:00Z", "blocked");
  previous.attempt.errors = ["unreviewed_losses:1"];
  const now = Date.parse("2026-10-03T14:30:00Z");
  expect(scheduledCollectionDecision(previous, now)).toMatchObject({ collect: false, reason: "review-required" });
  previous.schedule = { scheduledFor: "2026-10-03T14:00:00.000Z", attemptCount: 3, manualRepairCount: 0, lastAttemptId: previous.attempt.id,
    successfulPublicationId: null, settled: false, nextRetryAt: null };
  expect(collectionTriggerDecision({ event: "workflow_dispatch", receipt: "", signature: "", secret: "", bootstrap: false }, previous, now)).toMatchObject({
    collect: true, manualRepair: true, trigger: { source: "manual", scheduledFor: "2026-10-03T14:00:00.000Z" },
  });
  previous.schedule.attemptCount = 5; previous.schedule.manualRepairCount = 2;
  expect(scheduledCollectionDecision(previous, now, true)).toMatchObject({ collect: false, reason: "manual-budget-exhausted" });
});

it("retries an accepted partial publication only for transient problems", () => {
  const previous = journal("2026-10-03T14:00:00Z"); previous.attempt.partial = true; previous.attempt.failureClass = "transient";
  expect(scheduledCollectionDecision(previous, Date.parse("2026-10-03T14:30:00Z")).collect).toBe(true);
  previous.attempt.failureClass = "validation";
  expect(scheduledCollectionDecision(previous, Date.parse("2026-10-03T14:30:00Z"))).toMatchObject({ collect: false, reason: "published" });
});

it.each([false, true])("permits two explicit same-slot repairs of settled partial=%s without counting them as automatic", partial => {
  let previous = journal("2026-10-03T14:00:00Z");
  previous.attempt.partial = partial; previous.attempt.failureClass = partial ? "validation" : undefined;
  previous.schedule = { scheduledFor: "2026-10-03T14:00:00.000Z", attemptCount: 1, manualRepairCount: 0,
    lastAttemptId: previous.attempt.id, successfulPublicationId: null, settled: true, nextRetryAt: null };
  const input = { event: "workflow_dispatch", receipt: "", signature: "", secret: "", bootstrap: false };
  for (let index = 1; index <= 2; index++) {
    const now = Date.parse("2026-10-03T14:00:00Z") + index * 10 * 60_000;
    expect(scheduledCollectionDecision(previous, now)).toMatchObject({ collect: false, reason: "published" });
    expect(collectionTriggerDecision(input, previous, now)).toMatchObject({ collect: true, reason: "manual-repair", manualRepair: true,
      trigger: { source: "manual", scheduledFor: "2026-10-03T14:00:00.000Z" } });
    const a = { ...previous.attempt, id: `data-manual-${index}`, startedAt: new Date(now).toISOString(), completedAt: null,
      outcome: "running" as const, manualRepair: true };
    const running = startJournal(previous, a, `${a.id}-start`);
    const ref = { id: `${a.id}-complete`, dataAt: a.startedAt } as NonNullable<PublicationJournal["published"]>;
    previous = finishJournal(running, { ...a, completedAt: a.startedAt, outcome: "published" }, ref, ref.id);
    expect(previous.schedule).toMatchObject({ attemptCount: index + 1, manualRepairCount: index, settled: true });
    expect(previous.schedule!.attemptCount - previous.schedule!.manualRepairCount).toBe(1);
  }
  expect(collectionTriggerDecision(input, previous, Date.parse("2026-10-03T14:30:00Z"))).toMatchObject({ collect: false, reason: "manual-budget-exhausted" });
});

it("classifies a recorded transport failure as retryable without retrying a concurrent validation error", () => {
  const attempt = journal("2026-10-03T14:00:00Z", "blocked").attempt;
  attempt.errors = ["Recorded source transport failure"];
  expect(classifyAttemptFailure(attempt)).toBe("transient");
  attempt.errors.push("candidate_source_lineage_mismatch");
  expect(classifyAttemptFailure(attempt)).toBe("validation");
});

it("preserves UTC boundaries and the missed deadline", () => {
  expect(scheduledCollectionDecision(journal("2026-12-31T14:18:00Z"), Date.parse("2027-01-01T00:01:00Z")).collect).toBe(false);
  expect(scheduledCollectionDecision(journal("2026-12-31T14:18:00Z"), Date.parse("2027-01-01T02:00:00Z")).collect).toBe(true);
  const now = Date.parse("2026-10-03T16:00:00Z");
  expect(scheduledCollectionDecision(journal("2026-10-03T03:13:06Z"), now).collect).toBe(true);
  expect(collectionSchedule(now).deadlineAt).toBe(Date.parse("2026-10-03T15:30:00Z"));
});

it.each([null, "invalid", "2026-10-03T17:00:00Z"])("refuses an untrusted start time %s", startedAt => {
  expect(() => scheduledCollectionDecision(startedAt ? journal(startedAt) : null, Date.parse("2026-10-03T16:00:00Z"))).toThrow("Cannot determine");
});

it("keeps collection steps behind the due guard and writer lock", () => {
  const workflow = readFileSync(new URL("../.github/workflows/daily-snapshot.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  expect(workflow).toContain("group: screener-publication\n  cancel-in-progress: false");
  for (const step of ["Persist collection start", "Collect and validate candidate"]) {
    const block = workflow.split(`- name: ${step}`)[1].split("\n      - ")[0];
    expect(block).toContain("if: steps.due.outputs.collect == 'true'");
  }
});
