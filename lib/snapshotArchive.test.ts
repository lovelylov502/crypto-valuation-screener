import { expect, it } from "vitest";
import { finishJournal, startJournal, JOURNAL_DOWNLOAD } from "./publication";
import { parseJournal } from "./snapshotArchive";
import type { CollectionAttempt, PublishedSnapshot } from "./publicationTypes";

const at = "2026-10-05T02:05:00.000Z";
const attempt: CollectionAttempt = { id: "data-123-1", startedAt: at, completedAt: null, outcome: "running", runUrl: "https://github.com/run", reportUrl: "https://github.com/report", errors: [], sourceFailures: [], affectedProjects: 0, changeCount: 0, affected: [] };
const id = "data-123-1-complete";
const base = `${JOURNAL_DOWNLOAD}${id}/`;
const ref: PublishedSnapshot = { id, url: base + "data.json.gz", sha256: "a".repeat(64), dataAt: at, validatedAt: at, publishedAt: at, codeCommit: "abc", reportUrl: base + "report.json", witnessUrl: base + "witness.json.gz", witnessSha256: "b".repeat(64) };
const published = () => finishJournal(startJournal(null, attempt, "data-123-1-start"), { ...attempt, outcome: "published", completedAt: at }, ref, id);

it("accepts serialized legacy and complete pipeline proofs, rejecting incomplete source bindings", () => {
  const journal = published();
  expect(parseJournal(JSON.parse(JSON.stringify(journal)))).toEqual(journal);
  journal.published = { ...ref, rawBundleUrl: base + "source-bundle.json.gz", rawBundleSha256: "c".repeat(64), normalizedSha256: "d".repeat(64), replayVerified: true };
  expect(parseJournal(journal)).toBe(journal);
  for (const field of ["rawBundleUrl", "rawBundleSha256", "normalizedSha256", "replayVerified"] as const) {
    const changed = structuredClone(journal); delete changed.published![field];
    expect(() => parseJournal(changed)).toThrow("raw source proof");
  }
});
it("rejects corrupted slot state before it can suppress collection", () => {
  for (const patch of [{ attemptCount: -1 }, { manualRepairCount: 2 }, { lastAttemptId: "data-other" }, { scheduledFor: "2026-10-05T14:00:00Z" }, { successfulPublicationId: "data-wrong" }, { nextRetryAt: at }]) {
    const journal = published(); Object.assign(journal.schedule!, patch);
    expect(() => parseJournal(journal)).toThrow("slot state");
  }
  const running = startJournal(null, attempt, "data-123-1-start"); running.schedule!.settled = true;
  expect(() => parseJournal(running)).toThrow("slot state");
});

it("settles accepted nonretryable partial data while preserving the partial warning", () => {
  const journal = finishJournal(startJournal(null, attempt, "data-123-1-start"),
    { ...attempt, outcome: "published", completedAt: at, partial: true, failureClass: "validation" }, ref, id);
  expect(journal.attempt.partial).toBe(true);
  expect(journal.incident).toBeNull();
  expect(journal.schedule).toMatchObject({ settled: true, nextRetryAt: null, successfulPublicationId: id });
  expect(parseJournal(JSON.parse(JSON.stringify(journal)))).toEqual(journal);
  journal.attempt.failureClass = "transient";
  expect(() => parseJournal(journal)).toThrow("slot state");
});
