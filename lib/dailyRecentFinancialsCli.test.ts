import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const mocks = vi.hoisted(() => ({ url: "", input: null as unknown, load: vi.fn() }));
vi.mock("./historyDatabase", async original => ({ ...await original<typeof import("./historyDatabase")>(), connectHistory: () => createClient({ url: mocks.url }) }));
vi.mock("./historyCollection", () => ({ loadHistoryInputs: (...args: unknown[]) => mocks.load(...args), historyRetrySeconds: () => 3600 }));
import * as raw from "./dailyRawDatabase";
import { contentHash, type SourceReceipt } from "./sourceBundle";
import { assembleScreener } from "./screener";
import { sample } from "./testFixtures";
import { refreshDailyFinancialsMain } from "../scripts/refresh-daily-financials";
let directory: string, db: Client, priorExit: typeof process.exitCode;
const now = new Date("2026-10-20T12:00:00Z"), archive = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-test/source-bundle.json.gz";
const report = async () => JSON.parse(await readFile(join(directory, "recent-financial-patch-report.json"), "utf8"));
const argv = () => ["--cache", directory, "--run-id", "patch", "--max-estimated-writes", "50000", "--recent-days", "1"];
beforeEach(async () => {
  priorExit = process.exitCode; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.spyOn(console, "log").mockImplementation(() => {});
  directory = await mkdtemp(join(tmpdir(), "recent-financial-cli-")); mocks.url = pathToFileURL(join(directory, "raw.sqlite")).href; db = createClient({ url: mocks.url });
  await raw.initializeDailyRaw(db);
  const coins = [sample({ slug: "alpha", geckoId: "alpha-token", identityStatus: "verified", mcap: 200 }), sample({ slug: "beta", geckoId: "beta-token", identityStatus: "verified", mcap: 100 })];
  const receipts = (["dailyRevenue", "dailyHoldersRevenue"] as const).map(dataType => {
    const body = JSON.stringify({ protocols: coins.map((coin, i) => ({ slug: coin.slug, name: coin.name, defillamaId: String(i) })), totalDataChartBreakdown: [[Date.parse("2026-10-19") / 1000, { alpha: dataType === "dailyRevenue" ? 147706 : 0, beta: 5 }]] });
    return { url: `https://api.llama.fi/overview/fees?dataType=${dataType}&excludeTotalDataChartBreakdown=false`, body, sha256: contentHash(body), status: 200, requestedAt: "2026-10-20T10:00:00Z", observedAt: "2026-10-20T10:00:01Z", headers: {} };
  });
  mocks.input = { snapshot: assembleScreener(coins, "2026-10-20T10:00:00Z", []), bundle: { schema: 1, baseline: null, asOf: "2026-10-20T10:00:00Z", receipts }, ref: { id: "data-test", rawBundleUrl: archive, rawBundleSha256: "b".repeat(64) } };
  mocks.load.mockReset().mockResolvedValue(mocks.input);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers(); process.exitCode = priorExit; db.close();
  if (!directory.startsWith(join(tmpdir(), "recent-financial-cli-"))) throw Error("Unexpected test directory");
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 }).catch(error => { if (error.code !== "EBUSY" && error.code !== "EPERM") throw error; });
});
it("defaults to a SELECT-only plan and pins verified inputs without opening a run or touching raw rows", async () => {
  await refreshDailyFinancialsMain(argv());
  expect(await report()).toMatchObject({ status: "dry-run", selected: 2, changedAssets: 2, processed: 0, providerRequests: 0, estimatedWrites: 0, sourceTargetCoverage: { revenue: { complete: 2 }, holders: { zero: 1 } }, storedTargetCoverage: { revenue: { rows: 0 } } });
  expect((await db.execute("SELECT COUNT(*) n FROM daily_raw_runs")).rows[0].n).toBe(0); expect((await db.execute("SELECT COUNT(*) n FROM daily_raw_days")).rows[0].n).toBe(0);
  expect(JSON.parse(await readFile(join(directory, "reference.json"), "utf8"))).toMatchObject({ id: "data-test", rawBundleUrl: archive });
});
it("returns a nonzero paused status, then resumes the remaining exact asset and replays for zero credits", async () => {
  await refreshDailyFinancialsMain([...argv(), "--apply", "--max-assets", "1"]);
  expect(process.exitCode).toBe(2); expect(await report()).toMatchObject({ status: "asset-limit-paused", processed: 1, pendingAssets: 1, storedTargetCoverage: { revenue: { rows: 1 }, holders: { zero: 1 } } });
  process.exitCode = priorExit;
  await refreshDailyFinancialsMain([...argv(), "--apply"]);
  expect(await report()).toMatchObject({ status: "complete", unchangedAssets: 1, processed: 1, pendingAssets: 0, storedTargetCoverage: { revenue: { rows: 2 } } });
  const before = (await db.execute("SELECT reserved FROM history_budget")).rows;
  await refreshDailyFinancialsMain([...argv(), "--apply"]);
  expect(await report()).toMatchObject({ status: "complete", unchangedAssets: 2, changedAssets: 0, processed: 0, estimatedWrites: 0 });
  expect((await db.execute("SELECT reserved FROM history_budget")).rows).toEqual(before);
});
it("keeps a source-window checkpoint stable when replay planning retains only original conflict witnesses", async () => {
  const input = mocks.input as { bundle: { receipts: SourceReceipt[] } };
  const receipt = input.bundle.receipts[0], body = JSON.parse(receipt.body);
  body.totalDataChartBreakdown = [
    [Date.parse("2026-10-17") / 1000, { alpha: 2 }],
    [Date.parse("2026-10-18") / 1000, { alpha: 4 }],
    [Date.parse("2026-10-19") / 1000, { alpha: 147706 }],
  ];
  receipt.body = JSON.stringify(body); receipt.sha256 = contentHash(receipt.body);
  const summaryBody = JSON.stringify({ ...body.protocols[0], totalDataChart: [[Date.parse("2026-10-17") / 1000, 3], [Date.parse("2026-10-18") / 1000, 5]] });
  input.bundle.receipts.push({ ...receipt, url: "https://api.llama.fi/summary/fees/alpha?dataType=dailyRevenue", body: summaryBody, sha256: contentHash(summaryBody) });
  const options = argv(); options[options.indexOf("--recent-days") + 1] = "3"; options.push("--slug", "alpha", "--apply");
  await refreshDailyFinancialsMain(options);
  expect(await report()).toMatchObject({ status: "complete", processed: 1, daysWritten: 3 });
  expect(Number((await db.execute("SELECT COUNT(*) n FROM daily_raw_revisions")).rows[0].n)).toBeGreaterThan(0);
  const budget = (await db.execute("SELECT * FROM history_budget")).rows, checkpoint = (await db.execute("SELECT * FROM daily_raw_checkpoints")).rows;
  const run = (await db.execute("SELECT * FROM daily_raw_runs")).rows, revisions = (await db.execute("SELECT * FROM daily_raw_revisions")).rows;
  await refreshDailyFinancialsMain(options);
  expect(await report()).toMatchObject({ status: "complete", changedAssets: 1, processed: 1, rowsWritten: 0, daysWritten: 0, estimatedWrites: 0, assets: [{ days: 2, rowsWritten: 0, daysWritten: 0, estimatedWrites: 0 }] });
  expect((await db.execute("SELECT * FROM history_budget")).rows).toEqual(budget);
  expect((await db.execute("SELECT * FROM daily_raw_checkpoints")).rows).toEqual(checkpoint);
  expect((await db.execute("SELECT * FROM daily_raw_runs")).rows).toEqual(run);
  expect((await db.execute("SELECT * FROM daily_raw_revisions")).rows).toEqual(revisions);
});
it("does not open a writer run after its bounded input/read phase has exhausted the deadline", async () => {
  mocks.load.mockImplementation(async () => { vi.setSystemTime(new Date(now.getTime() + 2000)); return mocks.input; });
  await refreshDailyFinancialsMain([...argv(), "--apply", "--time-budget-seconds", "1"]);
  expect(process.exitCode).toBe(2); expect(await report()).toMatchObject({ status: "time-paused", pendingAssets: 2, processed: 0, estimatedWrites: 0 });
  expect((await db.execute("SELECT COUNT(*) n FROM daily_raw_runs")).rows[0].n).toBe(0);
});
it("stops after an unknown committed outcome, reports read-only evidence and resumes without retrying that asset", async () => {
  const write = raw.upsertDailyRaw, changed = vi.spyOn(raw, "upsertDailyRaw").mockImplementation(async (...args) => { await write(...args); throw Error("UND_ERR_SOCKET sensitive host"); });
  await refreshDailyFinancialsMain([...argv(), "--apply"]);
  expect(changed).toHaveBeenCalledOnce(); expect(process.exitCode).toBe(1);
  const failed = await report(); expect(failed).toMatchObject({ status: "failed", error: "daily_financial_write_outcome_requires_inspection", storedTargetCoverage: { revenue: { rows: 1 } } });
  expect(failed.estimatedWrites).toBeGreaterThan(5); expect(JSON.stringify(failed)).not.toContain("sensitive");
  changed.mockRestore(); process.exitCode = priorExit;
  await refreshDailyFinancialsMain([...argv(), "--apply"]);
  expect(await report()).toMatchObject({ status: "complete", unchangedAssets: 1, changedAssets: 1, processed: 1, pendingAssets: 0 });
});
it("never calls an absent target-day receipt healthy", async () => {
  const input = mocks.input as { bundle: { receipts: { body: string; sha256: string }[] } };
  for (const receipt of input.bundle.receipts) { receipt.body = JSON.stringify({ protocols: [], totalDataChartBreakdown: [] }); receipt.sha256 = contentHash(receipt.body); }
  await refreshDailyFinancialsMain([...argv(), "--apply"]);
  expect(process.exitCode).toBe(2); expect(await report()).toMatchObject({ status: "source-unavailable", selected: 0, estimatedWrites: 0 });
  expect((await db.execute("SELECT COUNT(*) n FROM daily_raw_runs")).rows[0].n).toBe(0);
});
