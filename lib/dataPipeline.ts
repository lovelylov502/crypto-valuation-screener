import { gzipSync } from "node:zlib";
import { fetchCoins } from "./sources";
import { assembleScreener } from "./screener";
import { annotateDataQuality, dataQualitySummary } from "./dataQuality";
import { captureSourceBundle, contentHash, objectHash, replaySourceBundle, witnessFromBundle, type SourceBundle } from "./sourceBundle";
import { normalizedHash, orderedSources, pipelineIntegrityErrors, pipelineOutputHash } from "./pipelineIntegrity";
import { snapshotErrors } from "./publication";
import { collectionRegressions, collectionState } from "./collectionQuality";
import { witnessErrors } from "./sourceWitness";
import type { CoinRaw, ScreenerResponse, SourceObservation } from "./types";
import { annotateFreshness, freshnessSummary } from "./datedFreshness";
import { activeWriterSchema } from "./pipelineRelease";
import {marketAcquisitionReadiness,failedIdentityChanges} from "./marketReadiness";
import { acquireEconomicProvenance } from "./economicDecisionSource";
import { activeEconomicPolicy } from "./pipelineRelease";
import {buildEconomicReview,summarizeEconomicReview,type EconomicReviewState} from "./economicReview";
import { marketValueErrors } from "./marketSelection";

export const encodeSourceBundle = (bundle: SourceBundle) => gzipSync(Buffer.from(JSON.stringify(bundle)));

function derive(raw: CoinRaw[], observations: SourceObservation[], bundle: SourceBundle, rawBundleSha256: string): ScreenerResponse {
  const sources = orderedSources(observations);
  const quality = annotateDataQuality(raw, sources);
  const normalized = bundle.pipelineSchema === 2 ? annotateFreshness(quality, bundle.asOf,(bundle.acquisitionRevision??1)>=4?bundle.baseline:undefined) : quality;
  const data = assembleScreener(normalized, bundle.asOf, sources);
  if (bundle.pipelineSchema === 2) data.freshness = freshnessSummary(normalized, bundle.asOf);
  const review=buildEconomicReview(normalized,bundle.asOf,rawBundleSha256,bundle.economicReviewBaseline,bundle.baseline,objectHash);
  if(review)data.economicReview=summarizeEconomicReview(review,objectHash);
  data.pipeline = { schema: bundle.pipelineSchema ?? 1, ...(bundle.economicPolicy?{economicPolicy:bundle.economicPolicy}:{}),asOf: bundle.asOf, rawBundleSha256,
    normalizedSha256: normalizedHash(normalized), outputSha256: pipelineOutputHash(data), replayVerified: true,
    quality: dataQualitySummary(normalized) };
  return data;
}

/** A fresh process can reproduce every displayed input and result using only the archived HTTP bytes. */
export async function replayDataPipeline(bundle: SourceBundle, rawBundleSha256 = contentHash(encodeSourceBundle(bundle))): Promise<ScreenerResponse> {
  const observations: SourceObservation[] = [];
  const raw = await replaySourceBundle(bundle, async () => { await acquireEconomicProvenance(); return fetchCoins(observations, bundle.baseline ?? undefined); });
  return derive(raw, observations, bundle, rawBundleSha256);
}

export async function captureDataPipeline(baseline: ScreenerResponse | null, asOf: string,
  preserve: (bundle: SourceBundle) => Promise<void>, observations: SourceObservation[] = [], schema: 1 | 2 = activeWriterSchema(),economicReviewBaseline?:EconomicReviewState,economicReviewBaselineRef?:import("./economicReviewArchive").EconomicReviewRef) {
  const captured = await captureSourceBundle(asOf, baseline, async () => { await acquireEconomicProvenance(); return fetchCoins(observations, baseline ?? undefined); }, undefined, schema,schema===2?6:undefined,activeEconomicPolicy(),economicReviewBaseline,economicReviewBaselineRef);
  // Even a failed collection retains original successful and failed responses for diagnosis.
  await preserve(captured.bundle);
  if (captured.error || !captured.value) throw captured.error ?? new Error("Source collection did not produce inputs");
  const rawHash = contentHash(encodeSourceBundle(captured.bundle));
  const candidate = derive(captured.value, observations, captured.bundle, rawHash);
  const replayed = await replayDataPipeline(captured.bundle, rawHash);
  if (candidate.pipeline!.outputSha256 !== replayed.pipeline!.outputSha256 || candidate.pipeline!.normalizedSha256 !== replayed.pipeline!.normalizedSha256)
    throw new Error("Source replay differs from collected normalization");
  return { data: replayed, bundle: captured.bundle, witness: witnessFromBundle(captured.bundle) };
}

/** Changes are diagnostics; current source evidence, locality and lineage decide validity. */
export function assessPipelineCandidate(data: ScreenerResponse, bundle: SourceBundle, baseline: ScreenerResponse | null,
  startedAt: string, completedAt: string, replayed: ScreenerResponse, rawBytes: Uint8Array = encodeSourceBundle(bundle)) {
  const errors = [...snapshotErrors(data), ...pipelineIntegrityErrors(data), ...witnessErrors(data, witnessFromBundle(bundle))];
  if ((bundle.acquisitionRevision ?? 1) >= 5) errors.push(...marketValueErrors(data.coins));
  if (!data.pipeline || data.pipeline.rawBundleSha256 !== contentHash(rawBytes) ||
    pipelineOutputHash(data) !== pipelineOutputHash(replayed)) errors.push("candidate_source_lineage_mismatch");
  if (objectHash(bundle.baseline) !== objectHash(baseline)) errors.push("candidate_baseline_mismatch");
  const age = Date.parse(completedAt) - Date.parse(data.updatedAt);
  if (age < -300_000 || age > 45 * 60_000 || data.updatedAt !== bundle.asOf || Date.parse(data.updatedAt) < Date.parse(startedAt)) errors.push("candidate_not_current");
  if (baseline && Date.parse(data.updatedAt) <= Date.parse(baseline.updatedAt)) errors.push("candidate_not_newer");
  const previous = baseline && collectionState(baseline), next = collectionState(data);
  const changes = previous ? collectionRegressions(previous, next) : [];
  const readiness=marketAcquisitionReadiness(data,baseline),unreviewedChanges=failedIdentityChanges(data,baseline,changes);
  errors.push(...readiness.errors);
  if(unreviewedChanges.length)errors.push(`unreviewed_identity_losses:${unreviewedChanges.length}`);
  const affected = [...new Set([...changes.map(c => c.slug), ...data.coins.filter(c => c.dataQuality?.issues.length).map(c => c.slug)])].map(slug => ({
    slug, name: data.coins.find(c => c.slug === slug)?.name ?? baseline?.coins.find(c => c.slug === slug)?.name ?? slug,
    issues: [...changes.filter(c => c.slug === slug).map(c => c.issue), ...(data.coins.find(c => c.slug === slug)?.dataQuality?.issues.map(i => `${i.scope}:${i.code}`) ?? [])],
    before: previous?.coins[slug] ?? null, after: next.coins[slug] ?? null,
  }));
  return { errors: [...new Set(errors)], changes, reviewedChanges: changes.filter(c=>!unreviewedChanges.includes(c)), unreviewedChanges, affected,marketReadiness:readiness };
}
