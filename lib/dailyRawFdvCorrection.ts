import type { Client, Row } from "@libsql/client";
import { historyRead } from "./historyDatabase";
import { getDailyRawRun, initializeDailyRaw, openDailyRawRun, upsertDailyRaw, type DailyRawAsset, type DailyRawSource } from "./dailyRawDatabase";
import { dailyRawSource } from "./dailyRawCollection";
import { objectHash } from "./sourceBundle";
import type { FdvPrimaryHold, FdvValidationManifest } from "./dailyRawFdvValidation";
import type { FdvHoldsManifest } from "./dailyRawFdvHolds";

const CAPTURED_BASIS = "captured_quote;actual_provider_timestamp";
export interface FdvCorrectionClaim extends DailyRawAsset {
  day: string; value: number; at: string; provider: string; observedAt: string; snapshotUrl: string; snapshotSha256: string; reason: string; proofSha256: string;
  review?: { id: string; sha256: string };
}
export interface FdvCorrectionCandidate { asset: DailyRawAsset; day: string; value: number; at: string; source: DailyRawSource; claim: FdvCorrectionClaim }

/** The caller loads both manifests through their original-proof verifiers first. */
export function fdvCorrectionClaims(bounds: FdvValidationManifest, holds: FdvHoldsManifest, currentHolds: FdvPrimaryHold[] = []): FdvCorrectionClaim[] {
  const claims = new Map<string, FdvCorrectionClaim>();
  const add = (claim: FdvCorrectionClaim) => { const key = objectHash([claim.slug, claim.identity, claim.day, claim.value, claim.at, claim.provider, claim.observedAt, claim.snapshotUrl, claim.snapshotSha256]); if (!claims.has(key)) claims.set(key, claim); };
  for (const rejection of bounds.rejections) add({ slug: rejection.slug, identity: rejection.identity, day: rejection.day, value: rejection.proof.reportedFdv, at: rejection.proof.quoteAt,
    provider: rejection.proof.provider, observedAt: rejection.proof.observedAt, snapshotUrl: rejection.proof.snapshotUrl, snapshotSha256: rejection.proof.snapshotSha256, reason: rejection.reason, proofSha256: objectHash(rejection) });
  for (const hold of [...holds.holds, ...currentHolds]) {
    if (!hold.observedAt) throw Error("daily_raw_fdv_correction_observation_required");
    add({ slug: hold.slug, identity: hold.identity, day: hold.day, value: hold.fdv, at: hold.fdvAt, provider: hold.provider, observedAt: hold.observedAt,
      snapshotUrl: hold.proof.snapshotUrl, snapshotSha256: hold.proof.snapshotSha256, reason: hold.reason, proofSha256: objectHash(hold) });
  }
  return [...claims.values()];
}

function candidate(row: Row, claim: FdvCorrectionClaim): FdvCorrectionCandidate {
  const source: DailyRawSource = { key: String(row.source_key), metric: "fdv", provider: String(row.provider), url: String(row.url), observedAt: String(row.observed_at), sha256: String(row.sha256),
    ...(row.archive_url === null ? {} : { archiveUrl: String(row.archive_url) }), scope: String(row.scope), definition: String(row.definition), basis: String(row.basis) };
  return { asset: { slug: String(row.slug), identity: String(row.identity) }, day: String(row.day), value: Number(row.fdv), at: String(row.fdv_at), source, claim };
}
/** Returns only positive captured cells whose complete source/value/time tuple matches a verified claim. */
export async function readFdvCorrectionCandidates(db: Client, claims: FdvCorrectionClaim[]): Promise<FdvCorrectionCandidate[]> {
  const results: FdvCorrectionCandidate[] = [];
  for (let offset = 0; offset < claims.length; offset += 200) {
    const batch = claims.slice(offset, offset + 200), byKey = new Map(batch.map(claim => [claim.proofSha256, claim]));
    // Match the REAL column representation even when JSON emits a large amount as integer digits.
    const found = await historyRead(db, { sql: `SELECT a.slug,a.identity,d.day,d.fdv,d.fdv_at,s.source_key,s.provider,s.scope,s.definition,s.basis,r.url,r.observed_at,r.sha256,r.archive_url,json_extract(j.value,'$.proofSha256') AS proof_key
      FROM json_each(?) j JOIN daily_raw_assets a ON a.slug=json_extract(j.value,'$.slug') AND a.identity=json_extract(j.value,'$.identity')
      JOIN daily_raw_days d ON d.asset_id=a.id AND d.day=json_extract(j.value,'$.day')
      JOIN daily_raw_sources s ON s.id=d.fdv_source AND s.asset_id=a.id AND s.metric='fdv'
      JOIN daily_raw_receipts r ON r.id=s.receipt_id
      WHERE d.fdv_state=1 AND d.fdv>0 AND s.basis=? AND s.provider=json_extract(j.value,'$.provider')
      AND r.url=json_extract(j.value,'$.snapshotUrl') AND r.sha256=json_extract(j.value,'$.snapshotSha256') AND r.observed_at=json_extract(j.value,'$.observedAt')
      AND d.fdv=CAST(json_extract(j.value,'$.value') AS REAL) AND d.fdv_at=json_extract(j.value,'$.at') ORDER BY a.slug,d.day`, args: [JSON.stringify(batch), CAPTURED_BASIS] });
    for (const row of found.rows) results.push(candidate(row, byKey.get(String(row.proof_key))!));
  }
  const unique = new Map(results.map(item => [objectHash([item.asset, item.day, item.source.key]), item]));
  return [...unique.values()].sort((a, b) => a.asset.slug.localeCompare(b.asset.slug) || a.asset.identity.localeCompare(b.asset.identity) || a.day.localeCompare(b.day));
}

