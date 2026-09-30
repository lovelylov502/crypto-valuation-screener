import { summarizeRevenueHistory, type RevenueHistory } from "./revenueHistory";
import type { SourceObservation } from "./types";
import { aggregateDefinitions } from "./fundamentalSource";
import { completeHistorySource } from "./completeHistorySource";
import { fetchParentHistorySources, mergeParentHistories } from "./parentHistorySource";

const URL = "https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false";
let cached: { at: number; value: Record<string, RevenueHistory>; sources: SourceObservation[] } | undefined;
let pending: Promise<Record<string, RevenueHistory>> | undefined;

export async function fetchRevenueHistory(observations: SourceObservation[], preservedParents: ReadonlyMap<string, readonly number[]> = new Map()): Promise<Record<string, RevenueHistory>> {
  try {
    if (!cached || Date.now() - cached.at > 1800_000 || Math.floor(Date.now() / 86400_000) !== Math.floor(cached.at / 86400_000)) {
      pending ??= (async () => {
        // Cache the compact result, not the multi-year raw response (too large for Next's fetch cache).
        const response = await fetch(URL, { cache: "no-store", signal: AbortSignal.timeout(30000), headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`Revenue history ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.protocols) || !Array.isArray(data.totalDataChartBreakdown)) throw new Error("Revenue history missing");
        const at = Date.now();
        const parents = new Map<string, string>(data.protocols.map((p: { slug: string; parentProtocol?: string }) => [p.slug, p.parentProtocol ?? p.slug]));
        const definitions = aggregateDefinitions(data.protocols, slug => parents.get(slug) ?? slug, "Revenue");
        const primary = summarizeRevenueHistory(data.protocols, data.totalDataChartBreakdown, at, URL, definitions);
        const missingParents = new Set([...preservedParents].filter(([key, days]) => days.some(day => (primary[key]?.periods[day as 1 | 7 | 30 | 90 | 365]?.reportedDays ?? 0) < day)).map(([key]) => key));
        const sources: SourceObservation[] = [];
        const eligible = (p: Record<string, unknown>) => ["protocol_revenue", "service_sales"].includes(definitions.get(parents.get(String(p.slug)) ?? String(p.slug))?.kind ?? "");
        const [chart, parentSources] = await Promise.all([
          completeHistorySource(data.protocols,data.totalDataChartBreakdown,at,"dailyRevenue",p=>eligible(p) && typeof p.total30d === "number",sources),
          // Previously complete source amounts deserve an exact-scope recheck even
          // when economic review withholds ratios. The baseline supplies IDs only.
          fetchParentHistorySources(data.protocols,data.totalDataChartBreakdown,at,"dailyRevenue",p=>eligible(p) || missingParents.has(parents.get(String(p.slug)) ?? String(p.slug)),sources),
        ]);
        const value = summarizeRevenueHistory(data.protocols, chart, at, URL, definitions);
        for (const [key,h] of Object.entries(value)) h.supplementalSources = sources.filter(s=>s.status === "ok" && (parents.get(decodeURIComponent(new globalThis.URL(s.url).pathname.split("/").at(-1)!)) ?? "") === key).map(s=>s.url);
        mergeParentHistories(value, chart, parentSources, at, sources);
        cached = { at, value, sources };
        return value;
      })().finally(() => { pending = undefined; });
      await pending;
    }
    observations.push({ url: URL, observedAt: new Date(cached!.at).toISOString(), status: "ok" });
    observations.push(...cached!.sources);
    return cached!.value;
  } catch {
    observations.push({ url: URL, observedAt: new Date().toISOString(), status: "error" });
    // Keep the ordinary screener available; do not present stale history as a current window.
    return {};
  }
}
