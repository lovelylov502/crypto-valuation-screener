import { summarizeRevenueHistory, type RevenueHistory } from "./revenueHistory";
import { aggregateHolderValueByGroup } from "./holderValue";
import { combineFundamentals, definitionReviewed } from "./fundamentalSource";
import { holderScope } from "./valuationMetrics";
import type { SourceObservation } from "./types";
import { completeHistorySource } from "./completeHistorySource";

export const HOLDER_HISTORY_URL = "https://api.llama.fi/overview/fees?dataType=dailyHoldersRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false";
type Row = Record<string, unknown>;
export function summarizeHolderHistory(protocols: Row[], chart: unknown[], now: number): Record<string, RevenueHistory> {
  const parent = new Map(protocols.map(p => [String(p.slug), String(p.parentProtocol ?? p.slug)]));
  const group = (s: string) => parent.get(s) ?? s;
  const summaries = aggregateHolderValueByGroup(protocols, group, definitionReviewed);
  const eligible = protocols.filter(p => p.doublecounted !== true && summaries.get(group(String(p.slug)))?.components.some(c => c.slug === p.slug && c.eligible));
  const fingerprints = new Map([...summaries].map(([key, holderValue]) => [key, { fingerprint: holderScope({ holderValue, fundamentals: combineFundamentals(undefined, undefined, protocols.filter(p => p.doublecounted !== true && group(String(p.slug)) === key)) }) }]));
  const result = summarizeRevenueHistory(eligible, chart, now, HOLDER_HISTORY_URL, fingerprints, protocols);
  // The table needs four windows; weekly holder charts are not part of this view.
  for (const h of Object.values(result)) h.weeks = [];
  return result;
}
let cached: { at: number; value: Record<string, RevenueHistory>; sources: SourceObservation[] } | undefined;
let pending: Promise<void> | undefined;
export async function fetchHolderHistory(observations: SourceObservation[]): Promise<Record<string, RevenueHistory>> {
  try {
    if (!cached || Date.now() - cached.at > 1800_000) {
      pending ??= (async () => {
        const response = await fetch(HOLDER_HISTORY_URL, { cache: "no-store", signal: AbortSignal.timeout(30000), headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`Holder history ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.protocols) || !Array.isArray(data.totalDataChartBreakdown) || !data.totalDataChartBreakdown.length) throw new Error("Holder history missing");
        const at = Date.now();
        const parent = new Map<string,string>(data.protocols.map((p: Row)=>[String(p.slug),String(p.parentProtocol ?? p.slug)]));
        const summaries = aggregateHolderValueByGroup(data.protocols,s=>parent.get(s) ?? s,definitionReviewed);
        const sources: SourceObservation[] = [];
        const chart = await completeHistorySource(data.protocols,data.totalDataChartBreakdown,at,"dailyHoldersRevenue",p=>!!summaries.get(parent.get(String(p.slug)) ?? String(p.slug))?.components.some(c=>c.slug === p.slug && c.eligible) && typeof p.total30d === "number",sources);
        cached = { at, value: summarizeHolderHistory(data.protocols, chart, at), sources };
        for (const [key,h] of Object.entries(cached.value)) h.supplementalSources = sources.filter(s=>s.status === "ok" && (parent.get(decodeURIComponent(new URL(s.url).pathname.split("/").at(-1)!)) ?? "") === key).map(s=>s.url);
      })().finally(() => { pending = undefined; });
      await pending;
    }
    observations.push({ url: HOLDER_HISTORY_URL, observedAt: new Date(cached!.at).toISOString(), status: "ok" });
    observations.push(...cached!.sources);
    return cached!.value;
  } catch {
    observations.push({ url: HOLDER_HISTORY_URL, observedAt: new Date().toISOString(), status: "error" });
    return {};
  }
}
