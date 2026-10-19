import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { contentHash, objectHash, type SourceReceipt } from "./sourceBundle";
import { indexCapturedFdvQuotes } from "./dailyRawFdvValidation";
import type { DailyRawAsset, DailyRawSource } from "./dailyRawData";
import type { FdvCorrectionClaim } from "./dailyRawFdvCorrection";
import type { CoinRaw } from "./types";

const capturedBasis = "captured_quote;actual_provider_timestamp";
const releaseRoot = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/";
export interface DailyRawFdvReviewEvidence { day: string; tag: string; snapshotSha256: string; bundleSha256: string; receiptSha256: string; observedAt: string; quoteAt: string }

/** Explicit quality review, independent of the positive-maximum anomaly gate.
 * Keep this provider's captured FDV blank until an explicit supply-basis review clears it.
 * The pinned originals remain evidence; this record supplies no replacement valuation. */
export const DAILY_RAW_FDV_REVIEW = {
  schema: 1, id: "snowbank-coingecko-supply-units-20261020", identity: "gecko:snowbank", provider: "CoinGecko", metric: "fdv",
  reason: "fdv_supply_basis_under_review_snowbank_coingecko_20261020", status: "held_pending_explicit_supply_basis_review",
  findings: [
    "2026-10-11 reported FDV is approximately one billion times the same-record price multiplied by reported total supply.",
    "2026-10-12 through 2026-10-19 reported total supply is one billion times circulating supply and FDV follows that scaled total.",
    "All nine CoinGecko records have max_supply null. This quality hold does not claim a positive-maximum bound failure or substitute CoinMarketCap supply.",
  ],
  evidence: [
    { day: "2026-10-11", tag: "data-38181139846-1-complete", snapshotSha256: "ac5a35a01c474ff4a423311f22087068e582c74fb4f5e4e08657d197ce23bc00", bundleSha256: "228724bdf2d546c0c81d9077b8bdb29ee72c5b722b2c4887b1498fd31a0bc645", receiptSha256: "b487ef9a92148df3c207496105a73ad393531cd9888f13ede37b9b0f19478231", observedAt: "2026-10-11T22:41:35.481Z", quoteAt: "2026-10-11T22:40:55.000Z" },
    { day: "2026-10-12", tag: "data-38314098490-1-complete", snapshotSha256: "7bd1e5f3f034ab49184693e6a5fbf4aaa3c28f7dd9165bc7d4a43babf4877239", bundleSha256: "cc368d6bc9b0f004f9408c3c8eb6a16a0e15641e0ab06bc0b7c2686ba131f23f", receiptSha256: "442aef9b8ab343f55b20d13ceec704c120f1f5be74cd392fd8fe227220165672", observedAt: "2026-10-12T22:04:34.759Z", quoteAt: "2026-10-12T22:03:52.000Z" },
    { day: "2026-10-13", tag: "data-38475048001-1-complete", snapshotSha256: "1b2f29f33a03f5d6dd8ffe21ca42681bdc2196d283a57ab558703e49fce2099d", bundleSha256: "5578e6be0313009c5a3c1b203eb81499ec36560cbb5a4b292252822a9933bf7d", receiptSha256: "ac70ae462845fd63692d08b6622f74ea201c16ec4ebce14b5b6fcb8fdc5a4afc", observedAt: "2026-10-13T22:07:21.932Z", quoteAt: "2026-10-13T22:06:47.000Z" },
    { day: "2026-10-14", tag: "data-38648875814-1-complete", snapshotSha256: "b2a0f1f2f3491bca097cc4869588370d58d270cb1dcce4006b6a4c0cdc662dc6", bundleSha256: "ab222e8c98d27b2177cfdbb98b30c5612738c4c51579cd71ab40b4c8ac0a718f", receiptSha256: "160a4821e2cce459a99399f9f0ea82a1661161f93ca65e2cf442f76608016e24", observedAt: "2026-10-14T22:41:20.437Z", quoteAt: "2026-10-14T22:40:57.000Z" },
    { day: "2026-10-15", tag: "data-38818337576-1-complete", snapshotSha256: "1ec538d1c2ce1dcc5e85303be46bec525f853dafedc31d0cf40e65c855c987ba", bundleSha256: "ede824e978941021c95ceaca377720877abf01856e703c7954fb14fa373e2b75", receiptSha256: "4225cd9ec17937c59d6dd89e699efd8128e96ccf8030f336d22514eaab9c9a6f", observedAt: "2026-10-15T22:41:39.828Z", quoteAt: "2026-10-15T22:40:53.000Z" },
    { day: "2026-10-16", tag: "data-38976826275-1-complete", snapshotSha256: "e127d09f8ff34ca237dc31d14627f9f23eb227d1c6f926ee421e96f21e835efe", bundleSha256: "91f4758b2e8afea26e6c44ab97bdab7a8f7e05dc42dfb58b65d46c972f56c9b5", receiptSha256: "9a19e12400c59a453e10fd7da3899f0d2d2f0ad44591a65ee43e2f0a7b0b1abe", observedAt: "2026-10-16T22:41:24.261Z", quoteAt: "2026-10-16T22:40:49.000Z" },
    { day: "2026-10-17", tag: "data-39056390727-1-complete", snapshotSha256: "3dfd7ca78682aac9c85219172aff0f82feafeb8ab0071a5d716191ecbc66229c", bundleSha256: "b13831061921511f1888233c085ac7fdcdcb098ce1bf21e4537f774ca5fdb92e", receiptSha256: "91304a0624b38f1a0460249886e6cc4ce5590137e208770d970ed1312363e410", observedAt: "2026-10-17T18:07:30.564Z", quoteAt: "2026-10-17T18:06:52.000Z" },
    { day: "2026-10-18", tag: "data-39153844791-1-complete", snapshotSha256: "a748e1453fd776e37dae1aac3b55f7729e29dec8696ca36f5220001b027efe6c", bundleSha256: "c8d16b3d440827d395078bccec109abe752cdb14c7839019e7d6784190e592d0", receiptSha256: "45f7e95f6559ab3c29ff9a55071e43f763c2b1591b7cc6025258e741321d99fc", observedAt: "2026-10-18T18:26:50.568Z", quoteAt: "2026-10-18T18:25:55.000Z" },
    { day: "2026-10-19", tag: "data-39240387690-1-complete", snapshotSha256: "2f0a6d9e4a2ee1337b3fcfd63ec18a6683c41d7d448567a91281196044a23278", bundleSha256: "046b4ff29a3ee1cdcf46c8eb42acd7e59a134091f168908d1a9defd146d8d9bd", receiptSha256: "8c8b242b806e92c6bdf6d5fb3e46764fc6a85f39e96bb6162ebbfcc1c72bb3eb", observedAt: "2026-10-19T10:55:28.996Z", quoteAt: "2026-10-19T07:32:22.000Z" },
  ] satisfies DailyRawFdvReviewEvidence[],
} as const;
export const DAILY_RAW_FDV_REVIEW_SHA256 = objectHash(DAILY_RAW_FDV_REVIEW);
export const DAILY_RAW_FDV_REVIEW_BASIS = `${capturedBasis};fdv_withheld=${DAILY_RAW_FDV_REVIEW.reason};fdv_review_id=${DAILY_RAW_FDV_REVIEW.id};fdv_review_sha256=${DAILY_RAW_FDV_REVIEW_SHA256}`;

