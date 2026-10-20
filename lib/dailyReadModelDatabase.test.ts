import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client, type TransactionMode } from "@libsql/client";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "./dailyRawDatabase";
import { canonicalReadModelJSON, decodeDailyReadModel, deleteDailyReadModels, initializeDailyReadModels, readDailyReadModels, writeDailyReadModel } from "./dailyReadModelDatabase";
import { HISTORY_STORAGE_LIMIT, HISTORY_WRITE_LIMIT, HistoryBudgetExceeded } from "./historyDatabase";
let db: Client;
const now = new Date("2026-10-20T12:00:00Z"), options = { runId: "models", namespace: "test", key: "one", revision: "r1", json: { b: [0, null, -2], a: "original" }, metadata: { asOf: "2026-10-18" }, now };
const budget = async () => Number((await db.execute("SELECT reserved FROM history_budget WHERE month='2026-10'")).rows[0].reserved);
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await initializeDailyReadModels(db); await openDailyRawRun(db, { id: "models", maxEstimatedWrites: 100_000, now }); });
afterEach(() => { vi.restoreAllMocks(); db.close(); });
it("stores one canonical compressed row, verifies its source bytes and replays without any write credit", async () => {
  const before = await budget(), first = await writeDailyReadModel(db, options);
  expect(first).toMatchObject({ changed: true, estimatedWrites: 5 }); expect(await budget() - before).toBe(5);
  const [row] = await readDailyReadModels(db, { namespace: "test", keys: ["one"] });
  expect(decodeDailyReadModel(row)).toEqual(options.json); expect(row.metadata).toEqual(options.metadata);
  const replay = await writeDailyReadModel(db, { ...options, json: { a: "original", b: [0, null, -2] }, now: new Date("2026-10-20T13:00:00Z") });
  expect(replay).toMatchObject({ changed: false, estimatedWrites: 0, sha256: first.sha256 });
  expect((await readDailyReadModels(db, { namespace: "test", keys: ["one"] }))[0].builtAt).toBe(now.toISOString());
  expect(canonicalReadModelJSON({ z: { b: 2, a: 1 }, a: 0 })).toBe('{"a":0,"z":{"a":1,"b":2}}');
});
it("preserves an immutable publication and rejects a different receipt under its key", async () => {
  await writeDailyReadModel(db, { ...options, immutable: true }); const before = await budget();
  await expect(writeDailyReadModel(db, { ...options, json: { changed: true }, immutable: true })).rejects.toThrow("immutable_conflict");
  expect(await budget()).toBe(before);
  expect(decodeDailyReadModel((await readDailyReadModels(db, { namespace: "test", keys: ["one"] }))[0])).toEqual(options.json);
});
it("checks the exact raw asset revision before model mutation or quota reservation", async () => {
  const raw = await upsertDailyRaw(db, { runId: "models", asset: { slug: "alpha", identity: "gecko:alpha" }, sources: [], points: [{ day: "2020-01-01" }], now });
  const before = await budget();
  await expect(writeDailyReadModel(db, { ...options, expectedRaw: { assetId: raw.assetId, revision: 0 } })).rejects.toThrow("raw_changed");
  expect(await budget()).toBe(before); expect(await readDailyReadModels(db, { namespace: "test", keys: ["one"] })).toEqual([]);
  expect(await writeDailyReadModel(db, { ...options, expectedRaw: { assetId: raw.assetId, revision: 1 } })).toMatchObject({ changed: true });
});
it("rejects insufficient monthly/reserve or run headroom before any INSERT/UPDATE/DELETE", async () => {
  await db.execute({ sql: "UPDATE history_budget SET reserved=? WHERE month='2026-10'", args: [HISTORY_WRITE_LIMIT - 500_003] });
  const transaction = db.transaction.bind(db), writes: string[] = [];
  vi.spyOn(db, "transaction").mockImplementation(async (mode?: TransactionMode) => {
    const tx = await transaction(mode), execute = tx.execute.bind(tx);
    vi.spyOn(tx, "execute").mockImplementation(async statement => { const sql = typeof statement === "string" ? statement : statement.sql; if (/^(INSERT|UPDATE|DELETE)/.test(sql)) writes.push(sql); return execute(statement); }); return tx;
  });
  await expect(writeDailyReadModel(db, options)).rejects.toBeInstanceOf(HistoryBudgetExceeded); expect(writes).toEqual([]);
  await db.execute("UPDATE history_budget SET reserved=100 WHERE month='2026-10'");
  await openDailyRawRun(db, { id: "tiny", maxEstimatedWrites: 8, now });
  await expect(writeDailyReadModel(db, { ...options, runId: "tiny" })).rejects.toBeInstanceOf(HistoryBudgetExceeded); expect(writes).not.toContainEqual(expect.stringMatching(/^INSERT INTO daily_read_models/));
});
it("preflights the four-GB storage ceiling before a blob write", async () => {
  const transaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation(async (mode?: TransactionMode) => {
    const tx = await transaction(mode), batch = tx.batch.bind(tx);
    vi.spyOn(tx, "batch").mockImplementation(async statements => {
      const result = await batch(statements);
      if (statements.some(statement => statement === "PRAGMA page_count")) result[4] = { ...result[4], rows: [{ ...result[4].rows[0], 0: HISTORY_STORAGE_LIMIT / 4096 }] };
      return result;
    }); return tx;
  });
  const before = await budget(); await expect(writeDailyReadModel(db, options)).rejects.toThrow("storage_budget"); expect(await budget()).toBe(before);
  expect(await readDailyReadModels(db, { namespace: "test", keys: ["one"] })).toEqual([]);
});
it("refuses payload and metadata corruption independently", async () => {
  await writeDailyReadModel(db, options); const [row] = await readDailyReadModels(db, { namespace: "test", keys: ["one"] });
  expect(() => decodeDailyReadModel({ ...row, sha256: "f".repeat(64) })).toThrow("hash_mismatch");
  await db.execute("UPDATE daily_read_models SET metadata='{}'");
  await expect(readDailyReadModels(db, { namespace: "test", keys: ["one"] })).rejects.toThrow("metadata_hash_mismatch");
});
it("deletes only explicit prepared keys, accounts actual rows, and replays an empty retention pass for zero credits", async () => {
  await writeDailyReadModel(db, options); await writeDailyReadModel(db, { ...options, key: "keep" });
  const before = await budget();
  expect(await deleteDailyReadModels(db, { runId: "models", namespace: "test", keys: ["one", "missing"], now })).toEqual({ deleted: 1, estimatedWrites: 5 });
  expect(await budget() - before).toBe(5);
  expect(await deleteDailyReadModels(db, { runId: "models", namespace: "test", keys: ["one"], now })).toEqual({ deleted: 0, estimatedWrites: 0 });
  expect((await readDailyReadModels(db, { namespace: "test", keys: ["keep"] })).length).toBe(1);
  expect(Number((await db.execute("SELECT COUNT(*) n FROM daily_raw_runs")).rows[0].n)).toBe(1);
});
