import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { sameHistoryIdentity } from "./completeHistorySource";
import { sameParentScope } from "./parentHistorySource";
import { sameMethodology } from "./fundamentalSource";
import { finite, historyIdentity, shiftDay, snapshotMarket, utcDay } from "./dailyHistory";
import { historyRetrySeconds } from "./historyCollection";
import { contentHash, objectHash, type SourceBundle, type SourceReceipt } from "./sourceBundle";
import type { CoinRaw } from "./types";
import type { PublishedSnapshot } from "./publicationTypes";
import type { DailyRawAsset, DailyRawObservation, DailyRawPoint, DailyRawSource, DailyRawWitness } from "./dailyRawDatabase";
import type { FdvRejection } from "./dailyRawFdvValidation";
import { checkCapturedFdvUpperBound, type indexCapturedFdvQuotes } from "./dailyRawFdvValidation";
import { DAILY_RAW_FDV_REVIEW, DAILY_RAW_FDV_REVIEW_BASIS, hasDailyRawFdvReview } from "./dailyRawFdvReview";

export const DAILY_RAW_COLLECTION_VERSION = "daily-raw-collection-v1";
const flowMetrics = [["fees", "dailyFees"], ["revenue", "dailyRevenue"], ["holders", "dailyHoldersRevenue"]] as const;
const marketMetrics = ["price", "mcap", "fdv"] as const;
type Row = Record<string, unknown>;
export interface DailyRawCollectionIssue { scope: string; reason: string; metric?: string; day?: string }
export interface CollectedDailyRawAsset { asset: DailyRawAsset; sources: DailyRawSource[]; points: DailyRawPoint[]; issues?: DailyRawCollectionIssue[] }
/** Rejection proofs are regenerated against archived originals by the caller.
 * Remove only the exact disproved captured claim; independent FDV remains eligible. */
export function rejectDailyRawCapturedFdv(input: CollectedDailyRawAsset, rejections: FdvRejection[], snapshotSha256: string): CollectedDailyRawAsset {
  const sources = new Map(input.sources.map(source => [source.key, source]));
  return { ...input, points: input.points.map(point => {
    const claim = point.fdv, source = claim && sources.get(claim.source);
    const rejected = claim && source && rejections.some(rejection => rejection.slug === input.asset.slug && rejection.identity === input.asset.identity && rejection.day === point.day
      && rejection.proof.snapshotSha256 === snapshotSha256 && source.sha256 === snapshotSha256 && source.provider === rejection.proof.provider
      && rejection.proof.reportedFdv === claim.value && Date.parse(rejection.proof.quoteAt) === Date.parse(claim.at ?? "") && rejection.proof.observedAt === source.observedAt);
    if (!rejected) return point;
    const next = { ...point }; delete next.fdv; return next;
  }) };
}
const differs = (a: number, b: number) => Math.abs(a - b) > Math.max(1, Math.abs(a), Math.abs(b)) * 1e-8;
const orderedJson = (value: unknown): string => {
  const order = (v: unknown): unknown => Array.isArray(v) ? v.map(order) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, order(item)])) : v;
  return JSON.stringify(order(value));
};

export function dailyRawSource(slug: string, input: Omit<DailyRawSource, "key">): DailyRawSource {
  return { key: objectHash([DAILY_RAW_COLLECTION_VERSION, slug, input]), ...input };
}
function conflictObservation(old: DailyRawObservation, next: DailyRawObservation): DailyRawObservation {
  const original = (point: DailyRawObservation): DailyRawWitness[] => point.witnesses ?? [{ value: point.value, state: point.state, source: point.source, at: point.at ?? null }];
  const witnesses = [...new Map([...original(old), ...original(next)].map(witness => [objectHash(witness), witness])).values()];
  if (witnesses.length > 16) throw new DailyRawInputError("daily_raw_conflict_witness_limit");
  return { ...old, value: null, state: "conflict", ...(witnesses.length > 1 ? { witnesses } : {}) };
}
export const dailyRawObservationSources = (observation: DailyRawObservation | undefined) => observation ? [observation.source, ...(observation.witnesses?.map(witness => witness.source) ?? [])].filter(Boolean) : [];

/** Parent metadata can list explicitly double-counted products. Recover only
 * actual parent totals whose dated child breakdown proves the selected scope. */
function parentFeeBreakdownScope(key: string, members: Row[], summary: Row, excluded: Row[]) {
  if (!Array.isArray(summary.childProtocols) || !Array.isArray(summary.totalDataChartBreakdown)) return null;
  const children = summary.childProtocols as Row[], ids = new Set(members.map(member => member.defillamaId)), selected = children.filter(child => ids.has(child.defillamaId)), extras = children.filter(child => !ids.has(child.defillamaId));
  if (!sameParentScope(key, members, { ...summary, childProtocols: selected }) || new Set(children.map(child => child.defillamaId)).size !== children.length || new Set(children.map(child => child.name)).size !== children.length) return null;
  if (!extras.every(child => excluded.filter(p => p.doublecounted === true && p.parentProtocol === key && p.defillamaId === child.defillamaId && p.name === child.name && sameMethodology(p.methodology, child.methodology)).length === 1)) return null;
  return { selectedNames: new Set(members.map(member => String(member.name))), allNames: new Set(children.map(child => String(child.name))) };
}
export function exactDailyRawFeeParentBreakdown(key: string, members: Row[], summary: Row, excluded: Row[] = []) {
  const scope = parentFeeBreakdownScope(key, members, summary, excluded);
  if (!scope) return null;
  const { selectedNames, allNames } = scope, breakdown = new Map<number, { value: number; reported: number; hash: string } | null>();
  for (const point of summary.totalDataChartBreakdown as unknown[]) {
    if (!Array.isArray(point) || !finite(point[0]) || !point[1] || typeof point[1] !== "object" || Array.isArray(point[1])) continue;
    let sum = 0, valid = true; const reported = new Set<string>();
    for (const chain of Object.values(point[1])) {
      if (!chain || typeof chain !== "object" || Array.isArray(chain)) { valid = false; break; }
      for (const [name, value] of Object.entries(chain)) {
        if (!allNames.has(name) || !finite(value)) { valid = false; break; }
        if (selectedNames.has(name)) { sum += value; reported.add(name); }
      }
    }
    const previous = breakdown.get(point[0]), hash = objectHash(point[1]);
    breakdown.set(point[0], !valid || previous === null || previous !== undefined && previous.hash !== hash ? null : { value: sum, reported: reported.size, hash });
  }
  return [...breakdown].filter((point): point is [number, { value: number; reported: number; hash: string }] => point[1] !== null && point[1].reported > 0).map(([time, point]) => ({ time, value: point.value, state: point.reported === members.length ? "complete" as const : "partial" as const }));
}
export function exactDailyRawFeeParentChart(key: string, members: Row[], summary: Row, excluded: Row[] = []): unknown[] | null {
  if (!Array.isArray(summary.totalDataChart)) return null;
  if (sameParentScope(key, members, summary)) return summary.totalDataChart;
  // A broader parent total has a different scope, even when an excluded product
  // happens to contribute zero. Only its validated selected-child series is used.
  return exactDailyRawFeeParentBreakdown(key, members, summary, excluded) ? [] : null;
}

