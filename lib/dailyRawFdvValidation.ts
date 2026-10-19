import { contentHash, objectHash, type SourceReceipt } from "./sourceBundle";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { historyIdentity } from "./dailyHistory";
import type { CoinRaw } from "./types";
import type { LegacyFdvManifest } from "./dailyRawCollection";

/** Rejection only: this never calculates a replacement FDV. Missing maxima are normal for unlimited assets. */
export const DAILY_RAW_FDV_BOUND_POLICY = {
  id: "same_receipt_price_max_supply_upper_bound_v1", relativeTolerance: .01, absoluteToleranceUsd: 1,
  rule: "Reject reported FDV only above same-record price * positive finite max_supply + max(1 USD, 1% of that bound).",
  unavailable: "Keep previously verified reported FDV when the bound or exact receipt/quote is unavailable. Never infer a maximum from total_supply.",
};
type Provider = "CoinGecko" | "CoinMarketCap";
type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const at = (value: unknown) => typeof value === "string" ? Date.parse(value) : NaN;
const quoteKey = (provider: Provider, id: string, observedAt: string) => objectHash([provider, id, observedAt]);

export interface CapturedFdvQuote {
  provider: Provider; id: string; receiptUrl: string; receiptSha256: string; observedAt: string;
  quoteAt: string | null; price: unknown; fdv: unknown; maxSupply: unknown; totalSupply: unknown; infiniteSupply: boolean;
}
export function indexCapturedFdvQuotes(receipts: SourceReceipt[]) {
  const quotes = new Map<string, CapturedFdvQuote[]>(), issues: string[] = [];
  for (const receipt of receipts) {
    let url: URL; try { url = new URL(receipt.url); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || [...url.searchParams.keys()].some(key => /key|secret|auth|signature|access|session|credential|password/i.test(key))) continue;
    const provider: Provider | null = url.hostname === "api.coingecko.com" && url.pathname === "/api/v3/coins/markets" && url.searchParams.get("vs_currency") === "usd" ? "CoinGecko"
      : url.hostname === "pro-api.coinmarketcap.com" && /^\/public-api\/v3\/cryptocurrency\/(listings|quotes)\/latest$/.test(url.pathname) && url.searchParams.get("convert") === "USD" ? "CoinMarketCap" : null;
    if (!provider || receipt.status !== 200 || receipt.error) continue;
    if (typeof receipt.body !== "string" || contentHash(receipt.body) !== receipt.sha256 || !Number.isFinite(at(receipt.observedAt)) || !Number.isFinite(at(receipt.requestedAt)) || at(receipt.requestedAt) > at(receipt.observedAt)) {
      issues.push("fdv_bound_receipt_integrity"); continue;
    }
    let parsed: unknown; try { parsed = JSON.parse(receipt.body); } catch { issues.push("fdv_bound_receipt_json"); continue; }
    const list = Array.isArray(parsed) ? parsed : row(parsed)?.data;
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const record = row(value); if (!record) continue;
      const id = provider === "CoinGecko" ? typeof record.id === "string" ? record.id : null : Number.isInteger(record.id) && positive(record.id) ? String(record.id) : null;
      if (!id) continue;
      const usd = provider === "CoinGecko" ? record : Array.isArray(record.quote) ? record.quote.map(row).find(quote => quote?.symbol === "USD") : row(row(record.quote)?.USD);
      if (!usd) continue;
      const quote: CapturedFdvQuote = { provider, id, receiptUrl: receipt.url, receiptSha256: receipt.sha256, observedAt: receipt.observedAt,
        quoteAt: typeof usd.last_updated === "string" ? usd.last_updated : null, price: provider === "CoinGecko" ? usd.current_price : usd.price,
        fdv: provider === "CoinGecko" ? usd.fully_diluted_valuation : usd.fully_diluted_market_cap, maxSupply: record.max_supply, totalSupply: record.total_supply, infiniteSupply: record.infinite_supply === true };
      const key = quoteKey(provider, id, receipt.observedAt); quotes.set(key, [...quotes.get(key) ?? [], quote]);
    }
  }
  return { quotes, issues: [...new Set(issues)] };
}

