import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { contentHash, objectHash, type SourceReceipt } from "./sourceBundle";
import { historyIdentity } from "./dailyHistory";
import { auditLegacyFdvSnapshot, type FdvPrimaryHold } from "./dailyRawFdvValidation";
import type { LegacyFdvManifest } from "./dailyRawCollection";
import type { CoinRaw } from "./types";

export const DAILY_RAW_FDV_HOLD_POLICY = {
  id: "exact_primary_fdv_quote_required_v1",
  rule: "Withhold legacy FDV without a pinned original provider bundle or an exact selected provider record/quote timestamp. Do not change dates or values.",
  retained: "A missing maximum supply is not a hold when the reported FDV and quote timestamp match their original provider record.",
};
export interface FdvHoldsManifest {
  schema: 1; policy: typeof DAILY_RAW_FDV_HOLD_POLICY; inputManifestSha256: string; createdAt: string;
  sources: { sourceId: string; snapshotSha256: string; status: "primary_snapshot_only" | "original_inspected"; holds: number }[];
  holds: FdvPrimaryHold[];
}
type Source = LegacyFdvManifest["sources"][number];
const active = (point: LegacyFdvManifest["assets"][number]["points"][number]) => !point.verification || point.verification === "verified";
async function original(cache: string, sha256: string, limit: number) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw Error("daily_raw_fdv_holds_hash");
  const bytes = await readFile(join(cache, `${sha256}.gz`));
  if (contentHash(bytes) !== sha256) throw Error("daily_raw_fdv_holds_original_hash");
  return JSON.parse(gunzipSync(bytes, { maxOutputLength: limit }).toString("utf8"));
}
async function originals(cache: string, source: Source) {
  if (!/^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/data-[a-zA-Z0-9-]+\/data\.json\.gz$/.test(source.url)) throw Error("daily_raw_fdv_holds_source_url");
  const snapshot = await original(cache, source.sha256, 150_000_000) as { coins: CoinRaw[]; pipeline?: { rawBundleSha256?: string } };
  if (!Array.isArray(snapshot.coins)) throw Error("daily_raw_fdv_holds_snapshot");
  const hash = snapshot.pipeline?.rawBundleSha256;
  if (!hash) return { snapshot };
  const bundle = await original(cache, hash, 500_000_000) as { receipts: SourceReceipt[] };
  if (!Array.isArray(bundle.receipts)) throw Error("daily_raw_fdv_holds_bundle");
  return { snapshot, bundle, bundleRef: { sha256: hash, url: source.url.replace(/data\.json\.gz$/, "source-bundle.json.gz") } };
}

/** The snapshot proves the old claim exists, but cannot prove its original provider response. */
function unpinnedHolds(input: LegacyFdvManifest, source: Source, coins: CoinRaw[]): FdvPrimaryHold[] {
  const bySlug = new Map(coins.map(coin => [coin.slug, coin])), holds: FdvPrimaryHold[] = [];
  for (const asset of input.assets) for (const point of asset.points.filter(point => point.sourceId === source.id && active(point))) {
    const coin = bySlug.get(asset.slug), provider = point.provider ?? coin?.marketSources?.fdv ?? "unknown";
    if (!coin || historyIdentity(coin) !== asset.identity || coin.fdv !== point.fdv || Date.parse(coin.marketDataUpdatedAt ?? "") !== Date.parse(point.fdvAt) || point.day !== point.fdvAt.slice(0, 10)) throw Error("daily_raw_fdv_holds_snapshot_claim_mismatch");
    const lookup = provider === "CoinGecko" ? coin.marketSources?.gecko : provider === "CoinMarketCap" ? coin.marketSources?.cmc : null;
    holds.push({ slug: asset.slug, identity: asset.identity, day: point.day, sourceId: source.id, fdv: point.fdv, fdvAt: point.fdvAt, provider,
      observedAt: point.observedAt ?? lookup?.observedAt ?? null, reason: "primary_provider_bundle_unpinned",
      proof: { snapshotUrl: source.url, snapshotSha256: source.sha256, assetId: lookup?.id ?? (provider === "CoinGecko" ? coin.geckoId : coin.cmcId ? String(coin.cmcId) : null),
        selectedObservation: lookup?.observedAt ?? null, selectedQuoteAt: coin.marketDataUpdatedAt, selectedFdv: coin.fdv, candidates: [] } });
  }
  return holds;
}