/** Retains the existing exact parent/component checks and the entire original
 * dated series. Fees follows the same path as Revenue and Holders Revenue. */
export function extractDailyRawFundamentals(bundle: SourceBundle, archiveUrl: string, receiptArchive?: (receipt: SourceReceipt) => string | undefined) {
  const series = new Map<string, Map<string, DailyRawPoint>>();
  const sources = new Map<string, Map<string, DailyRawSource>>();
  const bundleLastDay = shiftDay(utcDay(Date.parse(bundle.asOf)), -1);
  const read = (receipt: SourceReceipt): Row | null => {
    if (receipt.status !== 200 || receipt.error) return null;
    if (contentHash(receipt.body) !== receipt.sha256) throw Error("daily_raw_receipt_hash_mismatch");
    try {
      const body: unknown = JSON.parse(receipt.body);
      return body && typeof body === "object" && !Array.isArray(body) ? body as Row : null;
    } catch { return null; }
  };
  const matches = (receipt: SourceReceipt, path: string, dataType: string) => {
    const url = new URL(receipt.url);
    return receipt.status === 200 && url.hostname === "api.llama.fi" && url.pathname === path && (url.searchParams.get("dataType") ?? "dailyFees") === dataType;
  };
  for (const [metric, dataType] of flowMetrics) {
    const candidates = bundle.receipts.filter(r => matches(r, "/overview/fees", dataType) && new URL(r.url).searchParams.get("excludeTotalDataChartBreakdown") === "false");
    const receipt = metric === "fees" ? candidates.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] : candidates[0];
    if (!receipt) continue;
    const lastDay = metric === "fees" ? shiftDay(utcDay(Date.parse(receipt.observedAt)), -1) : bundleLastDay;
    const overview = read(receipt);
    if (!Array.isArray(overview?.protocols) || !Array.isArray(overview.totalDataChartBreakdown)) continue;
    const protocols = overview.protocols as Row[], counts = new Map<string, number>(), groups = new Map<string, Row[]>();
    for (const p of protocols) counts.set(String(p.name), (counts.get(String(p.name)) ?? 0) + 1);
    for (const p of protocols) if (typeof p.slug === "string" && typeof p.name === "string" && p.doublecounted !== true) {
      const slug = String(p.parentProtocol ?? p.slug);
      groups.set(slug, [...(groups.get(slug) ?? []), p]);
    }
    const rows = new Map<string, Row>(), conflicts = new Set<string>();
    for (const point of overview.totalDataChartBreakdown) {
      if (!Array.isArray(point) || !finite(point[0]) || point[0] % 86400 !== 0 || !point[1] || typeof point[1] !== "object" || Array.isArray(point[1])) continue;
      const day = utcDay(point[0] * 1000);
      if (day > lastDay) continue;
      if (rows.has(day) && orderedJson(rows.get(day)) !== orderedJson(point[1])) conflicts.add(day);
      rows.set(day, point[1] as Row);
    }
    const summaries = bundle.receipts.filter(r => {
      const url = new URL(r.url);
      return r.status === 200 && url.hostname === "api.llama.fi" && url.pathname.startsWith("/summary/fees/") && (url.searchParams.get("dataType") ?? "dailyFees") === dataType;
    }).map(r => ({ receipt: r, data: read(r) })).filter((r): r is { receipt: SourceReceipt; data: Row } => !!r.data);
    for (const [slug, members] of groups) {
      const sorted = [...members].sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
      const scope = orderedJson({ slug, components: sorted.map(p => ({ slug: p.slug, name: p.name, defillamaId: p.defillamaId, parentProtocol: p.parentProtocol ?? null })) });
      const definition = orderedJson({ dataType, currency: "USD", methodology: sorted.map(p => ({ slug: p.slug, methodology: p.methodology ?? null })) });
      const register = (r: SourceReceipt) => {
        const archived = receiptArchive ? receiptArchive(r) : archiveUrl;
        const source = dailyRawSource(slug, { metric, provider: "DefiLlama", url: r.url, observedAt: r.observedAt, sha256: r.sha256, ...(archived ? { archiveUrl: archived } : {}),
          scope, definition, basis: "completed_utc_day_flow;provider_reconstructed;original_dated_observations" });
        const target = sources.get(slug) ?? new Map<string, DailyRawSource>();
        target.set(source.key, source); sources.set(slug, target);
        return source.key;
      };
      const source = register(receipt), points = new Map<string, DailyRawObservation>();
      const unique = members.every(p => counts.get(String(p.name)) === 1);
      for (const [day, values] of rows) {
        const amounts = members.map(p => values[String(p.name)]), available = amounts.filter(finite);
        if (!available.length) continue;
        points.set(day, { value: unique && !conflicts.has(day) ? available.reduce((a, b) => a + b, 0) : null,
          state: !unique || conflicts.has(day) ? "conflict" : available.length === members.length ? "complete" : "partial", source, at: null });
      }
      const excluded = protocols.filter(p => p.parentProtocol === slug && p.doublecounted === true);
      const chart = (data: Row) => slug.startsWith("parent#") ? metric === "fees" ? exactDailyRawFeeParentChart(slug, members, data, excluded) : sameParentScope(slug, members, data) ? data.totalDataChart : null
        : members.length === 1 && sameHistoryIdentity(members[0], data) ? data.totalDataChart : null;
      const matching = summaries.filter(({ data }) => Array.isArray(chart(data)));
      const selected = metric === "fees" ? matching.sort((a, b) => Date.parse(a.receipt.observedAt) - Date.parse(b.receipt.observedAt)) : matching.slice(0, 1);
      for (const summary of selected) {
        const summaryChart = chart(summary.data);
        if (!Array.isArray(summaryChart)) continue;
        const source = register(summary.receipt), seen = new Map<string, number>();
        for (const point of summaryChart) {
          if (!Array.isArray(point) || !finite(point[0]) || point[0] % 86400 !== 0 || !finite(point[1])) continue;
          const day = utcDay(point[0] * 1000);
          if (day > lastDay) continue;
          const old = points.get(day), previous = seen.get(day);
          const duplicate = previous !== undefined && differs(previous, point[1]);
          const changed = old?.state === "complete" && old.value !== null && differs(old.value, point[1]);
          const oldObservedAt = old ? sources.get(slug)?.get(old.source)?.observedAt : undefined;
          const revision = metric === "fees" && oldObservedAt ? Date.parse(summary.receipt.observedAt) - Date.parse(oldObservedAt) : 0;
          seen.set(day, point[1]);
          // Exact identity/scope/methodology has already been checked above.
          // A later provider receipt is its restatement; same-time disagreement
          // and conflicting duplicate observations remain withheld.
          if (changed && revision < 0 && !duplicate && old?.state !== "conflict") continue;
          const conflict = old?.state === "conflict" || duplicate || changed && revision <= 0;
          const next: DailyRawObservation = { value: point[1], state: "complete", source, at: null };
          points.set(day, conflict && old ? conflictObservation(old, next) : { ...next, ...(conflict ? { value: null, state: "conflict" as const } : {}) });
        }
        if (metric === "fees" && slug.startsWith("parent#")) for (const point of exactDailyRawFeeParentBreakdown(slug, members, summary.data, excluded) ?? []) {
          if (point.time % 86400 !== 0) continue;
          const day = utcDay(point.time * 1000); if (day > lastDay) continue;
          const old = points.get(day), next: DailyRawObservation = { value: point.value, state: point.state, source, at: null };
          // Child decimals are a separate representation of the same receipt.
          // They fill gaps, never dispute a verified authoritative parent total.
          if (!old || old.state === "partial" && next.state === "complete") points.set(day, next);
          else if (old.state === "partial" && next.state === "partial" && old.value !== null && differs(old.value, next.value!)) points.set(day, conflictObservation(old, next));
        }
      }
      const target = series.get(slug) ?? new Map<string, DailyRawPoint>();
      for (const [day, point] of points) { const row = target.get(day) ?? { day }; row[metric] = point; target.set(day, row); }
      series.set(slug, target);
    }
  }
  return { series: new Map([...series].map(([slug, rows]) => [slug, [...rows.values()].sort((a, b) => a.day.localeCompare(b.day))])),
    sources: new Map([...sources].map(([slug, rows]) => [slug, [...rows.values()]])) };
}

