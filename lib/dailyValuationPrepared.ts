import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Client, Row } from "@libsql/client";
import { eligibleCapital } from "./capitalEligibility";
import { historyIdentity } from "./dailyHistory";
import { dailyRawHash } from "./dailyRawData";
import { historyRead } from "./historyDatabase";
import { canonicalReadModelJSON, readModelMetadata, readModelRow, writeDailyReadModel } from "./dailyReadModelDatabase";
import { compactDailyHistory, type CompactHistoryData, type CompactHistoryEnvelope, type DailyHistoryVersion } from "./dailyValuationCompact";
import { calculateDailyValuation, dailyComparisonMetric, dailyValuationAsOf, DAILY_VALUATION_VERSION } from "./dailyValuation";
import { connectDailyValuationReader, DAILY_COMPARISON_TIMEOUT_MS, DailyValuationIdentityChanged, DailyValuationRevisionChanged, readDailyValuationHistoryFull, type DailyValuationCoin, type DailyValuationSnapshot } from "./dailyValuationRead";
import { comparisonReading, type ComparisonUnavailableReason, type ValuationComparisonMetric, type ValuationComparisonPage } from "./valuationComparison";
import type { CapitalBasis } from "./valuationMetrics";

export const DAILY_HISTORY_MODEL_NAMESPACE = "daily-history-v1";
interface HistoryMetadata {
  schema: 1; calculationVersion: string; assetId: number; slug: string; identity: string; assetRevision: number; asOf: string; eligible: boolean; rawRevision: string; points: number;
  summaries: Record<CapitalBasis, { pr: ValuationComparisonMetric; phr: ValuationComparisonMetric }>;
}
const convention = "Capital(D) / (daily flow(D) * 365); same UTC date; completed days; no carry-forward";
const missingTables = (error: unknown) => error instanceof Error && /no such table: (daily_read_models|daily_raw_asset_revisions)/.test(error.message);
const stamp = (coin: DailyValuationCoin, revision: number, asOf: string) => dailyRawHash([DAILY_VALUATION_VERSION, coin.slug, historyIdentity(coin), revision, asOf, eligibleCapital(coin)]);
function version(coin: DailyValuationCoin, snapshot: DailyValuationSnapshot, rawRevision: string, now: Date): DailyHistoryVersion {
  const { asOf, freshness } = dailyValuationAsOf(snapshot, now);
  return { schema: 3, calculationVersion: DAILY_VALUATION_VERSION, asset: { slug: coin.slug, identity: historyIdentity(coin), snapshotId: snapshot.publication?.published?.id ?? snapshot.updatedAt }, asOf, rawRevision, revenueDays: 1, freshness, convention };
}
function metadata(row: Row, coin: DailyValuationCoin, asOf: string): HistoryMetadata | null {
  if (row.metadata === null || row.metadata === undefined) return null;
  const value = readModelMetadata(row) as HistoryMetadata;
  return value.schema === 1 && value.calculationVersion === DAILY_VALUATION_VERSION && value.slug === coin.slug && value.identity === historyIdentity(coin)
    && value.assetId === Number(row.asset_id) && value.assetRevision === Number(row.asset_revision) && value.asOf === asOf && value.eligible === eligibleCapital(coin)
    && value.rawRevision === stamp(coin, Number(row.asset_revision), asOf) && row.model_revision === value.rawRevision ? value : null;
}
export const dailyHistoryModelCurrent = (row: Row, coin: DailyValuationCoin, asOf: string) => metadata(row, coin, asOf) !== null;
async function state(db: Client, coin: DailyValuationCoin, payload = false) {
  const result = await historyRead(db, { sql: `SELECT a.id asset_id,COALESCE(r.revision,0) asset_revision,m.revision model_revision,m.model_key,m.sha256,m.metadata,m.metadata_sha256,m.built_at${payload ? ",m.payload" : ""} FROM daily_raw_assets a LEFT JOIN daily_raw_asset_revisions r ON r.asset_id=a.id LEFT JOIN daily_read_models m ON m.namespace=? AND m.model_key=CAST(a.id AS TEXT) WHERE a.slug=? AND a.identity=?`, args: [DAILY_HISTORY_MODEL_NAMESPACE, coin.slug, historyIdentity(coin)] });
  return result.rows[0];
}
export async function prepareDailyValuationHistory(db: Client, options: {
  coin: DailyValuationCoin; snapshot: DailyValuationSnapshot; runId: string; minimumReserve?: number; now?: Date; dryRun?: boolean;
  publish?: (candidate: Parameters<typeof writeDailyReadModel>[1]) => ReturnType<typeof writeDailyReadModel>;
}) {
  const { coin, snapshot } = options, now = options.now ?? new Date(), { asOf } = dailyValuationAsOf(snapshot, now);
  let current: Row | undefined;
  try { current = await state(db, coin); } catch (error) {
    if (!options.dryRun || !missingTables(error)) throw error;
    try { current = (await historyRead(db, { sql: "SELECT a.id asset_id,COALESCE(r.revision,0) asset_revision FROM daily_raw_assets a LEFT JOIN daily_raw_asset_revisions r ON r.asset_id=a.id WHERE a.slug=? AND a.identity=?", args: [coin.slug, historyIdentity(coin)] })).rows[0]; }
    catch (error) { if (!missingTables(error)) throw error; current = (await historyRead(db, { sql: "SELECT id asset_id,0 asset_revision FROM daily_raw_assets WHERE slug=? AND identity=?", args: [coin.slug, historyIdentity(coin)] })).rows[0]; }
  }
  if (!current || coin.identityStatus !== "verified") return { status: "absent" as const, changed: false, estimatedWrites: 0, compressedBytes: 0, points: 0 };
  const prior = metadata(current, coin, asOf);
  if (prior) return { status: "current" as const, changed: false, estimatedWrites: 0, compressedBytes: 0, points: prior.points };
  const fdv = await readDailyValuationHistoryFull(db, { coin, snapshot, capital: "fdv", from: "1900-01-01", to: asOf, now });
  if (!fdv) return { status: "absent" as const, changed: false, estimatedWrites: 0, compressedBytes: 0, points: 0 };
  const sources = new Map(fdv.sources.map(source => [source.key, source]));
  const mcap = fdv.points.map(point => calculateDailyValuation({ point, sources, capital: "mcap", eligible: eligibleCapital(coin), completedThrough: asOf }));
  const data = compactDailyHistory(fdv.points, mcap, fdv.sources), rawRevision = stamp(coin, Number(current.asset_revision), asOf);
  const model: HistoryMetadata = { schema: 1, calculationVersion: DAILY_VALUATION_VERSION, assetId: Number(current.asset_id), slug: coin.slug, identity: historyIdentity(coin), assetRevision: Number(current.asset_revision), asOf, eligible: eligibleCapital(coin), rawRevision, points: data.points.length,
    summaries: { fdv: { pr: dailyComparisonMetric(fdv.points, "pr", asOf, false), phr: dailyComparisonMetric(fdv.points, "phr", asOf, false) }, mcap: { pr: dailyComparisonMetric(mcap, "pr", asOf, false), phr: dailyComparisonMetric(mcap, "phr", asOf, false) } } };
  if (options.dryRun) return { status: "dry-run" as const, changed: false, estimatedWrites: 5, compressedBytes: gzipSync(canonicalReadModelJSON(data), { level: 9 }).byteLength, points: data.points.length };
  const result = await (options.publish ?? (candidate => writeDailyReadModel(db, candidate)))({ runId: options.runId, minimumReserve: options.minimumReserve, now, namespace: DAILY_HISTORY_MODEL_NAMESPACE, key: String(current.asset_id), revision: rawRevision, json: data, metadata: model, expectedRaw: { assetId: Number(current.asset_id), revision: Number(current.asset_revision) } });
  return { status: "prepared" as const, ...result, points: data.points.length };
}
export async function readDailyHistoryVersion(db: Client, options: { coin: DailyValuationCoin; snapshot: DailyValuationSnapshot; expectedIdentity?: string; now?: Date; onReadModel?: (mode: "prepared" | "raw-fallback") => void }): Promise<DailyHistoryVersion | null> {
  const { coin, snapshot } = options, now = options.now ?? new Date();
  if (options.expectedIdentity && options.expectedIdentity !== historyIdentity(coin)) throw new DailyValuationIdentityChanged();
  if (coin.identityStatus !== "verified") return null;
  try { const current = await state(db, coin); if (!current) return null; options.onReadModel?.(metadata(current, coin, dailyValuationAsOf(snapshot, now).asOf) ? "prepared" : "raw-fallback"); return version(coin, snapshot, stamp(coin, Number(current.asset_revision), dailyValuationAsOf(snapshot, now).asOf), now); }
  catch (error) {
    if (!missingTables(error)) throw error;
    options.onReadModel?.("raw-fallback");
    const raw = await readDailyValuationHistoryFull(db, { coin, snapshot, capital: "fdv", from: "1900-01-01", to: dailyValuationAsOf(snapshot, now).asOf, now });
    return raw ? version(coin, snapshot, raw.rawRevision, now) : null;
  }
}
export async function readCompactDailyHistory(db: Client, options: { coin: DailyValuationCoin; snapshot: DailyValuationSnapshot; expectedIdentity?: string; expectedRevision?: string; now?: Date; onReadModel?: (mode: "prepared" | "raw-fallback") => void }): Promise<CompactHistoryEnvelope | null> {
  const { coin, snapshot } = options, now = options.now ?? new Date(), { asOf } = dailyValuationAsOf(snapshot, now);
  if (options.expectedIdentity && options.expectedIdentity !== historyIdentity(coin)) throw new DailyValuationIdentityChanged();
  if (coin.identityStatus !== "verified") return null;
  let current: Row | undefined;
  try { current = await state(db, coin, true); } catch (error) { if (!missingTables(error)) throw error; }
  const ready = current && metadata(current, coin, asOf);
  let rawRevision = current ? stamp(coin, Number(current.asset_revision), asOf) : "", data: CompactHistoryData | undefined;
  if (ready) {
    options.onReadModel?.("prepared");
    if (options.expectedRevision && options.expectedRevision !== rawRevision) throw new DailyValuationRevisionChanged();
    const model = readModelRow(current!);
    return { ...version(coin, snapshot, rawRevision, now), encoding: "gzip-base64", sha256: model.sha256, payload: Buffer.from(model.payload).toString("base64") };
  }
  options.onReadModel?.("raw-fallback");
  const raw = await readDailyValuationHistoryFull(db, { coin, snapshot, capital: "fdv", from: "1900-01-01", to: asOf, now });
  if (!raw) return null;
  // A fresh raw read must not be labelled with a revision acquired before its data.
  if (current) { const after = await state(db, coin); if (!after || after.asset_revision !== current.asset_revision) throw new DailyValuationRevisionChanged(); }
  rawRevision ||= raw.rawRevision;
  if (options.expectedRevision && options.expectedRevision !== rawRevision) throw new DailyValuationRevisionChanged();
  const sources = new Map(raw.sources.map(source => [source.key, source]));
  data = compactDailyHistory(raw.points, raw.points.map(point => calculateDailyValuation({ point, sources, capital: "mcap", eligible: eligibleCapital(coin), completedThrough: asOf })), raw.sources);
  const json = canonicalReadModelJSON(data);
  return { ...version(coin, snapshot, rawRevision, now), encoding: "gzip-base64", sha256: createHash("sha256").update(json).digest("hex"), payload: gzipSync(json, { level: 9 }).toString("base64") };
}
/** One metadata-only SELECT: never downloads history blobs or scans 366 daily rows per coin. */
export async function readPreparedDailyComparisonBatch(options: { coins: DailyValuationCoin[]; capital: CapitalBasis; snapshot: DailyValuationSnapshot; db?: Client; now?: Date }): Promise<ValuationComparisonPage> {
  const { coins, capital, snapshot } = options, now = options.now ?? new Date(), period = dailyValuationAsOf(snapshot, now);
  if (coins.length > 200 || new Set(coins.map(coin => coin.slug)).size !== coins.length || !["fdv", "mcap"].includes(capital)) throw Error("daily_valuation_invalid_page");
  const db = options.db ?? connectDailyValuationReader(), rows: ValuationComparisonPage["rows"] = Object.create(null);
  const page: ValuationComparisonPage = { schema: 1, capital, revenueDays: 1, asOf: period.asOf, baseline: period.baseline, rows };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async () => {
      let result: Row[] = [];
      if (coins.length) try {
        result = (await historyRead(db, { sql: "SELECT a.id asset_id,a.slug,COALESCE(r.revision,0) asset_revision,m.revision model_revision,m.metadata,m.metadata_sha256 FROM json_each(?) w LEFT JOIN daily_raw_assets a ON a.slug=json_extract(w.value,'$.slug') AND a.identity=json_extract(w.value,'$.identity') LEFT JOIN daily_raw_asset_revisions r ON r.asset_id=a.id LEFT JOIN daily_read_models m ON m.namespace=? AND m.model_key=CAST(a.id AS TEXT)", args: [JSON.stringify(coins.map(coin => ({ slug: coin.slug, identity: historyIdentity(coin) }))), DAILY_HISTORY_MODEL_NAMESPACE] })).rows;
      } catch (error) { if (!missingTables(error)) throw error; }
      const bySlug = new Map(result.filter(row => row.slug !== null).map(row => [String(row.slug), row]));
      const unavailable = (reason: ComparisonUnavailableReason) => ({ pr: { status: "unavailable" as const, validDays: 0, reason }, phr: { status: "unavailable" as const, validDays: 0, reason } });
      for (const coin of coins) {
        const row = bySlug.get(coin.slug);
        if (!eligibleCapital(coin) || coin.identityStatus !== "verified") { rows[coin.slug] = unavailable("missing_capital"); continue; }
        if (!row) { rows[coin.slug] = unavailable(result.length ? "not_collected" : "not_prepared"); continue; }
        const model = metadata(row, coin, period.asOf);
        if (!model) { rows[coin.slug] = unavailable("not_prepared"); continue; }
        const value = structuredClone(model.summaries[capital]);
        if (period.freshness.status === "stale") for (const metric of ["pr", "phr"] as const) value[metric] = { status: "unavailable", validDays: value[metric].validDays, reason: "stale_data" };
        rows[coin.slug] = value;
        if (["pr", "phr"].some(metric => comparisonReading(page, capital, coin.slug, metric as "pr" | "phr", now.getTime()).status === "invalid")) throw Error("daily_read_model_invalid_summary");
      }
      return page;
    };
    return await Promise.race([work(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error("daily_valuation_deadline_exceeded")), DAILY_COMPARISON_TIMEOUT_MS); })]);
  } finally { clearTimeout(timer); if (!options.db) db.close(); }
}
