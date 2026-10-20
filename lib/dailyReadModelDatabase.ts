import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Client, Row } from "@libsql/client";
import { historyRead } from "./historyDatabase";
import { deleteDailyRawReadModels, writeDailyRawReadModel } from "./dailyRawDatabase";

export const DAILY_READ_MODEL_MAX_JSON = 32 * 1024 * 1024;
export const DAILY_READ_MODEL_MAX_GZIP = 4 * 1024 * 1024;
export interface DailyReadModel { key: string; revision: string; sha256: string; payload: Uint8Array; metadata: unknown; builtAt: string }
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
export function canonicalReadModelJSON(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical) : input && typeof input === "object"
    ? Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, canonical(value)])) : input;
  return JSON.stringify(canonical(value));
}
export async function initializeDailyReadModels(db: Client) {
  await db.execute("CREATE TABLE IF NOT EXISTS daily_read_models(namespace TEXT NOT NULL,model_key TEXT NOT NULL,revision TEXT NOT NULL,sha256 TEXT NOT NULL,payload BLOB NOT NULL,metadata TEXT NOT NULL,metadata_sha256 TEXT NOT NULL,built_at TEXT NOT NULL,PRIMARY KEY(namespace,model_key)) WITHOUT ROWID");
}
const validKey = (value: string) => typeof value === "string" && value.length > 0 && value.length <= 512;
export function readModelRow(row: Row): DailyReadModel {
  if (!(row.payload instanceof ArrayBuffer) && !ArrayBuffer.isView(row.payload)) throw Error("daily_read_model_invalid_blob");
  const payload = row.payload instanceof ArrayBuffer ? new Uint8Array(row.payload) : new Uint8Array(row.payload.buffer, row.payload.byteOffset, row.payload.byteLength);
  if (payload.byteLength > DAILY_READ_MODEL_MAX_GZIP) throw Error("daily_read_model_blob_too_large");
  return { key: String(row.model_key), revision: String(row.revision), sha256: String(row.sha256), payload, metadata: readModelMetadata(row), builtAt: String(row.built_at) };
}
export function readModelMetadata(row: Row): unknown {
  if (hash(String(row.metadata)) !== row.metadata_sha256) throw Error("daily_read_model_metadata_hash_mismatch");
  return JSON.parse(String(row.metadata));
}
export async function readDailyReadModels(db: Client, options: { namespace: string; keys: string[] }): Promise<DailyReadModel[]> {
  if (!validKey(options.namespace) || options.keys.length > 500 || options.keys.some(key => !validKey(key))) throw Error("daily_read_model_invalid_keys");
  if (!options.keys.length) return [];
  const result = await historyRead(db, { sql: "SELECT model_key,revision,sha256,payload,metadata,metadata_sha256,built_at FROM daily_read_models WHERE namespace=? AND model_key IN (SELECT value FROM json_each(?))", args: [options.namespace, JSON.stringify(options.keys)] });
  return result.rows.map(readModelRow);
}
export function decodeDailyReadModel<T>(row: DailyReadModel): T {
  const bytes = gunzipSync(row.payload, { maxOutputLength: DAILY_READ_MODEL_MAX_JSON });
  if (hash(bytes) !== row.sha256) throw Error("daily_read_model_hash_mismatch");
  return JSON.parse(bytes.toString("utf8")) as T;
}
/** No write retry: inspect the stored revision/hash after an unknown transport outcome. */
export async function writeDailyReadModel(db: Client, options: {
  runId: string; namespace: string; key: string; revision: string; json: unknown; metadata: unknown;
  expectedRaw?: { assetId: number; revision: number }; minimumReserve?: number; immutable?: boolean; now?: Date;
}) {
  if (![options.namespace, options.key, options.revision].every(validKey)) throw Error("daily_read_model_invalid_key");
  const json = canonicalReadModelJSON(options.json), metadata = canonicalReadModelJSON(options.metadata);
  if (Buffer.byteLength(json) > DAILY_READ_MODEL_MAX_JSON || Buffer.byteLength(metadata) > 1_000_000) throw Error("daily_read_model_json_too_large");
  const payload = gzipSync(json, { level: 9 });
  if (payload.byteLength > DAILY_READ_MODEL_MAX_GZIP) throw Error("daily_read_model_blob_too_large");
  const result = await writeDailyRawReadModel(db, { ...options, metadata, metadataSha256: hash(metadata), payload, sha256: hash(json) });
  return { ...result, compressedBytes: payload.byteLength, jsonBytes: Buffer.byteLength(json) };
}
export async function deleteDailyReadModels(db: Client, options: { runId: string; namespace: string; keys: string[]; minimumReserve?: number; now?: Date }) {
  if (!validKey(options.namespace) || options.keys.length > 500 || options.keys.some(key => !validKey(key))) throw Error("daily_read_model_invalid_keys");
  return deleteDailyRawReadModels(db, options);
}
