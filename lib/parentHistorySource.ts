import { sameMethodology } from "./fundamentalSource";
import { summarizeRevenueHistory, type RevenueHistory } from "./revenueHistory";
import type { SourceObservation } from "./types";

type Row = Record<string, unknown>;
type ParentSource = { key: string; members: Row[]; summary: Row; url: string; uniqueNames: boolean };
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

/** Runs alongside child supplementation, under its own bounded source-request budget. */
export async function fetchParentHistorySources(protocols: Row[], chart: unknown[], now: number, dataType: "dailyRevenue" | "dailyHoldersRevenue", eligible: (p: Row) => boolean, observations: SourceObservation[]): Promise<ParentSource[]> {
  const groups = new Map<string, Row[]>();
  const nameCounts = new Map<string, number>();
  for (const p of protocols) nameCounts.set(String(p.name), (nameCounts.get(String(p.name)) ?? 0) + 1);
  for (const p of protocols) if (p.doublecounted !== true && typeof p.parentProtocol === "string" && eligible(p)) {
    groups.set(p.parentProtocol, [...(groups.get(p.parentProtocol) ?? []), p]);
  }
  const rows = new Map(chart.filter((p): p is [number, Row] => Array.isArray(p) && typeof p[0] === "number" && !!p[1] && typeof p[1] === "object"));
  const end = Math.floor(now / 1000 / DAY) * DAY - DAY;
  const candidates = [...groups].filter(([, members]) => members.some(p => typeof p.total30d === "number") &&
    (Array.from({ length: 30 }, (_, i) => rows.get(end - i * DAY)).some(row => members.some(p => !Number.isFinite(row?.[String(p.name)]))) ||
      Array.from({ length: 730 }, (_, i) => rows.get(end - i * DAY)).some(row => members.some(p => typeof row?.[String(p.name)] === "number") && members.some(p => typeof row?.[String(p.name)] !== "number"))));
  const output: ParentSource[] = [];
  let index = 0;
  const deadline = Date.now() + 60_000;
  await Promise.all(Array.from({ length: Math.min(6, candidates.length) }, async () => {
    while (index < candidates.length) {
      const [key, members] = candidates[index++];
      // Parent IDs can retain old names (maker/lyra); linkedProtocols carries the current source name.
      const name = members.map(p => Array.isArray(p.linkedProtocols) ? p.linkedProtocols[0] : null).find(n => typeof n === "string");
      const slug = typeof name === "string" ? name.toLowerCase().replace(/\s+/g, "-") : key.replace(/^parent#/, "");
      const url = `https://api.llama.fi/summary/fees/${encodeURIComponent(slug)}?dataType=${dataType}`;
      let httpStatus: number | undefined;
      try {
        let summary: Row | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          let delay = 500;
          try {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error("parent history time budget exhausted");
            httpStatus = undefined;
            const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(Math.min(15_000, remaining)) });
            httpStatus = response.status;
            delay = Math.max(delay, (Number(response.headers.get("retry-after")) || 0) * 1000);
            if (!response.ok) throw new Error("parent history unavailable");
            summary = await response.json();
            break;
          } catch (error) {
            if (attempt === 1 || (httpStatus !== undefined && httpStatus !== 429 && httpStatus < 500) || Date.now() + delay >= deadline) throw error;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        if (!summary) throw new Error("parent history missing");
        if (!sameParentScope(key, members, summary)) {
          observations.push({ url, observedAt: new Date(now).toISOString(), status: "withheld", reason: "scope_mismatch" });
          continue;
        }
        if (!Array.isArray(summary.totalDataChart)) throw new Error("parent history missing");
        output.push({ key, members, summary, url, uniqueNames: members.every(p => nameCounts.get(String(p.name)) === 1) });
      } catch { observations.push({ url, observedAt: new Date(now).toISOString(), status: "error", httpStatus }); }
    }
  }));
  return output;
}

/** Merge explicit parent observations; never zero-fill a child's missing or pre-launch days. */
export function mergeParentHistories(histories: Record<string, RevenueHistory>, chart: unknown[], parents: ParentSource[], now: number, observations: SourceObservation[]): void {
  const end = Math.floor(now / 1000 / DAY) * DAY - DAY;
  for (const { key, members, summary, url, uniqueNames } of parents) {
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
      const recovered = summarizeRevenueHistory([{ slug: key, name: key }], [...daily].map(([t, v]) => [t, { [key]: v }]), now, url, new Map([[key, { fingerprint: current.definitionFingerprint! }]]))[key];
      recovered.supplementalSources = [...new Set([current.source, ...(current.supplementalSources ?? []), url])];
      if (!current.weeks.length) recovered.weeks = [];
      histories[key] = recovered;
    }
    observations.push({ url, observedAt: new Date(now).toISOString(), status: conflict ? "withheld" : "ok", ...(conflict ? { reason: "value_conflict" as const } : {}) });
  }
}
