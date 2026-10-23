import type { Client, InStatement, Row, Transaction } from "@libsql/client";
import { HISTORY_STORAGE_LIMIT, HISTORY_WRITE_LIMIT, HistoryBudgetExceeded, historyRead, historyReadBatch, storageBytes } from "./historyDatabase";
import { DAILY_RAW_METRICS, DAILY_RAW_STATES, assertDailyRawAsset, assertDailyRawDay, assertDailyRawObservation, assertDailyRawSource, dailyRawHash, dailyRawStateCode, mergeDailyRawCell, type DailyRawAsset, type DailyRawCheckpoint, type DailyRawMetric, type DailyRawPoint, type DailyRawSource, type DailyRawStoredPoint, type RawCell, type RawSourceMetadata } from "./dailyRawData";

export type { DailyRawAsset, DailyRawCheckpoint, DailyRawMetric, DailyRawObservation, DailyRawPoint, DailyRawSource, DailyRawStoredObservation, DailyRawStoredPoint, DailyRawStoredState, DailyRawWitness } from "./dailyRawData";
export const DAILY_RAW_SCHEMA = 2;
export const DAILY_RAW_ACCOUNTING_VERSION = "raw-table-weights-v1";
const LEGACY_ACCOUNTING_VERSION = "raw-double-v1";
type RawAccountingVersion = typeof DAILY_RAW_ACCOUNTING_VERSION | typeof LEGACY_ACCOUNTING_VERSION;
interface RawWriteCounts { plain: number; indexed: number }
const estimatedCost = (counts: RawWriteCounts, version: RawAccountingVersion) => version === LEGACY_ACCOUNTING_VERSION ? (counts.plain + counts.indexed + 1) * 2 + 4 : counts.plain + counts.indexed * 2 + 4;
const CELL_COLUMNS = DAILY_RAW_METRICS.flatMap(metric => [metric, `${metric}_state`, `${metric}_source`, `${metric}_at`]);
const COLUMNS = ["asset_id", "day", ...CELL_COLUMNS];
const sourceSelect = `SELECT s.*,r.url,r.observed_at,r.sha256,r.archive_url,(SELECT source_key FROM daily_raw_sources WHERE id=s.revision_of) AS revision_key FROM daily_raw_sources s JOIN daily_raw_receipts r ON r.id=s.receipt_id`;
const sourceFingerprint = (assetId: number, source: DailyRawSource) => dailyRawHash([assetId, source.metric, source.provider, source.url, source.observedAt, source.sha256.toLowerCase(), source.archiveUrl ?? null, source.scope, source.definition, source.basis, source.revisionOf ?? null]);
const revisionKey = (assetId: number, day: string, metric: DailyRawMetric, kind: string, candidate: RawCell) => dailyRawHash([assetId, day, metric, kind, candidate.value, candidate.state, candidate.sourceId, candidate.at]);
const unmeteredLocalClients = new WeakSet<Client>();
export interface DailyRawInitializeOptions { unmeteredLocal?: boolean }

/** Additive migration: the existing history tables and reader remain untouched. */
export async function initializeDailyRaw(db: Client, options: DailyRawInitializeOptions = {}) {
  const local = options.unmeteredLocal === true;
  if (local && db.protocol !== "file") throw Error("Unmetered daily raw staging requires a local file client");
  if (local) {
    const existing = await db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('history_budget','daily_raw_runs')");
    if (existing.rows.some(row => String(row.sql).includes("8000000"))) throw Error("Unmetered daily raw staging requires a fresh local database");
  }
  await db.batch([
    `CREATE TABLE IF NOT EXISTS history_budget(month TEXT PRIMARY KEY,reserved INTEGER NOT NULL${local ? "" : " CHECK(reserved<=8000000)"}) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS daily_raw_assets(id INTEGER PRIMARY KEY,slug TEXT NOT NULL,identity TEXT NOT NULL,UNIQUE(slug,identity))`,
    `CREATE TABLE IF NOT EXISTS daily_raw_receipts(id INTEGER PRIMARY KEY,receipt_key TEXT NOT NULL UNIQUE,url TEXT NOT NULL,observed_at TEXT NOT NULL,sha256 TEXT NOT NULL,archive_url TEXT)`,
    `CREATE TABLE IF NOT EXISTS daily_raw_sources(id INTEGER PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,asset_id INTEGER NOT NULL REFERENCES daily_raw_assets(id),receipt_id INTEGER NOT NULL REFERENCES daily_raw_receipts(id),metric TEXT NOT NULL CHECK(metric IN ('price','mcap','fdv','fees','revenue','holders')),provider TEXT NOT NULL,scope TEXT NOT NULL,definition TEXT NOT NULL,basis TEXT NOT NULL,revision_of INTEGER REFERENCES daily_raw_sources(id),content_hash TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS daily_raw_days(asset_id INTEGER NOT NULL REFERENCES daily_raw_assets(id),day TEXT NOT NULL,
      ${DAILY_RAW_METRICS.map(metric => `${metric} REAL,${metric}_state INTEGER NOT NULL DEFAULT 0 CHECK(${metric}_state BETWEEN 0 AND 5),${metric}_source INTEGER REFERENCES daily_raw_sources(id),${metric}_at TEXT`).join(",")},
      ${DAILY_RAW_METRICS.map(metric => `CHECK((${metric}_state IN (0,5) AND ${metric} IS NULL) OR (${metric}_state=1 AND ${metric} IS NOT NULL AND ${metric}>0) OR (${metric}_state=2 AND ${metric} IS NOT NULL AND ${metric}=0) OR (${metric}_state=3 AND ${metric} IS NOT NULL AND ${metric}<0) OR ${metric}_state=4),CHECK(${metric}_state=0 OR ${metric}_source IS NOT NULL)`).join(",")},
      PRIMARY KEY(asset_id,day)) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS daily_raw_revisions(id INTEGER PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,asset_id INTEGER NOT NULL REFERENCES daily_raw_assets(id),day TEXT NOT NULL,metric TEXT NOT NULL,kind TEXT NOT NULL,previous_value REAL,previous_state INTEGER NOT NULL,previous_source INTEGER REFERENCES daily_raw_sources(id),previous_at TEXT,next_value REAL,next_state INTEGER NOT NULL,next_source INTEGER REFERENCES daily_raw_sources(id),next_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS daily_raw_runs(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,max_estimated_writes INTEGER NOT NULL CHECK(max_estimated_writes>=1${local ? "" : " AND max_estimated_writes<=8000000"}),estimated_writes INTEGER NOT NULL DEFAULT 0 CHECK(estimated_writes<=max_estimated_writes),rows_written INTEGER NOT NULL DEFAULT 0,days_written INTEGER NOT NULL DEFAULT 0,accounting_version TEXT NOT NULL DEFAULT '${LEGACY_ACCOUNTING_VERSION}') WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS daily_raw_checkpoints(run_id TEXT NOT NULL REFERENCES daily_raw_runs(id),checkpoint_key TEXT NOT NULL,cursor TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('running','complete')),rows_written INTEGER NOT NULL,days_written INTEGER NOT NULL,PRIMARY KEY(run_id,checkpoint_key)) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS daily_raw_asset_revisions(asset_id INTEGER PRIMARY KEY REFERENCES daily_raw_assets(id),revision INTEGER NOT NULL CHECK(revision>=1)) WITHOUT ROWID`,
    `CREATE TRIGGER IF NOT EXISTS daily_raw_asset_immutable BEFORE UPDATE OF slug,identity ON daily_raw_assets BEGIN SELECT RAISE(ABORT,'daily_raw_asset_identity_immutable'); END`,
    `CREATE TRIGGER IF NOT EXISTS daily_raw_source_immutable BEFORE UPDATE ON daily_raw_sources BEGIN SELECT RAISE(ABORT,'daily_raw_source_immutable'); END`,
    `CREATE TRIGGER IF NOT EXISTS daily_raw_receipt_immutable BEFORE UPDATE ON daily_raw_receipts BEGIN SELECT RAISE(ABORT,'daily_raw_receipt_immutable'); END`,
    `CREATE TRIGGER IF NOT EXISTS daily_raw_run_allowance_immutable BEFORE UPDATE OF max_estimated_writes ON daily_raw_runs BEGIN SELECT RAISE(ABORT,'daily_raw_run_allowance_immutable'); END`,
    ...["INSERT", "UPDATE"].map(operation => `CREATE TRIGGER IF NOT EXISTS daily_raw_days_sources_${operation.toLowerCase()} BEFORE ${operation} ON daily_raw_days BEGIN ${DAILY_RAW_METRICS.map(metric => `SELECT CASE WHEN NEW.${metric}_source IS NOT NULL AND NOT EXISTS(SELECT 1 FROM daily_raw_sources WHERE id=NEW.${metric}_source AND asset_id=NEW.asset_id AND metric='${metric}') THEN RAISE(ABORT,'daily_raw_metric_source_mismatch') END;`).join(" ")} END`),
  ], "write");
  const columns = await db.execute("PRAGMA table_info(daily_raw_runs)");
  if (!columns.rows.some(row => row.name === "accounting_version")) await db.execute(`ALTER TABLE daily_raw_runs ADD COLUMN accounting_version TEXT NOT NULL DEFAULT '${LEGACY_ACCOUNTING_VERSION}'`);
  await db.execute("CREATE TRIGGER IF NOT EXISTS daily_raw_run_accounting_immutable BEFORE UPDATE OF accounting_version ON daily_raw_runs BEGIN SELECT RAISE(ABORT,'daily_raw_run_accounting_immutable'); END");
  if (local) unmeteredLocalClients.add(db);
}

