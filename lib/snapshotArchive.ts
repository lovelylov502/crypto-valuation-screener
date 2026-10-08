import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { ScreenerResponse } from "./types";
import type { PublicationJournal, PublishedSnapshot } from "./publicationTypes";
import { JOURNAL_DOWNLOAD, JOURNAL_LATEST, snapshotErrors } from "./publication";
import { pipelineIntegrityErrors } from "./pipelineIntegrity";
import { validateRecovery,withMigrationEvidence } from "./freshnessRecovery";
import {validateEconomicReview,validateEconomicSummary} from "./economicReview";
import {validateEconomicReviewRef} from "./economicReviewArchive";

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
  if(j.publicationFailure) {
    const p=j.publicationFailure;
    if(p.schema!==1||!/^data-[a-zA-Z0-9-]+-failed-observation$/.test(p.journalId)||p.attemptId!==`data-${p.runId}-${p.runAttempt}`||!/^\d+$/.test(p.runId)||!Number.isInteger(p.runAttempt)||p.runAttempt<1||
      ![p.failedAt,p.archivedAt].every(t=>typeof t==="string"&&Number.isFinite(Date.parse(t)))||Date.parse(p.archivedAt)<Date.parse(p.failedAt)||
      p.manifestUrl!==`${JOURNAL_DOWNLOAD}${p.journalId}/failed-evidence.json`||!/^[a-f0-9]{64}$/.test(p.manifestSha256)||
      j.id===p.journalId&&(j.previousId!==`${p.attemptId}-start`||j.attempt.id!==p.attemptId||j.attempt.outcome!=="blocked"||j.attempt.completedAt!==p.failedAt||!j.attempt.errors.includes("publication_storage_failed")||!j.incident))throw Error("Invalid failed publication evidence");
  }
  if(j.correction) {
    const c=j.correction;
    for(const url of [c.parentJournalUrl,c.originalJournalUrl,c.targetJournalUrl]){checkArchiveUrl(url);if(!url.endsWith("/state.json"))throw new Error("Invalid correction evidence");}
    if(c.schema!==1||c.reason!=="systemic-market-acquisition"||!/^data-[a-zA-Z0-9-]+-correction$/.test(c.journalId)||!Number.isFinite(Date.parse(c.observedAt))||!c.from||!c.to||
      !Array.isArray(c.readiness?.errors)||!c.readiness.errors.some(e=>e.startsWith("market_acquisition_failed:"))||!Array.isArray(c.readiness.coverage)||
      j.id===c.journalId&&(c.parentJournalUrl!==j.previousStateUrl||JSON.stringify(j.published)!==JSON.stringify(c.to)||!["published","blocked"].includes(j.attempt.outcome)||!j.incident))throw new Error("Invalid publication correction");
  }
  if (j.schema===2) validateRecovery(j);
  if(j.economicReview)validateEconomicReview(j.economicReview);
  if(j.economicReviewRef) {validateEconomicReviewRef(j.economicReviewRef);validateEconomicSummary(j.publicEconomicReview!);if(j.publicEconomicReview!.stateSha256!==j.economicReviewRef.stateSha256)throw Error("Economic review summary differs from archive reference");}
  return j;
}
export async function readJournal(): Promise<PublicationJournal> {
  const response = await fetch(JOURNAL_LATEST, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Publication store HTTP ${response.status}`);
  return withMigrationEvidence(parseJournal(await response.json()),readArchivedJournal);
}
export async function readArchivedJournal(url:string):Promise<PublicationJournal> {
  checkArchiveUrl(url);
  if(!url.endsWith("/state.json"))throw new Error("Invalid journal state reference");
  const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Journal archive HTTP ${response.status}`);
  return parseJournal(await response.json());
}
export async function readSnapshot(ref: PublishedSnapshot): Promise<ScreenerResponse> {
  checkArchiveUrl(ref.url);
  const response = await fetch(ref.url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Snapshot store HTTP ${response.status}`);
  return decodeSnapshot(new Uint8Array(await response.arrayBuffer()), ref);
}
