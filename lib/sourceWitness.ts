import type { ScreenerResponse } from "./types";
import { revenueReading } from "./revenueReading";

type Row = Record<string, any>;
export const WITNESS_PATHS = ["/protocols", "/config", "/overview/fees", "/overview/fees?dataType=dailyRevenue", "/overview/fees?dataType=dailyHoldersRevenue", "/overview/dexs"];
export async function collectWitness(): Promise<unknown[]> {
  return Promise.all(WITNESS_PATHS.map(async path => {
    const url = "https://api.llama.fi" + path + (path.includes("overview") ? `${path.includes("?") ? "&" : "?"}excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true` : "");
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Independent source audit HTTP ${response.status}`);
    return response.json();
  }));
}

/** Archived input witnesses are audited against their own snapshot, never today's values. */
export function witnessErrors(data: ScreenerResponse, witness: unknown[]): string[] {
  const [directory, config, fees, revenue, holders, dexs] = witness as Row[];
  if (!Array.isArray(directory) || !directory.length || !Array.isArray(config?.parentProtocols) || [fees,revenue,holders,dexs].some(s => !Array.isArray(s?.protocols) || !s.protocols.length)) return ["source_universe_unavailable"];
  const expected = new Set<string>([...directory, ...fees.protocols, ...revenue.protocols, ...holders.protocols, ...dexs.protocols].map(p => p.slug).filter(Boolean));
  for (const p of config.parentProtocols) expected.add(p.id);
  const represented = new Map(data.coins.flatMap(c => (c.sourceSlugs ?? []).map(slug => [slug, c] as const)));
  const errors = [...expected].filter(s => !represented.has(s)).map(s => `source_member_omitted:${s}`);
  for (const row of revenue.protocols as Row[]) {
    if (row.doublecounted === true) continue;
    const c = represented.get(row.slug);
    if (!c) continue;
    for (const [days, field] of [[1,"total24h"],[7,"total7d"],[30,"total30d"],[365,"total1y"]] as const) {
      if (typeof row[field] === "number" && revenueReading(c, days).amount === null) errors.push(`source_revenue_hidden:${row.slug}:${days}`);
    }
  }
  return errors;
}
