import { sameMethodology } from "./fundamentalSource";
import type { SourceObservation } from "./types";
import { readHistorySummary } from "./historyRequest";
import { sourceObservedAt } from "./sourceBundle";
import { validateSummaryHistory } from "./sourceValidation";

type Row = Record<string, unknown>;
const DAY = 86400;
/** Overview charts omit some series (notably chains). Recover explicit observations, never invent zeros. */
export async function completeHistorySource(protocols: Row[], chart: unknown[], now: number, dataType: "dailyRevenue" | "dailyHoldersRevenue", eligible: (row: Row) => boolean, observations: SourceObservation[], preservedWindows: ReadonlyMap<string, readonly number[]> = new Map()): Promise<unknown[]> {
  const rows = new Map<number, Row>();
  for (const point of chart) if (Array.isArray(point) && typeof point[0] === "number" && point[1] && typeof point[1] === "object") rows.set(point[0], {...point[1]});
  const end = Math.floor(now / 1000 / DAY) * DAY - DAY;
  const counts = new Map<string,number>();
  for (const p of protocols) counts.set(String(p.name),(counts.get(String(p.name)) ?? 0)+1);
  const previous = (p: Row) => preservedWindows.get(String(p.parentProtocol ?? p.slug)) ?? [];
  const gap = (p: Row, days: number) => Array.from({length:days},(_,i)=>rows.get(end-i*DAY)?.[p.name as string]).some(v=>typeof v !== "number" || !Number.isFinite(v));
  const candidates = protocols.filter(p => p.doublecounted !== true && typeof p.slug === "string" && typeof p.name === "string" && counts.get(p.name) === 1 && eligible(p) &&
    (gap(p,30) || previous(p).some(days=>gap(p,days)))).sort((a,b)=>String(a.slug).localeCompare(String(b.slug)));
  let index = 0;
  await Promise.all(Array.from({length:Math.min(6,candidates.length)},async()=>{
    while (index < candidates.length) {
      const p = candidates[index++];
      const url = `https://api.llama.fi/summary/fees/${encodeURIComponent(String(p.slug))}?dataType=${dataType}`;
      const sourceSlugs = [String(p.slug)];
      try {
        const summary = await readHistorySummary(url, now, Infinity, observations, sourceSlugs);
        if (!summary) continue;
        if (!sameHistoryIdentity(p,summary) || !Array.isArray(summary.totalDataChart)) {
          observations.push({url,observedAt:sourceObservedAt(url),sourceSlugs,status:"withheld",reason:"scope_mismatch"});
          continue;
        }
        const points = validateSummaryHistory(summary.totalDataChart, url, sourceSlugs, now, observations);
        if (observations.some(s => s.url === url && s.reason === "value_conflict")) continue;
        // A conflicting overlap cannot be silently patched with a differently valued series.
        const seen = new Map<number,number>();
        const conflict = points.some(([t,v]:[number,number]) => {
          const old=rows.get(t)?.[String(p.name)], previous=seen.get(t); seen.set(t,v);
          return (typeof old === "number" && Math.abs(old-v)>Math.max(1,Math.abs(v))*1e-8) || (previous !== undefined && previous !== v);
        });
        if (conflict) { observations.push({url,observedAt:sourceObservedAt(url),sourceSlugs,status:"withheld",reason:"value_conflict"}); continue; }
        for (const [t,v] of points) { const row=rows.get(t) ?? {}; row[String(p.name)]=v; rows.set(t,row); }
        observations.push({url,observedAt:sourceObservedAt(url),sourceSlugs,status:"ok"});
      } catch { observations.push({url,observedAt:sourceObservedAt(url),sourceSlugs,status:"error",httpStatus:200}); }
    }
  }));
  return [...rows].sort((a,b)=>a[0]-b[0]);
}
export function sameHistoryIdentity(p: Row, summary: Row): boolean {
  return typeof p.defillamaId === "string" && p.defillamaId.length > 0 && summary.slug === p.slug && summary.name === p.name && summary.defillamaId === p.defillamaId &&
    (summary.parentProtocol ?? null) === (p.parentProtocol ?? null) && summary.doublecounted !== true && sameMethodology(p.methodology, summary.methodology);
}
