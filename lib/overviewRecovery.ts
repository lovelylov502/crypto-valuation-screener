import type { ScreenerResponse, SourceObservation } from "./types";
import { definitionReviewed } from "./fundamentalSource";
import { readHistorySummary } from "./historyRequest";

type Row = Record<string, unknown>;
type Metric = "dailyFees" | "dailyRevenue" | "dailyHoldersRevenue";

/** An overview omission need not erase a still-available individual source.
 * The previous snapshot selects identities only; every amount is fetched anew. */
export async function recoverOverviewRows(directory: Row[], rows: Row[], baseline: ScreenerResponse | undefined, metric: Metric, observations: SourceObservation[]) {
  const recovered = new Map<string, string>(), deadline = Date.now() + 60_000;
  for (const coin of baseline?.coins ?? []) {
    const amount = metric === "dailyRevenue" ? coin.revenue30d : metric === "dailyFees" ? coin.fees30d : coin.holderValue.rawCurrent30d;
    if (coin.isParent || amount === null || rows.some(r => r.slug === coin.slug)) continue;
    const identity = directory.find(r => r.slug === coin.slug);
    if (!identity || identity.parentProtocol != null || !["gecko_id", "cmcId"].some(k => identity[k] != null)) continue;
    const url = `https://api.llama.fi/summary/fees/${encodeURIComponent(coin.slug)}?dataType=${metric}`;
    const summary = await readHistorySummary(url, Date.now(), deadline, observations);
    if (!summary) continue;
    const id = identity.category === "Chain" ? `chain#${coin.slug}` : String(identity.id);
    const sameIdentity = summary.slug === coin.slug && summary.name === identity.name && summary.defillamaId === id &&
      summary.parentProtocol == null && summary.doublecounted !== true &&
      ["gecko_id", "cmcId"].every(k => identity[k] == null || String(identity[k]) === String(summary[k]));
    if (!sameIdentity || !definitionReviewed(summary)) {
      observations.push({ url, observedAt: new Date().toISOString(), status: "withheld", reason: "scope_mismatch" });
      continue;
    }
    // Recovered rows go through the original aggregation and calculation gates.
    rows.push(summary);
    recovered.set(coin.slug, url);
    observations.push({ url, observedAt: new Date().toISOString(), status: "ok" });
  }
  return recovered;
}
