import { createHash } from "node:crypto";

export const DAILY_RAW_METRICS = ["price", "mcap", "fdv", "fees", "revenue", "holders"] as const;
export type DailyRawMetric = typeof DAILY_RAW_METRICS[number];
export type DailyRawState = "complete" | "partial" | "missing" | "conflict";
export type DailyRawStoredState = "missing" | "positive" | "zero" | "negative" | "partial" | "conflict";
export const DAILY_RAW_STATES: DailyRawStoredState[] = ["missing", "positive", "zero", "negative", "partial", "conflict"];

export interface DailyRawAsset { slug: string; identity: string }
export interface DailyRawSource {
  key: string; metric: DailyRawMetric; provider: string; url: string; observedAt: string; sha256: string;
  archiveUrl?: string; scope: string; definition: string; basis: string; revisionOf?: string;
}
export interface DailyRawWitness { value: number | null; state: DailyRawState; source: string; at?: string | null }
export interface DailyRawObservation extends DailyRawWitness { witnesses?: DailyRawWitness[] }
export type DailyRawPoint = { day: string } & Partial<Record<DailyRawMetric, DailyRawObservation>>;
export interface DailyRawStoredObservation { value: number | null; state: DailyRawStoredState; source: string; at: string | null }
export type DailyRawStoredPoint = { day: string } & Record<DailyRawMetric, DailyRawStoredObservation>;
export interface DailyRawCheckpoint { key: string; cursor: string; status?: "running" | "complete" }

