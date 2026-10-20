import type { Client, InStatement, ResultSet, Row, Transaction } from "@libsql/client";
import { eligibleCapital } from "./capitalEligibility";
import { historyIdentity } from "./dailyHistory";
import { DAILY_RAW_METRICS, DAILY_RAW_STATES, assertDailyRawDay, dailyRawHash, type DailyRawMetric, type DailyRawSource, type DailyRawStoredPoint } from "./dailyRawData";
import { connectHistory, historyDatabaseStats, historyRead } from "./historyDatabase";
import { DAILY_VALUATION_VERSION, calculateDailyValuation, dailyComparisonMetric, dailyValuationAsOf, type DailyValuationHistoryPoint } from "./dailyValuation";
import type { CoinRaw } from "./types";
import type { CapitalBasis } from "./valuationMetrics";
import type { ValuationComparisonMetric, ValuationComparisonPage } from "./valuationComparison";

export type { DailyValuationCell, DailyValuationHistoryPoint, DailyValuationRatio, DailyValuationReason } from "./dailyValuation";
export type DailyValuationCoin = Pick<CoinRaw, "slug" | "geckoId" | "cmcId" | "identityStatus" | "capitalExclusionReason">;
export interface DailyValuationSnapshot { updatedAt: string; publication?: { published?: { id: string } | null } }
export interface DailyValuationHistory {
  schema: 2; calculationVersion: typeof DAILY_VALUATION_VERSION; asset: { slug: string; identity: string; snapshotId: string };
  capital: CapitalBasis; revenueDays: 1; asOf: string; rawRevision: string; convention: string;
  freshness: ReturnType<typeof dailyValuationAsOf>["freshness"];
  points: DailyValuationHistoryPoint[]; sources: DailyRawSource[]; nextCursor: string | null;
}
export class DailyValuationRevisionChanged extends Error { constructor() { super("daily_valuation_revision_changed"); } }
export class DailyValuationIdentityChanged extends Error { constructor() { super("daily_valuation_identity_changed"); } }
const sharedScopes = new WeakMap<Client, string>();
export const connectDailyValuationReader = () => {
  const db = connectHistory(); sharedScopes.set(db, process.env.TURSO_DATABASE_URL!); return db;
};
const revisionSql = "SELECT id,estimated_writes,rows_written,days_written,accounting_version FROM daily_raw_runs ORDER BY id";
const sourceSql = "SELECT s.*,r.url,r.observed_at,r.sha256,r.archive_url,(SELECT source_key FROM daily_raw_sources WHERE id=s.revision_of) revision_key FROM daily_raw_sources s JOIN daily_raw_receipts r ON r.id=s.receipt_id";
const missingCell = () => ({ value: null, state: "missing" as const, source: "", at: null });
const cache = new Map<string, { expires: number; pr: ValuationComparisonMetric; phr: ValuationComparisonMetric }>();
const clientScopes = new WeakMap<Client, number>(); let nextClientScope = 0;
const CACHE_LIMIT = 4_000, CACHE_TTL = 120_000;
export const DAILY_COMPARISON_TIMEOUT_MS = 8_000;
export const DAILY_HISTORY_MAX_POINTS = 32_000;
const DETAIL_CACHE_POINTS = 64_000, DETAIL_CACHE_BYTES = 32 * 1024 * 1024;
interface DetailSnapshot { hint: string; revision: string; found: boolean; points: DailyValuationHistoryPoint[]; sources: DailyRawSource[]; expires: number; bytes: number }
const detailCache = new Map<string, DetailSnapshot>();
let detailPoints = 0, detailBytes = 0;

function databaseScope(db: Client) {
  if (sharedScopes.has(db)) return sharedScopes.get(db)!;
  if (!clientScopes.has(db)) clientScopes.set(db, ++nextClientScope);
  return `injected:${clientScopes.get(db)}`;
}
const revisionValue = (result: Pick<ResultSet, "rows" | "columns">) => dailyRawHash([DAILY_VALUATION_VERSION, result.rows.map(row => result.columns.map(column => row[column]))]);

