import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { createClient } from "@libsql/client";
import { expect, it } from "vitest";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "./dailyRawDatabase";
import { initializeDailyReadModels } from "./dailyReadModelDatabase";
import { prepareDailyValuationHistory, readCompactDailyHistory, readPreparedDailyComparisonBatch } from "./dailyValuationPrepared";
import { decodeCompactHistory, expandCompactHistory } from "./dailyValuationCompact";

it("prepares only newly published snapshots and serializes all file writers", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/daily-snapshot.yml", import.meta.url), "utf8")), job = workflow.jobs["prepare-reads"];
  expect(job.needs).toBe("capture"); expect(job.if).toBe("needs.capture.result == 'success' && needs.capture.outputs.published == 'true'");
  expect(workflow.jobs.capture.outputs.published).toContain("steps.finish.outputs.published");
  expect(job.concurrency.group).toBe("screener-read-model-writer"); expect(job.concurrency["cancel-in-progress"]).toBe(false);
  expect(job.env).not.toHaveProperty("TURSO_AUTH_TOKEN");
  expect(JSON.stringify(job.steps)).toContain("publish-read-artifacts.ts");
  expect(JSON.stringify(job.steps)).not.toContain("prepare-daily-history.ts");
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