export async function buildFdvHoldsManifest(legacyBytes: Uint8Array, cache: string, onSource?: (source: FdvHoldsManifest["sources"][number]) => void): Promise<FdvHoldsManifest> {
  const input = JSON.parse(Buffer.from(legacyBytes).toString("utf8")) as LegacyFdvManifest;
  if (input.schema !== 1 || !Array.isArray(input.assets) || !Array.isArray(input.sources)) throw Error("daily_raw_fdv_holds_input");
  const result: FdvHoldsManifest = { schema: 1, policy: DAILY_RAW_FDV_HOLD_POLICY, inputManifestSha256: contentHash(legacyBytes), createdAt: new Date().toISOString(), sources: [], holds: [] };
  for (const source of input.sources) {
    const data = await originals(cache, source), holds = data.bundle ? auditLegacyFdvSnapshot(input, source, data.snapshot.coins, data.bundle.receipts, data.bundleRef!).unmatched : unpinnedHolds(input, source, data.snapshot.coins);
    const report: FdvHoldsManifest["sources"][number] = { sourceId: source.id, snapshotSha256: source.sha256, status: data.bundle ? "original_inspected" : "primary_snapshot_only", holds: holds.length };
    result.sources.push(report); result.holds.push(...holds); onSource?.(report);
  }
  return result;
}

/** Holds have a separate proof policy; the concrete upper-bound rejection policy remains unchanged. */
export async function loadVerifiedFdvHoldsManifest(path: string, cache: string, legacyBytes: Uint8Array): Promise<FdvHoldsManifest> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as FdvHoldsManifest, input = JSON.parse(Buffer.from(legacyBytes).toString("utf8")) as LegacyFdvManifest;
  if (manifest.schema !== 1 || manifest.inputManifestSha256 !== contentHash(legacyBytes) || objectHash(manifest.policy) !== objectHash(DAILY_RAW_FDV_HOLD_POLICY) || !Array.isArray(manifest.holds)
    || input.schema !== 1 || !Array.isArray(input.sources) || !Array.isArray(input.assets)) throw Error("daily_raw_fdv_holds_manifest");
  const key = (asset: { slug: string; identity: string }, point: { day: string; sourceId: string; fdv: number; fdvAt: string }) => objectHash([asset.slug, asset.identity, point.day, point.sourceId, point.fdv, point.fdvAt]);
  const known = new Set(input.assets.flatMap(asset => asset.points.filter(active).map(point => key(asset, point))));
  const sources = new Map(input.sources.map(source => [source.id, source])), groups = new Map<string, FdvPrimaryHold[]>();
  for (const hold of manifest.holds) {
    if (!known.has(key(hold, hold))) throw Error("daily_raw_fdv_holds_unknown_claim");
    groups.set(hold.sourceId, [...groups.get(hold.sourceId) ?? [], hold]);
  }
  for (const [sourceId, holds] of groups) {
    const source = sources.get(sourceId); if (!source) throw Error("daily_raw_fdv_holds_source");
    const claims: LegacyFdvManifest = { schema: 1, sources: [source], assets: holds.map(hold => ({ slug: hold.slug, identity: hold.identity,
      points: [{ day: hold.day, fdv: hold.fdv, fdvAt: hold.fdvAt, provider: hold.provider, observedAt: hold.observedAt ?? undefined, sourceId }] })) };
    const data = await originals(cache, source), verified = data.bundle ? auditLegacyFdvSnapshot(claims, source, data.snapshot.coins, data.bundle.receipts, data.bundleRef!).unmatched : unpinnedHolds(claims, source, data.snapshot.coins);
    const proofs = new Set(verified.map(objectHash));
    if (holds.some(hold => !proofs.has(objectHash(hold)))) throw Error("daily_raw_fdv_holds_proof_mismatch");
  }
  return manifest;
}

/** Current fallback FDV can have a different timestamp than the preferred price. Never borrow that price timestamp. */
export async function loadCurrentFdvPrimaryHolds(legacyBytes: Uint8Array, cache: string, reference: { url: string; sha256: string; rawBundleSha256?: string }): Promise<FdvPrimaryHold[]> {
  const input = JSON.parse(Buffer.from(legacyBytes).toString("utf8")) as LegacyFdvManifest, source = input.sources.find(source => source.sha256 === reference.sha256 && source.url === reference.url);
  if (!source) throw Error("daily_raw_fdv_holds_current_reference");
  const data = await originals(cache, source);
  if (!data.bundle || data.bundleRef?.sha256 !== reference.rawBundleSha256) throw Error("daily_raw_fdv_holds_current_reference");
  const claims: LegacyFdvManifest = { schema: 1, sources: [source], assets: data.snapshot.coins.filter(coin => coin.identityStatus === "verified" && typeof coin.fdv === "number" && Number.isFinite(coin.fdv) && coin.fdv > 0 && Number.isFinite(Date.parse(coin.marketDataUpdatedAt ?? "")))
    .map(coin => ({ slug: coin.slug, identity: historyIdentity(coin), points: [{ day: coin.marketDataUpdatedAt!.slice(0, 10), fdv: coin.fdv!, fdvAt: coin.marketDataUpdatedAt!, sourceId: source.id,
      provider: coin.marketSources?.fdv ?? undefined, observedAt: (coin.marketSources?.fdv === "CoinGecko" ? coin.marketSources.gecko : coin.marketSources?.cmc)?.observedAt }] })) };
  return auditLegacyFdvSnapshot(claims, source, data.snapshot.coins, data.bundle.receipts, data.bundleRef).unmatched;
}