/** Actual archived quotes only. snapshotMarket supplies the existing identity,
 * provider timestamp and capital checks; no supply reconstruction is used. */
export function snapshotDailyRaw(coin: CoinRaw, current: CoinRaw, reference: PublishedSnapshot, fdvIndex?: ReturnType<typeof indexCapturedFdvQuotes>): CollectedDailyRawAsset {
  const asset = { slug: current.slug, identity: historyIdentity(current) }, point = snapshotMarket(coin, current, "", reference.dataAt);
  if (!point) return { asset, sources: [], points: [] };
  const sources: DailyRawSource[] = [], row: DailyRawPoint = { day: point.day }, issues: DailyRawCollectionIssue[] = [];
  for (const metric of marketMetrics) {
    const value = point[metric];
    if (value === null) continue;
    const provider = coin.marketSources?.[metric] ?? "unknown";
    const observedAt = (provider === "CoinGecko" ? coin.marketSources?.gecko : coin.marketSources?.cmc)?.observedAt ?? reference.validatedAt;
    const reviewed = hasDailyRawFdvReview(asset, { metric, provider, basis: "captured_quote;actual_provider_timestamp" });
    const source = dailyRawSource(current.slug, { metric, provider, url: reference.url, observedAt, sha256: reference.sha256, archiveUrl: reference.url,
      scope: orderedJson(asset), definition: `provider_reported_${metric}_usd;verified_token_identity`, basis: reviewed ? DAILY_RAW_FDV_REVIEW_BASIS : "captured_quote;actual_provider_timestamp" });
    if (reviewed) {
      sources.push(source); row[metric] = { value: null, state: "conflict", source: source.key, at: point.fdvAt };
      issues.push({ scope: current.slug, metric, day: point.day, reason: DAILY_RAW_FDV_REVIEW.reason }); continue;
    }
    let rejected = false;
    if (metric === "fdv" && fdvIndex && (provider === "CoinGecko" || provider === "CoinMarketCap")) {
      const lookup = provider === "CoinGecko" ? coin.marketSources?.gecko : coin.marketSources?.cmc, id = provider === "CoinGecko" ? coin.geckoId : coin.cmcId ? String(coin.cmcId) : null;
      let reason = "fdv_bound_exact_provider_record_unavailable"; rejected = true;
      if (id && lookup?.status === "received" && lookup.id === id && lookup.observedAt === observedAt && point.fdvAt) {
        const check = checkCapturedFdvUpperBound({ provider, id, observedAt, quoteAt: point.fdvAt, fdv: value }, fdvIndex);
        rejected = check.state === "exceeds_bound" || check.state === "receipt_unavailable"; reason = check.reason;
      }
      if (rejected) issues.push({ scope: current.slug, metric, day: point.day, reason });
    }
    sources.push(source); row[metric] = { value: rejected ? null : value, state: rejected ? "missing" : "complete", source: source.key, at: rejected ? null : metric === "fdv" ? point.fdvAt : point.marketAt };
  }
  return { asset, sources, points: [row], ...(issues.length ? { issues } : {}) };
}

