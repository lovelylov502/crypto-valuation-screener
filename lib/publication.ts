import type { ScreenerResponse } from "./types";
import type { CollectionAttempt, PublicationJournal, PublishedSnapshot } from "./publicationTypes";
import { RULE_VERSION } from "./fundamentals";
import { fundamentalErrors } from "./fundamentalContract";
import { collectionCoverage, collectionErrors, collectionRegressions, collectionState } from "./collectionQuality";

export const COLLECTION_DEADLINE_MS = 15 * 60_000;
export const JOURNAL_REPOSITORY = "lovelylov502/crypto-valuation-screener";
export const JOURNAL_DOWNLOAD = `https://github.com/${JOURNAL_REPOSITORY}/releases/download/`;
export const JOURNAL_LATEST = `https://github.com/${JOURNAL_REPOSITORY}/releases/latest/download/state.json`;
export const stateUrl = (id: string) => `${JOURNAL_DOWNLOAD}${id}/state.json`;

export function snapshotErrors(data: ScreenerResponse): string[] {
  const errors: string[] = [];
  if (data.scoreVersion !== RULE_VERSION || !Number.isFinite(Date.parse(data.updatedAt))) errors.push("snapshot_version_or_time");
  if (!Array.isArray(data.coins) || !data.coins.length) return [...errors, "empty_universe"];
  if (!Array.isArray(data.sources) || !data.sources.length) return [...errors, "missing_source_observations"];
  errors.push(...data.sources.filter(s => s.status === "error").map(s => `source_request_failed:${s.httpStatus ?? "network"}`));
  const coverage = collectionCoverage(data.coins);
  if (JSON.stringify(coverage) !== JSON.stringify(data.collection)) errors.push("collection_accounting_mismatch");
  for (const [vendor, q] of [["gecko", coverage.gecko], ["cmc", coverage.cmc]] as const) {
    if (q.failed) errors.push(`${vendor}_failed:${q.failed}`);
    if (q.requested && !q.received) errors.push(`${vendor}_empty_response`);
    if (q.requested !== q.received + q.failed + q.notReturned) errors.push(`${vendor}_unaccounted`);
  }
  const urls = data.sources.filter(s => s.status === "ok").map(s => new URL(s.url));
  for (const path of ["/protocols", "/config", "/overview/fees", "/overview/dexs"]) if (!urls.some(u => u.hostname === "api.llama.fi" && u.pathname === path)) errors.push(`source_evidence_missing:${path}`);
  for (const metric of ["dailyRevenue", "dailyHoldersRevenue"]) if (!urls.some(u => u.searchParams.get("dataType") === metric)) errors.push(`source_evidence_missing:${metric}`);
  errors.push(...collectionErrors(data.coins));
  for (const c of data.coins) errors.push(...fundamentalErrors(c).map(e => `${c.slug}:${e}`));
  return [...new Set(errors)];
}

/** Publication rejects unexplained losses even when every HTTP response is 200. */
export function assessCandidate(data: ScreenerResponse, baseline: ScreenerResponse | null, startedAt: string, completedAt: string) {
  const errors = snapshotErrors(data);
  const age = Date.parse(completedAt) - Date.parse(data.updatedAt);
  if (age < -300_000 || age > 45 * 60_000) errors.push("candidate_not_current");
  if (startedAt.slice(0, 10) !== data.updatedAt.slice(0, 10)) errors.push("collection_crossed_utc_day");
  if (baseline && Date.parse(data.updatedAt) <= Date.parse(baseline.updatedAt)) errors.push("candidate_not_newer");
  const previous = baseline && collectionState(baseline), next = collectionState(data);
  const changes = previous ? collectionRegressions(previous, next) : [];
  if (changes.length) errors.push(`unreviewed_losses:${changes.length}`);
  const affected = [...new Set(changes.map(c => c.slug))].map(slug => ({
    slug, name: data.coins.find(c => c.slug === slug)?.name ?? baseline?.coins.find(c => c.slug === slug)?.name ?? slug,
    issues: changes.filter(c => c.slug === slug).map(c => c.issue), before: previous?.coins[slug] ?? null, after: next.coins[slug] ?? null,
  }));
  return { errors, changes, affected };
}

export function startJournal(previous: PublicationJournal | null, attempt: CollectionAttempt, id: string): PublicationJournal {
  if (previous && Date.parse(attempt.startedAt) <= Date.parse(previous.attempt.startedAt)) throw new Error("Older collector cannot replace journal");
  const interrupted = previous?.attempt.outcome === "running";
  return { schema: 1, id, createdAt: attempt.startedAt, trackingStartedAt: previous?.trackingStartedAt ?? attempt.startedAt, previousId: previous?.id ?? null,
    previousStateUrl: previous ? stateUrl(previous.id) : null, published: previous?.published ?? null, attempt,
    incident: previous?.incident ?? (interrupted ? { firstFailureObservedAt: previous!.attempt.startedAt, lastFailureObservedAt: attempt.startedAt, lastGoodDataAt: previous?.published?.dataAt ?? null } : null),
    recoveredAt: previous?.recoveredAt ?? null };
}

export function finishJournal(current: PublicationJournal, attempt: CollectionAttempt, published: PublishedSnapshot | null, id: string): PublicationJournal {
  if (current.attempt.id !== attempt.id || current.attempt.outcome !== "running") throw new Error("Superseded or already completed collection");
  if (!attempt.completedAt || Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)) throw new Error("Invalid completion time");
  const accepted = attempt.outcome === "published";
  if (accepted && (!published || attempt.errors.length || (current.published && Date.parse(published.dataAt) <= Date.parse(current.published.dataAt)))) throw new Error("Unverified or older publication");
  if (!accepted && published) throw new Error("Blocked attempt cannot replace snapshot");
  const failureAt = attempt.sourceFailures.map(s => s.observedAt).sort()[0] ?? attempt.completedAt;
  return { schema: 1, id, createdAt: attempt.completedAt, trackingStartedAt: current.trackingStartedAt, previousId: current.id, previousStateUrl: stateUrl(current.id),
    published: accepted ? published : current.published, attempt,
    incident: accepted ? null : { firstFailureObservedAt: current.incident?.firstFailureObservedAt ?? failureAt,
      lastFailureObservedAt: attempt.completedAt, lastGoodDataAt: current.published?.dataAt ?? null },
    recoveredAt: accepted && current.incident ? attempt.completedAt : current.recoveredAt };
}
