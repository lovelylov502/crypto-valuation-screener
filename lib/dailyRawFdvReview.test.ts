import { expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { createClient } from "@libsql/client";
import { DAILY_RAW_FDV_REVIEW, DAILY_RAW_FDV_REVIEW_BASIS, DAILY_RAW_FDV_REVIEW_SHA256, hasDailyRawFdvReview, verifyDailyRawFdvReviewEvidence, type DailyRawFdvReviewEvidence } from "./dailyRawFdvReview";
import { combineDailyRawAssets, dailyRawSource, legacyDailyRawFdv, snapshotDailyRaw } from "./dailyRawCollection";
import { applyFdvCorrections, readFdvCorrectionCandidates } from "./dailyRawFdvCorrection";
import { initializeDailyRaw, openDailyRawRun, readDailyRaw, upsertDailyRaw } from "./dailyRawDatabase";
import { indexCapturedFdvQuotes } from "./dailyRawFdvValidation";
import { contentHash, type SourceReceipt } from "./sourceBundle";
import type { CoinRaw } from "./types";
import type { PublishedSnapshot } from "./publicationTypes";

const asset = { slug: "snowbank", identity: "gecko:snowbank" }, day = "2026-10-11", at = `${day}T22:40:55.000Z`, observedAt = `${day}T22:41:35.481Z`;
const url = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-review-test/data.json.gz";
const reference = { url, sha256: "a".repeat(64), dataAt: at, validatedAt: observedAt } as PublishedSnapshot;
function coin(provider: "CoinGecko" | "CoinMarketCap" = "CoinGecko", quoteAt = at, observation = observedAt): CoinRaw {
  return { ...asset, name: "Snowbank", geckoId: "snowbank", cmcId: 14027, cmcIdentity: { basis: "contract" }, identityStatus: "verified", price: 236.08, mcap: 37688150, fdv: 37688150238319590,
    marketDataUpdatedAt: quoteAt, marketSources: { price: provider, mcap: provider, fdv: provider,
      gecko: { id: "snowbank", status: "received", observedAt: observation }, cmc: { id: "14027", status: "received", observedAt: observation } } } as unknown as CoinRaw;
}
function proofFixture(extra: Partial<CoinRaw> = {}) {
  const captured = { ...coin(), ...extra }, body = JSON.stringify([{ id: captured.geckoId, current_price: captured.price, fully_diluted_valuation: captured.fdv,
    total_supply: 159640.027327531, max_supply: null, last_updated: captured.marketDataUpdatedAt }]);
  const receipt: SourceReceipt = { url: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=snowbank", requestedAt: observedAt, observedAt, body, sha256: contentHash(body), status: 200, headers: {} };
  const bundleBytes = gzipSync(JSON.stringify({ receipts: [receipt] })), snapshot = { coins: [captured], pipeline: { rawBundleSha256: contentHash(bundleBytes) } }, snapshotBytes = gzipSync(JSON.stringify(snapshot));
  const evidence: DailyRawFdvReviewEvidence = { day, tag: "data-review-test", snapshotSha256: contentHash(snapshotBytes), bundleSha256: contentHash(bundleBytes), receiptSha256: receipt.sha256, observedAt, quoteAt: at };
  return { captured, receipt, bundleBytes, snapshotBytes, snapshot, evidence };
}

it("holds exact historical and future CoinGecko captures with original timestamp, receipt and public review provenance", () => {
  const fixture = proofFixture(), captured = snapshotDailyRaw(fixture.captured, fixture.captured, reference, indexCapturedFdvQuotes([fixture.receipt]));
  expect(captured.points[0]).toMatchObject({ price: { value: 236.08, state: "complete" }, mcap: { value: 37688150, state: "complete" }, fdv: { value: null, state: "conflict", at } });
  expect(captured.sources.find(source => source.metric === "fdv")).toMatchObject({ url, sha256: reference.sha256, observedAt, archiveUrl: url, basis: DAILY_RAW_FDV_REVIEW_BASIS });
  expect(captured.issues).toContainEqual({ scope: asset.slug, metric: "fdv", day, reason: DAILY_RAW_FDV_REVIEW.reason });
  const legacy = legacyDailyRawFdv({ schema: 1, sources: [{ id: "s", url, observedAt, sha256: reference.sha256, archiveUrl: url }], assets: [{ ...asset,
    points: [{ day, fdv: fixture.captured.fdv!, fdvAt: at, observedAt, provider: "CoinGecko", sourceId: "s", verification: "verified" }] }] }, [fixture.captured])[0];
  expect(legacy.points[0].fdv).toMatchObject({ value: null, state: "conflict", at }); expect(legacy.sources[0].basis).toBe(DAILY_RAW_FDV_REVIEW_BASIS);
  const future = coin("CoinGecko", "2026-11-01T12:00:00Z", "2026-11-01T12:01:00Z");
  expect(snapshotDailyRaw(future, future, reference).points[0].fdv).toMatchObject({ value: null, state: "conflict", at: future.marketDataUpdatedAt });
});

it("isolates the exact identity, provider, metric and capture basis without holding another token or provider", () => {
  const source = { metric: "fdv" as const, provider: "CoinGecko", basis: "captured_quote;actual_provider_timestamp" };
  expect(hasDailyRawFdvReview(asset, source)).toBe(true);
  for (const other of [{ ...source, metric: "price" as const }, { ...source, provider: "CoinMarketCap" }, { ...source, provider: "CoinMetrics", basis: "utc_daily_close_verified_total_supply" }]) expect(hasDailyRawFdvReview(asset, other)).toBe(false);
  expect(hasDailyRawFdvReview({ ...asset, identity: "gecko:snowbank-other" }, source)).toBe(false);
  const cmc = coin("CoinMarketCap"), original = coin(), other = { ...original, geckoId: "another-token", marketSources: { ...original.marketSources, gecko: { ...original.marketSources!.gecko!, id: "another-token" } } } as CoinRaw;
  expect(snapshotDailyRaw(cmc, cmc, reference).points[0].fdv?.value).toBe(cmc.fdv);
  expect(snapshotDailyRaw(other, other, reference).points[0].fdv?.value).toBe(other.fdv);
});

it("lets independent CMC captured quotes and approved Coin Metrics closes remain usable beside the held provider", () => {
  const captured = snapshotDailyRaw(coin(), coin(), reference), cmc = snapshotDailyRaw(coin("CoinMarketCap"), coin("CoinMarketCap"), reference);
  const close = dailyRawSource(asset.slug, { metric: "fdv", provider: "CoinMetrics", url, observedAt: "2026-10-12T12:00:00Z", sha256: "b".repeat(64), scope: JSON.stringify(asset), definition: "verified issued supply", basis: "utc_daily_close_verified_total_supply" });
  const dated = { asset, sources: [close], points: [{ day, fdv: { value: 50, state: "complete" as const, source: close.key, at: "2026-10-12T00:00:00Z" } }] };
  for (const inputs of [[captured, cmc], [cmc, captured]]) expect(combineDailyRawAssets(asset, inputs).points[0].fdv).toMatchObject({ value: coin().fdv, state: "complete" });
  for (const inputs of [[captured, dated], [dated, captured]]) expect(combineDailyRawAssets(asset, inputs).points[0].fdv).toMatchObject({ value: 50, state: "complete", source: close.key });
});

it("derives a correction claim only after verifying the pinned snapshot, bundle and exact nested quote", () => {
  const fixture = proofFixture(), claim = verifyDailyRawFdvReviewEvidence(fixture.evidence, fixture.snapshotBytes, fixture.bundleBytes);
  expect(claim).toMatchObject({ ...asset, day, value: fixture.captured.fdv, at, observedAt, provider: "CoinGecko", snapshotUrl: url, snapshotSha256: fixture.evidence.snapshotSha256,
    reason: DAILY_RAW_FDV_REVIEW.reason, review: { id: DAILY_RAW_FDV_REVIEW.id, sha256: DAILY_RAW_FDV_REVIEW_SHA256 } });
  expect(() => verifyDailyRawFdvReviewEvidence(fixture.evidence, fixture.snapshotBytes, Buffer.from("changed original"))).toThrow("review_archive_hash");
  const different = proofFixture({ geckoId: "different-token" });
  expect(() => verifyDailyRawFdvReviewEvidence(different.evidence, different.snapshotBytes, different.bundleBytes)).toThrow("review_exact_quote");
  const tampered = { ...fixture.receipt, body: "[]" }, bundleBytes = gzipSync(JSON.stringify({ receipts: [tampered] }));
  const snapshotBytes = gzipSync(JSON.stringify({ ...fixture.snapshot, pipeline: { rawBundleSha256: contentHash(bundleBytes) } }));
  expect(() => verifyDailyRawFdvReviewEvidence({ ...fixture.evidence, snapshotSha256: contentHash(snapshotBytes), bundleSha256: contentHash(bundleBytes) }, snapshotBytes, bundleBytes)).toThrow("review_exact_quote");
});

it("retracts the reviewed existing cell with CAS and immutable original provenance, and repeats with zero writes", async () => {
  const db = createClient({ url: ":memory:" }), fixture = proofFixture(), claim = verifyDailyRawFdvReviewEvidence(fixture.evidence, fixture.snapshotBytes, fixture.bundleBytes), now = new Date("2026-10-20T12:00:00Z");
  try {
    await initializeDailyRaw(db); await openDailyRawRun(db, { id: "seed", maxEstimatedWrites: 1000, now });
    const source = dailyRawSource(asset.slug, { metric: "fdv", provider: "CoinGecko", url, observedAt, sha256: claim.snapshotSha256, archiveUrl: url,
      scope: JSON.stringify(asset), definition: "provider_reported_fdv_usd;verified_token_identity", basis: "captured_quote;actual_provider_timestamp" });
    await upsertDailyRaw(db, { runId: "seed", asset, sources: [source], points: [{ day, fdv: { value: claim.value, state: "complete", source: source.key, at } }], now });
    const candidates = await readFdvCorrectionCandidates(db, [claim]); expect(candidates).toHaveLength(1);
    expect(await readFdvCorrectionCandidates(db, [{ ...claim, value: claim.value + 8 }])).toEqual([]);
    expect(await applyFdvCorrections(db, candidates, { runId: "review", maxEstimatedWrites: 1000, now })).toMatchObject({ assets: 1, daysWritten: 1 });
    const stored = (await readDailyRaw(db, { asset }))!;
    expect(stored.points[0].fdv).toMatchObject({ value: null, state: "conflict", at });
    expect(stored.sources[0]).toMatchObject({ url, sha256: claim.snapshotSha256, observedAt, archiveUrl: url, revisionOf: source.key });
    expect(stored.sources[0].basis).toContain(`fdv_review_sha256=${DAILY_RAW_FDV_REVIEW_SHA256}`);
    expect((await db.execute("SELECT previous_value,next_value,kind FROM daily_raw_revisions WHERE metric='fdv'")).rows[0]).toMatchObject({ previous_value: claim.value, next_value: null, kind: "revision" });
    expect(await applyFdvCorrections(db, await readFdvCorrectionCandidates(db, [claim]), { runId: "review", maxEstimatedWrites: 1000, now })).toMatchObject({ assets: 0, daysWritten: 0, rowsWritten: 0, estimatedWrites: 0 });
  } finally { db.close(); }
});
