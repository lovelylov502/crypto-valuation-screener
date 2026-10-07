import type { CoinRaw, CoinScored, ScreenerResponse } from "./types";
import { objectHash } from "./sourceBundle";
import { freshnessAccountingErrors } from "./datedFreshness";

export function normalizedCoin(coin: CoinScored): CoinRaw {
  const { opportunities, peerCounts, multiples, sectorPercentiles, scoreAxes, valueScore, valueCapture, status,
    confidence, confidenceGrade, scoreNotes, gates, lowActivity, highDilution, ...raw } = coin;
  return raw;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const normalizedHash = (coins: CoinRaw[]) => objectHash([...coins].sort((a, b) => compare(a.slug, b.slug)));
export const orderedSources = (sources: ScreenerResponse["sources"]) => [...sources].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
export function pipelineOutputHash(data: ScreenerResponse): string {
  const { pipeline, publication, publicFreshness, ...snapshot } = data;
  return objectHash({ ...snapshot, coins: [...snapshot.coins].sort((a, b) => compare(a.slug, b.slug)), sources: orderedSources(snapshot.sources) });
}
/** Server-side integrity; the browser reads a paginated subset and cannot verify the full archive. */
export function pipelineIntegrityErrors(data: ScreenerResponse): string[] {
  const proof = data.pipeline;
  if (!proof) return [];
  const errors: string[] = [];
  if (![1,2].includes(proof.schema) || proof.asOf !== data.updatedAt || proof.replayVerified !== true ||
    ![proof.rawBundleSha256, proof.normalizedSha256, proof.outputSha256].every(h => /^[a-f0-9]{64}$/.test(h))) errors.push("pipeline_proof_invalid");
  if (normalizedHash(data.coins.map(normalizedCoin)) !== proof.normalizedSha256) errors.push("pipeline_normalized_values_changed");
  if (pipelineOutputHash(data) !== proof.outputSha256) errors.push("pipeline_output_changed");
  return [...errors, ...freshnessAccountingErrors(data)];
}
