import { definitionReviewed } from "./fundamentalSource";
import type { SourceObservation } from "./types";

type Row = Record<string, unknown>;
const DAY = 86400;
/** Overview charts omit some series (notably chains). Recover explicit observations, never invent zeros. */
export async function completeHistorySource(protocols: Row[], chart: unknown[], now: number, dataType: "dailyRevenue" | "dailyHoldersRevenue", eligible: (row: Row) => boolean, observations: SourceObservation[]): Promise<unknown[]> {
  const rows = new Map<number, Row>();
  for (const point of chart) if (Array.isArray(point) && typeof point[0] === "number" && point[1] && typeof point[1] === "object") rows.set(point[0], {...point[1]});
  const end = Math.floor(now / 1000 / DAY) * DAY - DAY;
  const counts = new Map<string,number>();
  for (const p of protocols) counts.set(String(p.name),(counts.get(String(p.name)) ?? 0)+1);
  const candidates = protocols.filter(p => p.doublecounted !== true && typeof p.slug === "string" && typeof p.name === "string" && counts.get(p.name) === 1 && eligible(p) &&
    Array.from({length:30},(_,i)=>rows.get(end-i*DAY)?.[p.name as string]).some(v=>typeof v !== "number"));
  let index = 0;
  const deadline = Date.now() + 20_000;
  await Promise.all(Array.from({length:Math.min(6,candidates.length)},async()=>{
    while (index < candidates.length) {
      const p = candidates[index++];
      const url = `https://api.llama.fi/summary/fees/${encodeURIComponent(String(p.slug))}?dataType=${dataType}`;
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("supplemental history time budget exhausted");
        const response = await fetch(url,{cache:"no-store",headers:{accept:"application/json"},signal:AbortSignal.timeout(Math.min(8000,remaining))});
        if (!response.ok) throw new Error("history source unavailable");
        const summary = await response.json();
        if (!sameHistoryIdentity(p,summary) || !Array.isArray(summary.totalDataChart)) throw new Error("history scope mismatch");
        const points = summary.totalDataChart.filter((point: unknown): point is [number,number] => Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number" && Number.isFinite(point[1]) && point[0] <= end && point[0] > end-365*DAY);
        // A conflicting overlap cannot be silently patched with a differently valued series.
        if (points.some(([t,v]:[number,number]) => { const old=rows.get(t)?.[String(p.name)]; return typeof old === "number" && Math.abs(old-v)>Math.max(1,Math.abs(v))*1e-8; })) throw new Error("history values conflict");
        for (const [t,v] of points) { const row=rows.get(t) ?? {}; row[String(p.name)]=v; rows.set(t,row); }
        observations.push({url,observedAt:new Date(now).toISOString(),status:"ok"});
      } catch { observations.push({url,observedAt:new Date(now).toISOString(),status:"error"}); }
    }
  }));
  return [...rows].sort((a,b)=>a[0]-b[0]);
}
export function sameHistoryIdentity(p: Row, summary: Row): boolean {
  return summary.slug === p.slug && summary.name === p.name && summary.defillamaId === p.defillamaId &&
    (summary.parentProtocol ?? null) === (p.parentProtocol ?? null) && summary.doublecounted !== true && definitionReviewed(p) && definitionReviewed(summary);
}