interface RawRunOptions { id: string; maxEstimatedWrites: number; minimumReserve?: number; now?: Date }
export interface DailyRawWriteResult { assetId: number; rowsWritten: number; daysWritten: number; estimatedWrites: number }
export interface DailyRawUpsertOptions {
  runId: string; asset: DailyRawAsset; sources: DailyRawSource[]; points: DailyRawPoint[];
  checkpoint?: DailyRawCheckpoint; now?: Date;
  /** Optional maintenance headroom, checked before any mutation together with the monthly cap. */
  minimumReserve?: number;
  /** Optional compare-and-swap guard for an explicitly reviewed correction. */
  expectedCells?: { day: string; metric: DailyRawMetric; sourceKey: string; value: number | null; state: number; at: string | null }[];
}
export interface DailyRawRun { id: string; maxEstimatedWrites: number; estimatedWrites: number; rowsWritten: number; daysWritten: number; accountingVersion: RawAccountingVersion }
const readRun = (row: Row): DailyRawRun => {
  const accountingVersion = String(row.accounting_version ?? LEGACY_ACCOUNTING_VERSION);
  if (accountingVersion !== DAILY_RAW_ACCOUNTING_VERSION && accountingVersion !== LEGACY_ACCOUNTING_VERSION) throw Error("Unknown daily raw accounting version");
  return { id: String(row.id), maxEstimatedWrites: Number(row.max_estimated_writes), estimatedWrites: Number(row.estimated_writes), rowsWritten: Number(row.rows_written), daysWritten: Number(row.days_written), accountingVersion };
};

export class DailyRawPreflightBudgetExceeded extends HistoryBudgetExceeded {
  constructor(public scope: "monthly" | "run", public requiredEstimatedWrites: number, public remainingEstimatedWrites: number) {
    super(`${scope === "monthly" ? "history_monthly" : "daily_raw_run"}_write_budget_preflight: requires at most ${requiredEstimatedWrites} estimated writes; ${remainingEstimatedWrites} remain unused`);
  }
}

async function reserve(tx: Transaction, runId: string, counts: RawWriteCounts, days: number, now: Date, version: RawAccountingVersion, local = false) {
  // Weighted runs: run update + reservation row + two explicit safety credits.
  // Indexed metadata has one UNIQUE secondary index; day rows have none.
  const dataRows = counts.plain + counts.indexed, cost = estimatedCost(counts, version);
  try {
    const results = await tx.batch([
      { sql: "UPDATE daily_raw_runs SET estimated_writes=estimated_writes+?,rows_written=rows_written+?,days_written=days_written+? WHERE id=? AND estimated_writes+?<=max_estimated_writes", args: [cost, dataRows + 1, days, runId, cost] },
      { sql: "INSERT INTO history_budget(month,reserved) VALUES(?,?) ON CONFLICT(month) DO UPDATE SET reserved=reserved+excluded.reserved", args: [now.toISOString().slice(0, 7), cost] },
      "PRAGMA page_count", "PRAGMA page_size",
    ]);
    if (!results[0].rowsAffected) throw new HistoryBudgetExceeded("daily_raw_run_write_budget");
    if (!local && Number(results[2].rows[0][0]) * Number(results[3].rows[0][0]) >= HISTORY_STORAGE_LIMIT) throw new HistoryBudgetExceeded("history_storage_budget");
  } catch (error) {
    if (error instanceof Error && /CHECK constraint failed.*reserved/i.test(error.message)) throw new HistoryBudgetExceeded("history_monthly_write_budget");
    throw error;
  }
  return cost;
}

/** A run's caller-supplied ceiling is immutable, including after process restarts. */
export async function openDailyRawRun(db: Client, options: RawRunOptions): Promise<DailyRawRun> {
  const { id, maxEstimatedWrites } = options, now = options.now ?? new Date();
  const minimumReserve = options.minimumReserve ?? 0;
  const local = unmeteredLocalClients.has(db);
  if (!id.trim() || !Number.isSafeInteger(maxEstimatedWrites) || maxEstimatedWrites < 8 || (!local && maxEstimatedWrites > HISTORY_WRITE_LIMIT) || !Number.isSafeInteger(minimumReserve) || minimumReserve < 0 || minimumReserve > HISTORY_WRITE_LIMIT) throw Error("Invalid daily raw run allowance");
  const tx = await db.transaction("write");
  try {
    const old = await tx.batch([
      { sql: "SELECT * FROM daily_raw_runs WHERE id=?", args: [id] },
      { sql: "SELECT reserved FROM history_budget WHERE month=?", args: [now.toISOString().slice(0, 7)] },
      "PRAGMA page_count", "PRAGMA page_size",
    ]);
    if (old[0].rows.length) {
      if (Number(old[0].rows[0].max_estimated_writes) !== maxEstimatedWrites) throw Error("Daily raw run allowance is immutable");
      await tx.commit();
      return readRun(old[0].rows[0]);
    }
    const remaining = HISTORY_WRITE_LIMIT - Number(old[1].rows[0]?.reserved ?? 0);
    const initialCost = estimatedCost({ plain: 1, indexed: 0 }, DAILY_RAW_ACCOUNTING_VERSION);
    if (!local && remaining < initialCost + minimumReserve) throw new DailyRawPreflightBudgetExceeded("monthly", initialCost + minimumReserve, remaining);
    if (!local && (Number(old[2].rows[0][0]) + 4) * Number(old[3].rows[0][0]) >= HISTORY_STORAGE_LIMIT) throw new HistoryBudgetExceeded("history_storage_budget");
    await tx.execute({ sql: "INSERT INTO daily_raw_runs(id,started_at,max_estimated_writes,accounting_version) VALUES(?,?,?,?)", args: [id, now.toISOString(), maxEstimatedWrites, DAILY_RAW_ACCOUNTING_VERSION] });
    await reserve(tx, id, { plain: 1, indexed: 0 }, 0, now, DAILY_RAW_ACCOUNTING_VERSION, local);
    const result = await tx.execute({ sql: "SELECT * FROM daily_raw_runs WHERE id=?", args: [id] });
    await tx.commit();
    return readRun(result.rows[0]);
  } finally { tx.close(); }
}

const metadata = (row: Row): RawSourceMetadata => ({ id: Number(row.id), key: String(row.source_key), metric: String(row.metric) as DailyRawMetric, provider: String(row.provider), url: String(row.url), observedAt: String(row.observed_at), scope: String(row.scope), definition: String(row.definition), basis: String(row.basis), revisionOf: row.revision_key === null || row.revision_key === undefined ? null : String(row.revision_key) });
const cell = (row: Row | undefined, metric: DailyRawMetric): RawCell => ({ value: row?.[metric] === null || row?.[metric] === undefined ? null : Number(row[metric]), state: Number(row?.[`${metric}_state`] ?? 0), sourceId: row?.[`${metric}_source`] === null || row?.[`${metric}_source`] === undefined ? null : Number(row[`${metric}_source`]), at: row?.[`${metric}_at`] === null || row?.[`${metric}_at`] === undefined ? null : String(row[`${metric}_at`]) });

