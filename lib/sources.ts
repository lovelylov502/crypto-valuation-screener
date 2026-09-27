import { capitalExclusion, STABLECOIN_SOURCE, type StablecoinAsset } from "./capitalEligibility";
import type { CoinRaw, IdentityStatus, QuoteLookup, SourceObservation } from "./types";
import { fetchRevenueHistory } from "./revenueSource";
import { REVENUE_OVERVIEW_URL } from "./revenueReading";
import { fetchHolderHistory } from "./holderHistorySource";
import { resolveSalesEvidence } from "./salesSource";
import { koreanDescription } from "./protocolDescriptions";
import { aggregateDefinitions, combineFundamentals, definitionReviewed } from "./fundamentalSource";
import type { MetricDefinition, RevenueKind, FeeKind } from "./fundamentals";
import {
  aggregateHolderValueByGroup,
  emptyHolderValueSummary,
} from "./holderValue";

const LLAMA = "https://api.llama.fi";
const GECKO = "https://api.coingecko.com/api/v3";
const CMC = "https://pro-api.coinmarketcap.com/public-api";

// 자동 이름/slug 매칭으로 확정할 수 없는 canonical CMC 예외.
// 각 항목은 프로젝트 구성원·심볼과 CMC 자산을 수동 검증한 뒤에만 추가한다.
const CMC_SLUG_OVERRIDES: Record<string, string> = {
  "parent#pump": "pump-fun",
  "parent#aerodrome": "aerodrome-finance",
};

type Json = Record<string, unknown>;

async function getJson<T>(url: string, observations: SourceObservation[], options: { timeout?: number; beforeAttempt?: () => Promise<void>; deadline?: number } = {}): Promise<T> {
  const { timeout = 30_000, beforeAttempt, deadline = Infinity } = options;
  let httpStatus: number | undefined;
  try {
  for (let attempt = 0; attempt < 3; attempt++) {
    await beforeAttempt?.();
    if (Date.now() >= deadline) throw new Error("Source request budget exhausted");
    const res = await fetch(url, {
      // The server caches the compressed joined snapshot; source responses can exceed 2 MB.
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(Math.min(timeout, deadline - Date.now())),
    });
    httpStatus = res.status;
    if (res.ok) {
      const result = (await res.json()) as T;
      observations.push({ url, observedAt: new Date().toISOString(), status: "ok" });
      return result;
    }
    if ((res.status !== 429 && res.status < 500) || attempt === 2) {
      throw new Error(`fetch ${url} -> ${res.status}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = res.status === 429 && beforeAttempt ? Math.max(60_000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0) : 500 * 2 ** attempt;
    if (Date.now() + delay >= deadline) throw new Error("Source retry exceeds request budget");
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`fetch ${url} failed`);
  } catch (error) {
    observations.push({ url, observedAt: new Date().toISOString(), status: "error", httpStatus });
    throw error;
  }
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const normalize = (v: string): string =>
  v.toLowerCase().replace(/[^a-z0-9]/g, "");

function quoteLookup(id: string, row: Json | undefined, vendor: "gecko" | "cmc", failed = false): QuoteLookup {
  const quote = vendor === "cmc" ? cmcQuote(row) : row;
  const fields = vendor === "cmc" ? { mcap: "market_cap", price: "price", fdv: "fully_diluted_market_cap" } : { mcap: "market_cap", price: "current_price", fdv: "fully_diluted_valuation" };
  return { id, status: failed ? "error" : row ? "received" : "not_returned", observedAt: new Date().toISOString(),
    available: (Object.keys(fields) as (keyof typeof fields)[]).filter(key => num(quote?.[fields[key]]) !== null) };
}

// "parent#hyperliquid" → "Hyperliquid"
function prettyParent(key: string): string {
  return key
    .replace(/^parent#/, "")
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// DefiLlama overview 응답을 raw 배열로 (parentProtocol 필드 접근 위해)
async function fetchOverviewList(path: string, observations: SourceObservation[]): Promise<Json[]> {
  const url = `${LLAMA}${path}${path.includes("?") ? "&" : "?"}excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
  const data = await getJson<{ protocols?: Json[] }>(url, observations);
  if (!Array.isArray(data.protocols) || data.protocols.length === 0) {
    const observation = observations.find(s => s.url === url);
    if (observation) observation.status = "error";
    throw new Error("DefiLlama overview is empty");
  }
  return data.protocols;
}

// Every explicit ID is queried. Rank changes cannot move a token outside the collector.
export async function fetchGecko(ids: string[], observations: SourceObservation[]) {
  const byId = new Map<string, Json>();
  const lookups = new Map<string, QuoteLookup>();
  let nextAt = 0;
  const deadline = Date.now() + 260_000;
  const pace = async () => {
    const delay = Math.max(0, nextAt - Date.now());
    if (Date.now() + delay > deadline) throw new Error("CoinGecko request budget exhausted");
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    nextAt = Date.now() + 12_500; // Public keyless API can be limited to five calls/minute.
  };
  await quoteBatches([...new Set(ids)].sort(), async batch => {
    const url = `${GECKO}/coins/markets?vs_currency=usd&ids=${batch.map(encodeURIComponent).join(",")}&per_page=250&price_change_percentage=7d,14d,30d,1y`;
    try {
      const rows = await getJson<Json[]>(url, observations, { timeout: 10_000, beforeAttempt: pace, deadline });
      if (!Array.isArray(rows)) throw new Error("CoinGecko response is invalid");
      for (const r of rows) {
        const id = str(r.id);
        if (id && batch.includes(id)) byId.set(id, r);
      }
      for (const id of batch) lookups.set(id, quoteLookup(id, byId.get(id), "gecko"));
    } catch {
      const observation = observations.find(s => s.url === url);
      if (observation) observation.status = "error";
      for (const id of batch) lookups.set(id, quoteLookup(id, undefined, "gecko", true));
    }
  }, 1);
  return { byId, lookups };
}

// At most two in-flight quote requests, with no silent truncation after a failed batch.
async function quoteBatches<T>(ids: T[], read: (batch: T[]) => Promise<void>, concurrency = 2) {
  let offset = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.ceil(ids.length / 250)) }, async () => {
    while (offset < ids.length) {
      const batch = ids.slice(offset, offset + 250);
      offset += 250;
      await read(batch);
    }
  }));
}