export interface FdvBoundProof {
  provider: Provider; assetId: string; receiptUrl: string; receiptSha256: string; observedAt: string; quoteAt: string;
  reportedFdv: number; price: number; maxSupply: number; totalSupply: number | null; upperBound: number; allowanceUsd: number;
}
export interface FdvBoundCheck {
  state: "within_bound" | "exceeds_bound" | "bound_unavailable" | "receipt_unavailable";
  reason: string; proof?: FdvBoundProof;
}
export function checkCapturedFdvUpperBound(claim: { provider: Provider; id: string; observedAt: string; quoteAt: string; fdv: number }, index: ReturnType<typeof indexCapturedFdvQuotes>): FdvBoundCheck {
  const candidates = index.quotes.get(quoteKey(claim.provider, claim.id, claim.observedAt)) ?? [];
  const exact = candidates.filter(quote => Number.isFinite(at(claim.quoteAt)) && at(quote.quoteAt) === at(claim.quoteAt) && quote.fdv === claim.fdv && at(quote.quoteAt) <= at(quote.observedAt));
  if (!exact.length) return { state: "receipt_unavailable", reason: "fdv_bound_exact_provider_record_unavailable" };
  const distinct = new Set(exact.map(quote => objectHash([quote.price, quote.maxSupply, quote.infiniteSupply])));
  if (distinct.size !== 1) return { state: "receipt_unavailable", reason: "fdv_bound_ambiguous_provider_records" };
  const quote = [...exact].sort((a, b) => a.receiptSha256.localeCompare(b.receiptSha256))[0];
  if (!positive(quote.price) || !positive(quote.maxSupply) || !positive(quote.fdv) || quote.infiniteSupply || !positive(quote.price * quote.maxSupply)) return { state: "bound_unavailable", reason: "fdv_bound_positive_finite_price_max_supply_unavailable" };
  const upperBound = quote.price * quote.maxSupply, allowanceUsd = Math.max(DAILY_RAW_FDV_BOUND_POLICY.absoluteToleranceUsd, upperBound * DAILY_RAW_FDV_BOUND_POLICY.relativeTolerance);
  const proof: FdvBoundProof = { provider: quote.provider, assetId: quote.id, receiptUrl: quote.receiptUrl, receiptSha256: quote.receiptSha256, observedAt: quote.observedAt,
    quoteAt: quote.quoteAt!, reportedFdv: quote.fdv, price: quote.price, maxSupply: quote.maxSupply, totalSupply: typeof quote.totalSupply === "number" && Number.isFinite(quote.totalSupply) ? quote.totalSupply : null, upperBound, allowanceUsd };
  return quote.fdv > upperBound + allowanceUsd ? { state: "exceeds_bound", reason: "fdv_exceeds_same_receipt_max_supply_upper_bound", proof } : { state: "within_bound", reason: "fdv_within_same_receipt_max_supply_upper_bound", proof };
}