export interface LegacyFdvManifest {
  schema: 1;
  assets: { slug: string; identity: string; points: { day: string; fdv: number; fdvAt: string; sourceId: string; observedAt?: string; provider?: string; evidenceBasis?: string; verification?: string }[] }[];
  sources: { id: string; url: string; observedAt: string; archiveUrl?: string; sha256: string }[];
}
export function legacyDailyRawFdv(input: LegacyFdvManifest, current: CoinRaw[]): CollectedDailyRawAsset[] {
  if (input.schema !== 1 || !Array.isArray(input.assets) || !Array.isArray(input.sources)) throw new DailyRawInputError("daily_raw_legacy_manifest_schema");
  const coins = new Map(current.map(coin => [coin.slug, coin])), receipts = new Map(input.sources.map(source => [source.id, source]));
  const output: CollectedDailyRawAsset[] = [];
  for (const item of input.assets) {
    const coin = coins.get(item.slug);
    if (!coin || coin.identityStatus !== "verified" || historyIdentity(coin) !== item.identity || coin.capitalExclusionReason) continue;
    const asset = { slug: item.slug, identity: item.identity }, sources = new Map<string, DailyRawSource>(), points: DailyRawPoint[] = [], issues: DailyRawCollectionIssue[] = [];
    for (const point of item.points) {
      if (point.verification && point.verification !== "verified") continue;
      const receipt = receipts.get(point.sourceId);
      const observedAt = point.observedAt ?? receipt?.observedAt;
      if (!receipt || !validDay(point.day) || !Number.isFinite(Date.parse(point.fdvAt)) || utcDay(Date.parse(point.fdvAt)) !== point.day || !finite(point.fdv) || point.fdv <= 0 || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !observedAt || !Number.isFinite(Date.parse(observedAt)) || Date.parse(point.fdvAt) > Date.parse(observedAt)) throw new DailyRawInputError("daily_raw_legacy_fdv_invalid");
      const provider = point.provider ?? "verified_screener_archive", reviewed = hasDailyRawFdvReview(asset, { metric: "fdv", provider, basis: "captured_quote;actual_provider_timestamp" });
      const source = dailyRawSource(item.slug, { metric: "fdv", provider, url: receipt.url, observedAt,
        sha256: receipt.sha256, ...(receipt.archiveUrl ? { archiveUrl: receipt.archiveUrl } : {}), scope: orderedJson(asset),
        definition: "provider_reported_fdv_usd;verified_token_identity", basis: reviewed ? DAILY_RAW_FDV_REVIEW_BASIS : "captured_quote;actual_provider_timestamp" });
      sources.set(source.key, source); points.push({ day: point.day, fdv: { value: reviewed ? null : point.fdv, state: reviewed ? "conflict" : "complete", source: source.key, at: point.fdvAt } });
      if (reviewed) issues.push({ scope: item.slug, metric: "fdv", day: point.day, reason: DAILY_RAW_FDV_REVIEW.reason });
    }
    output.push({ asset, sources: [...sources.values()], points, ...(issues.length ? { issues } : {}) });
  }
  return output;
}

/** Pick a documented market observation convention before storage. Different
 * intraday quotes are not evidence that a verified daily close is conflicting. */
export function combineDailyRawAssets(asset: DailyRawAsset, inputs: CollectedDailyRawAsset[]): CollectedDailyRawAsset {
  const sources = new Map<string, DailyRawSource>(), points = new Map<string, DailyRawPoint>();
  const rank = (metric: string, source: DailyRawSource | undefined) => {
    if (!source) return 0;
    if (metric === "fdv" && source.basis === DAILY_RAW_FDV_REVIEW_BASIS) return 0;
    if (metric === "fdv") return source.metric === "fdv" && source.provider === "CoinMetrics" && source.basis === "utc_daily_close_verified_total_supply" ? 4 : source.basis.includes("captured_quote") ? 3 : 1;
    if (["price", "mcap"].includes(metric) && source.metric === metric && source.provider === "CoinGecko" && source.basis.includes("coingecko_web_csv") && source.basis.includes("utc_day_close") && source.basis.includes('"verified":true')) return 4;
    return source.basis.includes("captured_quote") ? 3 : source.basis.includes("utc_day_close") ? 2 : 1;
  };
  for (const input of inputs) {
    if (input.asset.slug !== asset.slug || input.asset.identity !== asset.identity) throw new DailyRawInputError("daily_raw_combined_identity_mismatch");
    for (const source of input.sources) sources.set(source.key, source);
    for (const point of input.points) {
      const target = points.get(point.day) ?? { day: point.day };
      for (const metric of [...marketMetrics, "fees", "revenue", "holders"] as const) {
        const next = point[metric], old = target[metric];
        if (!next) continue;
        if (!old || old.state === "missing") { target[metric] = next; continue; }
        if (next.state === "missing") continue;
        if (marketMetrics.includes(metric as typeof marketMetrics[number])) {
          const oldRank = rank(metric, sources.get(old.source)), nextRank = rank(metric, sources.get(next.source));
          if (oldRank !== nextRank) {
            const preferred = nextRank > oldRank ? next : old, other = preferred === next ? old : next;
            if (Math.max(oldRank, nextRank) === 4 && Math.min(oldRank, nextRank) === 3 && (!preferred.at || !other.at || Date.parse(preferred.at) < Date.parse(other.at))) target[metric] = conflictObservation(old, next);
            else if (nextRank > oldRank) target[metric] = next;
            continue;
          }
          const oldSource = sources.get(old.source), nextSource = sources.get(next.source);
          if (oldSource?.basis.includes("captured_quote") && nextSource?.basis.includes("captured_quote") && old.at !== next.at) {
            if (Date.parse(next.at ?? "") > Date.parse(old.at ?? "")) target[metric] = next;
            continue;
          }
        }
        if (old.value === next.value && old.state === next.state) continue;
        target[metric] = conflictObservation(old, next);
      }
      points.set(point.day, target);
    }
  }
  const used = new Set([...points.values()].flatMap(point => ([...marketMetrics, "fees", "revenue", "holders"] as const).flatMap(metric => dailyRawObservationSources(point[metric]))));
  return { asset, sources: [...sources.values()].filter(source => used.has(source.key)), points: [...points.values()].sort((a, b) => a.day.localeCompare(b.day)), issues: inputs.flatMap(input => input.issues ?? []) };
}

export interface CsvTimestampSemantics { basis: string; verified?: boolean; timeUTC?: string; dayOffset?: number; atDayOffset?: number }
// Export event_date D labels the price at D+1 midnight, but the market cap at D
// midnight. This was checked against the original daily API receipt for INDEX.
export const COINGECKO_CSV_CLOSE_SEMANTICS = {
  price: { basis: "utc_day_close", verified: true, timeUTC: "00:00:00.000", dayOffset: 0, atDayOffset: 1 },
  mcap: { basis: "utc_day_close", verified: true, timeUTC: "00:00:00.000", dayOffset: -1, atDayOffset: 0 },
} satisfies Record<"price" | "mcap", CsvTimestampSemantics>;
export interface DailyRawCsvFile {
  geckoId: string; path: string; sha256: string; observedAt: string; url: string; archiveUrl?: string;
  firstDay?: string; availableThrough?: string;
  timestampSemantics?: Partial<Record<"price" | "mcap", CsvTimestampSemantics>>;
}
export interface DailyRawCsvManifest { schema: 1; files: DailyRawCsvFile[] }
export class DailyRawInputError extends Error {}

function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else if (!quoted && value) throw new DailyRawInputError("daily_raw_csv_quote"); else quoted = !quoted; }
    else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
      row.push(value); value = "";
      if (c !== ",") { if (row.some(v => v.trim())) rows.push(row); row = []; if (c === "\r" && text[i + 1] === "\n") i++; }
    } else value += c;
  }
  if (quoted) throw new DailyRawInputError("daily_raw_csv_quote");
  row.push(value); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && utcDay(Date.parse(day)) === day;