interface CmcIndex {
  byId: Map<number, Json>;
  bySlug: Map<string, Json>;
  byNameSymbol: Map<string, Json[]>;
  bySymbol: Map<string, Json[]>;
}

function indexCmcRows(index: CmcIndex, rows: Json[]) {
  for (const row of rows) {
    const id = num(row.id);
    if (id !== null && index.byId.has(id)) continue;
    if (id !== null) index.byId.set(id, row);
    const slug = str(row.slug)?.toLowerCase(), name = str(row.name), symbol = str(row.symbol)?.toLowerCase();
    if (slug) index.bySlug.set(slug, row);
    if (name && symbol) {
      const key = `${normalize(name)}#${symbol}`;
      index.byNameSymbol.set(key, [...(index.byNameSymbol.get(key) ?? []), row]);
    }
    if (symbol) index.bySymbol.set(symbol, [...(index.bySymbol.get(symbol) ?? []), row]);
  }
}

async function fetchCmc(observations: SourceObservation[]): Promise<CmcIndex> {
  const url = `${CMC}/v3/cryptocurrency/listings/latest?start=1&limit=5000&convert=USD`;
  const empty = (): CmcIndex => ({
    byId: new Map(),
    bySlug: new Map(),
    byNameSymbol: new Map(),
    bySymbol: new Map(),
  });
  try {
    const response = await getJson<{ data?: Json[] }>(
      url,
      observations,
    );
    if (!Array.isArray(response.data) || response.data.length === 0) throw new Error("CMC response is empty");
    const index = empty();
    indexCmcRows(index, response.data);
    return index;
  } catch {
    const observation = observations.find(s => s.url === url);
    if (observation) observation.status = "error";
    return empty();
  }
}

