import { createHash } from "node:crypto";
import registry from "./reviewedSourceChanges.json";
import type { ScreenerResponse } from "./types";
type Change = { slug: string; issue: string };
export type SourceChangeReview = {
  baselineHash: string; collectionDate: string; reviewedAt: string; evidenceHash: string;
  entries: (Change & { signature: string; reason: string; source: string })[];
};
export const sourceReviewHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Bind a review to the affected field, exact component scope and UTC window.
 * Quote/revenue fluctuations in unrelated fields cannot widen a loss approval. */
export function sourceChangeSignature(data: ScreenerResponse, change: Change): string {
  const coin = data.coins.find(c => c.slug === change.slug);
  const days = Number(change.issue.match(/revenue_(\d+)d/)?.[1]);
  const period = coin?.revenueHistory?.periods[days as 1 | 7 | 30 | 90 | 365];
  return sourceReviewHash([{ slug: change.slug, issue: change.issue }, coin ? {
    members: [...(coin.sourceSlugs ?? [])].sort(), geckoId: coin.geckoId, cmcId: coin.cmcId,
    definition: coin.fundamentals.revenue.fingerprint,
    period: period ? { start: period.start, end: period.end, reportedDays: period.reportedDays, total: period.total === null ? null : "reported" } : null,
  } : null]);
}

/** This dated, independently reviewed registry can never approve a different
 * baseline, day, identity, component scope or additional missing date. */
export function reviewedSourceChanges(data: ScreenerResponse, baseline: ScreenerResponse, review: SourceChangeReview = registry as SourceChangeReview) {
  if (sourceReviewHash(baseline) !== review.baselineHash || data.updatedAt.slice(0, 10) !== review.collectionDate) return [];
  return review.entries.filter(entry => entry.signature === sourceChangeSignature(data, entry));
}