export async function readDailyValuationRevision(db: Client) {
  return revisionValue(await historyRead(db, revisionSql));
}
function source(row: Row): DailyRawSource {
  return { key: String(row.source_key), metric: String(row.metric) as DailyRawMetric, provider: String(row.provider), url: String(row.url), observedAt: String(row.observed_at), sha256: String(row.sha256), ...(row.archive_url === null ? {} : { archiveUrl: String(row.archive_url) }), scope: String(row.scope), definition: String(row.definition), basis: String(row.basis), ...(row.revision_key === null ? {} : { revisionOf: String(row.revision_key) }) };
}
function assertCapital(capital: string): asserts capital is CapitalBasis { if (capital !== "fdv" && capital !== "mcap") throw Error("daily_valuation_invalid_capital"); }
function linked(coin: DailyValuationCoin) { return coin.identityStatus === "verified" && historyIdentity(coin) !== "unlinked"; }
function cacheSet(key: string, value: { pr: ValuationComparisonMetric; phr: ValuationComparisonMetric }) {
  cache.delete(key); cache.set(key, { ...value, expires: Date.now() + CACHE_TTL });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}
function detailDelete(key: string) {
  const old = detailCache.get(key); if (!old) return;
  detailPoints -= old.points.length; detailBytes -= old.bytes; detailCache.delete(key);
}
function detailSet(key: string, value: DetailSnapshot) {
  detailDelete(key);
  if (value.bytes > DETAIL_CACHE_BYTES) return;
  detailCache.set(key, value); detailPoints += value.points.length; detailBytes += value.bytes;
  while (detailPoints > DETAIL_CACHE_POINTS || detailBytes > DETAIL_CACHE_BYTES || detailCache.size > 32) detailDelete(detailCache.keys().next().value!);
}
async function transactionRead(db: Client, tx: Transaction, statement: InStatement) {
  const stats = historyDatabaseStats(db); stats.readRequests++;
  const result = await tx.execute(statement); stats.rowsReturned += result.rows.length; return result;
}
function rowPoint(row: Row, sources: Map<number, { owner: number; value: DailyRawSource }>): DailyRawStoredPoint {
  return { day: String(row.day), ...Object.fromEntries(DAILY_RAW_METRICS.map(metric => {
    if (row[`${metric}_state`] === undefined) return [metric, missingCell()];
    const id = row[`${metric}_source`], entry = id === null ? undefined : sources.get(Number(id));
    if (id !== null && (!entry || entry.owner !== Number(row.asset_id) || entry.value.metric !== metric)) throw Error("daily_valuation_invalid_source_reference");
    return [metric, { value: row[metric] === null ? null : Number(row[metric]), state: DAILY_RAW_STATES[Number(row[`${metric}_state`])], source: entry?.value.key ?? "", at: row[`${metric}_at`] === null ? null : String(row[`${metric}_at`]) }];
  })) } as DailyRawStoredPoint;
}