function csvAt(day: string, semantics?: CsvTimestampSemantics): string | null {
  if (!semantics?.verified) return null;
  if (!semantics.basis || !/^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(semantics.timeUTC ?? "") || !Number.isSafeInteger(semantics.dayOffset ?? 0) || !Number.isSafeInteger(semantics.atDayOffset ?? 0)) throw new DailyRawInputError("daily_raw_csv_timestamp_semantics");
  const date = `${shiftDay(day, semantics.atDayOffset ?? 0)}T${semantics.timeUTC}Z`, time = Date.parse(date);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(11, 19) !== semantics.timeUTC!.slice(0, 8)) throw new DailyRawInputError("daily_raw_csv_timestamp_semantics");
  return new Date(time).toISOString();
}
export function parseDailyRawCsv(text: string, file: DailyRawCsvFile, asset: DailyRawAsset): CollectedDailyRawAsset {
  if (asset.identity !== `gecko:${file.geckoId}`) throw new DailyRawInputError("daily_raw_csv_identity_mismatch");
  const url = new URL(file.url);
  if (url.protocol !== "https:" || !["coingecko.com", "www.coingecko.com"].includes(url.hostname) || url.pathname !== `/price_charts/export/${encodeURIComponent(file.geckoId)}/usd.csv`) throw new DailyRawInputError("daily_raw_csv_source_identity_mismatch");
  if (contentHash(text) !== file.sha256) throw new DailyRawInputError("daily_raw_csv_hash_mismatch");
  const rows = csvRows(text.replace(/^\uFEFF/, "")), headers = rows.shift()?.map(s => s.trim());
  if (!headers || new Set(headers).size !== headers.length || !["event_date", "close_price_usd", "market_cap_usd"].every(field => headers.includes(field))) throw new DailyRawInputError("daily_raw_csv_columns");
  const columns = { price: headers.indexOf("close_price_usd"), mcap: headers.indexOf("market_cap_usd") };
  const sources = (["price", "mcap"] as const).map(metric => dailyRawSource(asset.slug, { metric, provider: "CoinGecko", url: file.url, observedAt: file.observedAt,
    sha256: file.sha256, ...(file.archiveUrl ? { archiveUrl: file.archiveUrl } : {}), scope: orderedJson(asset),
    definition: `provider_reported_${metric}_usd;csv_column:${headers[columns[metric]]}`,
    basis: orderedJson({ format: "coingecko_web_csv", eventDate: "original_utc_date_label", column: headers[columns[metric]], normalization: "negative_market_cell_is_missing;zero_preserved;original_value_retained_in_receipt",
      timestamp: file.timestampSemantics?.[metric] ?? { basis: "timestamp_semantics_unverified", verified: false } }) }));
  const points = new Map<string, DailyRawPoint>(), issues: DailyRawCollectionIssue[] = [];
  for (const row of rows) {
    if (row.length !== headers.length) throw new DailyRawInputError("daily_raw_csv_row_columns");
    const rawDate = row[headers.indexOf("event_date")].trim(), day = rawDate.slice(0, 10);
    if (!validDay(day) || !/^\d{4}-\d{2}-\d{2}(?: 00:00:00 UTC)?$/.test(rawDate)) throw new DailyRawInputError("daily_raw_csv_date");
    for (const [i, metric] of (["price", "mcap"] as const).entries()) {
      const semantics = file.timestampSemantics?.[metric], targetDay = semantics?.verified ? shiftDay(day, semantics.dayOffset ?? 0) : day;
      if (semantics?.verified && semantics.basis === "utc_day_close" && targetDay >= utcDay(Date.parse(file.observedAt))) continue;
      const point = points.get(targetDay) ?? { day: targetDay };
      const raw = row[columns[metric]].trim(); let value: number | null = null;
      if (raw && !/^(?:null|n\/a|na)$/i.test(raw)) {
        if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw))) throw new DailyRawInputError("daily_raw_csv_number");
        value = Number(raw);
        if (value < 0) { value = null; issues.push({ scope: asset.slug, metric, day: targetDay, reason: "daily_raw_csv_negative_market_cell_missing" }); }
      }
      const old = point[metric], conflict = old?.state === "conflict" || !!old && old.value !== value;
      const next: DailyRawObservation = { value, state: value === null ? "missing" : "complete", source: sources[i].key, at: value === null ? null : csvAt(day, semantics) };
      point[metric] = conflict && old ? conflictObservation(old, next) : next;
      points.set(targetDay, point);
    }
  }
  return { asset, sources, points: [...points.values()].sort((a, b) => a.day.localeCompare(b.day)), issues };
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, path);
}
/** Originals never depend on a mutable download filename or a future public URL. */
export async function archiveDailyRawOriginal(cache: string, bytes: Uint8Array, extension: string) {
  if (!/^[a-z.]+$/.test(extension)) throw Error("daily_raw_archive_extension");
  const hash = contentHash(bytes), path = join(cache, "originals", `${hash}.${extension}`);
  await mkdir(dirname(path), { recursive: true });
  try { if (contentHash(await readFile(path)) !== hash) throw Error("daily_raw_archive_hash_mismatch"); }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    try { await writeFile(path, bytes, { flag: "wx" }); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
    if (contentHash(await readFile(path)) !== hash) throw Error("daily_raw_archive_hash_mismatch");
  }
  return { path, sha256: hash };
}
export async function loadDailyRawCsvManifest(path: string, cache: string, failed?: (file: DailyRawCsvFile, error: DailyRawInputError) => void): Promise<DailyRawCsvManifest> {
  const bytes = await readFile(path); await archiveDailyRawOriginal(cache, bytes, "manifest.json");
  const input = JSON.parse(bytes.toString()) as DailyRawCsvManifest;
  if (input.schema !== 1 || !Array.isArray(input.files)) throw new DailyRawInputError("daily_raw_csv_manifest_schema");
  const files: DailyRawCsvFile[] = [];
  for (const item of input.files) {
    try {
    if (typeof item.geckoId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(item.geckoId) || typeof item.path !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isFinite(Date.parse(item.observedAt))) throw new DailyRawInputError("daily_raw_csv_manifest_entry");
    const url = new URL(item.url);
    if (url.protocol !== "https:" || url.username || url.password || !["coingecko.com", "www.coingecko.com"].includes(url.hostname) || url.pathname !== `/price_charts/export/${encodeURIComponent(item.geckoId)}/usd.csv`) throw new DailyRawInputError("daily_raw_csv_source_url");
    const original = await readFile(resolve(dirname(path), item.path));
    if (contentHash(original) !== item.sha256) throw new DailyRawInputError("daily_raw_csv_hash_mismatch");
    const archived = await archiveDailyRawOriginal(cache, original, "csv");
    await archiveDailyRawOriginal(cache, Buffer.from(JSON.stringify(item)), "receipt.json");
    files.push({ ...item, path: archived.path });
    } catch (error) {
      if (!failed || !(error instanceof DailyRawInputError || error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      failed(item, error instanceof DailyRawInputError ? error : new DailyRawInputError("daily_raw_csv_original_missing"));
    }
  }
  return { schema: 1, files };
}

export interface DailyRawCsvAcquisition { status: "cached" | "fetched" | "deferred" | "unavailable"; file?: DailyRawCsvFile; retryAt?: string; httpStatus?: number; reason?: string }
interface CsvCheckpoint { schema: 1; geckoId: string; result: DailyRawCsvAcquisition }
const readJson = async <T>(path: string): Promise<T | null> => { try { return JSON.parse(await readFile(path, "utf8")) as T; } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null; throw error; } };

/** Public export endpoint discovered from CoinGecko's historical-data DOM.
 * Auth/captcha responses pause the provider, without cookies or API-key workarounds. */
export async function acquireDailyRawCsv(geckoId: string, cache: string, options: { now?: () => number; fetcher?: typeof fetch; onRequest?: () => Promise<void> | void; allowRequest?: boolean; targetDay?: string } = {}): Promise<DailyRawCsvAcquisition> {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(geckoId)) throw new DailyRawInputError("daily_raw_csv_gecko_id");
  const now = options.now ?? Date.now, path = join(cache, "csv-checkpoints", `${objectHash(geckoId)}.json`), providerPath = join(cache, "csv-provider.json");
  if (options.targetDay && (!validDay(options.targetDay) || options.targetDay >= utcDay(now()))) throw new DailyRawInputError("daily_raw_csv_target_not_completed");
  const coverage = (file: DailyRawCsvFile, bytes: Uint8Array) => {
    const parsed = parseDailyRawCsv(Buffer.from(bytes).toString(), file, { slug: geckoId, identity: `gecko:${geckoId}` });
    const dates = parsed.points.filter(point => [point.price, point.mcap].some(value => value?.state === "complete")).map(point => point.day);
    if (!dates.length) throw new DailyRawInputError("daily_raw_csv_empty_series");
    return { ...file, firstDay: dates[0], availableThrough: dates.at(-1)! };
  };
  const checkpoint = await readJson<CsvCheckpoint>(path);
  if (checkpoint?.schema === 1 && checkpoint.geckoId === geckoId) {
    if (checkpoint.result.file && ["cached", "fetched"].includes(checkpoint.result.status)) {
      const file = checkpoint.result.file;
      const bytes = await readFile(file.path);
      if (contentHash(bytes) !== file.sha256) throw Error("daily_raw_csv_cache_hash_mismatch");
      try {
        const ready = coverage(file, bytes);
        if (!options.targetDay || ready.availableThrough! >= options.targetDay) return { ...checkpoint.result, file: ready, status: "cached" };
      } catch (error) {
        if (!(error instanceof DailyRawInputError)) throw error;
        const result: DailyRawCsvAcquisition = { status: "unavailable", reason: error.message, retryAt: new Date(now() + 3600_000).toISOString() };
        await atomicJson(path, { schema: 1, geckoId, result } satisfies CsvCheckpoint); return result;
      }
    }
    if (checkpoint.result.retryAt && Date.parse(checkpoint.result.retryAt) > now()) return checkpoint.result;
  }
  if (options.allowRequest === false) return { status: "unavailable" };
  const provider = await readJson<{ retryAt: string; httpStatus: number }>(providerPath);
  if (provider && Date.parse(provider.retryAt) > now()) return { status: "deferred", ...provider };
  const url = `https://www.coingecko.com/price_charts/export/${encodeURIComponent(geckoId)}/usd.csv`;
  const requestedAt = new Date(now()).toISOString(); let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await options.onRequest?.();
    try { response = await (options.fetcher ?? fetch)(url, { headers: { accept: "text/csv" }, signal: AbortSignal.timeout(30_000) }); }
    catch {
      const result: DailyRawCsvAcquisition = { status: "unavailable", retryAt: new Date(now() + 3600_000).toISOString() };
      await atomicJson(path, { schema: 1, geckoId, result } satisfies CsvCheckpoint); return result;
    }
    if (response.status !== 503 || attempt === 2) break;
    const body = Buffer.from(await response.arrayBuffer()), original = await archiveDailyRawOriginal(cache, body, "response");
    await archiveDailyRawOriginal(cache, Buffer.from(JSON.stringify({ url, requestedAt, observedAt: new Date(now()).toISOString(), status: response.status, sha256: original.sha256, path: original.path })), "receipt.json");
    // Bounded idempotent GET retry; the caller also owns request pacing.
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  const observedAt = new Date(now()).toISOString(), status = response!.status;
  if (!response!.ok) {
    const result: DailyRawCsvAcquisition = { status: [401, 403, 429].includes(status) ? "deferred" : "unavailable", httpStatus: status,
      retryAt: new Date(now() + historyRetrySeconds(status, response!.headers.get("retry-after"), now()) * 1000).toISOString() };
    // Keep the actual error body too, but never log it.
    const body = Buffer.from(await response!.arrayBuffer());
    const original = await archiveDailyRawOriginal(cache, body, "response");
    await archiveDailyRawOriginal(cache, Buffer.from(JSON.stringify({ url, requestedAt, observedAt, status, sha256: original.sha256, path: original.path })), "receipt.json");
    if (result.status === "deferred") await atomicJson(providerPath, { retryAt: result.retryAt, httpStatus: status });
    await atomicJson(path, { schema: 1, geckoId, result } satisfies CsvCheckpoint); return result;
  }
  const body = Buffer.from(await response!.arrayBuffer()), original = await archiveDailyRawOriginal(cache, body, "csv");
  let file: DailyRawCsvFile = { geckoId, path: original.path, sha256: original.sha256, observedAt, url, timestampSemantics: COINGECKO_CSV_CLOSE_SEMANTICS };
  await archiveDailyRawOriginal(cache, Buffer.from(JSON.stringify({ ...file, requestedAt, status, headers: { "content-type": response!.headers.get("content-type") } })), "receipt.json");
  try { file = coverage(file, body); }
  catch (error) {
    if (!(error instanceof DailyRawInputError)) throw error;
    const result: DailyRawCsvAcquisition = { status: "unavailable", reason: error.message, retryAt: new Date(now() + 3600_000).toISOString() };
    await atomicJson(path, { schema: 1, geckoId, result } satisfies CsvCheckpoint); return result;
  }
  const result: DailyRawCsvAcquisition = { status: "fetched", file };
  await atomicJson(path, { schema: 1, geckoId, result } satisfies CsvCheckpoint);
  return result;
}