/** A read-only replay check permits true no-ops even when there is no remaining write allowance. */
async function replayWithoutWrites(tx: Transaction, options: DailyRawUpsertOptions, assetId: number, known: Map<string, Row>, checkpoint: Row | undefined) {
  if (options.sources.some(source => !known.has(source.key))) return false;
  if (options.checkpoint && (!checkpoint || checkpoint.cursor !== options.checkpoint.cursor || checkpoint.status !== (options.checkpoint.status ?? "running"))) return false;
  if (!options.points.length) return true;
  const days = JSON.stringify(options.points.map(point => point.day));
  const previous = await tx.batch([
    { sql: "SELECT * FROM daily_raw_days WHERE asset_id=? AND day IN (SELECT value FROM json_each(?))", args: [assetId, days] },
    { sql: `${sourceSelect} WHERE s.asset_id=? AND s.id IN (SELECT value FROM daily_raw_days d,json_each(json_array(${DAILY_RAW_METRICS.map(metric => `d.${metric}_source`).join(",")})) WHERE d.asset_id=? AND d.day IN (SELECT value FROM json_each(?)))`, args: [assetId, assetId, days] },
  ]);
  const rows = new Map(previous[0].rows.map(row => [String(row.day), row])), refs = new Map(previous[1].rows.map(row => [Number(row.id), metadata(row)])), events = new Set<string>();
  for (const point of options.points) {
    const old = rows.get(point.day);
    if (!old) return false;
    for (const metric of DAILY_RAW_METRICS) {
      const incoming = point[metric];
      if (!incoming) continue;
      const before = cell(old, metric), sourceRow = known.get(incoming.source), source = sourceRow ? metadata(sourceRow) : undefined;
      const candidate: RawCell = { value: incoming.state === "conflict" ? null : incoming.value, state: dailyRawStateCode(incoming.value, incoming.state), sourceId: source?.id ?? null, at: incoming.at ?? null };
      const merged = mergeDailyRawCell(before, candidate, before.sourceId === null ? undefined : refs.get(before.sourceId), source);
      if (JSON.stringify(merged.cell) !== JSON.stringify(before)) return false;
      if (merged.kind && !(merged.kind === "conflict" && incoming.witnesses)) events.add(revisionKey(assetId, point.day, metric, merged.kind, candidate));
      for (const witness of incoming.witnesses?.slice(1) ?? []) events.add(revisionKey(assetId, point.day, metric, "conflict", { value: witness.state === "conflict" ? null : witness.value, state: dailyRawStateCode(witness.value, witness.state), sourceId: Number(known.get(witness.source)?.id ?? 0) || null, at: witness.at ?? null }));
    }
  }
  if (!events.size) return true;
  const found = await tx.execute({ sql: "SELECT COUNT(*) AS n FROM daily_raw_revisions WHERE event_key IN (SELECT value FROM json_each(?))", args: [JSON.stringify([...events])] });
  return Number(found.rows[0].n) === events.size;
}

/** Turso bills rows changed by aborted transactions too. Reject insufficient headroom before any mutation. */
interface RawPreflight { assetId: number | null; sources: Map<string, Row>; run: DailyRawRun; replay: boolean }
async function preflightDailyRaw(tx: Transaction, options: DailyRawUpsertOptions, now: Date, local = false): Promise<RawPreflight> {
  const { asset, sources, points, checkpoint } = options, days = JSON.stringify(points.map(point => point.day));
  const keys = [...new Set(sources.flatMap(source => [source.key, ...(source.revisionOf ? [source.revisionOf] : [])]))];
  const reads = await tx.batch([
    { sql: "SELECT * FROM daily_raw_runs WHERE id=?", args: [options.runId] },
    { sql: "SELECT reserved FROM history_budget WHERE month=?", args: [now.toISOString().slice(0, 7)] },
    { sql: "SELECT id FROM daily_raw_assets WHERE slug=? AND identity=?", args: [asset.slug, asset.identity] },
    { sql: `${sourceSelect} WHERE s.source_key IN (SELECT value FROM json_each(?))`, args: [JSON.stringify(keys)] },
    { sql: "SELECT COUNT(*) AS n FROM daily_raw_days WHERE asset_id=(SELECT id FROM daily_raw_assets WHERE slug=? AND identity=?) AND day IN (SELECT value FROM json_each(?))", args: [asset.slug, asset.identity, days] },
    { sql: "SELECT cursor,status FROM daily_raw_checkpoints WHERE run_id=? AND checkpoint_key=?", args: [options.runId, checkpoint?.key ?? ""] },
    "PRAGMA page_count", "PRAGMA page_size",
  ]);
  if (!reads[0].rows.length) throw Error("Daily raw run has not been opened");
  const assetId = reads[2].rows.length ? Number(reads[2].rows[0].id) : null, known = new Map(reads[3].rows.map(row => [String(row.source_key), row]));
  for (const source of sources) {
    const old = known.get(source.key);
    if (old && (assetId === null || old.content_hash !== sourceFingerprint(assetId, source))) throw Error("Daily raw source key was reused with different evidence");
  }
  const ordinaryEvents = points.reduce((total, point) => total + DAILY_RAW_METRICS.filter(metric => point[metric] && point[metric]!.state !== "missing" && !point[metric]!.witnesses).length, 0);
  const witnessedEvents = points.reduce((total, point) => total + DAILY_RAW_METRICS.reduce((n, metric) => n + (point[metric]?.witnesses ? point[metric]!.witnesses!.length - 1 + Number(!!sources.find(source => source.key === point[metric]!.source)?.revisionOf) : 0), 0), 0);
  const counts = { plain: points.length + Number(points.length > 0) + Number(!!checkpoint), indexed: Number(assetId === null) + sources.filter(source => !known.has(source.key)).length * 2 + Math.min(ordinaryEvents, Number(reads[4].rows[0].n) * 6) + witnessedEvents };
  const run = readRun(reads[0].rows[0]), snapshot = { assetId, sources: known, run, replay: false };
  if (!counts.plain && !counts.indexed) return { ...snapshot, replay: true };
  const required = estimatedCost(counts, run.accountingVersion);
  const monthlyRemaining = HISTORY_WRITE_LIMIT - Number(reads[1].rows[0]?.reserved ?? 0), runRemaining = run.maxEstimatedWrites - run.estimatedWrites;
  const size = Number(reads[6].rows[0][0]) * Number(reads[7].rows[0][0]), estimatedBytes = Buffer.byteLength(JSON.stringify({ sources, points })) * 2 + Number(reads[7].rows[0][0]) * 4;
  const monthlyRequired = required + (options.minimumReserve ?? 0);
  if ((!local && monthlyRequired > monthlyRemaining) || required > runRemaining || (!local && size + estimatedBytes >= HISTORY_STORAGE_LIMIT)) {
    if (assetId !== null && await replayWithoutWrites(tx, options, assetId, known, reads[5].rows[0])) return { ...snapshot, replay: true };
    if (!local && monthlyRequired > monthlyRemaining) throw new DailyRawPreflightBudgetExceeded("monthly", monthlyRequired, monthlyRemaining);
    if (required > runRemaining) throw new DailyRawPreflightBudgetExceeded("run", required, runRemaining);
    throw new HistoryBudgetExceeded("history_storage_budget");
  }
  return snapshot;
}

async function registerSources(tx: Transaction, assetId: number, sources: DailyRawSource[], known: Map<string, Row>) {
  let rows = 0;
  const result = new Map<string, RawSourceMetadata>();
  if (!sources.length) return { sources: result, rows };
  const byKey = new Map(known);
  const pending: (DailyRawSource & { receiptKey: string; fingerprint: string })[] = [];
  for (const source of sources) {
    const fingerprint = sourceFingerprint(assetId, source);
    const old = byKey.get(source.key);
    if (old) {
      if (old.content_hash !== fingerprint) throw Error("Daily raw source key was reused with different evidence");
      result.set(source.key, metadata(old));
      continue;
    }
    if (source.revisionOf) {
      const previous = byKey.get(source.revisionOf), proposed = sources.find(candidate => candidate.key === source.revisionOf);
      if (previous ? Number(previous.asset_id) !== assetId || previous.metric !== source.metric : !proposed || proposed.metric !== source.metric) throw Error("Daily raw source revision has no exact predecessor");
    }
    const receiptKey = dailyRawHash([source.url, source.observedAt, source.sha256.toLowerCase(), source.archiveUrl ?? null]);
    pending.push({ ...source, sha256: source.sha256.toLowerCase(), receiptKey, fingerprint });
  }
  while (pending.length) {
    const wave = pending.filter(source => !source.revisionOf || byKey.has(source.revisionOf));
    if (!wave.length) throw Error("Daily raw source revisions contain a cycle");
    const json = JSON.stringify(wave);
    const written = await tx.batch([
      { sql: `INSERT INTO daily_raw_receipts(receipt_key,url,observed_at,sha256,archive_url) SELECT json_extract(value,'$.receiptKey'),json_extract(value,'$.url'),json_extract(value,'$.observedAt'),json_extract(value,'$.sha256'),json_extract(value,'$.archiveUrl') FROM json_each(?) WHERE 1 ON CONFLICT(receipt_key) DO NOTHING`, args: [json] },
      { sql: `INSERT INTO daily_raw_sources(source_key,asset_id,receipt_id,metric,provider,scope,definition,basis,revision_of,content_hash) SELECT json_extract(j.value,'$.key'),?,r.id,json_extract(j.value,'$.metric'),json_extract(j.value,'$.provider'),json_extract(j.value,'$.scope'),json_extract(j.value,'$.definition'),json_extract(j.value,'$.basis'),p.id,json_extract(j.value,'$.fingerprint') FROM json_each(?) j JOIN daily_raw_receipts r ON r.receipt_key=json_extract(j.value,'$.receiptKey') LEFT JOIN daily_raw_sources p ON p.source_key=json_extract(j.value,'$.revisionOf') AND p.asset_id=? AND p.metric=json_extract(j.value,'$.metric') WHERE json_extract(j.value,'$.revisionOf') IS NULL OR p.id IS NOT NULL`, args: [assetId, json, assetId] },
      { sql: `${sourceSelect} WHERE s.source_key IN (SELECT json_extract(value,'$.key') FROM json_each(?))`, args: [json] },
    ]);
    rows += written[0].rowsAffected + written[1].rowsAffected;
    if (written[1].rowsAffected !== wave.length || written[2].rows.length !== wave.length) throw Error("Daily raw source receipt was not registered");
    for (const row of written[2].rows) { byKey.set(String(row.source_key), row); result.set(String(row.source_key), metadata(row)); }
    for (const source of wave) pending.splice(pending.indexOf(source), 1);
  }
  return { sources: result, rows };
}

