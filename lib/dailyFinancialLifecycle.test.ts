import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { createClient } from "@libsql/client";
import { expect, it } from "vitest";
import { initializeDailyRaw, openDailyRawRun, upsertDailyRaw } from "./dailyRawDatabase";
import { initializeDailyReadModels } from "./dailyReadModelDatabase";
import { prepareDailyValuationHistory, readCompactDailyHistory, readPreparedDailyComparisonBatch } from "./dailyValuationPrepared";
import { decodeCompactHistory, expandCompactHistory } from "./dailyValuationCompact";

it("runs maintenance against pinned local sources before publishing and propagates failures", () => {
  const source = readFileSync(new URL("../scripts/publish-read-artifacts.ts", import.meta.url), "utf8");
  expect(source.indexOf('run("scripts/capture-current-fdv.ts"')).toBeLessThan(source.indexOf('run("scripts/refresh-daily-financials.ts"'));
  expect(source.indexOf('run("scripts/refresh-daily-financials.ts"')).toBeLessThan(source.indexOf('result = await buildReadArtifacts'));
  expect(source).toContain('"--reference", reference, "--database", database');
  expect(source).toContain('if (result.status !== 0) throw');
  for (const name of ["daily-snapshot", "daily-history", "refresh-read-models"]) {
    const text = readFileSync(new URL('../.github/workflows/' + name + '.yml', import.meta.url), "utf8");
    expect(text).toContain("scripts/publish-read-artifacts.ts"); expect(text).not.toContain("secrets.TURSO");
    expect(text).not.toContain("continue-on-error: true");
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
