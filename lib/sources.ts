import type { CoinRaw, IdentityStatus } from "./types";
import {
  aggregateHolderValueByGroup,
  emptyHolderValueSummary,
} from "./holderValue";

// 캐시 TTL (초)
const TTL_DEFILLAMA = 1800; // 30분
const TTL_COINGECKO = 21600; // 6시간
const TTL_CMC = 1800; // 30분

const LLAMA = "https://api.llama.fi";
const GECKO = "https://api.coingecko.com/api/v3";
const CMC = "https://pro-api.coinmarketcap.com/public-api";

// 자동 이름/slug 매칭으로 확정할 수 없는 canonical CMC 예외.
// 각 항목은 프로젝트 구성원·심볼과 CMC 자산을 수동 검증한 뒤에만 추가한다.
const CMC_SLUG_OVERRIDES: Record<string, string> = {
  "parent#pump": "pump-fun",
};

// CoinGecko 무료 레이트리밋 대응: 상위 N페이지(페이지당 250)만 FDV 보강
const GECKO_PAGES = 4; // 상위 ~1000개

type Json = Record<string, unknown>;

async function getJson<T>(url: string, revalidate: number): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      next: { revalidate },
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return (await res.json()) as T;
    if (res.status !== 429 || attempt === 2) {
      throw new Error(`fetch ${url} -> ${res.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw new Error(`fetch ${url} failed`);
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const normalize = (v: string): string =>
  v.toLowerCase().replace(/[^a-z0-9]/g, "");

// fees/revenue/volume용: total1y 우선, 없으면 30일 연율화.
// holder value는 이 함수를 쓰지 않고 lib/holderValue.ts에서 적격 30일만 연환산한다.
function annualize(p: Json): number | null {
  const y = num(p.total1y);
  if (y !== null && y > 0) return y;
  const m = num(p.total30d);
  if (m !== null && m > 0) return (m * 365) / 30;
  return null;
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
async function fetchOverviewList(path: string): Promise<Json[]> {
  const url = `${LLAMA}${path}${path.includes("?") ? "&" : "?"}excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
  const data = await getJson<{ protocols?: Json[] }>(url, TTL_DEFILLAMA);
  return data.protocols ?? [];
}

// CoinGecko 상위 코인: 명시적 gecko_id 보강용
async function fetchGecko(): Promise<{ byId: Map<string, Json> }> {
  const byId = new Map<string, Json>();
  for (let page = 1; page <= GECKO_PAGES; page++) {
    const url = `${GECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&price_change_percentage=7d,14d,30d,1y`;
    try {
      const rows = await getJson<Json[]>(url, TTL_COINGECKO);
      for (const r of rows) {
        const id = str(r.id);
        if (id) byId.set(id, r);
      }
    } catch {
      break; // 레이트리밋/실패 시 부분 보강 — FDV는 옵셔널
    }
  }
  return { byId };
}

interface CmcIndex {
  bySlug: Map<string, Json>;
  byNameSymbol: Map<string, Json[]>;
  bySymbol: Map<string, Json[]>;
}

async function fetchCmc(): Promise<CmcIndex> {
  const empty = (): CmcIndex => ({
    bySlug: new Map(),
    byNameSymbol: new Map(),
    bySymbol: new Map(),
  });
  try {
    const response = await getJson<{ data?: Json[] }>(
      `${CMC}/v3/cryptocurrency/listings/latest?start=1&limit=5000&convert=USD`,
      TTL_CMC,
    );
    const index = empty();
    for (const row of response.data ?? []) {
      const slug = str(row.slug)?.toLowerCase();
      const name = str(row.name);
      const symbol = str(row.symbol)?.toLowerCase();
      if (slug) index.bySlug.set(slug, row);
      if (name && symbol) {
        const key = `${normalize(name)}#${symbol}`;
        const rows = index.byNameSymbol.get(key) ?? [];
        rows.push(row);
        index.byNameSymbol.set(key, rows);
      }
      if (symbol) {
        const rows = index.bySymbol.get(symbol) ?? [];
        rows.push(row);
        index.bySymbol.set(symbol, rows);
      }
    }
    return index;
  } catch {
    return empty();
  }
}

function cmcQuote(row: Json | undefined): Json | undefined {
  if (!row || !Array.isArray(row.quote)) return undefined;
  return (row.quote as Json[]).find((quote) => str(quote.symbol) === "USD");
}

function findCmc({
  geckoId,
  groupKey,
  name,
  symbol,
  cmc,
}: {
  geckoId: string | null;
  groupKey: string;
  name: string;
  symbol: string | null;
  cmc: CmcIndex;
}): Json | undefined {
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
        candidateSlug === projectSlugNormalized ||
        (projectName.length >= 5 && candidateName.includes(projectName)) ||
        (projectName.length >= 5 && projectName.includes(candidateName))
      ) {
        return candidate;
      }
    }
  }
  return undefined;
}

