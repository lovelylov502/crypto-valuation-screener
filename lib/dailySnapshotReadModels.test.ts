import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { createClient } from "@libsql/client";
import { expect, it } from "vitest";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "./dailyRawDatabase";
import { initializeDailyReadModels } from "./dailyReadModelDatabase";
import { prepareDailyValuationHistory, readCompactDailyHistory, readPreparedDailyComparisonBatch } from "./dailyValuationPrepared";
import { decodeCompactHistory, expandCompactHistory } from "./dailyValuationCompact";

it("refreshes history after verified snapshot publication in its own bounded job, independently of raw import time", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/daily-snapshot.yml", import.meta.url), "utf8")), job = workflow.jobs["prepare-history"], command = job.steps.find((step: { run?: string }) => step.run?.includes("scripts/prepare-daily-history.ts")).run;
  expect(workflow.concurrency.group).toBe("screener-publication");
  expect(job.needs).toBe("capture"); expect(job.if).toBe("needs.capture.result == 'success'"); expect(job["timeout-minutes"]).toBeLessThanOrEqual(35); expect(job["continue-on-error"]).not.toBe(true);
  expect(job.concurrency).toEqual({ group: "daily-history-model-preparation", "cancel-in-progress": false });
  expect(command).toContain('--cache "$RUNNER_TEMP/daily-history-model"'); expect(command).toContain('--run-id "history-model-${{ github.run_id }}-${{ github.run_attempt }}"');
  expect(command).toContain("--time-budget-seconds 900"); expect(command).toContain("--max-estimated-writes 50000"); expect(command).toContain("--apply");
  expect(command).toContain('--reference "$RUNNER_TEMP/daily-history-model/reference.json"');
  for (const staleOrSharedInput of ["RAW_DEADLINE", "RAW_RUN_ID", "--snapshot", "sync-daily-raw", "acquire-"]) expect(JSON.stringify(job)).not.toContain(staleOrSharedInput);
  expect(job.env).toEqual({ TURSO_DATABASE_URL: "${{ secrets.TURSO_DATABASE_URL }}", TURSO_AUTH_TOKEN: "${{ secrets.TURSO_AUTH_TOKEN }}" });
});

it("rebuilds for a new verified asOf even without raw writes, preserving the missing new day and reusing a same-day publication", async () => {
  const db = createClient({ url: ":memory:" }), now = new Date("2026-10-20T12:00:00Z"), coin = { slug: "protocol", geckoId: "token", cmcId: null, identityStatus: "verified" as const, capitalExclusionReason: null };
  const oldSnapshot = { updatedAt: "2026-10-19T04:00:00Z", publication: { published: { id: "data-old" } } }, newSnapshot = { updatedAt: "2026-10-20T04:00:00Z", publication: { published: { id: "data-new" } } };
  try {
    await initializeDailyRaw(db); await initializeDailyReadModels(db); await openDailyRawRun(db, { id: "refresh", maxEstimatedWrites: 50000, minimumReserve: 500000, now });
    const sources = (["fdv", "revenue"] as const).map(metric => ({ key: metric, metric, provider: metric === "fdv" ? "CoinGecko" : "DefiLlama", url: `https://example.test/${metric}`, observedAt: now.toISOString(), sha256: "a".repeat(64), scope: "protocol", definition: `${metric} USD`, basis: metric === "fdv" ? "utc_day_close" : "completed_utc_day_flow" }));
    await upsertDailyRaw(db, { runId: "refresh", asset: { slug: coin.slug, identity: "gecko:token" }, sources, points: [{ day: "2026-10-18", fdv: { value: 365, state: "complete", source: "fdv", at: "2026-10-19T00:00:00Z" }, revenue: { value: 1, state: "complete", source: "revenue" } }], now });
    const rawBefore = await db.execute("SELECT * FROM daily_raw_asset_revisions");
    expect(await prepareDailyValuationHistory(db, { coin, snapshot: oldSnapshot, runId: "refresh", now })).toMatchObject({ status: "prepared", estimatedWrites: 5 });
    expect((await readPreparedDailyComparisonBatch({ coins: [coin], capital: "fdv", snapshot: newSnapshot, db, now })).rows.protocol.pr).toMatchObject({ reason: "not_prepared" });
    expect(await prepareDailyValuationHistory(db, { coin, snapshot: newSnapshot, runId: "refresh", now })).toMatchObject({ status: "prepared", estimatedWrites: 5 });
    const history = (await readCompactDailyHistory(db, { coin, snapshot: newSnapshot, now }))!, points = expandCompactHistory(await decodeCompactHistory(history), "fdv").points;
    expect(history.asOf).toBe("2026-10-19"); expect(history.asset.snapshotId).toBe("data-new"); expect(points.map(point => point.day)).toEqual(["2026-10-18"]); expect(points[0].pr.value).toBe(1);
    expect((await readPreparedDailyComparisonBatch({ coins: [coin], capital: "fdv", snapshot: newSnapshot, db, now })).rows.protocol.pr).toMatchObject({ status: "unavailable", reason: "not_collected" });
    expect((await db.execute("SELECT * FROM daily_raw_asset_revisions")).rows).toEqual(rawBefore.rows);
    expect(await prepareDailyValuationHistory(db, { coin, snapshot: { ...newSnapshot, publication: { published: { id: "data-same-day" } } }, runId: "refresh", now })).toMatchObject({ status: "current", estimatedWrites: 0 });
  } finally { db.close(); }
});
