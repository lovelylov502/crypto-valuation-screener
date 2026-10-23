import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const mocks = vi.hoisted(() => ({ url: "", snapshot: null as unknown }));
vi.mock("../lib/historyDatabase", async original => ({ ...await original<typeof import("../lib/historyDatabase")>(), connectHistory: () => createClient({ url: mocks.url }) }));
vi.mock("../lib/historyCollection", () => ({ loadHistoryReference: async () => ({ id: "verified-test", sha256: "a".repeat(64) }), loadArchivedSnapshot: async () => mocks.snapshot }));
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "../lib/dailyRawDatabase";
import * as storage from "../lib/dailyReadModelDatabase";
import { assembleScreener } from "../lib/screener";
import { sample } from "../lib/testFixtures";
import { prepareDailyHistoryMain } from "../scripts/prepare-daily-history";
let directory: string, db: Client, priorExit: typeof process.exitCode;
const now = new Date("2026-10-20T12:00:00Z");
beforeEach(async () => {
  priorExit = process.exitCode; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.spyOn(console, "log").mockImplementation(() => {});
  directory = await mkdtemp(join(tmpdir(), "history-model-cli-")); mocks.url = pathToFileURL(join(directory, "raw.sqlite")).href; db = createClient({ url: mocks.url });
  await db.execute("PRAGMA journal_mode=WAL"); await initializeDailyRaw(db); await storage.initializeDailyReadModels(db); await openDailyRawRun(db, { id: "source", maxEstimatedWrites: 100_000, now });
  const coins = Array.from({ length: 4 }, (_, i) => sample({ slug: `asset-${i}`, geckoId: `token-${i}`, identityStatus: "verified", mcap: 1_000_000 + i })); mocks.snapshot = assembleScreener(coins, "2026-10-19T23:00:00Z", []);
  for (const coin of coins) {
    const sources = (["fdv", "revenue"] as const).map(metric => ({ key: `${coin.slug}:${metric}`, metric, provider: metric === "fdv" ? "CoinGecko" : "DefiLlama", url: `https://example.test/${coin.slug}/${metric}`, observedAt: now.toISOString(), sha256: "a".repeat(64), scope: coin.slug, definition: `${metric} USD`, basis: metric === "fdv" ? "utc_day_close" : "completed_utc_day_flow" }));
    await upsertDailyRaw(db, { runId: "source", asset: { slug: coin.slug, identity: `gecko:${coin.geckoId}` }, sources, points: [{ day: "2026-10-18", fdv: { value: 365, state: "complete", source: sources[0].key, at: "2026-10-19T00:00:00Z" }, revenue: { value: 1, state: "complete", source: sources[1].key } }], now });
  }
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers(); process.exitCode = priorExit; db.close();
  if (!directory.startsWith(join(tmpdir(), "history-model-cli-"))) throw Error("Unexpected test directory");
  // libsql's native Windows statements can retain a closed temp file until process exit.
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 }).catch(error => { if (error.code !== "EBUSY" && error.code !== "EPERM") throw error; });
});
const report = async (directory: string) => JSON.parse(await readFile(join(directory, "daily-history-model-report.json"), "utf8"));
for (const [reserved, status] of [[7_500_000, "complete"], [8_000_000, "budget-paused"]] as const) it(`prepares current history from the maintenance allowance, respecting ${reserved} reserved credits`, async () => {
  await db.execute({ sql: "UPDATE history_budget SET reserved=? WHERE month='2026-10'", args: [reserved] });
  await prepareDailyHistoryMain(["--cache", directory, "--run-id", "maintenance", "--workers", "1", "--apply"]);
  expect(await report(directory)).toMatchObject({ status, minimumReserve: 0, prepared: status === "complete" ? 4 : 0 });
  expect((await db.execute("SELECT COUNT(*) n FROM daily_read_models")).rows[0].n).toBe(status === "complete" ? 4 : 0);
  const spent = Number((await db.execute("SELECT reserved FROM history_budget WHERE month='2026-10'")).rows[0].reserved);
  expect(spent).toBeGreaterThanOrEqual(reserved); expect(spent).toBeLessThanOrEqual(8_000_000);
});
it("defaults to a zero-write dry-run and rejects unknown or duplicated consequential flags", async () => {
  const before = await db.execute("SELECT reserved FROM history_budget");
  await prepareDailyHistoryMain(["--cache", directory, "--run-id", "dry", "--max-assets", "1", "--workers", "1"]);
  const result = await report(directory); expect(result).toMatchObject({ mode: "dry-run", processed: 1, pending: 3, estimatedWrites: 0, providerRequests: 0 });
  expect((await db.execute("SELECT COUNT(*) n FROM daily_read_models")).rows[0].n).toBe(0);
  expect((await db.execute("SELECT COUNT(*) n FROM daily_raw_runs WHERE id='dry'")).rows[0].n).toBe(0);
  expect((await db.execute("SELECT reserved FROM history_budget")).rows).toEqual(before.rows);
  await expect(prepareDailyHistoryMain(["--cache", directory, "--aply"])).rejects.toThrow("invalid_argument");
  await expect(prepareDailyHistoryMain(["--cache", directory, "--max-assets", "1", "--max-assets", "2"])).rejects.toThrow("invalid_argument");
});
it("stops queued writers after an unknown committed outcome and resumes from stored current-model evidence without a retry", async () => {
  const write = storage.writeDailyReadModel, calls = vi.spyOn(storage, "writeDailyReadModel").mockImplementation(async (...args) => { await write(...args); throw Error("UND_ERR_SOCKET private connection detail"); });
  const argv = ["--cache", directory, "--run-id", "resume", "--max-estimated-writes", "50000", "--workers", "4", "--apply"];
  await prepareDailyHistoryMain(argv);
  const failed = await report(directory);
  expect(calls).toHaveBeenCalledOnce(); expect(failed).toMatchObject({ status: "failed", estimatedWrites: 10, error: "daily_history_model_failed", providerRequests: 0 });
  expect(JSON.stringify(failed)).not.toContain("private"); expect((await db.execute("SELECT COUNT(*) n FROM daily_read_models")).rows[0].n).toBe(1);
  calls.mockRestore(); process.exitCode = priorExit;
  await prepareDailyHistoryMain(argv);
  expect(await report(directory)).toMatchObject({ status: "complete", selected: 4, current: 1, prepared: 3, processed: 3, pending: 0, estimatedWrites: 15, runEstimatedWrites: 25 });
  expect((await db.execute("SELECT COUNT(*) n FROM daily_read_models")).rows[0].n).toBe(4);
  await prepareDailyHistoryMain(argv);
  expect(await report(directory)).toMatchObject({ status: "complete", current: 4, prepared: 0, processed: 0, estimatedWrites: 0, runEstimatedWrites: 25 });
});