/** One identity/date seek batch for a page; never queries the full daily history table. */
export async function readDailyComparisonBatch(options: {
  coins: DailyValuationCoin[]; capital: CapitalBasis; snapshot: DailyValuationSnapshot; db?: Client; now?: Date;
}): Promise<ValuationComparisonPage> {
  const { coins, capital, snapshot } = options, now = options.now ?? new Date(); assertCapital(capital);
  if (coins.length > 200 || new Set(coins.map(coin => coin.slug)).size !== coins.length) throw Error("daily_valuation_invalid_page");
  const period = dailyValuationAsOf(snapshot, now), rows: ValuationComparisonPage["rows"] = Object.create(null);
  const empty = (reason: "not_collected" | "missing_capital" | "stale_data") => ({ status: "unavailable" as const, validDays: 0, reason });
  const candidates = coins.filter(coin => linked(coin) && eligibleCapital(coin));
  for (const coin of coins) if (!candidates.includes(coin)) rows[coin.slug] = { pr: empty(period.freshness.reason ?? "missing_capital"), phr: empty(period.freshness.reason ?? "missing_capital") };
  const page: ValuationComparisonPage = { schema: 1, capital, revenueDays: 1, asOf: period.asOf, baseline: period.baseline, rows };
  if (!candidates.length) return page;
  const db = options.db ?? connectDailyValuationReader();
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
    const scope = databaseScope(db);
    let revision = await readDailyValuationRevision(db);
    const keyFor = (coin: DailyValuationCoin) => dailyRawHash([scope, revision, period.asOf, period.freshness.status, capital, coin.slug, historyIdentity(coin), true]);
    const cached = candidates.map(coin => cache.get(keyFor(coin)));
    if (cached.every(value => value && value.expires > Date.now())) {
      const after = await readDailyValuationRevision(db);
      if (expired) throw Error("daily_valuation_deadline_exceeded");
      if (after === revision) {
        candidates.forEach((coin, index) => { const value = cached[index]!; rows[coin.slug] = structuredClone({ pr: value.pr, phr: value.phr }); });
        return page;
      }
      revision = after;
    }
    const computed = new Map<string, { pr: ValuationComparisonMetric; phr: ValuationComparisonMetric }>();
    // A cold/dirty page is one coherent raw-row SELECT, never cached/fresh mixtures.
    {
      const selected = [capital, "revenue", "holders"] as const;
      const fields = selected.flatMap(metric => [`CAST(d.${metric} AS REAL) ${metric}`, `d.${metric}_state`, `d.${metric}_source`, `d.${metric}_at`]).join(",");
      const result = await historyRead(db, { sql: `SELECT a.id asset_id,a.slug,a.identity,d.day,${fields} FROM json_each(?) w CROSS JOIN daily_raw_assets a ON a.slug=json_extract(w.value,'$.slug') AND a.identity=json_extract(w.value,'$.identity') CROSS JOIN daily_raw_days d ON d.asset_id=a.id AND d.day>=? AND d.day<=? ORDER BY a.id,d.day`, args: [JSON.stringify(candidates.map(coin => ({ slug: coin.slug, identity: historyIdentity(coin) }))), period.baseline.from, period.asOf] });
      if (result.rows.length > candidates.length * 366) throw Error("daily_valuation_invalid_day_count");
      const ids = [...new Set(result.rows.flatMap(row => selected.map(metric => row[`${metric}_source`])).filter(id => id !== null))];
      const receipts = ids.length ? (await historyRead(db, { sql: `${sourceSql} WHERE s.id IN (SELECT value FROM json_each(?))`, args: [JSON.stringify(ids)] })).rows : [];
      const sources = new Map(receipts.map(row => [Number(row.id), { owner: Number(row.asset_id), value: source(row) }])), byKey = new Map([...sources.values()].map(entry => [entry.value.key, entry.value]));
      const points = new Map<string, DailyValuationHistoryPoint[]>();
      for (const row of result.rows) {
        const slug = String(row.slug), list = points.get(slug) ?? [];
        list.push(calculateDailyValuation({ point: rowPoint(row, sources), sources: byKey, capital, eligible: true, completedThrough: period.asOf })); points.set(slug, list);
      }
      for (const coin of candidates) {
        const history = points.get(coin.slug) ?? [];
        computed.set(coin.slug, { pr: dailyComparisonMetric(history, "pr", period.asOf, period.freshness.status === "stale"), phr: dailyComparisonMetric(history, "phr", period.asOf, period.freshness.status === "stale") });
      }
    }
    const unchanged = await readDailyValuationRevision(db) === revision;
    if (expired) throw Error("daily_valuation_deadline_exceeded");
    for (const coin of candidates) {
      const value = computed.get(coin.slug)!;
      if (unchanged) cacheSet(keyFor(coin), value);
      rows[coin.slug] = structuredClone(value);
    }
    return page;
    })();
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; reject(Error("daily_valuation_deadline_exceeded")); }, DAILY_COMPARISON_TIMEOUT_MS); })]);
  } finally { clearTimeout(timer); if (!options.db) db.close(); }
}