/** No transport retry: a caller must read the committed checkpoint before resuming an unknown outcome. */
export async function upsertDailyRaw(db: Client, options: DailyRawUpsertOptions): Promise<DailyRawWriteResult> {
  const { asset, points, sources, checkpoint, runId } = options, now = options.now ?? new Date();
  assertDailyRawAsset(asset);
  if (options.minimumReserve !== undefined && (!Number.isSafeInteger(options.minimumReserve) || options.minimumReserve < 0 || options.minimumReserve > HISTORY_WRITE_LIMIT)) throw Error("Invalid daily raw maintenance reserve");
  if (points.length > 1_000 || sources.length > 100) throw Error("Daily raw batch exceeds its bounded size");
  if (new Set(points.map(point => point.day)).size !== points.length || new Set(sources.map(source => source.key)).size !== sources.length) throw Error("Duplicate daily raw batch key");
  const inputSources = new Map(sources.map(source => [source.key, source]));
  for (const source of sources) assertDailyRawSource(source);
  for (const point of points) {
    assertDailyRawDay(point.day);
    for (const metric of DAILY_RAW_METRICS) if (point[metric]) assertDailyRawObservation(metric, point, inputSources.get(point[metric]!.source), now, inputSources);
  }
  if (checkpoint && (!checkpoint.key.trim() || !["running", "complete"].includes(checkpoint.status ?? "running"))) throw Error("Invalid daily raw checkpoint");
  const tx = await db.transaction("write");
  try {
    const local = unmeteredLocalClients.has(db), preflight = await preflightDailyRaw(tx, options, now, local);
    if (options.expectedCells?.length) {
      if (options.expectedCells.length > 1_000) throw Error("Daily raw expected-cell guard exceeds its bounded size");
      for (const expected of options.expectedCells) {
        assertDailyRawDay(expected.day);
        if (!DAILY_RAW_METRICS.includes(expected.metric) || !Number.isInteger(expected.state) || expected.state < 0 || expected.state > 5 || expected.value !== null && !Number.isFinite(expected.value)) throw Error("Invalid daily raw expected-cell guard");
      }
      const previous = await tx.execute({ sql: `SELECT d.*,${DAILY_RAW_METRICS.map(metric => `(SELECT source_key FROM daily_raw_sources WHERE id=d.${metric}_source) AS ${metric}_key`).join(",")} FROM daily_raw_days d WHERE d.asset_id=? AND d.day IN (SELECT value FROM json_each(?))`, args: [preflight.assetId, JSON.stringify(options.expectedCells.map(expected => expected.day))] });
      const days = new Map(previous.rows.map(row => [String(row.day), row]));
      for (const expected of options.expectedCells) {
        const row = days.get(expected.day), actual = cell(row, expected.metric);
        const absent = !row && expected.value === null && expected.state === 0 && expected.at === null && expected.sourceKey === "";
        if (!absent && (!row || actual.value !== expected.value || actual.state !== expected.state || actual.at !== expected.at || String(row[`${expected.metric}_key`] ?? "") !== expected.sourceKey)) throw Error("Daily raw expected cell changed");
      }
    }
    if (preflight.replay) { await tx.commit(); return { assetId: preflight.assetId!, rowsWritten: 0, daysWritten: 0, estimatedWrites: 0 }; }
    const counts: RawWriteCounts = { plain: 0, indexed: 0 };
    let assetId = preflight.assetId;
    if (assetId === null) {
      const setup = await tx.batch([
        { sql: "INSERT INTO daily_raw_assets(slug,identity) VALUES(?,?) ON CONFLICT(slug,identity) DO NOTHING", args: [asset.slug, asset.identity] },
        { sql: "SELECT id FROM daily_raw_assets WHERE slug=? AND identity=?", args: [asset.slug, asset.identity] },
      ]);
      counts.indexed += setup[0].rowsAffected;
      assetId = Number(setup[1].rows[0].id);
    }
    const registered = await registerSources(tx, assetId, sources, preflight.sources);
    counts.indexed += registered.rows;
    const dates = points.map(point => point.day).sort();
    const previous = dates.length ? await tx.batch([
      { sql: "SELECT * FROM daily_raw_days WHERE asset_id=? AND day>=? AND day<=?", args: [assetId, dates[0], dates.at(-1)!] },
      { sql: `${sourceSelect} WHERE s.asset_id=? AND s.id IN (SELECT value FROM daily_raw_days d,json_each(json_array(${DAILY_RAW_METRICS.map(metric => `d.${metric}_source`).join(",")})) WHERE d.asset_id=? AND d.day>=? AND d.day<=?)`, args: [assetId, assetId, dates[0], dates.at(-1)!] },
    ]) : [{ rows: [] as Row[] }, { rows: [] as Row[] }];
    const previousDays = new Map(previous[0].rows.map(row => [String(row.day), row]));
    const knownSources = new Map(previous[1].rows.map(row => [Number(row.id), metadata(row)]));
    const changed: (number | string | null)[][] = [], revisions: InStatement[] = [];
    const recordRevision = (day: string, metric: DailyRawMetric, kind: string, before: RawCell, candidate: RawCell) => {
      const eventKey = revisionKey(assetId, day, metric, kind, candidate);
      revisions.push({ sql: "INSERT INTO daily_raw_revisions(event_key,asset_id,day,metric,kind,previous_value,previous_state,previous_source,previous_at,next_value,next_state,next_source,next_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING", args: [eventKey, assetId, day, metric, kind, before.value, before.state, before.sourceId, before.at, candidate.value, candidate.state, candidate.sourceId, candidate.at] });
    };
    for (const point of points) {
      const old = previousDays.get(point.day), values: (number | string | null)[] = [assetId, point.day];
      let differs = false;
      for (const metric of DAILY_RAW_METRICS) {
        const before = cell(old, metric), incoming = point[metric];
        let next = before;
        if (incoming) {
          const source = registered.sources.get(incoming.source);
          const candidate: RawCell = { value: incoming.state === "conflict" ? null : incoming.value, state: dailyRawStateCode(incoming.value, incoming.state), sourceId: source?.id ?? null, at: incoming.at ?? null };
          const merged = mergeDailyRawCell(before, candidate, before.sourceId === null ? undefined : knownSources.get(before.sourceId), source);
          next = merged.cell;
          if (merged.kind && !(merged.kind === "conflict" && incoming.witnesses)) recordRevision(point.day, metric, merged.kind, before, candidate);
          if (incoming.witnesses) {
            const witnesses = incoming.witnesses.map(witness => ({ value: witness.state === "conflict" ? null : witness.value, state: dailyRawStateCode(witness.value, witness.state), sourceId: registered.sources.get(witness.source)?.id ?? null, at: witness.at ?? null }));
            for (const witness of witnesses.slice(1)) recordRevision(point.day, metric, "conflict", witnesses[0], witness);
          }
        }
        if (JSON.stringify(before) !== JSON.stringify(next)) differs = true;
        values.push(next.value, next.state, next.sourceId, next.at);
      }
      if (differs || !old) changed.push(values);
    }
    for (let i = 0; i < revisions.length; i += 100) for (const result of await tx.batch(revisions.slice(i, i + 100))) counts.indexed += result.rowsAffected;
    if (changed.length) {
      const expressions = COLUMNS.map((_, i) => `json_extract(value,'$[${i}]')`).join(",");
      const written = await tx.execute({ sql: `INSERT INTO daily_raw_days(${COLUMNS.join(",")}) SELECT ${expressions} FROM json_each(?) WHERE 1 ON CONFLICT(asset_id,day) DO UPDATE SET ${CELL_COLUMNS.map(column => `${column}=excluded.${column}`).join(",")}`, args: [JSON.stringify(changed)] });
      counts.plain += written.rowsAffected;
      counts.plain += (await tx.execute({ sql: "INSERT INTO daily_raw_asset_revisions(asset_id,revision) VALUES(?,1) ON CONFLICT(asset_id) DO UPDATE SET revision=revision+1", args: [assetId] })).rowsAffected;
    }
    if (checkpoint) counts.plain += (await tx.execute({ sql: `INSERT INTO daily_raw_checkpoints(run_id,checkpoint_key,cursor,status,rows_written,days_written) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id,checkpoint_key) DO UPDATE SET cursor=excluded.cursor,status=excluded.status,rows_written=rows_written+excluded.rows_written,days_written=days_written+excluded.days_written WHERE cursor<>excluded.cursor OR status<>excluded.status OR excluded.rows_written>0`, args: [runId, checkpoint.key, checkpoint.cursor, checkpoint.status ?? "running", counts.plain + counts.indexed, changed.length] })).rowsAffected;
    const rowsWritten = counts.plain + counts.indexed;
    const estimatedWrites = rowsWritten ? await reserve(tx, runId, counts, changed.length, now, preflight.run.accountingVersion, local) : 0;
    await tx.commit();
    return { assetId, rowsWritten: rowsWritten + Number(rowsWritten > 0), daysWritten: changed.length, estimatedWrites };
  } finally { tx.close(); }
}