export interface FdvRejection {
  slug: string; identity: string; day: string; sourceId: string; reason: string;
  proof: FdvBoundProof & { snapshotUrl: string; snapshotSha256: string; bundleUrl: string; bundleSha256: string };
}
export interface FdvPrimaryHold {
  slug: string; identity: string; day: string; sourceId: string; fdv: number; fdvAt: string; provider: string; observedAt: string | null; reason: string;
  proof: { snapshotUrl: string; snapshotSha256: string; bundleUrl?: string; bundleSha256?: string; assetId: string | null;
    selectedObservation: string | null; selectedQuoteAt: string | null; selectedFdv: number | null;
    candidates: { receiptUrl: string; receiptSha256: string; observedAt: string; quoteAt: string | null; reportedFdv: number | null }[] };
}
export interface FdvValidationManifest {
  schema: 1; methodology: typeof DAILY_RAW_FDV_BOUND_POLICY; inputManifestSha256: string; createdAt: string;
  sources: { sourceId: string; snapshotUrl: string; snapshotSha256: string; bundleUrl?: string; bundleSha256?: string; status: string; checks: Record<string, number>; issues: string[] }[];
  rejections: FdvRejection[];
}
/** The caller verifies compressed snapshot/bundle hashes before supplying these decoded originals. */
export function auditLegacyFdvSnapshot(input: LegacyFdvManifest, source: LegacyFdvManifest["sources"][number], coins: CoinRaw[], receipts: SourceReceipt[], bundle: { url: string; sha256: string }) {
  const index = indexCapturedFdvQuotes(receipts), bySlug = new Map(coins.map(coin => [coin.slug, coin])), checks: Record<string, number> = {}, rejections: FdvRejection[] = [], unmatched: FdvPrimaryHold[] = [];
  const count = (state: string) => { checks[state] = (checks[state] ?? 0) + 1; };
  for (const asset of input.assets) for (const point of asset.points.filter(point => point.sourceId === source.id && (!point.verification || point.verification === "verified"))) {
    const coin = bySlug.get(asset.slug), provider = point.provider ?? coin?.marketSources?.fdv;
    const lookup = provider === "CoinGecko" ? coin?.marketSources?.gecko : provider === "CoinMarketCap" ? coin?.marketSources?.cmc : null;
    const id = provider === "CoinGecko" ? coin?.geckoId : coin?.cmcId ? String(coin.cmcId) : null;
    const contextReason = !coin ? "snapshot_asset_missing" : historyIdentity(coin) !== asset.identity ? "snapshot_identity_mismatch" : coin.fdv !== point.fdv ? "snapshot_fdv_value_mismatch"
      : coin.marketSources?.fdv !== provider ? "snapshot_fdv_provider_mismatch" : !lookup || lookup.status !== "received" ? "snapshot_provider_lookup_unavailable"
      : !id || lookup.id !== id ? "snapshot_provider_id_mismatch" : point.observedAt && point.observedAt !== lookup.observedAt ? "snapshot_observation_mismatch"
      : at(point.fdvAt) !== at(coin.marketDataUpdatedAt) ? "snapshot_quote_time_mismatch" : !Number.isFinite(at(point.fdvAt)) || point.day !== new Date(at(point.fdvAt)).toISOString().slice(0, 10) ? "snapshot_quote_day_mismatch"
      : !["CoinGecko", "CoinMarketCap"].includes(provider ?? "") ? "snapshot_fdv_provider_unavailable" : null;
    const candidates = id && (provider === "CoinGecko" || provider === "CoinMarketCap") && lookup ? index.quotes.get(quoteKey(provider, id, lookup.observedAt)) ?? [] : [];
    const hold = (reason: string) => unmatched.push({ slug: asset.slug, identity: asset.identity, day: point.day, sourceId: source.id, fdv: point.fdv, fdvAt: point.fdvAt,
      provider: provider ?? "unknown", observedAt: point.observedAt ?? lookup?.observedAt ?? null, reason,
      proof: { snapshotUrl: source.url, snapshotSha256: source.sha256, bundleUrl: bundle.url, bundleSha256: bundle.sha256, assetId: id ?? null,
        selectedObservation: lookup?.observedAt ?? null, selectedQuoteAt: coin?.marketDataUpdatedAt ?? null, selectedFdv: coin?.fdv ?? null,
        candidates: candidates.map(candidate => ({ receiptUrl: candidate.receiptUrl, receiptSha256: candidate.receiptSha256, observedAt: candidate.observedAt,
          quoteAt: candidate.quoteAt, reportedFdv: typeof candidate.fdv === "number" && Number.isFinite(candidate.fdv) ? candidate.fdv : null })).sort((a, b) => a.receiptSha256.localeCompare(b.receiptSha256)) } });
    if (contextReason) { count("receipt_unavailable"); hold(contextReason); continue; }
    const result = checkCapturedFdvUpperBound({ provider: provider as Provider, id: id!, observedAt: lookup!.observedAt, quoteAt: point.fdvAt, fdv: point.fdv }, index);
    count(result.state);
    if (result.state === "receipt_unavailable") hold(!candidates.length ? "raw_selected_receipt_or_asset_missing" : !candidates.some(candidate => at(candidate.quoteAt) === at(point.fdvAt)) ? "raw_quote_time_mismatch"
      : !candidates.some(candidate => at(candidate.quoteAt) === at(point.fdvAt) && candidate.fdv === point.fdv) ? "raw_reported_fdv_mismatch" : "raw_quote_ambiguous_or_invalid_time");
    if (result.state === "exceeds_bound") rejections.push({ slug: asset.slug, identity: asset.identity, day: point.day, sourceId: source.id, reason: result.reason,
      proof: { ...result.proof!, snapshotUrl: source.url, snapshotSha256: source.sha256, bundleUrl: bundle.url, bundleSha256: bundle.sha256 } });
  }
  return { checks, rejections, unmatched, issues: index.issues };
}