export const dailyRawHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function assertDailyRawDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw Error("Invalid daily raw UTC date");
}
export function assertDailyRawAsset(asset: DailyRawAsset) {
  if (!asset.slug?.trim() || !/^[a-z][a-z0-9_-]*:[^\s]+$/.test(asset.identity)) throw Error("Daily raw requires an exact linked token identity");
}
export function assertDailyRawSource(source: DailyRawSource) {
  if (!DAILY_RAW_METRICS.includes(source.metric)) throw Error("Invalid daily raw metric");
  for (const key of ["key", "provider", "scope", "definition", "basis"] as const) if (!source[key]?.trim()) throw Error(`Daily raw source requires ${key}`);
  if (!/^https?:\/\//.test(source.url) || !Number.isFinite(Date.parse(source.observedAt)) || !/^[a-f0-9]{64}$/i.test(source.sha256)) throw Error("Invalid daily raw receipt");
  if (source.archiveUrl && !/^https?:\/\//.test(source.archiveUrl)) throw Error("Invalid daily raw archive URL");
}
export function dailyRawStateCode(value: number | null, state: DailyRawState): number {
  if (state === "missing") return 0;
  if (state === "partial") return 4;
  if (state === "conflict") return 5;
  return value! > 0 ? 1 : value === 0 ? 2 : 3;
}
export function assertDailyRawObservation(metric: DailyRawMetric, point: DailyRawPoint, source: DailyRawSource | undefined, now: Date, sources?: ReadonlyMap<string, DailyRawSource>) {
  const observation = point[metric]!;
  if (!["complete", "partial", "missing", "conflict"].includes(observation.state)) throw Error("Invalid daily raw observation state");
  if (observation.value !== null && (typeof observation.value !== "number" || !Number.isFinite(observation.value))) throw Error("Invalid daily raw amount");
  if ((observation.state === "missing" && observation.value !== null) || (observation.state === "complete" && observation.value === null)) throw Error("Daily raw value does not match its state");
  if (observation.value !== null && ["price", "mcap", "fdv"].includes(metric) && observation.value < 0) throw Error("Negative daily raw market amount");
  if ((!source && (observation.state !== "missing" || observation.source)) || (source && source.metric !== metric)) throw Error("Daily raw source does not match the metric");
  if (point.day > now.toISOString().slice(0, 10)) throw Error("Future daily raw date");
  if (observation.state === "complete" && ["fees", "revenue", "holders"].includes(metric) && point.day >= now.toISOString().slice(0, 10)) throw Error("Incomplete daily raw UTC day");
  if (observation.at) {
    const at = Date.parse(observation.at), start = Date.parse(point.day);
    // A verified UTC close may be timestamped exactly at the following midnight.
    const close = source?.basis.includes("utc_day_close") || source?.basis.includes("utc_daily_close");
    if (!Number.isFinite(at) || at < start || at > start + 86_400_000 || (at === start + 86_400_000 && !close) || (source && at > Date.parse(source.observedAt))) throw Error("Daily raw metric timestamp does not match its UTC day");
  }
  if (observation.witnesses) {
    if (observation.state !== "conflict" || observation.witnesses.length < 2 || observation.witnesses.length > 16) throw Error("Invalid daily raw conflict witnesses");
    for (const witness of observation.witnesses) {
      if ("witnesses" in witness) throw Error("Nested daily raw conflict witnesses");
      assertDailyRawObservation(metric, { day: point.day, [metric]: witness }, sources?.get(witness.source), now);
    }
  }
}

export interface RawCell { value: number | null; state: number; sourceId: number | null; at: string | null }
export interface RawSourceMetadata { id: number; key: string; metric: DailyRawMetric; provider: string; url: string; observedAt: string; scope: string; definition: string; basis: string; revisionOf: string | null }
export interface RawMerge { cell: RawCell; kind?: "revision" | "conflict" | "completion" }
const sameAmount = (a: number | null, b: number | null) => a === b;
const complete = (cell: RawCell) => cell.state >= 1 && cell.state <= 3;
const captured = (source: RawSourceMetadata) => source.basis.includes("captured_quote");
const capturedSnapshotArchive = /^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/data-[A-Za-z0-9-]+\/data\.json\.gz$/;
const sameCapturedArchiveSeries = (previous: RawSourceMetadata, source: RawSourceMetadata, old: RawCell, next: RawCell) => previous.metric === source.metric && ["price", "mcap", "fdv"].includes(source.metric)
  && ["CoinGecko", "CoinMarketCap"].includes(source.provider) && source.basis === "captured_quote;actual_provider_timestamp"
  && old.at !== null && next.at !== null && capturedSnapshotArchive.test(previous.url) && capturedSnapshotArchive.test(source.url);
const verifiedClose = (source: RawSourceMetadata) => source.provider === "CoinGecko" && ["price", "mcap"].includes(source.metric) && source.basis.includes("coingecko_web_csv") && source.basis.includes("utc_day_close") && source.basis.includes('"verified":true')
  || source.provider === "CoinMetrics" && source.metric === "fdv" && source.basis === "utc_daily_close_verified_total_supply";

/** A receipt can recover missing data, but cannot silently redefine existing evidence. */
export function mergeDailyRawCell(old: RawCell, next: RawCell, previous: RawSourceMetadata | undefined, source: RawSourceMetadata | undefined): RawMerge {
  if (next.state === 0 && old.state !== 0) return { cell: old };
  if (old.state === 0) return { cell: next };
  if (old.state === 5 && next.sourceId === old.sourceId) return { cell: old };
  const sameMeaning = !!previous && !!source && previous.provider === source.provider && previous.scope === source.scope && previous.definition === source.definition && previous.basis === source.basis;
  if (sameMeaning && old.state === next.state && sameAmount(old.value, next.value)) return { cell: old };
  if (source?.revisionOf && source.revisionOf === previous?.key) return { cell: next, kind: "revision" };
  if (sameMeaning && complete(old) && next.state === 4) return { cell: old };
  if (previous && source && previous.metric === source.metric && old.at && next.at) {
    if (verifiedClose(source) && captured(previous) && old.state !== 5 && complete(next) && Date.parse(next.at) >= Date.parse(old.at)) return { cell: next, kind: "revision" };
    if (verifiedClose(previous) && captured(source) && Date.parse(old.at) >= Date.parse(next.at)) return { cell: old };
  }
  if (sameMeaning && (previous.url === source.url || sameCapturedArchiveSeries(previous, source, old, next))) {
    const observed = Date.parse(source.observedAt) - Date.parse(previous.observedAt);
    if (observed < 0 || captured(source) && old.at && next.at && Date.parse(next.at) < Date.parse(old.at)) return { cell: old };
    if (observed > 0 && complete(next) && old.state !== 5) return { cell: next, kind: "revision" };
  }
  if (sameMeaning && old.state === 4 && complete(next)) return { cell: next, kind: "completion" };
  return { cell: { ...old, value: null, state: 5 }, kind: "conflict" };
}