// 한 그룹의 overview 집계 (연율화·30일·직전30일 합산)
interface Agg {
  annual: number;
  y1: number;
  d7: number;
  prev7: number;
  d30: number;
  prev30: number;
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
      a = { annual: 0, y1: 0, d7: 0, prev7: 0, d30: 0, prev30: 0, hit: false };
      m.set(k, a);
    }
    const an = annualize(p); if (an) a.annual += an;
    const y1 = num(p.total1y); if (y1 && y1 > 0) a.y1 += y1;
    const d7 = num(p.total7d); if (d7 && d7 > 0) a.d7 += d7;
    const p7 = num(p.total14dto7d); if (p7 && p7 > 0) a.prev7 += p7;
    const d30 = num(p.total30d); if (d30 && d30 > 0) a.d30 += d30;
    const pv = num(p.total60dto30d); if (pv && pv > 0) a.prev30 += pv;
    a.hit = true;
  }
  return m;
}

/**
 * DefiLlama 4종 + CMC + CoinGecko를 조인하되, **parent protocol 단위로 묶어** 집계한다.
 * holder revenue는 child 경제유형을 보존해 적격 최근 30일과 raw TTM을 따로 합산한다.
 */
export async function fetchCoins(): Promise<CoinRaw[]> {
  const [protocols, feesL, revL, hrL, dexsL, gecko, cmc] = await Promise.all([
    getJson<Json[]>(`${LLAMA}/protocols`, TTL_DEFILLAMA),
    fetchOverviewList("/overview/fees"),
    fetchOverviewList("/overview/fees?dataType=dailyRevenue"),
    fetchOverviewList("/overview/fees?dataType=dailyHoldersRevenue"),
    fetchOverviewList("/overview/dexs"),
    fetchGecko(),
    fetchCmc(),
  ]);

  // slug → parentProtocol 매핑 (overview에서만 제공됨)
  const parentOf = new Map<string, string>();
  for (const list of [feesL, revL, hrL, dexsL]) {
    for (const p of list) {
      const slug = str(p.slug);
      const par = str(p.parentProtocol);
      if (slug && par) parentOf.set(slug, par);
    }
  }
  const groupKey = (slug: string) => parentOf.get(slug) ?? slug;

  const feesAgg = aggregateOverviewByGroup(feesL, groupKey);
  const revAgg = aggregateOverviewByGroup(revL, groupKey);
  const holderValues = aggregateHolderValueByGroup(hrL, groupKey);
  const volAgg = aggregateOverviewByGroup(dexsL, groupKey);

  // protocols를 그룹키로 묶기
  const groups = new Map<string, Json[]>();
  for (const p of protocols) {
    const slug = str(p.slug);
    if (!slug) continue;
    const k = groupKey(slug);
    let arr = groups.get(k);
    if (!arr) { arr = []; groups.set(k, arr); }
    arr.push(p);
  }

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
    for (const m of members) {
      const v = num(m.mcap);
      if (v !== null && v > 0 && (dlMcap === null || v > dlMcap)) dlMcap = v;
      const t = num(m.tvl);
      if (t !== null) tvl = (tvl ?? 0) + t;
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
    const name = isParent ? prettyParent(k) : (str(rep.name) ?? k);

    const fees = feesAgg.get(k);
    const rev = revAgg.get(k);
    const holderValue = holderValues.get(k) ?? emptyHolderValueSummary();
    const vol = volAgg.get(k);
    // CoinGecko는 명시적 gecko_id만 사용한다. symbol-only 폴백은 동명이인 오매칭 위험 때문에 금지.
    const g = geckoId ? gecko.byId.get(geckoId) : undefined;
    const cmcRow = findCmc({ geckoId, groupKey: k, name, symbol, cmc });
    const quote = cmcQuote(cmcRow);

    let identityStatus: IdentityStatus = "review";
    let identityReason = "프로젝트와 시장 토큰의 연결을 확인하지 못함";
    if (isParent && (memberGeckoIds.size > 1 || memberSymbols.size > 1)) {
      identityStatus = "ambiguous";
      identityReason = `parent 그룹에 토큰 후보가 여러 개임 (${memberSymbols.size || memberGeckoIds.size})`;
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
    const mcap = cmcMcap ?? dlMcap ?? gMcap;
    if (mcap === null && tvl === null) continue; // 둘 다 없으면 의미 없음

    const cmcListedAt = cmcRow ? Date.parse(str(cmcRow.date_added) ?? "") : NaN;
    if (Number.isFinite(cmcListedAt)) listedAt = cmcListedAt / 1000;

    const feesChange7 =
      fees && fees.prev7 > 0 ? ((fees.d7 - fees.prev7) / fees.prev7) * 100 : null;
    const feesChange =
      fees && fees.prev30 > 0 ? ((fees.d30 - fees.prev30) / fees.prev30) * 100 : null;

    coins.push({
      slug: k,
      name,
      symbol,
      category: str(rep.category),
      chains: Array.isArray(rep.chains) ? (rep.chains as string[]) : [],
      geckoId,
      cmcId: cmcRow ? num(cmcRow.id) : null,
      cmcSlug: cmcRow ? str(cmcRow.slug) : null,
      logo: str(rep.logo),
      listedAt,
      isParent,
      identityStatus,
      identityReason,

      mcap,
      tvl,
      change1d: quote ? num(quote.percent_change_24h) : num(rep.change_1d),
      change7d: quote ? num(quote.percent_change_7d) : num(rep.change_7d),
      price: quote ? num(quote.price) : g ? num(g.current_price) : null,
      marketCapRank: cmcRow ? num(cmcRow.cmc_rank) : g ? num(g.market_cap_rank) : null,
      totalVolume: quote ? num(quote.volume_24h) : g ? num(g.total_volume) : null,
      numMarketPairs: cmcRow ? num(cmcRow.num_market_pairs) : null,
      marketDataUpdatedAt: quote ? str(quote.last_updated) : null,
      priceChange7d: quote ? num(quote.percent_change_7d) : g ? num(g.price_change_percentage_7d_in_currency) : num(rep.change_7d),
      priceChange14d: g ? num(g.price_change_percentage_14d_in_currency) : null,
      priceChange30d: quote ? num(quote.percent_change_30d) : g ? num(g.price_change_percentage_30d_in_currency) : null,
      priceChange60d: quote ? num(quote.percent_change_60d) : null,
      priceChange90d: quote ? num(quote.percent_change_90d) : null,
      priceChange1y: g ? num(g.price_change_percentage_1y_in_currency) : null,
      athChangePercentage: g ? num(g.ath_change_percentage) : null,
      atlChangePercentage: g ? num(g.atl_change_percentage) : null,

      feesAnnual: fees && fees.annual > 0 ? fees.annual : null,
      fees1y: fees && fees.y1 > 0 ? fees.y1 : null,
      fees7d: fees && fees.d7 > 0 ? fees.d7 : null,
      fees30d: fees && fees.d30 > 0 ? fees.d30 : null,
      feesPrev30d: fees && fees.prev30 > 0 ? fees.prev30 : null,
      feesChange7dover7d: feesChange7,
      feesChange30dover30d: feesChange,

      revenueAnnual: rev && rev.annual > 0 ? rev.annual : null,
      revenue1y: rev && rev.y1 > 0 ? rev.y1 : null,
      revenue30d: rev && rev.d30 > 0 ? rev.d30 : null,
      revenuePrev30d: rev && rev.prev30 > 0 ? rev.prev30 : null,

      holderValue,

      volumeAnnual: vol && vol.annual > 0 ? vol.annual : null,
      volume30d: vol && vol.d30 > 0 ? vol.d30 : null,

      fdv: quote ? num(quote.fully_diluted_market_cap) : g ? num(g.fully_diluted_valuation) : null,
      circulatingSupply: cmcRow ? num(cmcRow.circulating_supply) : g ? num(g.circulating_supply) : null,
      totalSupply: cmcRow ? num(cmcRow.total_supply) : g ? num(g.total_supply) : null,
      maxSupply: cmcRow ? num(cmcRow.max_supply) : g ? num(g.max_supply) : null,
    });
  }

  return coins;
}