/** Cursor/limit do not alter this token: it covers the complete requested asset range. */
export async function readDailyValuationHistory(db: Client, options: {
  coin: DailyValuationCoin; snapshot: DailyValuationSnapshot; capital: CapitalBasis;
  from?: string; to?: string; after?: string; limit?: number; expectedIdentity?: string; expectedRevision?: string; now?: Date;
}): Promise<DailyValuationHistory | null> {
  const { coin, snapshot, capital } = options, now = options.now ?? new Date(); assertCapital(capital);
  const identity = historyIdentity(coin);
  if (options.expectedIdentity && options.expectedIdentity !== identity) throw new DailyValuationIdentityChanged();
  if (!linked(coin)) return null;
  const period = dailyValuationAsOf(snapshot, now);
  for (const day of [options.from, options.to, options.after]) if (day) assertDailyRawDay(day);
  const to = options.to && options.to < period.asOf ? options.to : period.asOf, from = options.from ?? "0000-01-01";
  if (options.to && from > options.to) throw Error("daily_valuation_invalid_range");
  const limit = options.limit ?? 1000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw Error("daily_valuation_invalid_page_limit");
  const scope = [DAILY_VALUATION_VERSION, coin.slug, identity, from, to, period.asOf, capital, eligibleCapital(coin)];
  const key = dailyRawHash([databaseScope(db), scope]), hint = await readDailyValuationRevision(db);
  let entry = detailCache.get(key);
  if (!entry || entry.expires <= Date.now() || entry.hint !== hint) {
    const tx = await db.transaction("read");
    try {
      const insideHint = revisionValue(await transactionRead(db, tx, revisionSql));
      const fields = DAILY_RAW_METRICS.flatMap(metric => [`CAST(d.${metric} AS REAL) ${metric}`, `d.${metric}_state`, `d.${metric}_source`, `d.${metric}_at`]).join(",");
      const data = await transactionRead(db, tx, { sql: `SELECT a.id asset_id,d.day,${fields} FROM daily_raw_assets a LEFT JOIN daily_raw_days d ON d.asset_id=a.id AND d.day>=? AND d.day<=? WHERE a.slug=? AND a.identity=? ORDER BY d.day LIMIT ${DAILY_HISTORY_MAX_POINTS + 1}`, args: [from, to, coin.slug, identity] });
      const rawRows = data.rows.filter(row => row.day !== null);
      if (rawRows.length > DAILY_HISTORY_MAX_POINTS) throw Error("daily_valuation_history_range_too_large");
      const ids = [...new Set(rawRows.flatMap(row => DAILY_RAW_METRICS.map(metric => row[`${metric}_source`])).filter(id => id !== null))];
      const receiptRows = ids.length ? (await transactionRead(db, tx, { sql: `${sourceSql} WHERE s.id IN (SELECT value FROM json_each(?)) ORDER BY s.id`, args: [JSON.stringify(ids)] })).rows : [];
      const byId = new Map(receiptRows.map(row => [Number(row.id), { owner: Number(row.asset_id), value: source(row) }])), sources = [...byId.values()].map(item => item.value), byKey = new Map(sources.map(item => [item.key, item]));
      const rawPoints = rawRows.map(row => rowPoint(row, byId));
      const revision = dailyRawHash([scope, data.rows.length > 0, rawPoints, receiptRows.map(row => [row.source_key, row.content_hash])]);
      const points = rawPoints.map(point => calculateDailyValuation({ point, sources: byKey, capital, eligible: eligibleCapital(coin), completedThrough: period.asOf }));
      await tx.commit();
      entry = { hint: insideHint, revision, found: data.rows.length > 0, points, sources, expires: Date.now() + CACHE_TTL, bytes: Buffer.byteLength(JSON.stringify({ revision, points, sources })) + 512 };
      detailSet(key, entry);
    } finally { tx.close(); }
  }
  if (options.expectedRevision && options.expectedRevision !== entry.revision) throw new DailyValuationRevisionChanged();
  if (!entry.found) return null;
  const available = entry.points.filter(point => !options.after || point.day > options.after), points = available.slice(0, limit);
  const sourceKeys = new Set(points.flatMap(point => DAILY_RAW_METRICS.map(metric => point[metric].source)));
  return { schema: 2, calculationVersion: DAILY_VALUATION_VERSION, asset: { slug: coin.slug, identity, snapshotId: snapshot.publication?.published?.id ?? snapshot.updatedAt }, capital, revenueDays: 1, asOf: period.asOf, rawRevision: entry.revision, freshness: period.freshness, convention: "Capital(D) / (daily flow(D) * 365); same UTC date; completed days; no carry-forward", points: structuredClone(points), sources: structuredClone(entry.sources.filter(item => sourceKeys.has(item.key))), nextCursor: available.length > limit ? points.at(-1)!.day : null };
}
