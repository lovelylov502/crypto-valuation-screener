import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { createClient } from "@libsql/client";
import { expect, it } from "vitest";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "./dailyRawDatabase";
import { initializeDailyReadModels } from "./dailyReadModelDatabase";
import { prepareDailyValuationHistory, readCompactDailyHistory, readPreparedDailyComparisonBatch } from "./dailyValuationPrepared";
import { decodeCompactHistory, expandCompactHistory } from "./dailyValuationCompact";

for (const workflowName of ["daily-snapshot", "daily-history"]) it(`${workflowName} patches recent archived flows before rebuilding models, with one combined quota and source reference`, () => {
  const workflow = parse(readFileSync(new URL(`../.github/workflows/${workflowName}.yml`, import.meta.url), "utf8")), job = workflow.jobs["prepare-history"], steps = job.steps as { id?: string; if?: string; run?: string; "continue-on-error"?: boolean }[];
  const financialIndex = steps.findIndex(step => step.run?.includes("scripts/refresh-daily-financials.ts")), fdvIndex = steps.findIndex(step => step.run?.includes("scripts/capture-current-fdv.ts")), modelIndex = steps.findIndex(step => step.run?.includes("scripts/prepare-daily-history.ts"));
  expect(financialIndex).toBeGreaterThanOrEqual(0); expect(modelIndex).toBeGreaterThan(financialIndex); expect(steps[financialIndex].id).toBe("financial"); expect(steps[modelIndex].if).toBe("steps.financial.outcome == 'success'");
  expect(steps[financialIndex]["continue-on-error"]).not.toBe(true); expect(steps[modelIndex]["continue-on-error"]).not.toBe(true);
  expect(fdvIndex).toBeGreaterThan(financialIndex); expect(fdvIndex).toBeLessThan(modelIndex); expect(steps[fdvIndex].if).toBe("steps.financial.outcome == 'success'");
  const financial = steps[financialIndex].run!, fdv = steps[fdvIndex].run!, model = steps[modelIndex].run!, argument = (command: string, flag: string) => command.match(new RegExp(`${flag} ("[^"\\n]+"|[^ \\n]+)`))?.[1];
  for (const flag of ["--cache", "--run-id", "--max-estimated-writes"]) { expect(argument(model, flag)).toBe(argument(financial, flag)); expect(argument(fdv, flag)).toBe(argument(financial, flag)); }
  expect(argument(fdv, "--reference")).toBe(argument(model, "--reference")); expect(fdv).toContain("--apply"); expect(steps[fdvIndex]["continue-on-error"]).not.toBe(true);
  expect(argument(financial, "--cache")).toContain("$RUNNER_TEMP/"); expect(argument(financial, "--run-id")).toContain("${{ github.run_id }}-${{ github.run_attempt }}"); expect(argument(financial, "--max-estimated-writes")).toBe("50000");
  expect(argument(financial, "--reference")).toBeUndefined(); expect(argument(financial, "--recent-days")).toBe("3");
  expect(argument(model, "--reference")).toBe(argument(financial, "--cache")!.replace(/"$/, '/reference.json"'));
  expect(Number(argument(financial, "--time-budget-seconds")) + Number(argument(fdv, "--time-budget-seconds")) + Number(argument(model, "--time-budget-seconds"))).toBeLessThanOrEqual(1800); expect(argument(financial, "--time-budget-seconds")).toBe("600"); expect(argument(model, "--time-budget-seconds")).toBe("900"); expect(job["timeout-minutes"]).toBeLessThanOrEqual(35);
  expect(financial).toContain("--apply"); expect(model).toContain("--apply"); expect(job.concurrency).toEqual({ group: "daily-history-model-preparation", "cancel-in-progress": false });
  expect(job["continue-on-error"]).not.toBe(true);
  expect(JSON.stringify(job)).not.toMatch(/RAW_DEADLINE|RAW_RUN_ID|acquire-daily|sync-daily-raw|--max-requests/);
  expect(job.steps.find((step: { uses?: string }) => step.uses === "actions/upload-artifact@v7").with.path).toContain("*report.json");
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  if (existsSync(bash)) for (const command of [financial, fdv, model]) expect(() => execFileSync(bash, ["--noprofile", "--norc", "-n"], { input: command, encoding: "utf8", windowsHide: true })).not.toThrow();
});

for (const workflowName of ["daily-snapshot", "daily-history"]) it(`${workflowName} fails visibly on the actual model pause report even when the CLI returned successfully`, () => {
  const workflow = parse(readFileSync(new URL(`../.github/workflows/${workflowName}.yml`, import.meta.url), "utf8")), command = workflow.jobs["prepare-history"].steps.find((step: { run?: string }) => step.run?.includes("scripts/prepare-daily-history.ts")).run;
  const gate = command.match(/node --input-type=module <<'NODE'\n([\s\S]+?)\nNODE/)?.[1]; expect(gate).toBeTruthy();
  const directory = mkdtempSync(join(tmpdir(), "financial-lifecycle-")), cache = join(directory, workflowName === "daily-snapshot" ? "daily-history-model" : "daily-history-model-cache");
  try {
    mkdirSync(cache);
    for (const status of ["complete", "paused", "budget-paused", "failed"]) {
      writeFileSync(join(cache, "daily-history-model-report.json"), JSON.stringify({ status, pending: status === "complete" ? 0 : 12, runEstimatedWrites: 49990 }));
      const run = () => execFileSync(process.execPath, ["--input-type=module", "--eval", gate!], { env: { ...process.env, RUNNER_TEMP: directory }, encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      if (status === "complete") expect(run()).toContain('"status":"complete"');
      else { try { run(); throw Error("Expected a non-complete report to fail"); } catch (error) { expect(error).toMatchObject({ status: 2 }); } }
    }
    writeFileSync(join(cache, "daily-history-model-report.json"), JSON.stringify({ status: "complete", pending: 12 }));
    expect(() => execFileSync(process.execPath, ["--input-type=module", "--eval", gate!], { env: { ...process.env, RUNNER_TEMP: directory }, encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })).toThrow();
  } finally {
    const absolute = resolve(directory); if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith("financial-lifecycle-")) throw Error("Unexpected lifecycle test directory");
    rmSync(absolute, { recursive: true, force: true });
  }
});

it("refreshes genuine same-day flows before model calculation while retaining zero and insufficient-history outcomes", async () => {
  const db = createClient({ url: ":memory:" }), now = new Date("2026-10-20T12:00:00Z"), snapshot = { updatedAt: "2026-10-20T04:43:36Z", publication: { published: { id: "data-new-day" } } };
  try {
    await initializeDailyRaw(db); await initializeDailyReadModels(db); await openDailyRawRun(db, { id: "financial-and-model", maxEstimatedWrites: 50000, minimumReserve: 500000, now });
    for (const [slug, value] of [["positive", 2], ["zero", 0]] as const) {
      const coin = { slug, geckoId: slug, cmcId: null, identityStatus: "verified" as const, capitalExclusionReason: null }, asset = { slug, identity: `gecko:${slug}` }, sources = (["fdv", "revenue"] as const).map(metric => ({ key: `${slug}:${metric}`, metric, provider: metric === "fdv" ? "CoinGecko" : "DefiLlama", url: `https://example.test/${slug}/${metric}`, observedAt: now.toISOString(), sha256: "a".repeat(64), scope: slug, definition: `${metric} USD`, basis: metric === "fdv" ? "utc_day_close" : "completed_utc_day_flow" }));
      await upsertDailyRaw(db, { runId: "financial-and-model", asset, sources, points: [{ day: "2026-10-18", revenue: { value: 100, state: "complete", source: `${slug}:revenue` } }, { day: "2026-10-19", fdv: { value: 730, state: "complete", source: `${slug}:fdv`, at: "2026-10-20T00:00:00Z" } }], now });
      await prepareDailyValuationHistory(db, { coin, snapshot, runId: "financial-and-model", now });
      expect((await readPreparedDailyComparisonBatch({ coins: [coin], capital: "fdv", snapshot, db, now })).rows[slug].pr).toMatchObject({ status: "unavailable", reason: "missing_revenue" });
      await upsertDailyRaw(db, { runId: "financial-and-model", asset, sources, points: [{ day: "2026-10-19", revenue: { value, state: "complete", source: `${slug}:revenue` } }], now });
      await prepareDailyValuationHistory(db, { coin, snapshot, runId: "financial-and-model", now });
      const history = (await readCompactDailyHistory(db, { coin, snapshot, now }))!, latest = expandCompactHistory(await decodeCompactHistory(history), "fdv").points.at(-1)!;
      expect(latest.day).toBe("2026-10-19"); expect(latest.revenue.value).toBe(value); expect(latest.pr.value).toBe(value ? 1 : null); expect(latest.pr.reason).toBe(value ? null : "non_positive_revenue");
      expect((await readPreparedDailyComparisonBatch({ coins: [coin], capital: "fdv", snapshot, db, now })).rows[slug].pr).toMatchObject(value ? { status: "insufficient", validDays: 0, latest: { date: "2026-10-19", value: 1 } } : { status: "unavailable", reason: "non_positive_revenue" });
    }
    const runs = (await db.execute("SELECT id,max_estimated_writes,estimated_writes FROM daily_raw_runs")).rows; expect(runs).toHaveLength(1); expect(runs[0].id).toBe("financial-and-model"); expect(runs[0].max_estimated_writes).toBe(50000); expect(Number(runs[0].estimated_writes)).toBeLessThanOrEqual(50000);
  } finally { db.close(); }
});
