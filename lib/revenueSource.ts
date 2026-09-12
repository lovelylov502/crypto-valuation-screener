import { summarizeRevenueHistory, type RevenueHistory } from "./revenueHistory";
import type { SourceObservation } from "./types";

const URL = "https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false";
let cached: { at: number; value: Record<string, RevenueHistory> } | undefined;
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
        const value = summarizeRevenueHistory(data.protocols, data.totalDataChartBreakdown, at, URL);
        cached = { at, value };
        return value;
      })().finally(() => { pending = undefined; });
      await pending;
    }
    observations.push({ url: URL, observedAt: new Date(cached!.at).toISOString(), status: "ok" });
    return cached!.value;
  } catch {
    observations.push({ url: URL, observedAt: new Date().toISOString(), status: "error" });
    // Keep the ordinary screener available; do not present stale history as a current window.
    return {};
  }
}