/** Verify a rejection file against its exact legacy input, snapshot and original captured response. No network or writes. */
export async function loadVerifiedFdvValidationManifest(path: string, cache: string, legacyBytes: Uint8Array): Promise<FdvValidationManifest> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as FdvValidationManifest, input = JSON.parse(Buffer.from(legacyBytes).toString("utf8")) as LegacyFdvManifest;
  if (manifest.schema !== 1 || manifest.inputManifestSha256 !== contentHash(legacyBytes) || objectHash(manifest.methodology) !== objectHash(DAILY_RAW_FDV_BOUND_POLICY) || !Array.isArray(manifest.rejections)
    || input.schema !== 1 || !Array.isArray(input.sources)) throw Error("daily_raw_fdv_validation_manifest");
  const sources = new Map(input.sources.map(source => [source.id, source])), groups = new Map<string, FdvRejection[]>();
  for (const rejection of manifest.rejections) groups.set(rejection.sourceId, [...groups.get(rejection.sourceId) ?? [], rejection]);
  for (const [sourceId, rejections] of groups) {
    const source = sources.get(sourceId);
    if (!source || !/^[a-f0-9]{64}$/.test(source.sha256) || !/^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/data-[a-zA-Z0-9-]+\/data\.json\.gz$/.test(source.url)) throw Error("daily_raw_fdv_validation_source");
    const snapshotBytes = await readFile(join(cache, `${source.sha256}.gz`));
    if (contentHash(snapshotBytes) !== source.sha256) throw Error("daily_raw_fdv_validation_snapshot_hash");
    const snapshot = JSON.parse(gunzipSync(snapshotBytes, { maxOutputLength: 150_000_000 }).toString("utf8")) as { coins: CoinRaw[]; pipeline?: { rawBundleSha256: string } };
    const bundleHash = snapshot.pipeline?.rawBundleSha256;
    if (!bundleHash || !/^[a-f0-9]{64}$/.test(bundleHash) || !Array.isArray(snapshot.coins)) throw Error("daily_raw_fdv_validation_source");
    const bundleBytes = await readFile(join(cache, `${bundleHash}.gz`));
    if (contentHash(bundleBytes) !== bundleHash) throw Error("daily_raw_fdv_validation_bundle_hash");
    const bundle = JSON.parse(gunzipSync(bundleBytes, { maxOutputLength: 500_000_000 }).toString("utf8")) as { receipts: SourceReceipt[] };
    const claims: LegacyFdvManifest = { schema: 1, sources: [source], assets: rejections.map(rejection => ({ slug: rejection.slug, identity: rejection.identity,
      points: [{ day: rejection.day, fdv: rejection.proof.reportedFdv, fdvAt: rejection.proof.quoteAt, observedAt: rejection.proof.observedAt, provider: rejection.proof.provider, sourceId }] })) };
    const audited = auditLegacyFdvSnapshot(claims, source, snapshot.coins, bundle.receipts, { url: source.url.replace(/data\.json\.gz$/, "source-bundle.json.gz"), sha256: bundleHash });
    const verified = new Set(audited.rejections.map(objectHash));
    if (rejections.some(rejection => !verified.has(objectHash(rejection)))) throw Error("daily_raw_fdv_rejection_proof_mismatch");
  }
  return manifest;
}