export function hasDailyRawFdvReview(asset: DailyRawAsset, source: Pick<DailyRawSource, "metric" | "provider" | "basis">) {
  return asset.identity === DAILY_RAW_FDV_REVIEW.identity && source.metric === "fdv" && source.provider === DAILY_RAW_FDV_REVIEW.provider && source.basis === capturedBasis;
}

/** Verify one pinned original and derive the exact existing captured claim, never a replacement value. */
export function verifyDailyRawFdvReviewEvidence(evidence: DailyRawFdvReviewEvidence, snapshotBytes: Uint8Array, bundleBytes: Uint8Array): FdvCorrectionClaim {
  if (contentHash(snapshotBytes) !== evidence.snapshotSha256 || contentHash(bundleBytes) !== evidence.bundleSha256) throw Error("daily_raw_fdv_review_archive_hash");
  const snapshot = JSON.parse(gunzipSync(snapshotBytes, { maxOutputLength: 150_000_000 }).toString("utf8")) as { coins: CoinRaw[]; pipeline?: { rawBundleSha256: string } };
  if (snapshot.pipeline?.rawBundleSha256 !== evidence.bundleSha256 || !Array.isArray(snapshot.coins)) throw Error("daily_raw_fdv_review_bundle_pin");
  const bundle = JSON.parse(gunzipSync(bundleBytes, { maxOutputLength: 500_000_000 }).toString("utf8")) as { receipts: SourceReceipt[] };
  const receipts = bundle.receipts?.filter(receipt => receipt.sha256 === evidence.receiptSha256) ?? [], index = indexCapturedFdvQuotes(receipts);
  const coin = snapshot.coins.find(coin => coin.slug === "snowbank" && `gecko:${coin.geckoId}` === DAILY_RAW_FDV_REVIEW.identity), lookup = coin?.marketSources?.gecko;
  const exact = [...index.quotes.values()].flat().filter(quote => quote.provider === DAILY_RAW_FDV_REVIEW.provider && quote.id === "snowbank" && quote.observedAt === evidence.observedAt
    && quote.quoteAt === evidence.quoteAt && typeof quote.fdv === "number" && Number.isFinite(quote.fdv) && quote.fdv > 0 && quote.fdv === coin?.fdv && Date.parse(quote.quoteAt) <= Date.parse(quote.observedAt));
  if (!coin || coin.identityStatus !== "verified" || coin.capitalExclusionReason || coin.marketSources?.fdv !== DAILY_RAW_FDV_REVIEW.provider || lookup?.id !== "snowbank" || lookup.status !== "received"
    || lookup.observedAt !== evidence.observedAt || coin.marketDataUpdatedAt !== evidence.quoteAt || evidence.quoteAt.slice(0, 10) !== evidence.day || exact.length !== 1 || index.issues.length) throw Error("daily_raw_fdv_review_exact_quote");
  return { slug: coin.slug, identity: DAILY_RAW_FDV_REVIEW.identity, day: evidence.day, value: exact[0].fdv as number, at: evidence.quoteAt, provider: DAILY_RAW_FDV_REVIEW.provider,
    observedAt: evidence.observedAt, snapshotUrl: `${releaseRoot}${evidence.tag}/data.json.gz`, snapshotSha256: evidence.snapshotSha256, reason: DAILY_RAW_FDV_REVIEW.reason,
    proofSha256: objectHash([DAILY_RAW_FDV_REVIEW_SHA256, evidence]), review: { id: DAILY_RAW_FDV_REVIEW.id, sha256: DAILY_RAW_FDV_REVIEW_SHA256 } };
}

/** Local originals only; all nine proofs must verify before the correction CLI connects to a database. */
export async function loadVerifiedDailyRawFdvReviewClaims(cache: string): Promise<FdvCorrectionClaim[]> {
  const claims: FdvCorrectionClaim[] = [];
  for (const evidence of DAILY_RAW_FDV_REVIEW.evidence) claims.push(verifyDailyRawFdvReviewEvidence(evidence,
    await readFile(join(cache, `${evidence.snapshotSha256}.gz`)), await readFile(join(cache, `${evidence.bundleSha256}.gz`))));
  return claims;
}