async function completeCmc(ids: number[], index: CmcIndex, observations: SourceObservation[]) {
  const lookups = new Map<number, QuoteLookup>();
  for (const [id, row] of index.byId) lookups.set(id, quoteLookup(String(id), row, "cmc"));
  await quoteBatches([...new Set(ids)].filter(id => !index.byId.has(id)).sort((a,b) => a-b), async batch => {
    const url = `${CMC}/v3/cryptocurrency/quotes/latest?id=${batch.join(",")}&convert=USD&skip_invalid=true`;
    try {
      const response = await getJson<{ data?: Json[] } | Json[]>(url, observations, { timeout: 10_000 });
      const rows = Array.isArray(response) ? response : response.data;
      if (!Array.isArray(rows)) throw new Error("CMC quote response is invalid");
      indexCmcRows(index, rows.filter(row => batch.includes(Number(row.id))));
      for (const id of batch) lookups.set(id, quoteLookup(String(id), index.byId.get(id), "cmc"));
    } catch {
      const observation = observations.find(s => s.url === url);
      if (observation) observation.status = "error";
      for (const id of batch) lookups.set(id, quoteLookup(String(id), undefined, "cmc", true));
    }
  });
  return lookups;
}

function cmcQuote(row: Json | undefined): Json | undefined {
  if (!row || !Array.isArray(row.quote)) return undefined;
  return (row.quote as Json[]).find((quote) => str(quote.symbol) === "USD");
}

export function findCmc({
  cmcIds = [],
  geckoId,
  groupKey,
  name,
  symbol,
  cmc,
}: {
  cmcIds?: number[];
  geckoId: string | null;
  groupKey: string;
  name: string;
  symbol: string | null;
  cmc: CmcIndex;
}): Json | undefined {
  // DefiLlama supplies canonical numeric CMC IDs. Slugs are not shared identifiers across vendors.
  if (cmcIds.length > 1) return undefined;
  if (cmcIds.length === 1) {
    const exact = cmc.byId.get(cmcIds[0]);
    return exact && (!symbol || str(exact.symbol)?.toLowerCase() === symbol.toLowerCase()) ? exact : undefined;
  }
  const normalizedSymbol = symbol?.toLowerCase() ?? null;
  const symbolMatches = (row: Json | undefined) =>
    !!row && (!normalizedSymbol || str(row.symbol)?.toLowerCase() === normalizedSymbol);

  const overrideSlug = CMC_SLUG_OVERRIDES[groupKey];
  if (overrideSlug) {
    const override = cmc.bySlug.get(overrideSlug);
    if (symbolMatches(override)) return override;
  }

  if (geckoId) {
    const exact = cmc.bySlug.get(geckoId.toLowerCase());
    if (symbolMatches(exact)) return exact;
    // A known different Gecko asset cannot be overwritten by a name or symbol match.
    return undefined;
  }

  const projectSlug = groupKey.replace(/^parent#/, "").toLowerCase();
  const exactProject = cmc.bySlug.get(projectSlug);
  if (symbolMatches(exactProject)) return exactProject;

  if (normalizedSymbol) {
    const exactName = cmc.byNameSymbol.get(`${normalize(name)}#${normalizedSymbol}`) ?? [];
    if (exactName.length === 1) return exactName[0];

    const candidates = cmc.bySymbol.get(normalizedSymbol) ?? [];
    if (candidates.length === 1) {
      const candidate = candidates[0];
      const candidateName = normalize(str(candidate.name) ?? "");
      const candidateSlug = normalize(str(candidate.slug) ?? "");
      const projectName = normalize(name);
      const projectSlugNormalized = normalize(projectSlug);
      if (
        candidateName === projectName ||
        candidateSlug === projectSlugNormalized
      ) {
        return candidate;
      }
    }
  }
  return undefined;
}

// 한 그룹의 overview 집계 (연율화·30일·직전30일 합산)
interface Agg {
  annual: number | null;
  y1: number | null;
  d1: number | null;
  prev1: number | null;
  d7: number | null;
  prev7: number | null;
  d30: number | null;
  prev30: number | null;
  hit: boolean;
}

export function aggregateOverviewByGroup(
  list: Json[],
  groupKey: (slug: string) => string,
): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const p of list) {
    const slug = str(p.slug);
    if (!slug) continue;
    if (p.doublecounted === true) continue;
    const k = groupKey(slug);
    let a = m.get(k);
    if (!a) {
      a = { annual: 0, y1: 0, d1: 0, prev1: 0, d7: 0, prev7: 0, d30: 0, prev30: 0, hit: false };
      m.set(k, a);
    }
    const fields = { y1: "total1y", d1: "total24h", prev1: "total48hto24h", d7: "total7d", prev7: "total14dto7d", d30: "total30d", prev30: "total60dto30d" } as const;
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
      const value = num(p[fields[key]]);
      // A partial parent sum is not a complete period. Preserve reported zeros.
      a[key] = a[key] !== null && value !== null ? a[key]! + value : null;
    }
    a.annual = a.d30 !== null ? a.d30 * 365 / 30 : null;
    a.hit = true;
  }
  return m;
}

