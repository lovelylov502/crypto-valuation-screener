import type { Client } from "@libsql/client";
import type { CollectedDailyRawAsset } from "./dailyRawCollection";
import type { DailyRawPoint } from "./dailyRawData";
import { upsertDailyRaw } from "./dailyRawDatabase";

/** Preserve existing quotes/holds and all financial cells. Only the local archive is writable. */
export async function captureMissingLocalMarket(db: Client, input: CollectedDailyRawAsset[], runId: string, now = new Date()) {
  if (db.protocol !== "file") throw Error("market_capture_local_database_required");
  let cells = 0;
  for (const item of input) {
    const previous = await db.execute({ sql: `SELECT d.* FROM daily_raw_days d JOIN daily_raw_assets a ON a.id=d.asset_id
      WHERE a.slug=? AND a.identity=? AND d.day IN (SELECT value FROM json_each(?))`, args: [item.asset.slug, item.asset.identity, JSON.stringify(item.points.map(point => point.day))] });
    const rows = new Map(previous.rows.map(row => [String(row.day), row])), points: DailyRawPoint[] = [], keys = new Set<string>();
    const expectedCells: NonNullable<Parameters<typeof upsertDailyRaw>[1]["expectedCells"]> = [];
    for (const point of item.points) {
      const next: DailyRawPoint = { day: point.day }, old = rows.get(point.day);
      for (const metric of ["price", "mcap"] as const) {
        const quote = point[metric];
        if (quote?.state !== "complete" || !quote.at || point.day > now.toISOString().slice(0, 10)) continue;
        if (old && (old[metric + "_state"] !== 0 || old[metric + "_source"] !== null || old[metric + "_at"] !== null)) continue;
        next[metric] = quote; keys.add(quote.source);
        expectedCells.push({ day: point.day, metric, sourceKey: "", value: null, state: 0, at: null });
      }
      if (next.price || next.mcap) points.push(next);
    }
    if (points.length) {
      await upsertDailyRaw(db, { runId, asset: item.asset, sources: item.sources.filter(source => keys.has(source.key)), points, expectedCells, minimumReserve: 0, now });
      cells += expectedCells.length;
    }
  }
  return cells;
}