/** One prepared blob row; its CAS, quota reservation and data commit share this transaction. */
export async function writeDailyRawReadModel(db: Client, options: {
  runId: string; namespace: string; key: string; revision: string; sha256: string; metadata: string; metadataSha256: string; payload: Uint8Array;
  expectedRaw?: { assetId: number; revision: number }; minimumReserve?: number; immutable?: boolean; now?: Date;
}) {
  const now = options.now ?? new Date(), local = unmeteredLocalClients.has(db), minimumReserve = options.minimumReserve ?? 500_000;
  if (!Number.isSafeInteger(minimumReserve) || minimumReserve < 0 || minimumReserve > HISTORY_WRITE_LIMIT) throw Error("Invalid read model maintenance reserve");
  const tx = await db.transaction("write");
  try {
    const reads = await tx.batch([
      { sql: "SELECT * FROM daily_raw_runs WHERE id=?", args: [options.runId] },
      { sql: "SELECT reserved FROM history_budget WHERE month=?", args: [now.toISOString().slice(0, 7)] },
      { sql: "SELECT revision,sha256,metadata FROM daily_read_models WHERE namespace=? AND model_key=?", args: [options.namespace, options.key] },
      { sql: "SELECT a.id,COALESCE(r.revision,0) revision FROM daily_raw_assets a LEFT JOIN daily_raw_asset_revisions r ON r.asset_id=a.id WHERE a.id=?", args: [options.expectedRaw?.assetId ?? -1] },
      "PRAGMA page_count", "PRAGMA page_size",
    ]);
    if (!reads[0].rows.length) throw Error("Daily raw run has not been opened");
    if (options.expectedRaw && (!reads[3].rows.length || Number(reads[3].rows[0].revision) !== options.expectedRaw.revision)) throw Error("daily_read_model_raw_changed");
    const old = reads[2].rows[0];
    if (old && old.revision === options.revision && old.sha256 === options.sha256 && old.metadata === options.metadata) { await tx.commit(); return { changed: false, estimatedWrites: 0, sha256: options.sha256 }; }
    if (old && options.immutable) throw Error("daily_read_model_immutable_conflict");
    const run = readRun(reads[0].rows[0]), required = estimatedCost({ plain: 1, indexed: 0 }, run.accountingVersion);
    const remaining = HISTORY_WRITE_LIMIT - Number(reads[1].rows[0]?.reserved ?? 0), runRemaining = run.maxEstimatedWrites - run.estimatedWrites;
    if (!local && remaining - required < minimumReserve) throw new DailyRawPreflightBudgetExceeded("monthly", required + minimumReserve, remaining);
    if (required > runRemaining) throw new DailyRawPreflightBudgetExceeded("run", required, runRemaining);
    const size = Number(reads[4].rows[0][0]) * Number(reads[5].rows[0][0]), bytes = options.payload.byteLength * 2 + Buffer.byteLength(options.metadata) * 2 + Number(reads[5].rows[0][0]) * 4;
    if (!local && size + bytes >= HISTORY_STORAGE_LIMIT) throw new HistoryBudgetExceeded("history_storage_budget");
    await tx.execute({ sql: "INSERT INTO daily_read_models(namespace,model_key,revision,sha256,payload,metadata,metadata_sha256,built_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(namespace,model_key) DO UPDATE SET revision=excluded.revision,sha256=excluded.sha256,payload=excluded.payload,metadata=excluded.metadata,metadata_sha256=excluded.metadata_sha256,built_at=excluded.built_at", args: [options.namespace, options.key, options.revision, options.sha256, options.payload, options.metadata, options.metadataSha256, now.toISOString()] });
    const estimatedWrites = await reserve(tx, options.runId, { plain: 1, indexed: 0 }, 0, now, run.accountingVersion, local);
    await tx.commit(); return { changed: true, estimatedWrites, sha256: options.sha256 };
  } finally { tx.close(); }
}

/** Builder-only retention for explicit prepared-model keys; source tables are never touched. */
export async function deleteDailyRawReadModels(db: Client, options: { runId: string; namespace: string; keys: string[]; minimumReserve?: number; now?: Date }) {
  const now = options.now ?? new Date(), local = unmeteredLocalClients.has(db), minimumReserve = options.minimumReserve ?? 500_000;
  if (!Number.isSafeInteger(minimumReserve) || minimumReserve < 0 || minimumReserve > HISTORY_WRITE_LIMIT) throw Error("Invalid read model maintenance reserve");
  if (!options.keys.length) return { deleted: 0, estimatedWrites: 0 };
  const tx = await db.transaction("write");
  try {
    const reads = await tx.batch([
      { sql: "SELECT * FROM daily_raw_runs WHERE id=?", args: [options.runId] },
      { sql: "SELECT reserved FROM history_budget WHERE month=?", args: [now.toISOString().slice(0, 7)] },
      { sql: "SELECT COUNT(*) n FROM daily_read_models WHERE namespace=? AND model_key IN (SELECT value FROM json_each(?))", args: [options.namespace, JSON.stringify(options.keys)] },
    ]);
    if (!reads[0].rows.length) throw Error("Daily raw run has not been opened");
    const count = Number(reads[2].rows[0].n);
    if (!count) { await tx.commit(); return { deleted: 0, estimatedWrites: 0 }; }
    const run = readRun(reads[0].rows[0]), required = estimatedCost({ plain: count, indexed: 0 }, run.accountingVersion), remaining = HISTORY_WRITE_LIMIT - Number(reads[1].rows[0]?.reserved ?? 0);
    if (!local && remaining - required < minimumReserve) throw new DailyRawPreflightBudgetExceeded("monthly", required + minimumReserve, remaining);
    if (required > run.maxEstimatedWrites - run.estimatedWrites) throw new DailyRawPreflightBudgetExceeded("run", required, run.maxEstimatedWrites - run.estimatedWrites);
    const deleted = (await tx.execute({ sql: "DELETE FROM daily_read_models WHERE namespace=? AND model_key IN (SELECT value FROM json_each(?))", args: [options.namespace, JSON.stringify(options.keys)] })).rowsAffected;
    // Deletion cannot increase storage; existing full files must still be able to remove prepared rows.
    const estimatedWrites = await reserve(tx, options.runId, { plain: deleted, indexed: 0 }, 0, now, run.accountingVersion, true);
    await tx.commit(); return { deleted, estimatedWrites };
  } finally { tx.close(); }
}

export async function getDailyRawCheckpoint(db: Client, runId: string, key: string) {
  const result = await historyRead(db, { sql: "SELECT cursor,status,rows_written,days_written FROM daily_raw_checkpoints WHERE run_id=? AND checkpoint_key=?", args: [runId, key] });
  return result.rows.length ? { cursor: String(result.rows[0].cursor), status: String(result.rows[0].status) as "running" | "complete", rowsWritten: Number(result.rows[0].rows_written), daysWritten: Number(result.rows[0].days_written) } : null;
}

export async function getDailyRawRun(db: Client, runId: string): Promise<DailyRawRun | null> {
  const result = await historyRead(db, { sql: "SELECT * FROM daily_raw_runs WHERE id=?", args: [runId] });
  return result.rows.length ? readRun(result.rows[0]) : null;
}