/** Partial source sums are display evidence only; they never replace a complete valuation denominator. */
export function aggregateRevenueSource(list: Json[], groupKey: (slug: string) => string) {
  const groups = new Map<string, Json[]>();
  for (const p of list) if (typeof p.slug === "string" && p.doublecounted !== true) {
    const key = groupKey(p.slug);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return new Map([...groups].map(([key, rows]) => [key, Object.fromEntries(([1, 7, 30, 365] as const).map(days => {
    const field = ({ 1: "total24h", 7: "total7d", 30: "total30d", 365: "total1y" })[days];
    const values = rows.flatMap(p => num(p[field]) !== null ? [Number(p[field])] : []);
    return [days, { total: values.length ? values.reduce((a,b) => a+b, 0) : null, reported: values.length, expected: rows.length }];
  })) as NonNullable<CoinRaw["revenueSource"]>["periods"]]));
}

/**
 * DefiLlama 4종 + CMC + CoinGecko를 조인하되, **parent protocol 단위로 묶어** 집계한다.
 * holder revenue는 child 경제유형을 보존해 적격 최근 30일과 raw TTM을 따로 합산한다.
 */
export async function fetchCoins(observations: SourceObservation[] = []): Promise<CoinRaw[]> {
  const histories = Promise.all([fetchRevenueHistory(observations), fetchHolderHistory(observations)]);
  const [protocols, feesL, revL, hrL, dexsL, cmc, stablecoins, config] = await Promise.all([
    getJson<Json[]>(`${LLAMA}/protocols`, observations),
    fetchOverviewList("/overview/fees", observations),
    fetchOverviewList("/overview/fees?dataType=dailyRevenue", observations),
    fetchOverviewList("/overview/fees?dataType=dailyHoldersRevenue", observations),
    fetchOverviewList("/overview/dexs", observations),
    fetchCmc(observations),
    getJson<{ peggedAssets: StablecoinAsset[] }>(STABLECOIN_SOURCE, observations),
    getJson<{ parentProtocols: Json[] }>(`${LLAMA}/config`, observations),
  ]);

  if (!Array.isArray(stablecoins.peggedAssets) || stablecoins.peggedAssets.length === 0) throw new Error("Stablecoin identity registry unavailable");
  if (!Array.isArray(protocols) || !protocols.length || !Array.isArray(config.parentProtocols)) throw new Error("DefiLlama directory unavailable");
  const parents = new Map(config.parentProtocols.flatMap(p => typeof p.id === "string" ? [[p.id, p] as const] : []));
  const identityRows = [...protocols, ...feesL, ...revL, ...hrL, ...dexsL, ...config.parentProtocols];
  const [gecko, cmcLookups, [revenueHistories, holderHistories]] = await Promise.all([
    fetchGecko(identityRows.flatMap(p => str(p.gecko_id) ? [String(p.gecko_id)] : []), observations),
    completeCmc(identityRows.map(p => Number(p.cmcId)).filter(id => Number.isSafeInteger(id) && id > 0), cmc, observations),
    histories,
  ]);

  // /protocols also carries parent links, including children absent from revenue overviews.
  const parentOf = new Map<string, string>();
  for (const list of [feesL, revL, hrL, dexsL, protocols]) {
    for (const p of list) {
      const slug = str(p.slug);
      const par = str(p.parentProtocol);
      if (slug && par) parentOf.set(slug, par);
    }
  }
  const groupKey = (slug: string) => parentOf.get(slug) ?? slug;

  const feesAgg = aggregateOverviewByGroup(feesL, groupKey);
  const revAgg = aggregateOverviewByGroup(revL, groupKey);
  const sourceRevAgg = aggregateRevenueSource(revL, groupKey);
  const holderValues = aggregateHolderValueByGroup(hrL, groupKey, definitionReviewed);
  const revenueDefinitions = aggregateDefinitions(revL, groupKey, "Revenue");
  const feeDefinitions = aggregateDefinitions(feesL, groupKey, "Fees");
  const volAgg = aggregateOverviewByGroup(dexsL, groupKey);
  const identities = new Map<string, Json[]>();
  for (const p of identityRows) if (typeof p.slug === "string") {
    const key = groupKey(p.slug);
    identities.set(key, [...(identities.get(key) ?? []), p]);
  }

  // Include fee/revenue-only projects too. One component per slug; no market-cap cutoff.
  const directory = new Map<string, Json>();
  for (const p of [...protocols, ...feesL, ...revL, ...hrL, ...dexsL]) {
    const slug = str(p.slug);
    if (slug && !directory.has(slug)) directory.set(slug, p);
  }
  const groups = new Map<string, Json[]>();
  for (const p of directory.values()) {
    const slug = str(p.slug);
    if (!slug) continue;
    const k = groupKey(slug);
    let arr = groups.get(k);
    if (!arr) { arr = []; groups.set(k, arr); }
    arr.push(p);
  }
  for (const [key, parent] of parents) if (!groups.has(key)) groups.set(key, [{ ...parent, slug: key }]);

  const coins: CoinRaw[] = [];

  for (const [k, members] of groups) {
    // 메타 집계
    let dlMcap: number | null = null; // DefiLlama가 아는 시총 (있으면 우선)
    let tvl: number | null = null;
    let geckoId: string | null = null;
    let symbol: string | null = null;
    let listedAt: number | null = null;
    const memberGeckoIds = new Set<string>();
    const memberSymbols = new Set<string>();
    const memberCmcIds = new Set<number>();
    const parent = parents.get(k);
    for (const m of members) {
      const t = num(m.tvl);
      if (t !== null && m !== parent) tvl = (tvl ?? 0) + t;
    }
    for (const m of [...(parent ? [parent] : []), ...(identities.get(k) ?? members)]) {
      const id = typeof m.cmcId === "string" && /^\d+$/.test(m.cmcId) ? Number(m.cmcId) : num(m.cmcId);
      if (id !== null && id > 0) memberCmcIds.add(id);
      const v = num(m.mcap);
      if (v !== null && v > 0 && (dlMcap === null || v > dlMcap)) dlMcap = v;
      const memberGeckoId = str(m.gecko_id);
      if (memberGeckoId) {
        memberGeckoIds.add(memberGeckoId);
        if (!geckoId) geckoId = memberGeckoId;
      }
      const memberSymbol = str(m.symbol);
      if (memberSymbol && memberSymbol !== "-") {
        memberSymbols.add(memberSymbol.toUpperCase());
        if (!symbol) symbol = memberSymbol;
      }
      const listed = num(m.listedAt);
      if (listed !== null && listed > 0 && (listedAt === null || listed < listedAt)) listedAt = listed;
    }
    // 대표 멤버 (메타 표시용): gecko 있는 것 > mcap 있는 것 > TVL 최대 > 첫째
    const rep =
      members.find((m) => str(m.gecko_id)) ??
      members.find((m) => (num(m.mcap) ?? 0) > 0) ??
      [...members].sort((a, b) => (num(b.tvl) ?? 0) - (num(a.tvl) ?? 0))[0] ??
      members[0];

    const isParent = k.startsWith("parent#");
    const name = isParent ? str(parent?.name) ?? prettyParent(k) : (str(rep.name) ?? k);

    const fees = feesAgg.get(k);
    const rev = revAgg.get(k);
    const history = revenueHistories[k] ?? null;
    const holderValue = holderValues.get(k) ?? emptyHolderValueSummary();
    const vol = volAgg.get(k);
    // CoinGecko는 명시적 gecko_id만 사용한다. symbol-only 폴백은 동명이인 오매칭 위험 때문에 금지.
    const g = geckoId ? gecko.byId.get(geckoId) : undefined;
    const cmcRow = findCmc({ cmcIds: [...memberCmcIds], geckoId, groupKey: k, name, symbol, cmc });
    const quote = cmcQuote(cmcRow);

    let identityStatus: IdentityStatus = "review";
    let identityReason = "프로젝트와 시장 토큰의 연결을 확인하지 못함";
    if (memberCmcIds.size > 1 || memberGeckoIds.size > 1 || (isParent && memberSymbols.size > 1)) {
      identityStatus = "ambiguous";
      identityReason = `그룹에 토큰 후보가 여러 개임 (${Math.max(memberSymbols.size, memberGeckoIds.size, memberCmcIds.size)})`;
    } else if (memberCmcIds.size === 1 && cmcRow) {
      identityStatus = "verified";
      identityReason = "DefiLlama의 숫자 CMC ID와 시장 자산 ID 일치";
    } else if (isParent && memberGeckoIds.size === 1 && memberSymbols.size <= 1) {
      identityStatus = "verified";
      identityReason = "parent 구성원이 하나의 gecko_id·심볼을 공유";
    } else if (isParent && memberGeckoIds.size === 0 && memberSymbols.size === 1 && cmcRow) {
      identityStatus = "verified";
      identityReason = "단일 parent 심볼과 CMC canonical 자산이 일치";
    } else if (!isParent && geckoId) {
      identityStatus = "verified";
      identityReason = "DefiLlama gecko_id로 토큰 연결";
    } else if (!isParent && cmcRow) {
      identityStatus = "verified";
      identityReason = "프로젝트명·심볼과 CMC canonical 자산이 일치";
    }

    const gMcap = g ? num(g.market_cap) : null;
    const cmcMcap = quote ? num(quote.market_cap) : null;

    // 시총: canonical CMC 매칭을 우선하고, 없으면 DefiLlama/CoinGecko 보조값.
    const mcap = cmcMcap ?? gMcap ?? dlMcap;
    const cmcId = cmcRow ? num(cmcRow.id) : memberCmcIds.size === 1 ? [...memberCmcIds][0] : null;

    const cmcListedAt = cmcRow ? Date.parse(str(cmcRow.date_added) ?? "") : NaN;
    if (Number.isFinite(cmcListedAt)) listedAt = cmcListedAt / 1000;

    const feesChange7 =
      fees && fees.prev7 !== null && fees.prev7 > 0 && fees.d7 !== null ? ((fees.d7 - fees.prev7) / fees.prev7) * 100 : null;
    const feesChange =
      fees && fees.prev30 !== null && fees.prev30 > 0 && fees.d30 !== null ? ((fees.d30 - fees.prev30) / fees.prev30) * 100 : null;

    coins.push({
      fundamentals: combineFundamentals(revenueDefinitions.get(k) as MetricDefinition<RevenueKind> | undefined, feeDefinitions.get(k) as MetricDefinition<FeeKind> | undefined, hrL.filter(h => typeof h.slug === "string" && h.doublecounted !== true && groupKey(h.slug) === k)),
      slug: k,
      sourceSlugs: [...new Set([k, ...members.map(m => String(m.slug))])],
      name,
      symbol: (cmcRow ? str(cmcRow.symbol) : g ? str(g.symbol)?.toUpperCase() : null) ?? symbol,
      category: str(rep.category),
      chains: [...new Set(members.flatMap(m => Array.isArray(m.chains) ? m.chains.filter((v): v is string => typeof v === "string") : []))],
      geckoId,
      cmcId: cmcRow ? num(cmcRow.id) : null,
      cmcSlug: cmcRow ? str(cmcRow.slug) : identityStatus === "verified" ? CMC_SLUG_OVERRIDES[k] ?? null : null,
      logo: str(parent?.logo) ?? str(rep.logo),
      listedAt,
      isParent,
      identityStatus,
      identityReason,
      capitalExclusionReason: capitalExclusion(geckoId ?? (cmcRow ? str(cmcRow.slug) : null), (cmcRow ? str(cmcRow.symbol) : g ? str(g.symbol) : null) ?? symbol, stablecoins.peggedAssets),
      description: str(parent?.description) ?? str(rep.description),
      descriptionKo: koreanDescription(str(parent?.description) ?? str(rep.description)),
      descriptionSource: `https://defillama.com/protocol/${encodeURIComponent(String(rep.slug))}`,
      website: str(parent?.url) ?? str(rep.url),
      revenueHistory: history,
      revenueSource: { url: REVENUE_OVERVIEW_URL, observedAt: observations.find(s => s.url === REVENUE_OVERVIEW_URL && s.status === "ok")!.observedAt, periods: sourceRevAgg.get(k) },
      holderHistory: holderHistories[k] ?? null,
      sales: resolveSalesEvidence({ slug: k, geckoId, symbol, identityStatus }, new Date().toISOString()),

      mcap,
      marketSources: {
        mcap: cmcMcap !== null ? "CoinMarketCap" : gMcap !== null ? "CoinGecko" : dlMcap !== null ? "DefiLlama" : null,
        price: num(quote?.price) !== null ? "CoinMarketCap" : num(g?.current_price) !== null ? "CoinGecko" : null,
        fdv: num(quote?.fully_diluted_market_cap) !== null ? "CoinMarketCap" : num(g?.fully_diluted_valuation) !== null ? "CoinGecko" : null,
        gecko: geckoId ? gecko.lookups.get(geckoId) ?? null : null,
        cmc: cmcId !== null ? !cmcRow && cmc.byId.has(cmcId) ? { ...cmcLookups.get(cmcId)!, status: "identity_mismatch" } : cmcLookups.get(cmcId) ?? null : null,
      },
      tvl,
      change1d: num(quote?.percent_change_24h) ?? num(g?.price_change_percentage_24h),
      change7d: num(quote?.percent_change_7d) ?? num(g?.price_change_percentage_7d_in_currency),
      price: num(quote?.price) ?? num(g?.current_price),
      marketCapRank: cmcRow ? num(cmcRow.cmc_rank) : g ? num(g.market_cap_rank) : null,
      totalVolume: num(quote?.volume_24h) ?? num(g?.total_volume),
      numMarketPairs: cmcRow ? num(cmcRow.num_market_pairs) : null,
      marketDataUpdatedAt: str(quote?.last_updated) ?? str(g?.last_updated),
      priceChange7d: num(quote?.percent_change_7d) ?? num(g?.price_change_percentage_7d_in_currency),
      priceChange14d: g ? num(g.price_change_percentage_14d_in_currency) : null,
      priceChange30d: num(quote?.percent_change_30d) ?? num(g?.price_change_percentage_30d_in_currency),
      priceChange60d: quote ? num(quote.percent_change_60d) : null,
      priceChange90d: quote ? num(quote.percent_change_90d) : null,
      priceChange1y: g ? num(g.price_change_percentage_1y_in_currency) : null,
      athChangePercentage: g ? num(g.ath_change_percentage) : null,
      atlChangePercentage: g ? num(g.atl_change_percentage) : null,

      feesAnnual: fees?.annual ?? null,
      fees1y: fees?.y1 ?? null,
      fees7d: fees?.d7 ?? null,
      fees30d: fees?.d30 ?? null,
      feesPrev30d: fees?.prev30 ?? null,
      feesChange7dover7d: feesChange7,
      feesChange30dover30d: feesChange,

      // Preserve overview amounts. Research uses compatible completed-day history when available.
      // Holder share requires separately reviewed denominator scope and the same source window.
      revenueAnnual: rev?.annual ?? null,
      revenue1y: rev?.y1 ?? null,
      revenue24h: rev?.d1 ?? null,
      revenuePrev24h: rev?.prev1 ?? null,
      revenuePrev7d: rev?.prev7 ?? null,
      revenue7d: rev?.d7 ?? null,
      revenue90d: history?.periods[90].total ?? null,
      revenue30d: rev?.d30 ?? null,
      revenuePrev30d: rev?.prev30 ?? null,

      holderValue,

      volumeAnnual: vol?.annual ?? null,
      volume30d: vol?.d30 ?? null,

      fdv: num(quote?.fully_diluted_market_cap) ?? num(g?.fully_diluted_valuation),
      circulatingSupply: num(cmcRow?.circulating_supply) ?? num(g?.circulating_supply),
      totalSupply: num(cmcRow?.total_supply) ?? num(g?.total_supply),
      maxSupply: num(cmcRow?.max_supply) ?? num(g?.max_supply),
    });
  }

  const represented = new Set(coins.flatMap(c => c.sourceSlugs!));
  const expected = [...directory.keys(), ...parents.keys()];
  if (new Set(coins.map(c => c.slug)).size !== coins.length || expected.some(slug => !represented.has(slug))) throw new Error("Source directory coverage mismatch");
  if (coins.some(c => c.geckoId && !c.marketSources?.gecko)) throw new Error("Unattempted CoinGecko identity");
  return coins;
}
