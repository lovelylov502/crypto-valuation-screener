import type { DailyRawSource, DailyRawStoredState } from "./dailyRawData";
import type { DailyValuationCell, DailyValuationHistory, DailyValuationHistoryPoint, DailyValuationRatio, DailyValuationReason } from "./dailyValuationRead";
import type { CapitalBasis } from "./valuationMetrics";

/** Browser-safe wire contract. Runtime imports must not pull in the database or Node. */
export interface DailyHistoryVersion {
  schema: 3; calculationVersion: string; asset: { slug: string; identity: string; snapshotId: string };
  asOf: string; rawRevision: string; revenueDays: 1;
  freshness: DailyValuationHistory["freshness"]; convention: string;
}
export interface CompactHistoryEnvelope extends DailyHistoryVersion { encoding: "gzip-base64"; sha256: string; payload: string }
export type CompactCell = [number | null, DailyRawStoredState, number, string | null, DailyValuationReason | null];
export type CompactRatio = [number | null, DailyValuationReason | null, number];
export type CompactHistoryPoint = [string, CompactCell[], CompactRatio[]];
export interface CompactHistoryData { schema: 1; sources: DailyRawSource[]; definitions: string[]; points: CompactHistoryPoint[] }
export interface DecodedCompactHistory { version: DailyHistoryVersion; data: CompactHistoryData }
export const COMPACT_HISTORY_MAX_POINTS = 32_000;
export const COMPACT_HISTORY_MAX_BYTES = 32 * 1024 * 1024;
const metrics = ["price", "mcap", "fdv", "fees", "revenue", "holders"] as const;
const states = ["missing", "positive", "zero", "negative", "partial", "conflict"];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const amount = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value);
const reason = (value: unknown) => value === null || typeof value === "string";
export function dailyHistoryVersionValid(value: unknown): value is DailyHistoryVersion {
  return record(value) && value.schema === 3 && value.calculationVersion === "daily-raw-same-day-v1" && record(value.asset)
    && typeof value.asset.slug === "string" && typeof value.asset.identity === "string" && typeof value.asset.snapshotId === "string"
    && date(value.asOf) && typeof value.rawRevision === "string" && /^[a-f0-9]{64}$/.test(value.rawRevision) && value.revenueDays === 1
    && typeof value.convention === "string" && record(value.freshness) && Number.isInteger(value.freshness.lagDays) && Number(value.freshness.lagDays) >= 0
    && ["current", "stale"].includes(String(value.freshness.status)) && (value.freshness.reason === null || value.freshness.reason === "stale_data");
}
export function compactHistoryDataValid(value: unknown): value is CompactHistoryData {
  if (!record(value) || value.schema !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.definitions) || !Array.isArray(value.points)
    || value.points.length > COMPACT_HISTORY_MAX_POINTS || value.definitions.some(definition => typeof definition !== "string")) return false;
  const sources = value.sources, definitions = value.definitions, points = value.points;
  if (sources.some(source => !record(source) || !["key", "metric", "provider", "url", "observedAt", "sha256", "scope", "definition", "basis"].every(key => typeof source[key] === "string") || !metrics.includes(source.metric as typeof metrics[number]))) return false;
  return points.every((point: unknown, index: number) => Array.isArray(point) && point.length === 3 && date(point[0])
    && (index === 0 || point[0] > points[index - 1][0]) && Array.isArray(point[1]) && point[1].length === 6
    && point[1].every((cell: unknown, metric: number) => Array.isArray(cell) && cell.length === 5 && amount(cell[0]) && states.includes(cell[1])
      && Number.isInteger(cell[2]) && cell[2] >= -1 && cell[2] < sources.length && (cell[2] === -1 || sources[cell[2]].metric === metrics[metric])
      && (cell[3] === null || typeof cell[3] === "string" && Number.isFinite(Date.parse(cell[3]))) && reason(cell[4]))
    && Array.isArray(point[2]) && point[2].length === 4 && point[2].every((ratio: unknown) => Array.isArray(ratio) && ratio.length === 3 && amount(ratio[0])
      && (ratio[0] === null || ratio[0] > 0) && reason(ratio[1]) && Number.isInteger(ratio[2]) && ratio[2] >= -1 && ratio[2] < definitions.length
      && (ratio[0] === null || ratio[1] === null && ratio[2] >= 0)));
}
export function compactDailyHistory(fdv: DailyValuationHistoryPoint[], mcap: DailyValuationHistoryPoint[], sources: DailyRawSource[]): CompactHistoryData {
  if (fdv.length !== mcap.length || fdv.length > COMPACT_HISTORY_MAX_POINTS) throw Error("daily_history_compact_point_count");
  const sourceIds = new Map(sources.map((source, index) => [source.key, index])), definitions: string[] = [];
  const ratio = (value: DailyValuationRatio): CompactRatio => {
    if (value.financialDefinition !== null && !definitions.includes(value.financialDefinition)) definitions.push(value.financialDefinition);
    return [value.value, value.reason, value.financialDefinition === null ? -1 : definitions.indexOf(value.financialDefinition)];
  };
  const points = fdv.map((point, index): CompactHistoryPoint => {
    if (point.day !== mcap[index].day) throw Error("daily_history_compact_date_mismatch");
    return [point.day, metrics.map(metric => { const cell = point[metric]; return [cell.value, cell.state, sourceIds.get(cell.source) ?? -1, cell.at, cell.reason]; }), [ratio(point.pr), ratio(point.phr), ratio(mcap[index].pr), ratio(mcap[index].phr)]];
  });
  const data: CompactHistoryData = { schema: 1, sources, definitions, points };
  if (!compactHistoryDataValid(data)) throw Error("daily_history_compact_invalid_data");
  return data;
}
export async function decodeCompactHistory(value: unknown): Promise<DecodedCompactHistory> {
  if (!dailyHistoryVersionValid(value) || !record(value) || value.encoding !== "gzip-base64" || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.payload !== "string" || value.payload.length > 6_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.payload)) throw Error("daily_history_compact_invalid_envelope");
  const binary = atob(value.payload), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > COMPACT_HISTORY_MAX_BYTES) throw Error("daily_history_compact_too_large"); chunks.push(chunk.value); }
  } finally { await reader.cancel(); }
  const decoded = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { decoded.set(chunk, offset); offset += chunk.length; }
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", decoded)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (sha256 !== value.sha256) throw Error("daily_history_compact_hash_mismatch");
  const data: unknown = JSON.parse(new TextDecoder().decode(decoded));
  if (!compactHistoryDataValid(data) || data.points.some(point => point[0] > value.asOf)) throw Error("daily_history_compact_invalid_data");
  const { schema, calculationVersion, asset, asOf, rawRevision, revenueDays, freshness, convention } = value;
  return { version: { schema, calculationVersion, asset, asOf, rawRevision, revenueDays, freshness, convention }, data };
}
export function expandCompactHistory(decoded: DecodedCompactHistory, capital: CapitalBasis, from = "1900-01-01", to = decoded.version.asOf): DailyValuationHistory {
  const { version, data } = decoded, offset = capital === "fdv" ? 0 : 2;
  const ratio = (value: CompactRatio): DailyValuationRatio => ({ value: value[0], reason: value[1], financialDefinition: value[2] < 0 ? null : data.definitions[value[2]] });
  const points = data.points.filter(point => point[0] >= from && point[0] <= to && point[0] <= version.asOf).map(([day, cells, ratios]): DailyValuationHistoryPoint => ({
    day, ...Object.fromEntries(metrics.map((metric, index) => { const cell = cells[index]; return [metric, { value: cell[0], state: cell[1], source: cell[2] < 0 ? "" : data.sources[cell[2]].key, at: cell[3], reason: cell[4] } satisfies DailyValuationCell]; })) as Record<typeof metrics[number], DailyValuationCell>, pr: ratio(ratios[offset]), phr: ratio(ratios[offset + 1]),
  }));
  const keys = new Set(points.flatMap(point => metrics.map(metric => point[metric].source)));
  return { ...version, schema: 2, calculationVersion: "daily-raw-same-day-v1", capital, points, sources: data.sources.filter(source => keys.has(source.key)), nextCursor: null };
}
