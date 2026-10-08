import { sameMethodology } from "./fundamentalSource";
import { summarizeRevenueHistory, type RevenueHistory } from "./revenueHistory";
import type { SourceObservation } from "./types";
import { readHistorySummary } from "./historyRequest";
import { sourceObservedAt, sourcePipelineSchema, sourceAcquisitionRevision } from "./sourceBundle";
import { validateSummaryHistory } from "./sourceValidation";

type Row = Record<string, unknown>;
type ParentSource = { key: string; members: Row[]; summary: Row; url: string; observedAt: string; uniqueNames: boolean };
const DAY = 86400;
const differs = (a: number, b: number) => Math.abs(a - b) > Math.max(1, Math.abs(b)) * 1e-8;

/** A parent series is usable only for the exact selected component set, including zero contributors. */
export function sameParentScope(key: string, members: Row[], summary: Row): boolean {
  if (summary.defillamaId !== key || summary.parentProtocol != null || summary.doublecounted === true || !Array.isArray(summary.childProtocols)) return false;
  const children = summary.childProtocols as Row[];
  const ids = members.map(p => p.defillamaId);
  if (!ids.length || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length || children.length !== ids.length || new Set(children.map(p => p.defillamaId)).size !== ids.length) return false;
  return members.every(p => children.some(child => child.defillamaId === p.defillamaId && child.name === p.name && child.doublecounted !== true && sameMethodology(p.methodology, child.methodology)));
}

/** Runs alongside child supplementation; the enclosing capture owns the shared deadline. */
export async function fetchParentHistorySources(protocols: Row[], chart: unknown[], now: number, dataType: "dailyRevenue" | "dailyHoldersRevenue", eligible: (p: Row) => boolean, observations: SourceObservation[], preservedWindows: ReadonlyMap<string, readonly number[]> = new Map()): Promise<ParentSource[]> {
  const groups = new Map<string, Row[]>();
  const nameCounts = new Map<string, number>();
  for (const p of protocols) nameCounts.set(String(p.name), (nameCounts.get(String(p.name)) ?? 0) + 1);
  for (const p of protocols) if (p.doublecounted !== true && typeof p.parentProtocol === "string" && eligible(p)) {
    groups.set(p.parentProtocol, [...(groups.get(p.parentProtocol) ?? []), p]);
  }
  const rows = new Map(chart.filter((p): p is [number, Row] => Array.isArray(p) && typeof p[0] === "number" && !!p[1] && typeof p[1] === "object"));
  const end = Math.floor(now / 1000 / DAY) * DAY - DAY;
  const candidates = [...groups].filter(([key, members]) => (members.some(p => [p.total24h,p.total7d,p.total30d,p.total1y].some(v=>typeof v === "number" && Number.isFinite(v))) || preservedWindows.has(key)) &&
    (Array.from({ length: 30 }, (_, i) => rows.get(end - i * DAY)).some(row => members.some(p => !Number.isFinite(row?.[String(p.name)]))) ||
      (preservedWindows.get(key) ?? []).some(days=>Array.from({length:days},(_,i)=>rows.get(end-i*DAY)).some(row=>members.some(p=>!Number.isFinite(row?.[String(p.name)])))) ||
      Array.from({ length: 730 }, (_, i) => rows.get(end - i * DAY)).some(row => members.some(p => typeof row?.[String(p.name)] === "number") && members.some(p => typeof row?.[String(p.name)] !== "number"))));
  candidates.sort(([a],[b])=>a.localeCompare(b));
  const parentUrl = (key: string, members: Row[]) => {
    const name = members.map(p => Array.isArray(p.linkedProtocols) ? p.linkedProtocols[0] : null).find(n => typeof n === "string");
    const slug = typeof name === "string" ? name.toLowerCase().replace(/\s+/g, "-") : key.replace(/^parent#/, "");
    return `https://api.llama.fi/summary/fees/${encodeURIComponent(slug)}?dataType=${dataType}`;
  };
  const output: ParentSource[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(6, candidates.length) }, async () => {
    while (index < candidates.length) {
      const [key, members] = candidates[index++];
      // Parent IDs can retain old names (maker/lyra); linkedProtocols carries the current source name.
      const url = parentUrl(key,members);
      const sourceSlugs = members.map(p => String(p.slug));
      try {
        const summary = await readHistorySummary(url, now, Infinity, observations, sourceSlugs);
        if (!summary) continue;
        if (!sameParentScope(key, members, summary)) {
          observations.push({ url, observedAt: sourceObservedAt(url), sourceSlugs, status: "withheld", reason: "scope_mismatch" });
          continue;
        }
        if (!Array.isArray(summary.totalDataChart)) throw new Error("parent history missing");
        summary.totalDataChart = validateSummaryHistory(summary.totalDataChart, url, sourceSlugs, now, observations);
        if (observations.some(s => s.url === url && s.reason === "value_conflict")) continue;
        output.push({ key, members, summary, url, observedAt: sourceObservedAt(url), uniqueNames: members.every(p => nameCounts.get(String(p.name)) === 1) });
      } catch { observations.push({ url, observedAt: sourceObservedAt(url), sourceSlugs, status: "error", httpStatus: 200 }); }
    }
  }));
  return output;
}