export function fdvCorrectionRevision(item: FdvCorrectionCandidate) {
  const { key, ...metadata } = item.source;
  const review = item.claim.review ? `;fdv_review_id=${item.claim.review.id};fdv_review_sha256=${item.claim.review.sha256}` : "";
  return dailyRawSource(item.asset.slug, { ...metadata, basis: `${metadata.basis};fdv_withheld=${item.claim.reason};fdv_proof_sha256=${item.claim.proofSha256}${review}`, revisionOf: key });
}
export async function applyFdvCorrections(db: Client, candidates: FdvCorrectionCandidate[], options: { runId: string; maxEstimatedWrites: number; now?: Date }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(options.runId) || !Number.isSafeInteger(options.maxEstimatedWrites) || options.maxEstimatedWrites < 8 || options.maxEstimatedWrites > 50_000) throw Error("daily_raw_fdv_correction_run_and_allowance");
  const groups = new Map<string, FdvCorrectionCandidate[]>();
  for (const item of candidates) { const key = objectHash(item.asset); groups.set(key, [...groups.get(key) ?? [], item]); }
  const old = await getDailyRawRun(db, options.runId);
  if (old && old.maxEstimatedWrites !== options.maxEstimatedWrites) throw Error("daily_raw_fdv_correction_allowance_immutable");
  const upperBound = candidates.length * 7 + groups.size * 4 + Number(!old && candidates.length > 0) * 5;
  if (upperBound > options.maxEstimatedWrites - (old?.estimatedWrites ?? 0)) throw Error("daily_raw_fdv_correction_allowance_preflight");
  const totals = { assets: 0, daysWritten: 0, rowsWritten: 0, estimatedWrites: 0 };
  if (!candidates.length) return totals;
  // Older pilots predate accounting_version. Only an explicit nonempty apply reaches this additive migration.
  await initializeDailyRaw(db);
  await openDailyRawRun(db, { id: options.runId, maxEstimatedWrites: options.maxEstimatedWrites, now: options.now });
  for (const items of groups.values()) {
    const sources = items.map(fdvCorrectionRevision);
    const result = await upsertDailyRaw(db, { runId: options.runId, asset: items[0].asset, sources,
      points: items.map((item, i) => ({ day: item.day, fdv: { value: null, state: "conflict", source: sources[i].key, at: item.at } })),
      expectedCells: items.map(item => ({ day: item.day, metric: "fdv", sourceKey: item.source.key, value: item.value, state: 1, at: item.at })), now: options.now });
    totals.assets++; totals.daysWritten += result.daysWritten; totals.rowsWritten += result.rowsWritten; totals.estimatedWrites += result.estimatedWrites;
  }
  const final = await getDailyRawRun(db, options.runId);
  totals.estimatedWrites = (final?.estimatedWrites ?? 0) - (old?.estimatedWrites ?? 0);
  totals.rowsWritten = (final?.rowsWritten ?? 0) - (old?.rowsWritten ?? 0);
  return totals;
}

/** Structural diagnostics only. Provider/SQL messages can include connection details and are never printed verbatim. */
export function fdvCorrectionError(error: unknown) {
  const codes = new Set<string>(), messages: string[] = [];
  for (let cause = error, depth = 0; cause && typeof cause === "object" && depth < 6; depth++) {
    if ("code" in cause && typeof cause.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(cause.code)) codes.add(cause.code);
    if ("message" in cause && typeof cause.message === "string") messages.push(cause.message);
    cause = "cause" in cause ? cause.cause : null;
  }
  const text = messages.join("\n"), known = messages.find(message => /^daily_raw_fdv_[a-z_]+$/.test(message));
  const reason = /(?:no column named|no such column[^\n]*)[ :]+accounting_version/i.test(text) ? "daily_raw_fdv_correction_schema_accounting_column_missing"
    : /Daily raw expected cell changed/.test(text) ? "daily_raw_fdv_correction_expected_cell_changed"
    : /source key was reused with different evidence/.test(text) ? "daily_raw_fdv_correction_source_evidence_mismatch"
    : /source revision has no exact predecessor/.test(text) ? "daily_raw_fdv_correction_predecessor_missing"
    : /history_monthly_write_budget|daily_raw_run_write_budget|history_storage_budget/.test(text) ? "daily_raw_fdv_correction_budget_blocked"
    : [...codes].some(code => ["UND_ERR_SOCKET", "ECONNRESET", "EPIPE", "ETIMEDOUT", "HRANA_WEBSOCKET_ERROR"].includes(code)) ? "daily_raw_fdv_correction_transport_outcome_unknown"
    : known ?? "daily_raw_fdv_correction_failed_verify_before_rerun";
  return { reason, databaseCodes: [...codes] };
}