export async function readDailyRaw(db: Client, query: { asset: DailyRawAsset; from?: string; to?: string; after?: string; limit?: number }): Promise<{ assetId: number; points: DailyRawStoredPoint[]; sources: DailyRawSource[]; nextCursor: string | null } | null> {
  assertDailyRawAsset(query.asset);
  for (const day of [query.from, query.to, query.after]) if (day) assertDailyRawDay(day);
  const limit = query.limit ?? 1_000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw Error("Invalid daily raw read limit");
  const asset = await historyRead(db, { sql: "SELECT id FROM daily_raw_assets WHERE slug=? AND identity=?", args: [query.asset.slug, query.asset.identity] });
  if (!asset.rows.length) return null;
  const assetId = Number(asset.rows[0].id);
  const result = await historyRead(db, { sql: "SELECT * FROM daily_raw_days WHERE asset_id=? AND day>=? AND day<=? AND day>? ORDER BY day LIMIT ?", args: [assetId, query.from ?? "0000-01-01", query.to ?? "9999-12-31", query.after ?? "", limit + 1] });
  const rows = result.rows.slice(0, limit), sourceIds = [...new Set(rows.flatMap(row => DAILY_RAW_METRICS.map(metric => cell(row, metric).sourceId)).filter((id): id is number => id !== null))];
  const sources = sourceIds.length ? await historyRead(db, { sql: `${sourceSelect} WHERE s.id IN (${sourceIds.map(() => "?").join(",")})`, args: sourceIds }) : { rows: [] as Row[] };
  const byId = new Map(sources.rows.map(row => [Number(row.id), String(row.source_key)]));
  const points = rows.map(row => Object.fromEntries([["day", String(row.day)], ...DAILY_RAW_METRICS.map(metric => {
    const stored = cell(row, metric);
    return [metric, { value: stored.value, state: DAILY_RAW_STATES[stored.state], source: stored.sourceId === null ? "" : byId.get(stored.sourceId)!, at: stored.at }];
  })]) as unknown as DailyRawStoredPoint);
  return { assetId, points, sources: sources.rows.map(readSource), nextCursor: result.rows.length > limit ? points.at(-1)!.day : null };
}

const readSource = (row: Row): DailyRawSource => ({ key: String(row.source_key), metric: String(row.metric) as DailyRawMetric, provider: String(row.provider), url: String(row.url), observedAt: String(row.observed_at), sha256: String(row.sha256), ...(row.archive_url === null ? {} : { archiveUrl: String(row.archive_url) }), scope: String(row.scope), definition: String(row.definition), basis: String(row.basis), ...(row.revision_key === null ? {} : { revisionOf: String(row.revision_key) }) });

export interface DailyRawAssetSummary extends DailyRawAsset { assetId: number; days: number; firstDay: string | null; lastDay: string | null; flowDays: number; positiveFlowDays: number; marketDays: number; fdvDays: number; usableDays: number }
/** Only small summaries cross the client; source-bearing protocol histories are copied first. */
export async function listDailyRawAssets(db: Client): Promise<DailyRawAssetSummary[]> {
  const market = "d.price_state=1 OR d.mcap_state=1 OR d.fdv_state=1", flow = "d.revenue_state=1 OR d.holders_state=1";
  const result = await historyRead(db, `SELECT a.id,a.slug,a.identity,COUNT(d.day) AS days,MIN(d.day) AS first_day,MAX(d.day) AS last_day,
    SUM(CASE WHEN d.fees_state BETWEEN 1 AND 4 OR d.revenue_state BETWEEN 1 AND 4 OR d.holders_state BETWEEN 1 AND 4 THEN 1 ELSE 0 END) AS flow_days,
    SUM(CASE WHEN ${flow} THEN 1 ELSE 0 END) AS positive_flow_days,SUM(CASE WHEN ${market} THEN 1 ELSE 0 END) AS market_days,
    SUM(CASE WHEN d.fdv_state=1 THEN 1 ELSE 0 END) AS fdv_days,SUM(CASE WHEN (${market}) AND (${flow}) THEN 1 ELSE 0 END) AS usable_days
    FROM daily_raw_assets a LEFT JOIN daily_raw_days d ON d.asset_id=a.id GROUP BY a.id
    ORDER BY CASE WHEN SUM(CASE WHEN (${market}) AND (${flow}) THEN 1 ELSE 0 END)>0 THEN 0 WHEN SUM(CASE WHEN ${flow} THEN 1 ELSE 0 END)>0 THEN 1 WHEN SUM(CASE WHEN d.fees_state BETWEEN 1 AND 4 OR d.revenue_state BETWEEN 1 AND 4 OR d.holders_state BETWEEN 1 AND 4 THEN 1 ELSE 0 END)>0 THEN 2 ELSE 3 END,fdv_days DESC,flow_days DESC,a.slug,a.identity`);
  return result.rows.map(row => ({ assetId: Number(row.id), slug: String(row.slug), identity: String(row.identity), days: Number(row.days), firstDay: row.first_day === null ? null : String(row.first_day), lastDay: row.last_day === null ? null : String(row.last_day), flowDays: Number(row.flow_days ?? 0), positiveFlowDays: Number(row.positive_flow_days ?? 0), marketDays: Number(row.market_days ?? 0), fdvDays: Number(row.fdv_days ?? 0), usableDays: Number(row.usable_days ?? 0) }));
}

export interface DailyRawMetricCoverage {
  positiveDays: number; zeroDays: number; negativeDays: number; partialDays: number; conflictDays: number; missingDays: number;
  firstObservedDay: string | null; lastObservedDay: string | null; firstVerifiedDay: string | null; lastVerifiedDay: string | null;
  minValue: number | null; maxValue: number | null;
}
export interface DailyRawCoverage { assets: number; days: number; receipts: number; sources: number; revisions: number; storageBytes: number; metrics: Record<DailyRawMetric, DailyRawMetricCoverage> }
/** SQL aggregates return only coverage, never all historical JSON payloads. */
export async function dailyRawCoverage(db: Client, asset?: DailyRawAsset): Promise<DailyRawCoverage> {
  if (asset) assertDailyRawAsset(asset);
  const filter = asset ? " WHERE asset_id=(SELECT id FROM daily_raw_assets WHERE slug=? AND identity=?)" : "", args = asset ? [asset.slug, asset.identity] : [];
  const select = DAILY_RAW_METRICS.flatMap(metric => [
    ...["missing", "positive", "zero", "negative", "partial", "conflict"].map((state, code) => `SUM(CASE WHEN ${metric}_state=${code} THEN 1 ELSE 0 END) AS ${metric}_${state}`),
    `MIN(CASE WHEN ${metric}_state BETWEEN 1 AND 4 THEN day END) AS ${metric}_first_observed`, `MAX(CASE WHEN ${metric}_state BETWEEN 1 AND 4 THEN day END) AS ${metric}_last_observed`,
    `MIN(CASE WHEN ${metric}_state BETWEEN 1 AND 3 THEN day END) AS ${metric}_first_verified`, `MAX(CASE WHEN ${metric}_state BETWEEN 1 AND 3 THEN day END) AS ${metric}_last_verified`,
    `CAST(MIN(CASE WHEN ${metric}_state BETWEEN 1 AND 3 THEN ${metric} END) AS REAL) AS ${metric}_min`, `CAST(MAX(CASE WHEN ${metric}_state BETWEEN 1 AND 3 THEN ${metric} END) AS REAL) AS ${metric}_max`,
  ]);
  const results = await historyReadBatch(db, [
    { sql: `SELECT COUNT(*) AS days,${select.join(",")} FROM daily_raw_days${filter}`, args },
    { sql: `SELECT COUNT(*) AS assets FROM daily_raw_assets${asset ? " WHERE slug=? AND identity=?" : ""}`, args },
    { sql: `SELECT COUNT(*) AS sources,COUNT(DISTINCT receipt_id) AS receipts FROM daily_raw_sources${filter}`, args },
    { sql: `SELECT COUNT(*) AS revisions FROM daily_raw_revisions${filter}`, args },
  ]);
  const row = results[0].rows[0], nullable = (key: string) => row[key] === null ? null : String(row[key]);
  const metrics = Object.fromEntries(DAILY_RAW_METRICS.map(metric => [metric, {
    positiveDays: Number(row[`${metric}_positive`] ?? 0), zeroDays: Number(row[`${metric}_zero`] ?? 0), negativeDays: Number(row[`${metric}_negative`] ?? 0), partialDays: Number(row[`${metric}_partial`] ?? 0), conflictDays: Number(row[`${metric}_conflict`] ?? 0), missingDays: Number(row[`${metric}_missing`] ?? 0),
    firstObservedDay: nullable(`${metric}_first_observed`), lastObservedDay: nullable(`${metric}_last_observed`), firstVerifiedDay: nullable(`${metric}_first_verified`), lastVerifiedDay: nullable(`${metric}_last_verified`), minValue: row[`${metric}_min`] === null ? null : Number(row[`${metric}_min`]), maxValue: row[`${metric}_max`] === null ? null : Number(row[`${metric}_max`]),
  }])) as Record<DailyRawMetric, DailyRawMetricCoverage>;
  return { assets: Number(results[1].rows[0].assets), days: Number(row.days), sources: Number(results[2].rows[0].sources), receipts: Number(results[2].rows[0].receipts), revisions: Number(results[3].rows[0].revisions), storageBytes: await storageBytes(db), metrics };
}

