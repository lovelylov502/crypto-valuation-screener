import type { Client, Row } from "@libsql/client";
import { eligibleCapital } from "./capitalEligibility";
import { historyIdentity, utcDay } from "./dailyHistory";
import { dailyRawObservationSources, extractDailyRawFundamentals, type CollectedDailyRawAsset } from "./dailyRawCollection";
import { dailyRawStateCode, mergeDailyRawCell, type DailyRawMetric, type DailyRawPoint, type DailyRawSource, type RawCell, type RawSourceMetadata } from "./dailyRawData";
import { dailyValuationAsOf, shiftValuationDay } from "./dailyValuation";
import { historyRead } from "./historyDatabase";
import { objectHash, validateSourceBundle, type SourceBundle } from "./sourceBundle";
import { checkArchiveUrl } from "./snapshotArchive";
import type { PublishedSnapshot } from "./publicationTypes";
import type { CoinRaw } from "./types";

const metrics = ["fees", "revenue", "holders"] as const;
type FinancialMetric = typeof metrics[number];
const state = () => ({ rows: 0, complete: 0, positive: 0, zero: 0, negative: 0, partial: 0, conflict: 0 });
export interface RecentDailyFinancials {
  publicationId: string; targetDay: string; from: string; to: string; assets: CollectedDailyRawAsset[];
  targetCoverage: Record<FinancialMetric, ReturnType<typeof state>>;
  sources: { metric: FinancialMetric; url: string; observedAt: string; sha256: string; archiveUrl: string }[];
}
/** Inputs must come from loadHistoryInputs: it verifies both pinned compressed archives. */
export function collectRecentDailyFinancials(options: {
  snapshot: { updatedAt: string; coins: CoinRaw[] }; bundle: SourceBundle; reference: PublishedSnapshot; recentDays?: number; slugs?: string[]; now?: Date;
}): RecentDailyFinancials {
  const { snapshot, bundle, reference } = options, recentDays = options.recentDays ?? 3;
  if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 14) throw Error("daily_financial_recent_days");
  if (!reference.rawBundleUrl || !/^[a-f0-9]{64}$/.test(reference.rawBundleSha256 ?? "")) throw Error("daily_financial_original_archive_required");
  checkArchiveUrl(reference.rawBundleUrl); validateSourceBundle(bundle);
  const targetDay = dailyValuationAsOf(snapshot, options.now).asOf, from = shiftValuationDay(targetDay, 1 - recentDays), to = [targetDay, shiftValuationDay(utcDay(Date.parse(bundle.asOf)), -1)].sort()[0];
  const selected = new Set(options.slugs ?? []);
  if (new Set(snapshot.coins.map(coin => coin.slug)).size !== snapshot.coins.length || [...selected].some(slug => !snapshot.coins.some(coin => coin.slug === slug))) throw Error("daily_financial_identity_selection");
  const targetCoverage = Object.fromEntries(metrics.map(metric => [metric, state()])) as RecentDailyFinancials["targetCoverage"], sources = new Map<string, RecentDailyFinancials["sources"][number]>();
  if (from > to) return { publicationId: reference.id, targetDay, from, to, assets: [], targetCoverage, sources: [] };
  const extracted = extractDailyRawFundamentals(bundle, reference.rawBundleUrl, undefined, { from, to });
  const assets: CollectedDailyRawAsset[] = [];
  for (const coin of snapshot.coins) {
    if (selected.size && !selected.has(coin.slug) || coin.identityStatus !== "verified" || !eligibleCapital(coin) || historyIdentity(coin) === "unlinked") continue;
    const points = extracted.series.get(coin.slug) ?? []; if (!points.length) continue;
    const used = new Set(points.flatMap(point => metrics.flatMap(metric => dailyRawObservationSources(point[metric]))));
    const refs = (extracted.sources.get(coin.slug) ?? []).filter(source => used.has(source.key));
    for (const source of refs) sources.set(objectHash([source.metric, source.url, source.observedAt, source.sha256]), { metric: source.metric as FinancialMetric, url: source.url, observedAt: source.observedAt, sha256: source.sha256, archiveUrl: reference.rawBundleUrl });
    for (const point of points) if (point.day === targetDay) for (const metric of metrics) {
      const cell = point[metric]; if (!cell) continue; const count = targetCoverage[metric]; count.rows++;
      if (cell.state === "complete") { count.complete++; if (cell.value! > 0) count.positive++; else if (cell.value === 0) count.zero++; else count.negative++; }
      else if (cell.state === "partial") count.partial++; else if (cell.state === "conflict") count.conflict++;
    }
    assets.push({ asset: { slug: coin.slug, identity: historyIdentity(coin) }, points, sources: refs });
  }
  const coins = new Map(snapshot.coins.map(coin => [coin.slug, coin]));
  assets.sort((a, b) => (coins.get(b.asset.slug)?.mcap ?? 0) - (coins.get(a.asset.slug)?.mcap ?? 0) || a.asset.slug.localeCompare(b.asset.slug));
  return { publicationId: reference.id, targetDay, from, to, assets, targetCoverage, sources: [...sources.values()] };
}
const oldCell = (row: Row | undefined, metric: FinancialMetric): RawCell => ({ value: row?.[metric] == null ? null : Number(row[metric]), state: Number(row?.[`${metric}_state`] ?? 0), sourceId: row?.[`${metric}_source`] == null ? null : Number(row[`${metric}_source`]), at: row?.[`${metric}_at`] == null ? null : String(row[`${metric}_at`]) });
const sourceMetadata = (source: DailyRawSource, id: number): RawSourceMetadata => ({ ...source, id, revisionOf: source.revisionOf ?? null });
/** Batch reads avoid one network query per asset; only potentially changed financial cells leave this planner. */
export async function planRecentDailyFinancials(db: Client, input: RecentDailyFinancials) {
  const assets: CollectedDailyRawAsset[] = []; let unchangedAssets = 0, unchangedCells = 0;
  for (let offset = 0; offset < input.assets.length; offset += 500) {
    const batch = input.assets.slice(offset, offset + 500), wanted = JSON.stringify(batch.map(item => item.asset));
    const rows = await historyRead(db, { sql: `SELECT a.id asset_id,a.slug,a.identity,d.day,${metrics.flatMap(metric => [`CAST(d.${metric} AS REAL) ${metric}`, `d.${metric}_state`, `d.${metric}_source`, `d.${metric}_at`]).join(",")} FROM json_each(?) w JOIN daily_raw_assets a ON a.slug=json_extract(w.value,'$.slug') AND a.identity=json_extract(w.value,'$.identity') JOIN daily_raw_days d ON d.asset_id=a.id AND d.day>=? AND d.day<=?`, args: [wanted, input.from, input.to] });
    const ids = [...new Set(rows.rows.flatMap(row => metrics.map(metric => row[`${metric}_source`])).filter(id => id !== null))];
    const refs = ids.length ? await historyRead(db, { sql: "SELECT s.*,r.url,r.observed_at,(SELECT source_key FROM daily_raw_sources WHERE id=s.revision_of) revision_key FROM daily_raw_sources s JOIN daily_raw_receipts r ON r.id=s.receipt_id WHERE s.id IN (SELECT value FROM json_each(?))", args: [JSON.stringify(ids)] }) : { rows: [] as Row[] };
    const metadata = new Map(refs.rows.map(row => [Number(row.id), { id: Number(row.id), key: String(row.source_key), metric: String(row.metric) as DailyRawMetric, provider: String(row.provider), url: String(row.url), observedAt: String(row.observed_at), scope: String(row.scope), definition: String(row.definition), basis: String(row.basis), revisionOf: row.revision_key === null ? null : String(row.revision_key) }]));
    const byDay = new Map(rows.rows.map(row => [JSON.stringify([row.slug, row.identity, row.day]), row]));
    for (const item of batch) {
      const byKey = new Map(item.sources.map((source, index) => [source.key, sourceMetadata(source, -1 - index)])), points: DailyRawPoint[] = [];
      for (const point of item.points) {
        const row = byDay.get(JSON.stringify([item.asset.slug, item.asset.identity, point.day])), changed: DailyRawPoint = { day: point.day };
        for (const metric of metrics) {
          const incoming = point[metric]; if (!incoming) continue;
          const previous = oldCell(row, metric), source = byKey.get(incoming.source);
          const candidate: RawCell = { value: incoming.state === "conflict" ? null : incoming.value, state: dailyRawStateCode(incoming.value, incoming.state), sourceId: source?.id ?? null, at: incoming.at ?? null };
          const merged = mergeDailyRawCell(previous, candidate, previous.sourceId === null ? undefined : metadata.get(previous.sourceId), source);
          // Same meaning/value retains the original receipt, avoiding receipt-only writes every publication.
          if (JSON.stringify(merged.cell) !== JSON.stringify(previous) || merged.kind || incoming.witnesses) changed[metric] = incoming;
          else unchangedCells++;
        }
        if (metrics.some(metric => changed[metric])) points.push(changed);
      }
      if (!points.length) { unchangedAssets++; continue; }
      const used = new Set(points.flatMap(point => metrics.flatMap(metric => dailyRawObservationSources(point[metric]))));
      assets.push({ asset: item.asset, points, sources: item.sources.filter(source => used.has(source.key)) });
    }
  }
  return { assets, unchangedAssets, unchangedCells };
}
export async function recentDailyFinancialCoverage(db: Client, input: RecentDailyFinancials) {
  const result = Object.fromEntries(metrics.map(metric => [metric, state()])) as RecentDailyFinancials["targetCoverage"];
  for (let offset = 0; offset < input.assets.length; offset += 500) {
    const counts = await historyRead(db, { sql: `SELECT ${metrics.flatMap(metric => [
      `SUM(CASE WHEN d.${metric}_state>0 THEN 1 ELSE 0 END) ${metric}_rows`,
      ...[["complete", "BETWEEN 1 AND 3"], ["positive", "=1"], ["zero", "=2"], ["negative", "=3"], ["partial", "=4"], ["conflict", "=5"]].map(([name, condition]) => `SUM(CASE WHEN d.${metric}_state ${condition} THEN 1 ELSE 0 END) ${metric}_${name}`),
    ]).join(",")} FROM json_each(?) w JOIN daily_raw_assets a ON a.slug=json_extract(w.value,'$.slug') AND a.identity=json_extract(w.value,'$.identity') JOIN daily_raw_days d ON d.asset_id=a.id AND d.day=?`, args: [JSON.stringify(input.assets.slice(offset, offset + 500).map(item => item.asset)), input.targetDay] });
    for (const metric of metrics) for (const key of Object.keys(result[metric]) as (keyof ReturnType<typeof state>)[]) result[metric][key] += Number(counts.rows[0]?.[`${metric}_${key}`] ?? 0);
  }
  return result;
}
