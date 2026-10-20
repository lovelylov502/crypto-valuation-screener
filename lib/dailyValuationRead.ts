import type { Client, Row } from "@libsql/client";
import { eligibleCapital } from "./capitalEligibility";
import { historyIdentity } from "./dailyHistory";
import { DAILY_RAW_METRICS, DAILY_RAW_STATES, assertDailyRawDay, dailyRawHash, type DailyRawMetric, type DailyRawSource, type DailyRawStoredPoint } from "./dailyRawData";
import { readDailyRaw } from "./dailyRawDatabase";
import { connectHistory, historyRead } from "./historyDatabase";
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
export const connectDailyValuationReader = () => connectHistory();
const revisionSql = "SELECT id,estimated_writes,rows_written,days_written,accounting_version FROM daily_raw_runs ORDER BY id";
const sourceSql = "SELECT s.*,r.url,r.observed_at,r.sha256,r.archive_url,(SELECT source_key FROM daily_raw_sources WHERE id=s.revision_of) revision_key FROM daily_raw_sources s JOIN daily_raw_receipts r ON r.id=s.receipt_id";
const missingCell = () => ({ value: null, state: "missing" as const, source: "", at: null });
const cache = new Map<string, { expires: number; pr: ValuationComparisonMetric; phr: ValuationComparisonMetric }>();
const clientScopes = new WeakMap<Client, number>(); let nextClientScope = 0;
const CACHE_LIMIT = 4_000, CACHE_TTL = 120_000;
export const DAILY_COMPARISON_TIMEOUT_MS = 8_000;

export async function readDailyValuationRevision(db: Client) {
  const result = await historyRead(db, revisionSql);
  return dailyRawHash([DAILY_VALUATION_VERSION, result.rows.map(row => result.columns.map(column => row[column]))]);
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
    let scope: string;
    if (options.db) { if (!clientScopes.has(db)) clientScopes.set(db, ++nextClientScope); scope = `injected:${clientScopes.get(db)}`; }
    else scope = process.env.TURSO_DATABASE_URL!;
    const revision = await readDailyValuationRevision(db), keys = new Map(candidates.map(coin => [coin.slug, dailyRawHash([scope, revision, period.asOf, period.freshness.status, capital, coin.slug, historyIdentity(coin), true])]));
    const pending = candidates.filter(coin => { const found = cache.get(keys.get(coin.slug)!); if (found && found.expires > Date.now()) { rows[coin.slug] = structuredClone({ pr: found.pr, phr: found.phr }); return false; } return true; });
    const computed = new Map<string, { pr: ValuationComparisonMetric; phr: ValuationComparisonMetric }>();
    if (pending.length) {
      const selected = [capital, "revenue", "holders"] as const;
      const fields = selected.flatMap(metric => [`CAST(d.${metric} AS REAL) ${metric}`, `d.${metric}_state`, `d.${metric}_source`, `d.${metric}_at`]).join(",");
      const result = await historyRead(db, { sql: `SELECT a.id asset_id,a.slug,a.identity,d.day,${fields} FROM json_each(?) w CROSS JOIN daily_raw_assets a ON a.slug=json_extract(w.value,'$.slug') AND a.identity=json_extract(w.value,'$.identity') CROSS JOIN daily_raw_days d ON d.asset_id=a.id AND d.day>=? AND d.day<=? ORDER BY a.id,d.day`, args: [JSON.stringify(pending.map(coin => ({ slug: coin.slug, identity: historyIdentity(coin) }))), period.baseline.from, period.asOf] });
      if (result.rows.length > pending.length * 366) throw Error("daily_valuation_invalid_day_count");
      const ids = [...new Set(result.rows.flatMap(row => selected.map(metric => row[`${metric}_source`])).filter(id => id !== null))];
      const receipts = ids.length ? (await historyRead(db, { sql: `${sourceSql} WHERE s.id IN (SELECT value FROM json_each(?))`, args: [JSON.stringify(ids)] })).rows : [];
      const sources = new Map(receipts.map(row => [Number(row.id), { owner: Number(row.asset_id), value: source(row) }])), byKey = new Map([...sources.values()].map(entry => [entry.value.key, entry.value]));
      const points = new Map<string, DailyValuationHistoryPoint[]>();
      for (const row of result.rows) {
        const slug = String(row.slug), list = points.get(slug) ?? [];
        list.push(calculateDailyValuation({ point: rowPoint(row, sources), sources: byKey, capital, eligible: true, completedThrough: period.asOf })); points.set(slug, list);
      }
      for (const coin of pending) {
        const history = points.get(coin.slug) ?? [];
        computed.set(coin.slug, { pr: dailyComparisonMetric(history, "pr", period.asOf, period.freshness.status === "stale"), phr: dailyComparisonMetric(history, "phr", period.asOf, period.freshness.status === "stale") });
      }
    }
    if (await readDailyValuationRevision(db) !== revision) throw new DailyValuationRevisionChanged();
    if (expired) throw Error("daily_valuation_deadline_exceeded");
    for (const [slug, value] of computed) { cacheSet(keys.get(slug)!, value); rows[slug] = structuredClone(value); }
    return page;
    })();
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; reject(Error("daily_valuation_deadline_exceeded")); }, DAILY_COMPARISON_TIMEOUT_MS); })]);
  } finally { clearTimeout(timer); if (!options.db) db.close(); }
}

/** Paginated MAX reader; every page is bound to the same raw revision and token identity. */
export async function readDailyValuationHistory(db: Client, options: {
  coin: DailyValuationCoin; snapshot: DailyValuationSnapshot; capital: CapitalBasis;
  from?: string; to?: string; after?: string; limit?: number; expectedIdentity?: string; expectedRevision?: string; now?: Date;
}): Promise<DailyValuationHistory | null> {
  const { coin, snapshot, capital } = options, now = options.now ?? new Date(); assertCapital(capital);
  const identity = historyIdentity(coin);
  if (options.expectedIdentity && options.expectedIdentity !== identity) throw new DailyValuationIdentityChanged();
  if (!linked(coin)) return null;
  const period = dailyValuationAsOf(snapshot, now), revision = await readDailyValuationRevision(db);
  if (options.expectedRevision && options.expectedRevision !== revision) throw new DailyValuationRevisionChanged();
  for (const day of [options.from, options.to, options.after]) if (day) assertDailyRawDay(day);
  const to = options.to && options.to < period.asOf ? options.to : period.asOf, from = options.from ?? "0000-01-01";
  if (options.to && from > options.to) throw Error("daily_valuation_invalid_range");
  const raw = await readDailyRaw(db, { asset: { slug: coin.slug, identity }, from, to, after: options.after, limit: options.limit });
  if (!raw) { if (await readDailyValuationRevision(db) !== revision) throw new DailyValuationRevisionChanged(); return null; }
  const sources = new Map(raw.sources.map(item => [item.key, item])), points = raw.points.map(point => calculateDailyValuation({ point, sources, capital, eligible: eligibleCapital(coin), completedThrough: period.asOf }));
  if (await readDailyValuationRevision(db) !== revision) throw new DailyValuationRevisionChanged();
  return { schema: 2, calculationVersion: DAILY_VALUATION_VERSION, asset: { slug: coin.slug, identity, snapshotId: snapshot.publication?.published?.id ?? snapshot.updatedAt }, capital, revenueDays: 1, asOf: period.asOf, rawRevision: revision, freshness: period.freshness, convention: "Capital(D) / (daily flow(D) * 365); same UTC date; completed days; no carry-forward", points, sources: raw.sources, nextCursor: raw.nextCursor };
}
