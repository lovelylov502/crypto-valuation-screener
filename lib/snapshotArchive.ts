import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { ScreenerResponse } from "./types";
import type { PublicationJournal, PublishedSnapshot } from "./publicationTypes";
import { JOURNAL_DOWNLOAD, JOURNAL_LATEST, snapshotErrors } from "./publication";
import { pipelineIntegrityErrors } from "./pipelineIntegrity";
import { validateRecovery } from "./freshnessRecovery";

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function checkArchiveUrl(url: string) {
  if (!url.startsWith(JOURNAL_DOWNLOAD) || !/^data-[a-zA-Z0-9-]+\/[a-zA-Z0-9.-]+$/.test(url.slice(JOURNAL_DOWNLOAD.length))) throw new Error("Invalid archive URL");
}
export function decodeSnapshot(bytes: Uint8Array, ref: PublishedSnapshot): ScreenerResponse {
  if (sha256(bytes) !== ref.sha256) throw new Error("Snapshot hash mismatch");
  const data = JSON.parse(gunzipSync(bytes, { maxOutputLength: 150_000_000 }).toString("utf8")) as ScreenerResponse;
  if (data.updatedAt !== ref.dataAt) throw new Error("Snapshot date mismatch");
  const errors = [...snapshotErrors(data), ...pipelineIntegrityErrors(data)];
  if ((data.pipeline || ref.rawBundleSha256) && (!data.pipeline || !ref.rawBundleUrl || data.pipeline.rawBundleSha256 !== ref.rawBundleSha256 || data.pipeline.normalizedSha256 !== ref.normalizedSha256 || ref.replayVerified !== true)) errors.push("archive_source_proof_mismatch");
  if (errors.length) throw new Error(`Archived snapshot failed verification: ${errors.slice(0, 3).join(", ")}`);
  return data;
}
export function parseJournal(value: unknown): PublicationJournal {
  const j = value as PublicationJournal;
  if (!j || ![1,2].includes(j.schema) || !/^data-[a-zA-Z0-9-]+$/.test(j.id) || !j.attempt || !["running", "published", "blocked"].includes(j.attempt.outcome)
    || !Number.isFinite(Date.parse(j.createdAt)) || !Number.isFinite(Date.parse(j.attempt.startedAt))
    || !Array.isArray(j.attempt.errors) || !Array.isArray(j.attempt.sourceFailures) || !Array.isArray(j.attempt.affected)
    || (j.attempt.comparisonCompleted !== undefined && typeof j.attempt.comparisonCompleted !== "boolean")
    || !Number.isInteger(j.attempt.affectedProjects) || j.attempt.affectedProjects < 0) throw new Error("Invalid publication journal");
  if (j.published) {
    for (const url of [j.published.url,j.published.reportUrl,j.published.witnessUrl]) checkArchiveUrl(url);
    if ([j.published.rawBundleUrl, j.published.rawBundleSha256, j.published.normalizedSha256, j.published.replayVerified].some(v => v !== undefined)) {
      if (typeof j.published.rawBundleUrl !== "string") throw new Error("Invalid raw source proof");
      checkArchiveUrl(j.published.rawBundleUrl);
      if (![j.published.rawBundleSha256, j.published.normalizedSha256].every(h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)) || j.published.replayVerified !== true) throw new Error("Invalid raw source proof");
    }
    if (![j.published.sha256,j.published.witnessSha256].every(h => /^[a-f0-9]{64}$/.test(h)) || ![j.published.dataAt,j.published.validatedAt,j.published.publishedAt].every(t => Number.isFinite(Date.parse(t)))) throw new Error("Invalid snapshot proof");
  }
  const a = j.attempt, s = j.schedule;
  if ((a.scheduledFor != null && !Number.isFinite(Date.parse(a.scheduledFor)))
    || (a.manualRepair !== undefined && typeof a.manualRepair !== "boolean")
    || (a.partial !== undefined && typeof a.partial !== "boolean")
    || (a.failureClass !== undefined && !["transient", "validation", "unknown"].includes(a.failureClass))) throw new Error("Invalid attempt state");
  if (s && (!Number.isFinite(Date.parse(s.scheduledFor)) || s.scheduledFor !== a.scheduledFor
    || !Number.isInteger(s.attemptCount) || s.attemptCount < 1
    || !Number.isInteger(s.manualRepairCount) || s.manualRepairCount < 0 || s.manualRepairCount > s.attemptCount
    || s.lastAttemptId !== a.id || typeof s.settled !== "boolean"
    || (s.successfulPublicationId !== null && s.successfulPublicationId !== j.published?.id)
    || (s.settled && (a.outcome !== "published" || (a.partial === true && a.failureClass === "transient") || s.successfulPublicationId !== j.published?.id))
    || (s.nextRetryAt !== null && (!Number.isFinite(Date.parse(s.nextRetryAt)) || s.settled)))) throw new Error("Invalid collection slot state");
  if (j.previousStateUrl) checkArchiveUrl(j.previousStateUrl);
  if (j.schema===2) validateRecovery(j);
  return j;
}
export async function readJournal(): Promise<PublicationJournal> {
  const response = await fetch(JOURNAL_LATEST, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Publication store HTTP ${response.status}`);
  return parseJournal(await response.json());
}
export async function readSnapshot(ref: PublishedSnapshot): Promise<ScreenerResponse> {
  checkArchiveUrl(ref.url);
  const response = await fetch(ref.url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Snapshot store HTTP ${response.status}`);
  return decodeSnapshot(new Uint8Array(await response.arrayBuffer()), ref);
}