/** Check source ownership explicitly; libsql connection-level foreign-key settings may differ. */
export interface DailyRawReferenceAudit {
  ok: boolean; invalidIdentities: number; orphanDays: number; orphanSourceAssets: number; orphanSourceReceipts: number;
  mismatchedDayReferences: number; invalidValues: number; orphanRevisionAssets: number; mismatchedRevisionReferences: number;
  missingRevisionPredecessors: number; runBudgetErrors: number; monthlyBudgetErrors: number;
}
export async function auditDailyRawReferences(db: Client): Promise<DailyRawReferenceAudit> {
  const invalid = DAILY_RAW_METRICS.map(metric => `NOT((${metric}_state IN (0,5) AND ${metric} IS NULL) OR (${metric}_state=1 AND ${metric} IS NOT NULL AND ${metric}>0) OR (${metric}_state=2 AND ${metric} IS NOT NULL AND ${metric}=0) OR (${metric}_state=3 AND ${metric} IS NOT NULL AND ${metric}<0) OR (${metric}_state=4)) OR (${metric}_state<>0 AND ${metric}_source IS NULL)`).join(" OR ");
  const ownership = DAILY_RAW_METRICS.map(metric => `(d.${metric}_source IS NOT NULL AND NOT EXISTS(SELECT 1 FROM daily_raw_sources s WHERE s.id=d.${metric}_source AND s.asset_id=d.asset_id AND s.metric='${metric}'))`).join(" OR ");
  const result = await historyRead(db, `SELECT
    (SELECT COUNT(*) FROM daily_raw_assets WHERE TRIM(slug)='' OR INSTR(identity,':')<2 OR identity='unlinked') AS invalidIdentities,
    (SELECT COUNT(*) FROM daily_raw_days d LEFT JOIN daily_raw_assets a ON a.id=d.asset_id WHERE a.id IS NULL) AS orphanDays,
    (SELECT COUNT(*) FROM daily_raw_sources s LEFT JOIN daily_raw_assets a ON a.id=s.asset_id WHERE a.id IS NULL) AS orphanSourceAssets,
    (SELECT COUNT(*) FROM daily_raw_sources s LEFT JOIN daily_raw_receipts r ON r.id=s.receipt_id WHERE r.id IS NULL) AS orphanSourceReceipts,
    (SELECT COUNT(*) FROM daily_raw_days d WHERE ${ownership}) AS mismatchedDayReferences,
    (SELECT COUNT(*) FROM daily_raw_days WHERE ${invalid} OR price<0 OR mcap<0 OR fdv<0) AS invalidValues,
    (SELECT COUNT(*) FROM daily_raw_revisions e LEFT JOIN daily_raw_assets a ON a.id=e.asset_id WHERE a.id IS NULL) AS orphanRevisionAssets,
    (SELECT COUNT(*) FROM daily_raw_revisions e LEFT JOIN daily_raw_sources p ON p.id=e.previous_source LEFT JOIN daily_raw_sources n ON n.id=e.next_source WHERE (e.previous_source IS NOT NULL AND (p.id IS NULL OR p.asset_id<>e.asset_id OR p.metric<>e.metric)) OR (e.next_source IS NOT NULL AND (n.id IS NULL OR n.asset_id<>e.asset_id OR n.metric<>e.metric))) AS mismatchedRevisionReferences,
    (SELECT COUNT(*) FROM daily_raw_sources s LEFT JOIN daily_raw_sources p ON p.id=s.revision_of WHERE s.revision_of IS NOT NULL AND (p.id IS NULL OR p.asset_id<>s.asset_id OR p.metric<>s.metric)) AS missingRevisionPredecessors,
    (SELECT COUNT(*) FROM daily_raw_runs WHERE estimated_writes<0 OR estimated_writes>max_estimated_writes) AS runBudgetErrors,
    (SELECT COUNT(*) FROM history_budget WHERE reserved<0${unmeteredLocalClients.has(db) ? "" : ` OR reserved>${HISTORY_WRITE_LIMIT}`}) AS monthlyBudgetErrors`);
  const counts = Object.fromEntries(result.columns.map(key => [key, Number(result.rows[0][key])]));
  return { ok: Object.values(counts).every(value => value === 0), ...counts } as DailyRawReferenceAudit;
}

export async function getDailyRawSources(db: Client, asset: DailyRawAsset): Promise<DailyRawSource[]> {
  assertDailyRawAsset(asset);
  const result = await historyRead(db, { sql: `${sourceSelect} WHERE s.asset_id=(SELECT id FROM daily_raw_assets WHERE slug=? AND identity=?) ORDER BY s.id`, args: [asset.slug, asset.identity] });
  return result.rows.map(readSource);
}

export function dailyRawImportPoints(points: DailyRawStoredPoint[]): DailyRawPoint[] {
  return points.map(point => Object.fromEntries([["day", point.day], ...DAILY_RAW_METRICS.map(metric => [metric, { ...point[metric], state: ["positive", "zero", "negative"].includes(point[metric].state) ? "complete" : point[metric].state }])]) as DailyRawPoint);
}

interface DailyRawCopyOptions {
  runId: string; maxEstimatedWrites: number;
  /** Hash of the sealed staging database/manifest. It must stay unchanged while this run resumes. */
  stagingId: string; now?: Date; batchSize?: number; requireArchives?: boolean;
  maxAssets?: number; hasTime?: () => boolean;
  onBatch?: (progress: { asset: DailyRawAsset; daysWritten: number; estimatedWrites: number; complete: boolean }) => void | Promise<void>;
}
export interface DailyRawCopyResult { assetsCompleted: number; assetsSkipped: number; emptyAssetsSkipped: number; daysWritten: number; rowsWritten: number; estimatedWrites: number; accountingVersion: RawAccountingVersion; pendingAssets: number; stopped: boolean }

async function copyRevisions(from: Client, to: Client, asset: DailyRawAsset, runId: string, checkpointKey: string, now: Date, hasTime: () => boolean) {
  const local = unmeteredLocalClients.has(to);
  let after = Number((await getDailyRawCheckpoint(to, runId, checkpointKey))?.cursor ?? 0), rowsWritten = 0, estimatedWrites = 0;
  for (;;) {
    if (!hasTime()) return { rowsWritten, estimatedWrites, stopped: true };
    const revisions = await historyRead(from, { sql: `SELECT e.*,p.source_key AS previous_key,n.source_key AS next_key FROM daily_raw_revisions e LEFT JOIN daily_raw_sources p ON p.id=e.previous_source LEFT JOIN daily_raw_sources n ON n.id=e.next_source WHERE e.asset_id=(SELECT id FROM daily_raw_assets WHERE slug=? AND identity=?) AND e.id>? ORDER BY e.id LIMIT 500`, args: [asset.slug, asset.identity, after] });
    if (!revisions.rows.length) return { rowsWritten, estimatedWrites, stopped: false };
    const tx = await to.transaction("write");
    try {
      const reads = await tx.batch([
        { sql: "SELECT id FROM daily_raw_assets WHERE slug=? AND identity=?", args: [asset.slug, asset.identity] },
        { sql: "SELECT id,source_key,metric FROM daily_raw_sources WHERE asset_id=(SELECT id FROM daily_raw_assets WHERE slug=? AND identity=?)", args: [asset.slug, asset.identity] },
        { sql: "SELECT * FROM daily_raw_runs WHERE id=?", args: [runId] },
        { sql: "SELECT reserved FROM history_budget WHERE month=?", args: [now.toISOString().slice(0, 7)] },
        { sql: "SELECT cursor FROM daily_raw_checkpoints WHERE run_id=? AND checkpoint_key=?", args: [runId, checkpointKey] },
        "PRAGMA page_count", "PRAGMA page_size",
      ]);
      const assetId = Number(reads[0].rows[0]?.id), byKey = new Map(reads[1].rows.map(row => [String(row.source_key), { id: Number(row.id), metric: String(row.metric) }]));
      if (!reads[2].rows.length) throw Error("Daily raw run has not been opened");
      const run = readRun(reads[2].rows[0]), eventKeys: string[] = [];
      const statements: InStatement[] = revisions.rows.map(row => {
        const previous = row.previous_key === null ? null : byKey.get(String(row.previous_key)), next = row.next_key === null ? null : byKey.get(String(row.next_key));
        if ((row.previous_key !== null && (!previous || previous.metric !== row.metric)) || (row.next_key !== null && (!next || next.metric !== row.metric))) throw Error("Daily raw revision has no exact source reference");
        const eventKey = dailyRawHash([assetId, row.day, row.metric, row.kind, row.next_value, row.next_state, next?.id ?? null, row.next_at]);
        eventKeys.push(eventKey);
        return { sql: "INSERT INTO daily_raw_revisions(event_key,asset_id,day,metric,kind,previous_value,previous_state,previous_source,previous_at,next_value,next_state,next_source,next_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING", args: [eventKey, assetId, row.day, row.metric, row.kind, row.previous_value, row.previous_state, previous?.id ?? null, row.previous_at, row.next_value, row.next_state, next?.id ?? null, row.next_at] };
      });
      const existing = await tx.execute({ sql: "SELECT event_key FROM daily_raw_revisions WHERE event_key IN (SELECT value FROM json_each(?))", args: [JSON.stringify(eventKeys)] });
      const alreadyPresent = new Set(existing.rows.map(row => String(row.event_key))), pending = statements.filter((_, i) => !alreadyPresent.has(eventKeys[i]));
      after = Number(revisions.rows.at(-1)!.id);
      if (!pending.length && Number(reads[4].rows[0]?.cursor ?? 0) >= after) { await tx.commit(); continue; }
      const required = estimatedCost({ plain: 1, indexed: pending.length }, run.accountingVersion), monthlyRemaining = HISTORY_WRITE_LIMIT - Number(reads[3].rows[0]?.reserved ?? 0), runRemaining = run.maxEstimatedWrites - run.estimatedWrites;
      if (!local && required > monthlyRemaining) throw new DailyRawPreflightBudgetExceeded("monthly", required, monthlyRemaining);
      if (required > runRemaining) throw new DailyRawPreflightBudgetExceeded("run", required, runRemaining);
      if (!local && Number(reads[5].rows[0][0]) * Number(reads[6].rows[0][0]) + Buffer.byteLength(JSON.stringify(pending)) * 2 + Number(reads[6].rows[0][0]) * 4 >= HISTORY_STORAGE_LIMIT) throw new HistoryBudgetExceeded("history_storage_budget");
      const counts: RawWriteCounts = { plain: 0, indexed: 0 };
      for (let i = 0; i < pending.length; i += 100) for (const result of await tx.batch(pending.slice(i, i + 100))) counts.indexed += result.rowsAffected;
      counts.plain += (await tx.execute({ sql: "INSERT INTO daily_raw_checkpoints(run_id,checkpoint_key,cursor,status,rows_written,days_written) VALUES(?,?,?,'running',?,0) ON CONFLICT(run_id,checkpoint_key) DO UPDATE SET cursor=excluded.cursor,rows_written=rows_written+excluded.rows_written", args: [runId, checkpointKey, String(after), counts.indexed] })).rowsAffected;
      const cost = await reserve(tx, runId, counts, 0, now, run.accountingVersion, local);
      await tx.commit();
      rowsWritten += counts.plain + counts.indexed + 1;
      estimatedWrites += cost;
    } finally { tx.close(); }
  }
}