export interface DailyRawFeeCandidate { slug: string; url: string; members: Row[]; excluded?: Row[]; scope: string; priority?: number }
/** Query every source group: an overview prefix can be shorter than its exact
 * summary even when the recent overview period has no missing dates. */
export function dailyRawFeeCandidates(bundle: SourceBundle): DailyRawFeeCandidate[] {
  const candidates = bundle.receipts.filter(receipt => {
    const url = new URL(receipt.url);
    return receipt.status === 200 && url.hostname === "api.llama.fi" && url.pathname === "/overview/fees" && (url.searchParams.get("dataType") ?? "dailyFees") === "dailyFees";
  });
  const receipt = candidates.find(receipt => new URL(receipt.url).searchParams.get("excludeTotalDataChartBreakdown") === "false") ?? candidates[0];
  if (!receipt) return [];
  if (contentHash(receipt.body) !== receipt.sha256) throw new DailyRawInputError("daily_raw_receipt_hash_mismatch");
  const data = JSON.parse(receipt.body) as { protocols?: Row[]; totalDataChartBreakdown?: unknown[] };
  if (!Array.isArray(data.protocols)) throw new DailyRawInputError("daily_raw_fee_overview_schema");
  const groups = new Map<string, Row[]>();
  for (const p of data.protocols) if (p.doublecounted !== true && typeof p.slug === "string" && typeof p.name === "string") {
    const slug = String(p.parentProtocol ?? p.slug); groups.set(slug, [...(groups.get(slug) ?? []), p]);
  }
  const datedCoverage = (overview: typeof data) => {
    const names = new Map<string, string>(), repeated = new Set<string>(), sizes = new Map<string, number>(), coverage = new Map<string, { from: number; partial: boolean }>();
    for (const p of overview.protocols ?? []) if (p.doublecounted !== true && typeof p.slug === "string" && typeof p.name === "string") {
      const key = String(p.parentProtocol ?? p.slug);
      if (names.has(p.name)) repeated.add(p.name);
      names.set(p.name, key); sizes.set(key, (sizes.get(key) ?? 0) + 1);
    }
    for (const point of overview.totalDataChartBreakdown ?? []) {
      if (!Array.isArray(point) || !finite(point[0]) || !point[1] || typeof point[1] !== "object") continue;
      const count = new Map<string, number>();
      for (const [name, value] of Object.entries(point[1])) if (finite(value) && !repeated.has(name)) {
        const key = names.get(name); if (key) count.set(key, (count.get(key) ?? 0) + 1);
      }
      for (const [key, n] of count) {
        const previous = coverage.get(key);
        coverage.set(key, { from: Math.min(previous?.from ?? Infinity, point[0]), partial: !!previous?.partial || n < (sizes.get(key) ?? 0) });
      }
    }
    return coverage;
  };
  const feeCoverage = datedCoverage(data), otherCoverage = new Map<string, number>();
  for (const receipt of bundle.receipts) {
    const url = new URL(receipt.url);
    if (receipt.status !== 200 || url.hostname !== "api.llama.fi" || url.pathname !== "/overview/fees" || !["dailyRevenue", "dailyHoldersRevenue"].includes(url.searchParams.get("dataType") ?? "") || url.searchParams.get("excludeTotalDataChartBreakdown") !== "false") continue;
    if (contentHash(receipt.body) !== receipt.sha256) throw new DailyRawInputError("daily_raw_receipt_hash_mismatch");
    for (const [slug, coverage] of datedCoverage(JSON.parse(receipt.body) as typeof data)) otherCoverage.set(slug, Math.min(otherCoverage.get(slug) ?? Infinity, coverage.from));
  }
  return [...groups].map(([slug, members]) => {
    const linked = members.map(p => Array.isArray(p.linkedProtocols) ? p.linkedProtocols[0] : null).find(name => typeof name === "string");
    const query = slug.startsWith("parent#") ? typeof linked === "string" ? linked.toLowerCase().replace(/\s+/g, "-") : slug.slice(7) : String(members[0].slug);
    const current = feeCoverage.get(slug), prefix = (otherCoverage.get(slug) ?? Infinity) < (current?.from ?? Infinity);
    const priority = Number(prefix) * 4 + Number(!!current?.partial) * 2 + Number(slug.startsWith("parent#"));
    return { slug, members, excluded: data.protocols!.filter(p => p.parentProtocol === slug && p.doublecounted === true), priority, scope: objectHash(members.map(p => [p.slug, p.defillamaId, p.methodology]).sort()), url: `https://api.llama.fi/summary/fees/${encodeURIComponent(query)}?dataType=dailyFees` };
  }).sort((a, b) => b.priority - a.priority || b.members.reduce((sum, p) => sum + (finite(p.total24h) ? p.total24h : 0), 0) - a.members.reduce((sum, p) => sum + (finite(p.total24h) ? p.total24h : 0), 0) || a.slug.localeCompare(b.slug));
}
export interface DailyRawFeeAcquisition {
  status: "cached" | "fetched" | "deferred" | "unavailable";
  file?: string; receipt?: SourceReceipt; retryAt?: string; httpStatus?: number; reason?: string;
}
export async function acquireDailyRawFeesSummary(candidate: DailyRawFeeCandidate, cache: string, options: { now?: () => number; fetcher?: typeof fetch; onRequest?: () => Promise<void> | void; allowRequest?: boolean } = {}): Promise<DailyRawFeeAcquisition> {
  const now = options.now ?? Date.now, path = join(cache, "fee-checkpoints", `${objectHash([candidate.url, candidate.scope])}.json`), providerPath = join(cache, "fees-provider.json");
  const checkpoint = await readJson<Omit<DailyRawFeeAcquisition, "receipt">>(path);
  const validSummary = (data: Row) => {
    if (candidate.slug.startsWith("parent#")) {
      const breakdown = exactDailyRawFeeParentBreakdown(candidate.slug, candidate.members, data, candidate.excluded);
      return breakdown?.length ? breakdown : exactDailyRawFeeParentChart(candidate.slug, candidate.members, data, candidate.excluded);
    }
    return candidate.members.length === 1 && sameHistoryIdentity(candidate.members[0], data) && Array.isArray(data.totalDataChart) ? data.totalDataChart : null;
  };
  if (checkpoint?.file && (checkpoint.status === "cached" || checkpoint.status === "fetched" || checkpoint.reason === "daily_raw_fee_scope_mismatch")) {
    const bytes = await readFile(checkpoint.file), receipt = JSON.parse(gunzipSync(bytes).toString()) as SourceReceipt;
    if (!basename(checkpoint.file).startsWith(contentHash(bytes) + ".") || receipt.url !== candidate.url || contentHash(receipt.body) !== receipt.sha256) throw new DailyRawInputError("daily_raw_fee_cache_integrity");
    let data: Row | null = null; try { data = JSON.parse(receipt.body) as Row; } catch {}
    const chart = data ? validSummary(data) : null;
    if (Array.isArray(chart) && chart.length) {
      if (checkpoint.status === "unavailable") await atomicJson(path, { status: "fetched", file: checkpoint.file });
      return { ...checkpoint, receipt, status: "cached" };
    }
  }
  if (checkpoint?.retryAt && Date.parse(checkpoint.retryAt) > now()) return checkpoint;
  if (options.allowRequest === false) return { status: "unavailable" };
  const provider = await readJson<{ retryAt: string; httpStatus: number }>(providerPath);
  if (provider && Date.parse(provider.retryAt) > now()) return { status: "deferred", ...provider };
  let response: Response | undefined, receipt: SourceReceipt | undefined, file: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    await options.onRequest?.(); const requestedAt = new Date(now()).toISOString();
    try {
      response = await (options.fetcher ?? fetch)(candidate.url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      const body = await response.text();
      receipt = { url: candidate.url, requestedAt, observedAt: new Date(now()).toISOString(), status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "", "retry-after": response.headers.get("retry-after") ?? "" }, body, sha256: contentHash(body) };
    } catch {
      const result: DailyRawFeeAcquisition = { status: "unavailable", retryAt: new Date(now() + 3600_000).toISOString(), reason: "daily_raw_fee_request_failed" };
      await atomicJson(path, result); return result;
    }
    file = (await archiveDailyRawOriginal(cache, gzipSync(JSON.stringify(receipt!)), "receipt.json.gz")).path;
    if (response.status !== 503 || attempt === 2) break;
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  const status = response!.status;
  if (!response!.ok) {
    const result: DailyRawFeeAcquisition = { status: [401, 403, 429].includes(status) ? "deferred" : "unavailable", file, httpStatus: status,
      retryAt: new Date(now() + historyRetrySeconds(status, response!.headers.get("retry-after"), now()) * 1000).toISOString() };
    if (result.status === "deferred") await atomicJson(providerPath, { retryAt: result.retryAt, httpStatus: status });
    await atomicJson(path, result); return { ...result, receipt };
  }
  let summary: Row | null = null;
  try { summary = JSON.parse(receipt!.body) as Row; } catch {}
  const chart = summary ? validSummary(summary) : null, valid = Array.isArray(chart) && chart.length > 0;
  const result: Omit<DailyRawFeeAcquisition, "receipt"> = valid ? { status: "fetched", file } : { status: "unavailable", file, reason: "daily_raw_fee_scope_mismatch", retryAt: new Date(now() + 86400_000).toISOString() };
  await atomicJson(path, result); return { ...result, receipt };
}

