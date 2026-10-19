import { readFile, rename, writeFile, access } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { cachedArchive } from "../lib/historyCollection";
import { contentHash } from "../lib/sourceBundle";
import { historyIdentity } from "../lib/dailyHistory";
import { auditLegacyFdvSnapshot, DAILY_RAW_FDV_BOUND_POLICY, type FdvValidationManifest } from "../lib/dailyRawFdvValidation";
import type { LegacyFdvManifest } from "../lib/dailyRawCollection";
import type { SourceBundle } from "../lib/sourceBundle";
import type { ScreenerResponse } from "../lib/types";

async function main() {
  const argv = process.argv.slice(2), arg = (name: string, fallback = "") => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1] ?? fallback; };
  if (!arg("--cache")) throw Error("daily_raw_fdv_cache_required");
  const cache = resolve(arg("--cache")), rel = relative(process.cwd(), cache);
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\")) throw Error("daily_raw_fdv_cache_must_be_outside_git");
  const inputBytes = await readFile(resolve(cache, arg("--manifest", "legacy-fdv-verified-manifest.json"))), input = JSON.parse(inputBytes.toString("utf8")) as LegacyFdvManifest;
  if (input.schema !== 1 || !Array.isArray(input.assets) || !Array.isArray(input.sources)) throw Error("daily_raw_fdv_legacy_manifest");
  const output = resolve(cache, arg("--output", "fdv-validation-manifest.json")), outputRel = relative(cache, output);
  if (isAbsolute(outputRel) || outputRel === ".." || outputRel.startsWith("../") || outputRel.startsWith("..\\")) throw Error("daily_raw_fdv_output_escape");
  const reference = JSON.parse(await readFile(resolve(cache, arg("--reference", "reference.json")), "utf8")) as { sha256: string };
  if (!input.sources.some(source => source.sha256 === reference.sha256)) throw Error("daily_raw_fdv_current_reference_not_in_legacy_sources");
  const manifest: FdvValidationManifest = { schema: 1, methodology: DAILY_RAW_FDV_BOUND_POLICY, inputManifestSha256: contentHash(inputBytes), createdAt: new Date().toISOString(), sources: [], rejections: [] };
  const save = async () => { await writeFile(`${output}.tmp`, JSON.stringify(manifest, null, 2)); await rename(`${output}.tmp`, output); };
  const plan: { source: LegacyFdvManifest["sources"][number]; bundleHash?: string; cached: boolean }[] = [];
  for (const source of input.sources) {
    if (!/^[a-f0-9]{64}$/.test(source.sha256) || !/^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/data-[a-zA-Z0-9-]+\/data\.json\.gz$/.test(source.url)) throw Error("daily_raw_fdv_snapshot_source");
    const bytes = await cachedArchive(source.url, source.sha256, cache), snapshot = JSON.parse(gunzipSync(bytes, { maxOutputLength: 150_000_000 }).toString("utf8")) as ScreenerResponse;
    const bundleHash = snapshot.pipeline?.rawBundleSha256; let cached = false;
    if (bundleHash && /^[a-f0-9]{64}$/.test(bundleHash)) try { await access(join(cache, `${bundleHash}.gz`)); cached = true; } catch {}
    plan.push({ source, bundleHash, cached });
  }
  // Check the current snapshot and already cached originals first, without delaying them behind downloads.
  plan.sort((a, b) => Number(b.source.sha256 === reference.sha256) - Number(a.source.sha256 === reference.sha256) || Number(b.cached) - Number(a.cached) || b.source.observedAt.localeCompare(a.source.observedAt));
  for (const entry of plan) {
    const { source, bundleHash } = entry, report: FdvValidationManifest["sources"][number] = { sourceId: source.id, snapshotUrl: source.url, snapshotSha256: source.sha256, status: "bound_unavailable", checks: {}, issues: [] };
    manifest.sources.push(report);
    if (bundleHash && /^[a-f0-9]{64}$/.test(bundleHash)) {
      const bundleUrl = source.url.replace(/data\.json\.gz$/, "source-bundle.json.gz"); report.bundleUrl = bundleUrl; report.bundleSha256 = bundleHash;
      try {
        const snapshotBytes = await cachedArchive(source.url, source.sha256, cache), snapshot = JSON.parse(gunzipSync(snapshotBytes, { maxOutputLength: 150_000_000 }).toString("utf8")) as ScreenerResponse;
        const bundleBytes = await cachedArchive(bundleUrl, bundleHash, cache), bundle = JSON.parse(gunzipSync(bundleBytes, { maxOutputLength: 500_000_000 }).toString("utf8")) as SourceBundle;
        const audited = auditLegacyFdvSnapshot(input, source, snapshot.coins, bundle.receipts, { url: bundleUrl, sha256: bundleHash });
        report.checks = audited.checks; report.issues = audited.issues; manifest.rejections.push(...audited.rejections);
        if (source.sha256 === reference.sha256) {
          const current: LegacyFdvManifest = { schema: 1, sources: [source], assets: snapshot.coins.filter(coin => coin.identityStatus === "verified" && typeof coin.fdv === "number" && Number.isFinite(coin.fdv) && coin.fdv > 0 && coin.marketDataUpdatedAt)
            .map(coin => ({ slug: coin.slug, identity: historyIdentity(coin), points: [{ day: coin.marketDataUpdatedAt!.slice(0, 10), fdv: coin.fdv!, fdvAt: coin.marketDataUpdatedAt!, sourceId: source.id,
              provider: coin.marketSources?.fdv ?? undefined, observedAt: (coin.marketSources?.fdv === "CoinGecko" ? coin.marketSources.gecko : coin.marketSources?.cmc)?.observedAt }] })) };
          const extra = auditLegacyFdvSnapshot(current, source, snapshot.coins, bundle.receipts, { url: bundleUrl, sha256: bundleHash });
          for (const [state, count] of Object.entries(extra.checks)) report.checks[`current_${state}`] = count;
          const keys = new Set(manifest.rejections.map(rejection => JSON.stringify([rejection.slug, rejection.identity, rejection.day, rejection.sourceId])));
          for (const rejection of extra.rejections) if (!keys.has(JSON.stringify([rejection.slug, rejection.identity, rejection.day, rejection.sourceId]))) manifest.rejections.push(rejection);
        }
        report.status = "complete";
      } catch (error) {
        report.status = "original_unavailable"; report.issues.push(error instanceof Error && /HTTP (403|429)/.test(error.message) ? "fdv_bound_archive_access_deferred" : "fdv_bound_archive_unavailable_or_integrity");
        if (report.issues.includes("fdv_bound_archive_access_deferred")) { await save(); break; }
      }
    } else report.issues.push("fdv_bound_archived_bundle_unavailable");
    await save();
    console.log(JSON.stringify({ event: "fdv-upper-bound-audit", sources: manifest.sources.length, totalSources: plan.length, status: report.status, checks: report.checks, rejections: manifest.rejections.length }));
  }
  await save();
  console.log(JSON.stringify({ status: manifest.sources.length === plan.length && manifest.sources.every(source => source.status === "complete") ? "complete" : "partial", sources: manifest.sources.length, totalSources: plan.length, rejections: manifest.rejections.length }));
}
main().catch(error => { const message = error instanceof Error ? error.message : ""; console.error(/^daily_raw_fdv_[a-z_]+$/.test(message) ? message : "daily_raw_fdv_validation_failed"); process.exitCode = 1; });
