import type { CoinScored, ScreenerResponse } from "./types";
import { collectionRegressions, collectionState } from "./collectionQuality";
import { aggregateDefinitions, sameMethodology } from "./fundamentalSource";
import { revenueReading } from "./revenueReading";
import type { RevenueWindowDays } from "./revenueHistory";
import { readHistorySummary } from "./historyRequest";
import { findCmc, getJson } from "./sources";
import { geckoRequests, GECKO_INTERVAL_MS } from "./geckoRequests";
import { witnessErrors } from "./sourceWitness";

type Row = Record<string, any>;
type Change = { slug: string; issue: string };
type Proof = Change & { reason: string; sources: string[] };
const DAY = 86400;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Review current source changes anew on every run. A proof authorizes the
 * explicit unavailable/changed state, never an old amount or a new definition. */
export async function reviewUpstreamChanges(data: ScreenerResponse, baseline: ScreenerResponse, witness: unknown[], reviewed: ReadonlySet<string> = new Set()) {
  const keys = new Set<string>(), proofs: Proof[] = [], evidence: Record<string, unknown> = {};
  if (data.sources.some(s => s.status === "error") || witnessErrors(data, witness).length) return { keys, proofs, evidence };
  const [directory, config, fees, revenue, holders, dexs] = witness as [Row[], Row, Row, Row, Row, Row];
  const universe: Row[] = [...directory, ...config.parentProtocols.map((p: Row) => ({ ...p, slug: p.id })), ...fees.protocols, ...revenue.protocols, ...holders.protocols, ...dexs.protocols];
  const sourceSlugs = new Set(universe.map(r => r.slug));
  const represented = new Set(data.coins.flatMap(c => c.sourceSlugs ?? [c.slug]));
  const changes = collectionRegressions(collectionState(baseline), collectionState(data)).filter(c => !reviewed.has(`${c.slug}:${c.issue}`));
  const accept = (change: Change, reason: string, sources: string[]) => { keys.add(`${change.slug}:${change.issue}`); proofs.push({ ...change, reason, sources }); };
  const coins = new Map(data.coins.map(c => [c.slug, c]));
  const oldCoins = new Map(baseline.coins.map(c => [c.slug, c]));
  const deadline = Date.now() + 120_000;

  // Re-query disappeared quote fields and optional market links by ID. A 200
  // response omitting a value is different from a failed or unattempted request.
  const marketCoins = [...new Set(changes.filter(c => /^(identity_changed|(?:mcap|price|fdv)_(?:positive_)?lost)$/.test(c.issue)).map(c => c.slug))].flatMap(slug => coins.get(slug) ? [coins.get(slug)!] : []);
  const gecko = new Map<string, Row>(), cmc = new Map<number, Row>();
  const geckoIds = [...new Set(marketCoins.flatMap(c => c.geckoId ? [c.geckoId] : []))];
  const cmcIds = [...new Set(marketCoins.flatMap(c => [c.cmcId, oldCoins.get(c.slug)?.cmcId].filter((id): id is number => id != null)))];
  let marketVerified = true;
  try {
    let nextGeckoAt = 0;
    for (const { url } of geckoRequests(geckoIds)) {
      const rows = await getJson<Row[]>(url, data.sources, { timeout: 15_000, deadline, beforeAttempt: async () => {
        const delay = Math.max(0, nextGeckoAt - Date.now());
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        nextGeckoAt = Date.now() + GECKO_INTERVAL_MS;
      } });
      if (!Array.isArray(rows)) throw new Error("Invalid independent Gecko response");
      evidence[url] = rows;
      for (const row of rows) gecko.set(row.id, row);
    }
    cmcIds.sort((a,b) => a-b);
    for (let i = 0; i < cmcIds.length; i += 250) {
      const url = `https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=${cmcIds.slice(i, i + 250).join(",")}&convert=USD&skip_invalid=true`;
      const response = await getJson<{ data: Row[] }>(url, data.sources, { timeout: 15_000, deadline });
      if (!Array.isArray(response.data)) throw new Error("Invalid independent CMC response");
      evidence[url] = response;
      for (const row of response.data) cmc.set(row.id, row);
    }
  } catch { marketVerified = false; }
  const cmcIndex = { byId: cmc, bySlug: new Map<string, Row>(), byNameSymbol: new Map<string, Row[]>(), bySymbol: new Map<string, Row[]>() };
  for (const row of cmc.values()) {
    const symbol = String(row.symbol ?? "").toLowerCase(), name = String(row.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    cmcIndex.bySlug.set(String(row.slug).toLowerCase(), row);
    cmcIndex.byNameSymbol.set(`${name}#${symbol}`, [...(cmcIndex.byNameSymbol.get(`${name}#${symbol}`) ?? []), row]);
    cmcIndex.bySymbol.set(symbol, [...(cmcIndex.bySymbol.get(symbol) ?? []), row]);
  }

  for (const change of changes) {
    const c = coins.get(change.slug), old = oldCoins.get(change.slug)!;
    if (change.issue === "project_removed" || change.issue === "source_membership_lost") {
      const missing = (old.sourceSlugs ?? [old.slug]).filter(s => !represented.has(s));
      if (missing.length && missing.every(s => !sourceSlugs.has(s))) accept(change, "removed_from_current_source_universe", ["witness.json.gz"]);
      continue;
    }
    if (!c) continue;
    const identityRows = universe.filter(r => (c.sourceSlugs ?? [c.slug]).includes(r.slug));
    if (change.issue === "identity_changed" && marketVerified) {
      const geckoIds = new Set(identityRows.map(r => r.gecko_id).filter(Boolean));
      const explicitCmc = new Set(identityRows.map(r => Number(r.cmcId)).filter(id => Number.isSafeInteger(id) && id > 0));
      const geckoMatches = geckoIds.size <= 1 && (geckoIds.values().next().value ?? null) === c.geckoId;
      const matchedCmc = findCmc({ cmcIds: [...explicitCmc], geckoId: c.geckoId, groupKey: c.slug, name: c.name, symbol: c.symbol, cmc: cmcIndex });
      const cmcMatches = explicitCmc.size <= 1 && (explicitCmc.size ? explicitCmc.has(c.cmcId!) : c.cmcId === null || matchedCmc?.id === c.cmcId);
      const changedToken = !!c.geckoId && c.geckoId !== old.geckoId && geckoIds.has(c.geckoId);
      const withdrawn = old.geckoId !== null && c.geckoId === null && c.cmcId === null && c.identityStatus !== "verified" && !geckoIds.size && !explicitCmc.size &&
        identityRows.some(r => Object.hasOwn(r, "gecko_id") && Object.hasOwn(r, "cmcId") && r.gecko_id === null && r.cmcId === null);
      const optionalLinkAbsent = c.cmcId !== null || old.cmcId === null || !cmc.has(old.cmcId) || changedToken || withdrawn;
      if (geckoMatches && cmcMatches && optionalLinkAbsent) accept(change, "current_explicit_identity_or_verified_provider_absence", ["witness.json.gz", ...Object.keys(evidence)]);
    }
    const field = change.issue.match(/^(mcap|price|fdv)_(positive_)?lost$/);
    if (field && marketVerified) {
      const name = field[1] as "mcap" | "price" | "fdv";
      const g = c.geckoId ? gecko.get(c.geckoId) : undefined;
      const m = c.cmcId ? cmc.get(c.cmcId) : undefined;
      const q = m?.quote?.find((q: Row) => q.symbol === "USD");
      const gv = g?.[({ mcap: "market_cap", price: "current_price", fdv: "fully_diluted_valuation" })[name]];
      const mv = q?.[({ mcap: "market_cap", price: "price", fdv: "fully_diluted_market_cap" })[name]];
      const values = [gv, ...(c.marketSources?.cmc?.status === "identity_mismatch" ? [] : [mv]), ...(name === "mcap" ? identityRows.map(r => r.mcap) : [])];
      const absent = field[2] ? values.every(v => !finite(v) || v <= 0) : values.every(v => !finite(v));
      // A dropped identity cannot make a still-available old quote disappear.
      const identitySafe = !changes.some(x => x.slug === c.slug && x.issue === "identity_changed") || keys.has(`${c.slug}:identity_changed`);
      if (absent && identitySafe) accept(change, "field_absent_from_independent_current_quotes", Object.keys(evidence));
    }
    if (change.issue === "definition_review_lost") {
      const members = revenue.protocols.filter((r: Row) => c.sourceSlugs?.includes(r.slug));
      const definition = aggregateDefinitions(members, () => c.slug, "Revenue").get(c.slug);
      if (definition?.fingerprint === c.fundamentals.revenue.fingerprint && definition.fingerprint !== old.fundamentals.revenue.fingerprint && definition.components.some(p => p.status !== "matched")) {
        accept(change, "current_definition_changed_and_ratios_withheld", ["witness.json.gz"]);
      }
    }
  }

  const summaries = new Map<string, Promise<Row | undefined>>();
  const read = (member: Row, metric: string) => {
    const url = `https://api.llama.fi/summary/fees/${encodeURIComponent(member.slug)}?dataType=${metric}`;
    if (!summaries.has(url)) summaries.set(url, (async () => {
      const summary = await readHistorySummary(url, Date.now(), deadline, data.sources);
      if (!summary) return undefined;
      evidence[url] = summary;
      data.sources.push({ url, status: "ok", observedAt: new Date().toISOString() });
      if (summary.slug !== member.slug || summary.name !== member.name || summary.defillamaId !== member.defillamaId ||
        (summary.parentProtocol ?? null) !== (member.parentProtocol ?? null) || summary.doublecounted === true || !sameMethodology(summary.methodology, member.methodology) || !Array.isArray(summary.totalDataChart)) return undefined;
      return summary;
    })());
    return { url, summary: summaries.get(url)! };
  };
  const groups = new Map<string, { coin: CoinScored; metric: "revenue" | "holder"; changes: Change[] }>();
  for (const change of changes) {
    const match = change.issue.match(/^(revenue|holder)_(1|7|30|90|365)d_(?:history_lost|lost)$/), c = coins.get(change.slug);
    if (!match || !c) continue;
    const metric = match[1] as "revenue" | "holder", key = `${metric}:${c.slug}`;
    groups.set(key, { coin: c, metric, changes: [...(groups.get(key)?.changes ?? []), change] });
  }
  const tasks = [...groups.values()];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
    while (index < tasks.length) {
      const { coin, metric, changes } = tasks[index++];
      const members = (metric === "holder" ? holders : revenue).protocols.filter((r: Row) => r.doublecounted !== true && coin.sourceSlugs?.includes(r.slug) &&
        (metric !== "holder" || coin.holderValue.components.some(c => c.slug === r.slug && c.eligible))) as Row[];
      if (!members.length) continue;
      const reads = members.map(m => read(m, metric === "holder" ? "dailyHoldersRevenue" : "dailyRevenue"));
      const results = await Promise.all(reads.map(r => r.summary));
      if (results.some(r => !r)) continue;
      const charts = results.map(r => new Map<number, number>(r!.totalDataChart.filter((p: unknown): p is [number, number] => Array.isArray(p) && Number.isInteger(p[0]) && p[0] % DAY === 0 && finite(p[1]))));
      for (const change of changes) {
        const days = Number(change.issue.match(/_(\d+)d/)![1]) as RevenueWindowDays;
        const period = (metric === "holder" ? coin.holderHistory : coin.revenueHistory)?.periods[days];
        const end = Math.floor(Date.parse(data.updatedAt) / 86400000) * DAY - DAY;
        const count = Array.from({ length: days }, (_, i) => end - i * DAY).filter(t => charts.every(chart => chart.has(t))).length;
        const exactGap = period?.end === new Date(end * 1000).toISOString().slice(0,10) && period.total === null && period.reportedDays === count && count < days;
        const sourceField = ({ 1: "total24h", 7: "total7d", 30: "total30d", 90: null, 365: "total1y" })[days];
        const noProviderAmount = sourceField === null || results.every(r => !finite(r![sourceField]));
        if (change.issue.endsWith("history_lost") ? exactGap : metric === "revenue" && revenueReading(coin, days).amount === null && noProviderAmount && (exactGap || !period)) {
          accept(change, "exact_current_component_dates_or_provider_absence", reads.map(r => r.url));
        }
      }
    }
  }));
  return { keys, proofs, evidence };
}