/** Merge explicit parent observations; never zero-fill a child's missing or pre-launch days. */
export function mergeParentHistories(histories: Record<string, RevenueHistory>, chart: unknown[], parents: ParentSource[], now: number, observations: SourceObservation[]): void {
  const end = Math.floor(now / 1000 / DAY) * DAY - DAY;
  for (const { key, members, summary, url, observedAt, uniqueNames } of parents) {
    const current = histories[key];
    if (!current) continue;
    const daily = new Map<number, number>();
    for (const point of uniqueNames ? chart : []) {
      if (!Array.isArray(point) || typeof point[0] !== "number" || !point[1] || typeof point[1] !== "object") continue;
      const values = members.map(p => point[1][String(p.name)]);
      if (values.every((v): v is number => typeof v === "number" && Number.isFinite(v))) daily.set(point[0], values.reduce((a, b) => a + b, 0));
    }
    let conflict = false;
    for (const point of summary.totalDataChart as unknown[]) {
      if (!Array.isArray(point) || typeof point[0] !== "number" || point[0] % DAY !== 0 || point[0] > end || point[0] <= end - 730 * DAY || typeof point[1] !== "number" || !Number.isFinite(point[1])) continue;
      const old = daily.get(point[0]);
      if (old !== undefined && differs(old, point[1])) { conflict = true; break; }
      daily.set(point[0], point[1]);
    }
    if (!conflict) {
      const recovered = summarizeRevenueHistory([{ slug: key, name: key }], [...daily].map(([t, v]) => [t, { [key]: v }]), now, url, new Map([[key, { fingerprint: current.definitionFingerprint!, ...(sourceAcquisitionRevision()>=4?{physicalFingerprint:current.freshness?.definition}:{}) }]]), undefined, sourcePipelineSchema())[key];
      recovered.supplementalSources = [...new Set([current.source, ...(current.supplementalSources ?? []), url])].sort();
      recovered.observedAt = [current.observedAt,observedAt].sort().at(-1)!;
      if (recovered.freshness) { recovered.freshness.components = current.freshness!.components; recovered.freshness.sources = recovered.supplementalSources; recovered.freshness.observedAt = recovered.observedAt; recovered.freshness.coverageBasis="exact_parent"; }
      if (!current.weeks.length) recovered.weeks = [];
      histories[key] = recovered;
    }
    observations.push({ url, observedAt, sourceSlugs: members.map(p => String(p.slug)), status: conflict ? "withheld" : "ok", ...(conflict ? { reason: "value_conflict" as const } : {}) });
  }
}
