import { summarizeRevenueHistory, type RevenueHistory } from "./revenueHistory";
import type { SourceObservation } from "./types";
import { aggregateDefinitions } from "./fundamentalSource";
import { completeHistorySource } from "./completeHistorySource";
import { fetchParentHistorySources, mergeParentHistories } from "./parentHistorySource";
import { sourceFetch, sourceNow, sourceObservedAt, sourceSessionActive } from "./sourceBundle";
import { validateHistoryBreakdown, validateProtocolFinancialRows } from "./sourceValidation";

const URL = "https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false";
let cached: { at: number; value: Record<string, RevenueHistory>; sources: SourceObservation[] } | undefined;
let pending: Promise<Record<string, RevenueHistory>> | undefined;

export async function fetchRevenueHistory(observations: SourceObservation[], preservedWindows: ReadonlyMap<string, readonly number[]> = new Map()): Promise<Record<string, RevenueHistory>> {
  let httpStatus: number | undefined;
  try {
    const load = async () => {
        // Cache the compact result, not the multi-year raw response (too large for Next's fetch cache).
        const response = await sourceFetch(URL, { cache: "no-store", signal: AbortSignal.timeout(30000), headers: { accept: "application/json" } });
        httpStatus = response.status;
        if (!response.ok) throw new Error(`Revenue history ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.protocols) || !Array.isArray(data.totalDataChartBreakdown)) throw new Error("Revenue history missing");
        const at = sourceNow(), observedAt = sourceObservedAt(URL);
        const sources: SourceObservation[] = [];
        data.protocols = validateProtocolFinancialRows(data.protocols, URL, sources);
        data.totalDataChartBreakdown = validateHistoryBreakdown(data.protocols, data.totalDataChartBreakdown, URL, at, sources);
        const parents = new Map<string, string>(data.protocols.map((p: { slug: string; parentProtocol?: string }) => [p.slug, p.parentProtocol ?? p.slug]));
        const definitions = aggregateDefinitions(data.protocols, slug => parents.get(slug) ?? slug, "Revenue");
        // Raw dated evidence is independent of permission to calculate a ratio.
        const reported = (p: Record<string, unknown>) => [p.total24h,p.total7d,p.total30d,p.total1y].some(v=>typeof v === "number" && Number.isFinite(v)) || preservedWindows.has(String(p.parentProtocol ?? p.slug));
        const [chart, parentSources] = await Promise.all([
          completeHistorySource(data.protocols,data.totalDataChartBreakdown,at,"dailyRevenue",reported,sources,preservedWindows),
          fetchParentHistorySources(data.protocols,data.totalDataChartBreakdown,at,"dailyRevenue",()=>true,sources,preservedWindows),
        ]);
        const value = summarizeRevenueHistory(data.protocols, chart, at, URL, definitions);
        for (const [key,h] of Object.entries(value)) {
          const supplements = sources.filter(s=>s.status === "ok" && s.sourceSlugs?.some(slug=>(parents.get(slug) ?? slug) === key));
          h.observedAt = [observedAt,...supplements.map(s=>s.observedAt)].sort().at(-1)!;
          h.supplementalSources = [...new Set(supplements.map(s=>s.url))].sort();
        }
        mergeParentHistories(value, chart, parentSources, at, sources);
        return { at, value, sources: [{url:URL,observedAt,status:"ok" as const},...sources] };
    };
    if (sourceSessionActive()) {
      const result = await load(); observations.push(...result.sources); return result.value;
    }
    if (!cached || sourceNow() - cached.at > 1800_000 || Math.floor(sourceNow() / 86400_000) !== Math.floor(cached.at / 86400_000)) {
      pending ??= load().then(result=>{cached=result;return result.value;}).finally(() => { pending = undefined; });
      await pending;
    }
    observations.push(...cached!.sources);
    return cached!.value;
  } catch {
    observations.push({ url: URL, observedAt: sourceObservedAt(URL), status: "error", httpStatus });
    // Keep the ordinary screener available; do not present stale history as a current window.
    return {};
  }
}