/** Copy merged staging rows once, remapping source IDs by immutable keys instead of copying integer IDs. */
export async function copyDailyRaw(from: Client, to: Client, options: DailyRawCopyOptions): Promise<DailyRawCopyResult> {
  if (from === to || !/^[a-f0-9]{64}$/i.test(options.stagingId)) throw Error("Daily raw copy requires a sealed, separate staging database");
  const now = options.now ?? new Date(), batchSize = options.batchSize ?? 500;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) throw Error("Invalid daily raw copy batch size");
  if (options.maxAssets !== undefined && (!Number.isSafeInteger(options.maxAssets) || options.maxAssets < 1)) throw Error("Invalid daily raw copy asset limit");
  const hasTime = options.hasTime ?? (() => true);
  const registry = await listDailyRawAssets(from), assets = registry.filter(asset => asset.days > 0), emptyAssetsSkipped = registry.length - assets.length;
  const before = await getDailyRawRun(to, options.runId);
  if (!assets.length) {
    const stage = before ? await getDailyRawCheckpoint(to, options.runId, "copy:staging") : null;
    if (stage && stage.cursor !== options.stagingId) throw Error("Daily raw staging changed while resuming a run");
    return { assetsCompleted: 0, assetsSkipped: 0, emptyAssetsSkipped, daysWritten: 0, rowsWritten: 0, estimatedWrites: 0, accountingVersion: before?.accountingVersion ?? DAILY_RAW_ACCOUNTING_VERSION, pendingAssets: 0, stopped: false };
  }
  const run = await openDailyRawRun(to, { id: options.runId, maxEstimatedWrites: options.maxEstimatedWrites, now });
  const evidence = await historyRead(from, "SELECT DISTINCT asset_id FROM daily_raw_revisions");
  const auditAssetIds = new Set(evidence.rows.map(row => Number(row.asset_id)));
  const checkpoints = await historyRead(to, { sql: "SELECT checkpoint_key,cursor,status FROM daily_raw_checkpoints WHERE run_id=?", args: [options.runId] });
  const knownCheckpoints = new Map(checkpoints.rows.map(row => [String(row.checkpoint_key), { cursor: String(row.cursor), status: String(row.status) }]));
  let stage = knownCheckpoints.get("copy:staging");
  if (stage && stage.cursor !== options.stagingId) throw Error("Daily raw staging changed while resuming a run");
  const complete = new Set([...knownCheckpoints].filter(([, checkpoint]) => checkpoint.status === "complete").map(([key]) => key));
  const total: DailyRawCopyResult = { assetsCompleted: 0, assetsSkipped: 0, emptyAssetsSkipped, daysWritten: 0, rowsWritten: 0, estimatedWrites: 0, accountingVersion: run.accountingVersion, pendingAssets: 0, stopped: false };
  const account = (result: Pick<DailyRawWriteResult, "daysWritten" | "rowsWritten" | "estimatedWrites">) => { total.daysWritten += result.daysWritten; total.rowsWritten += result.rowsWritten; total.estimatedWrites += result.estimatedWrites; };
  const finish = async (stopped: boolean) => {
    const final = (await getDailyRawRun(to, options.runId))!;
    total.rowsWritten = final.rowsWritten - (before?.rowsWritten ?? 0);
    total.estimatedWrites = final.estimatedWrites - (before?.estimatedWrites ?? 0);
    total.pendingAssets = assets.filter(asset => !complete.has(`copy:${asset.slug}:${asset.identity}`)).length;
    total.stopped = stopped;
    return total;
  };
  for (const asset of assets) {
    const key = `copy:${asset.slug}:${asset.identity}`, checkpoint = knownCheckpoints.get(key);
    if (checkpoint?.status === "complete") { total.assetsSkipped++; continue; }
    if (!hasTime() || total.assetsCompleted >= (options.maxAssets ?? Infinity)) return finish(true);
    const sources = await getDailyRawSources(from, asset);
    const simpleCopy = !auditAssetIds.has(asset.assetId) && !sources.some(source => source.revisionOf);
    if (options.requireArchives !== false && sources.some(source => !source.archiveUrl)) throw Error("Daily raw publish requires archived source receipts");
    if (!stage) {
      account(await upsertDailyRaw(to, { runId: options.runId, asset, sources: [], points: [], checkpoint: { key: "copy:staging", cursor: options.stagingId }, now }));
      stage = { cursor: options.stagingId, status: "running" };
    }
    for (let i = 0; !simpleCopy && i < sources.length; i += 100) {
      if (!hasTime()) return finish(true);
      account(await upsertDailyRaw(to, { runId: options.runId, asset, sources: sources.slice(i, i + 100), points: [], now }));
    }
    let after = checkpoint?.cursor, completedWithData = false;
    for (;;) {
      if (!hasTime()) return finish(true);
      const page = await readDailyRaw(from, { asset, after, limit: batchSize });
      if (!page?.points.length) break;
      const imported = dailyRawImportPoints(page.points), sourceByKey = new Map(sources.map(source => [source.key, source]));
      // A page with many archived quote receipts is split at 100 distinct sources.
      for (let start = 0; start < imported.length;) {
        if (!hasTime()) return finish(true);
        const keys = new Set<string>();
        let end = start;
        while (end < imported.length) {
          const required = DAILY_RAW_METRICS.map(metric => imported[end][metric]!.source).filter(Boolean), additions = required.filter(source => !keys.has(source));
          if (keys.size + new Set(additions).size > 100 && end > start) break;
          required.forEach(source => keys.add(source));
          end++;
        }
        const points = imported.slice(start, end), selected = [...keys].map(source => sourceByKey.get(source)!);
        if (selected.some(source => !source)) throw Error("Daily raw staging has a broken source reference");
        const finalChunk = simpleCopy && !page.nextCursor && end === imported.length;
        const result = await upsertDailyRaw(to, { runId: options.runId, asset, sources: selected, points, checkpoint: { key, cursor: points.at(-1)!.day, status: finalChunk ? "complete" : "running" }, now });
        account(result);
        completedWithData = finalChunk;
        await options.onBatch?.({ asset, daysWritten: result.daysWritten, estimatedWrites: result.estimatedWrites, complete: finalChunk });
        start = end;
      }
      after = page.points.at(-1)!.day;
      if (!page.nextCursor) break;
    }
    if (!simpleCopy) {
      const revisions = await copyRevisions(from, to, asset, options.runId, `${key}:revisions`, now, hasTime);
      account({ ...revisions, daysWritten: 0 });
      if (revisions.stopped) return finish(true);
    }
    if (!completedWithData) account(await upsertDailyRaw(to, { runId: options.runId, asset, sources: [], points: [], checkpoint: { key, cursor: after ?? "", status: "complete" }, now }));
    total.assetsCompleted++;
    complete.add(key);
    if (!completedWithData) await options.onBatch?.({ asset, daysWritten: 0, estimatedWrites: 0, complete: true });
  }
  return finish(false);
}
