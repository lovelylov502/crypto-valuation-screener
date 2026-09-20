import { summarizeRevenueHistory, type RevenueHistory } from "./revenueHistory";
import type { SourceObservation } from "./types";
import { aggregateDefinitions } from "./fundamentalSource";
import { completeHistorySource } from "./completeHistorySource";

const URL = "https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false";
let cached: { at: number; value: Record<string, RevenueHistory>; sources: SourceObservation[] } | undefined;
let pending: Promise<Record<string, RevenueHistory>> | undefined;

export async function fetchRevenueHistory(observations: SourceObservation[]): Promise<Record<string, RevenueHistory>> {
  try {
    if (!cached || Date.now() - cached.at > 1800_000) {
      pending ??= (async () => {
        // Cache the compact result, not the multi-year raw response (too large for Next's fetch cache).
        const response = await fetch(URL, { cache: "no-store", signal: AbortSignal.timeout(30000), headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`Revenue history ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.protocols) || !Array.isArray(data.totalDataChartBreakdown) || data.totalDataChartBreakdown.length === 0) throw new Error("Revenue history missing");
        const at = Date.now();
        const parents = new Map<string, string>(data.protocols.map((p: { slug: string; parentProtocol?: string }) => [p.slug, p.parentProtocol ?? p.slug]));
        const definitions = aggregateDefinitions(data.protocols, slug => parents.get(slug) ?? slug, "Revenue");
        const sources: SourceObservation[] = [];
        const chart = await completeHistorySource(data.protocols,data.totalDataChartBreakdown,at,"dailyRevenue", p => ["protocol_revenue","service_sales"].includes(definitions.get(parents.get(String(p.slug)) ?? String(p.slug))?.kind ?? "") && typeof p.total30d === "number",sources);
        const value = summarizeRevenueHistory(data.protocols, chart, at, URL, definitions);
        for (const [key,h] of Object.entries(value)) h.supplementalSources = sources.filter(s=>s.status === "ok" && (parents.get(decodeURIComponent(new globalThis.URL(s.url).pathname.split("/").at(-1)!)) ?? "") === key).map(s=>s.url);
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
