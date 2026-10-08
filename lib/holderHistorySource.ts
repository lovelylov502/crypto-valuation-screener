import { summarizeRevenueHistory, type RevenueHistory } from "./revenueHistory";
import { aggregateHolderValueByGroup } from "./holderValue";
import { combineFundamentals, definitionReviewed, physicalSeriesFingerprint } from "./fundamentalSource";
import { holderScope } from "./valuationMetrics";
import type { SourceObservation } from "./types";
import { completeHistorySource } from "./completeHistorySource";
import { fetchParentHistorySources, mergeParentHistories } from "./parentHistorySource";
import { sourceFetch, sourceNow, sourceObservedAt, sourceSessionActive, sourcePipelineSchema, sourceEconomicPolicy, objectHash } from "./sourceBundle";
import { validateHistoryBreakdown, validateProtocolFinancialRows } from "./sourceValidation";

export const HOLDER_HISTORY_URL = "https://api.llama.fi/overview/fees?dataType=dailyHoldersRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false";
type Row = Record<string, unknown>;
export function summarizeHolderHistory(protocols: Row[], chart: unknown[], now: number): Record<string, RevenueHistory> {
  const parent = new Map(protocols.map(p => [String(p.slug), String(p.parentProtocol ?? p.slug)]));
  const group = (s: string) => parent.get(s) ?? s;
  const summaries = aggregateHolderValueByGroup(protocols, group, definitionReviewed);
  const eligible = protocols.filter(p => p.doublecounted !== true && summaries.get(group(String(p.slug)))?.components.some(c => c.slug === p.slug && c.eligible));
  const fingerprints = new Map([...summaries].map(([key, holderValue]) => [key, { fingerprint: holderScope({ holderValue, fundamentals: combineFundamentals(undefined, undefined, protocols.filter(p => p.doublecounted !== true && group(String(p.slug)) === key)) }) }]));
  const result = summarizeRevenueHistory(eligible, chart, now, HOLDER_HISTORY_URL, fingerprints, protocols, sourcePipelineSchema());
  if (sourcePipelineSchema() === 2) {
    const raw = summarizeRevenueHistory(protocols, chart, now, HOLDER_HISTORY_URL, new Map([...summaries].map(([key]) => [key,{ fingerprint: sourceEconomicPolicy()?physicalSeriesFingerprint(protocols.filter(p=>group(String(p.slug))===key),"HoldersRevenue"):objectHash(protocols.filter(p=>group(String(p.slug))===key).map(p=>[p.slug,p.defillamaId,p.methodology,p.parentProtocol]).sort()) }])), protocols, 2);
    for (const [key,h] of Object.entries(raw)) {
      if (!result[key]) result[key] = { ...h, definitionFingerprint: fingerprints.get(key)?.fingerprint, periods: Object.fromEntries(Object.entries(h.periods).map(([d,p]) => [d,{...p,total:null,reportedDays:0}])) as RevenueHistory["periods"], previous30: {...h.previous30,total:null,reportedDays:0}, previous: undefined, weeks: [] };
      result[key].rawFreshness = h.freshness;
    }
  }
  // Keep period totals; the table does not render weekly holder charts.
  for (const h of Object.values(result)) h.weeks = [];
  return result;
}
let cached: { at: number; value: Record<string, RevenueHistory>; sources: SourceObservation[] } | undefined;
let pending: Promise<void> | undefined;
export async function fetchHolderHistory(observations: SourceObservation[], preservedWindows: ReadonlyMap<string, readonly number[]> = new Map()): Promise<Record<string, RevenueHistory>> {
  let httpStatus: number | undefined;
  try {
    const load = async () => {
        const response = await sourceFetch(HOLDER_HISTORY_URL, { cache: "no-store", signal: AbortSignal.timeout(30000), headers: { accept: "application/json" } });
        httpStatus = response.status;
        if (!response.ok) throw new Error(`Holder history ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.protocols) || !Array.isArray(data.totalDataChartBreakdown)) throw new Error("Holder history missing");
        const at = sourceNow(), observedAt = sourceObservedAt(HOLDER_HISTORY_URL);
        const sources: SourceObservation[] = [];
        data.protocols = validateProtocolFinancialRows(data.protocols, HOLDER_HISTORY_URL, sources);
        data.totalDataChartBreakdown = validateHistoryBreakdown(data.protocols, data.totalDataChartBreakdown, HOLDER_HISTORY_URL, at, sources);
        const parent = new Map<string,string>(data.protocols.map((p: Row)=>[String(p.slug),String(p.parentProtocol ?? p.slug)]));
        const summaries = aggregateHolderValueByGroup(data.protocols,s=>parent.get(s) ?? s,definitionReviewed);
        const eligible = (p: Row) => !!summaries.get(parent.get(String(p.slug)) ?? String(p.slug))?.components.some(c=>c.slug === p.slug && c.eligible);
        const reported = (p: Row) => [p.total24h,p.total7d,p.total30d,p.total1y].some(v=>typeof v === "number" && Number.isFinite(v)) || preservedWindows.has(String(p.parentProtocol ?? p.slug));
        const [chart, parentSources] = await Promise.all([
          completeHistorySource(data.protocols,data.totalDataChartBreakdown,at,"dailyHoldersRevenue",reported,sources,preservedWindows),
          fetchParentHistorySources(data.protocols,data.totalDataChartBreakdown,at,"dailyHoldersRevenue",()=>true,sources,preservedWindows),
        ]);
        const value = summarizeHolderHistory(data.protocols, chart, at);
        for (const [key,h] of Object.entries(value)) {
          const supplements = sources.filter(s=>s.status === "ok" && s.sourceSlugs?.some(slug=>(parent.get(slug) ?? slug) === key));
          h.observedAt = [observedAt,...supplements.map(s=>s.observedAt)].sort().at(-1)!;
          h.supplementalSources = [...new Set(supplements.map(s=>s.url))].sort();
          if (h.rawFreshness) { h.rawFreshness.sources = [HOLDER_HISTORY_URL,...h.supplementalSources]; h.rawFreshness.observedAt = h.observedAt; }
        }
        // A full raw parent must never widen an economically eligible subset.
        const rawHistories = sourcePipelineSchema() === 2 ? summarizeRevenueHistory(data.protocols,chart,at,HOLDER_HISTORY_URL,
          new Map(Object.entries(value).map(([key,h])=>[key,{fingerprint:h.rawFreshness?.definition ?? "unknown"}])),data.protocols,2) : {};
        for(const [key,h] of Object.entries(rawHistories)) {
          h.observedAt=value[key]?.observedAt??observedAt;h.supplementalSources=value[key]?.supplementalSources??[];
          if(h.freshness){h.freshness.observedAt=h.observedAt;h.freshness.sources=[HOLDER_HISTORY_URL,...h.supplementalSources];}
        }
        if (sourcePipelineSchema() === 2) mergeParentHistories(rawHistories,chart,parentSources,at,sources);
        mergeParentHistories(value, chart, parentSources.filter(p=>p.members.every(eligible)), at, sources);
        for (const [key,h] of Object.entries(value)) if (rawHistories[key]?.freshness) h.rawFreshness=rawHistories[key].freshness;
        return {at,value,sources:[{url:HOLDER_HISTORY_URL,observedAt,status:"ok" as const},...sources]};
    };
    if (sourceSessionActive()) {
      const result=await load();observations.push(...result.sources);return result.value;
    }
    if (!cached || sourceNow() - cached.at > 1800_000 || Math.floor(sourceNow() / 86400_000) !== Math.floor(cached.at / 86400_000)) {
      pending ??= load().then(result=>{cached=result;}).finally(() => { pending = undefined; });
      await pending;
    }
    observations.push(...cached!.sources);
    return cached!.value;
  } catch {
    observations.push({ url: HOLDER_HISTORY_URL, observedAt: sourceObservedAt(HOLDER_HISTORY_URL), status: "error", httpStatus });
    return {};
  }
}