/** Verifies an existing immutable release, never a guessed future upload URL.
 * A bundle hash can witness its nested original HTTP receipt body hash. */
export interface DailyRawArchiveVerification { sha256: string; receipts: Set<string> }
export async function verifyDailyRawArchives(sources: DailyRawSource[], fetcher: typeof fetch = fetch, verified = new Map<string, DailyRawArchiveVerification>()) {
  const byUrl = new Map<string, DailyRawSource[]>();
  for (const source of sources) {
    if (!source.archiveUrl || !/^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/[^/]+\/[^/?#]+$/.test(source.archiveUrl)) throw new DailyRawInputError("daily_raw_archive_pending");
    byUrl.set(source.archiveUrl, [...(byUrl.get(source.archiveUrl) ?? []), source]);
  }
  for (const [url, witnesses] of byUrl) {
    let original = verified.get(url);
    if (!original) {
      const response = await fetcher(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new DailyRawInputError("daily_raw_archive_unavailable");
      const bytes = Buffer.from(await response.arrayBuffer());
      original = { sha256: contentHash(bytes), receipts: new Set<string>() };
      if (witnesses.some(source => source.sha256 !== original!.sha256)) {
        let bundle: { receipts?: SourceReceipt[] } & Partial<SourceReceipt>;
        try { bundle = JSON.parse(gunzipSync(bytes, { maxOutputLength: 500_000_000 }).toString()) as typeof bundle; }
        catch { throw new DailyRawInputError("daily_raw_archive_hash_mismatch"); }
        const receipts = bundle.receipts ?? (typeof bundle.body === "string" && typeof bundle.url === "string" ? [bundle as SourceReceipt] : []);
        for (const receipt of receipts) if (contentHash(receipt.body) === receipt.sha256) original.receipts.add(objectHash([receipt.url, receipt.observedAt, receipt.sha256]));
      }
      verified.set(url, original);
    }
    for (const source of witnesses) if (source.sha256 !== original.sha256 && !original.receipts.has(objectHash([source.url, source.observedAt, source.sha256]))) throw new DailyRawInputError("daily_raw_archive_receipt_missing");
  }
}

export function dailyRawAssetFingerprint(input: CollectedDailyRawAsset) {
  // Receipt IDs remain durable in SQLite; a fresh unchanged HTTP receipt alone
  // does not force the same raw values to be re-written.
  const sources = new Map(input.sources.map(source => [source.key, source]));
  return objectHash([DAILY_RAW_COLLECTION_VERSION, input.asset, input.points.map(point => [point.day, ...([...marketMetrics, "fees", "revenue", "holders"] as const).map(metric => {
    const value = point[metric]; if (!value) return null;
    const source = sources.get(value.source);
    return [metric, value.value, value.state, value.at ?? null, source?.provider, source?.scope, source?.definition, source?.basis,
      value.witnesses?.map(witness => { const source = sources.get(witness.source); return [witness.value, witness.state, witness.at ?? null, source?.provider, source?.scope, source?.definition, source?.basis]; })];
  })])]);
}

/** Asset-local input failures are accounted for and do not starve later assets. */
export async function visitDailyRawAssets<T>(assets: T[], options: { hasTime: () => boolean; visit: (asset: T) => Promise<void>; failed: (asset: T, error: DailyRawInputError) => void }) {
  let attempted = 0;
  for (const asset of assets) {
    if (!options.hasTime()) break;
    attempted++;
    try { await options.visit(asset); }
    catch (error) { if (!(error instanceof DailyRawInputError)) throw error; options.failed(asset, error); }
  }
  return assets.length - attempted;
}
