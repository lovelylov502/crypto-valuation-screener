import type { ScreenerResponse } from "./types";
import { collectionRegressions, collectionState } from "./collectionQuality";
import { sameParentScope } from "./parentHistorySource";
import { sameMethodology } from "./fundamentalSource";
import { sourceReviewHash } from "./reviewedSourceChanges";
import { readHistorySummary } from "./historyRequest";

/** UTC rollover can precede a provider's daily report. Independently confirm the
 * exact missing latest date; never invent zero or approve older/multiple gaps. */
export async function reviewPendingHistory(data: ScreenerResponse, baseline: ScreenerResponse, witness: unknown[]) {
  const rows = (witness[3] as { protocols?: Record<string, any>[] })?.protocols ?? [];
  const end = Math.floor(Date.parse(data.updatedAt) / 86400000) * 86400 - 86400;
  const endDate = new Date(end * 1000).toISOString().slice(0, 10);
  const candidates = new Map<string, { issue: string; days: number }[]>();
  for (const change of collectionRegressions(collectionState(baseline), collectionState(data))) {
    const match = change.issue.match(/^revenue_(1|7|30|90|365)d_(?:history_lost|lost)$/);
    if (!match) continue;
    const days = Number(match[1]);
    const p = data.coins.find(c => c.slug === change.slug)?.revenueHistory?.periods[days as 1 | 7 | 30 | 90 | 365];
    if (p?.end === endDate && p.total === null && p.reportedDays === days - 1)
      candidates.set(change.slug, [...(candidates.get(change.slug) ?? []), { issue: change.issue, days }]);
  }
  const keys = new Set<string>(), proofs: Record<string, unknown>[] = [];
  const tasks = [...candidates], deadline = Date.now() + 60_000;
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
    while (index < tasks.length) {
      const [slug, changes] = tasks[index++], coin = data.coins.find(c => c.slug === slug)!;
      const members = rows.filter(p => coin.sourceSlugs?.includes(p.slug) && p.doublecounted !== true);
      if (!members.length) continue;
      const sourceSlug = coin.isParent ? members.find(p => p.linkedProtocols?.length)?.linkedProtocols[0]?.toLowerCase().replace(/\s+/g, "-") ?? slug.replace(/^parent#/, "") : slug;
      const url = `https://api.llama.fi/summary/fees/${encodeURIComponent(sourceSlug)}?dataType=dailyRevenue`;
      try {
        const summary = await readHistorySummary(url, Date.now(), deadline, data.sources);
        if (!summary) continue;
        data.sources.push({ url, observedAt: new Date().toISOString(), status: "ok" });
        const scopeMatches = coin.isParent ? sameParentScope(slug, members, summary) : members.length === 1 &&
          summary.slug === members[0].slug && summary.name === members[0].name && summary.defillamaId === members[0].defillamaId &&
          (summary.parentProtocol ?? null) === (members[0].parentProtocol ?? null) && summary.doublecounted !== true && sameMethodology(summary.methodology, members[0].methodology);
        if (!scopeMatches || !Array.isArray(summary.totalDataChart)) continue;
        const values = new Map<number, number>(summary.totalDataChart.filter((p: unknown): p is [number, number] => Array.isArray(p) && Number.isInteger(p[0]) && Number.isFinite(p[1])));
        if (values.has(end) || !values.has(end - 86400)) continue;
        const approved = changes.filter(c => Array.from({ length: c.days - 1 }, (_, i) => end - (i + 1) * 86400).every(t => values.has(t)));
        for (const change of approved) keys.add(`${slug}:${change.issue}`);
        if (approved.length) proofs.push({ slug, source: url, observedAt: new Date().toISOString(), missingDate: endDate,
          issues: approved.map(c => c.issue), summaryHash: sourceReviewHash(summary), summary });
      } catch {
        data.sources.push({ url, observedAt: new Date().toISOString(), status: "error", httpStatus: 200 });
      }
    }
  }));
  return { keys, proofs };
}
