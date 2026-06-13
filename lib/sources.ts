import type { CoinRaw } from "./types";

// 캐시 TTL (초)
const TTL_DEFILLAMA = 1800; // 30분
const TTL_COINGECKO = 21600; // 6시간

const LLAMA = "https://api.llama.fi";
const GECKO = "https://api.coingecko.com/api/v3";

// CoinGecko 무료 레이트리밋 대응: 상위 N페이지(페이지당 250)만 FDV 보강
const GECKO_PAGES = 4; // 상위 ~1000개

type Json = Record<string, unknown>;

async function getJson<T>(url: string, revalidate: number): Promise<T> {
  const res = await fetch(url, {
    next: { revalidate },
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

// total1y 우선, 없으면 30일 → 연율화
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

// CoinGecko 상위 코인: id 맵 + symbol 맵(동일 심볼은 시총 최대 우선)
async function fetchGecko(): Promise<{ byId: Map<string, Json>; bySymbol: Map<string, Json> }> {
  const byId = new Map<string, Json>();
  const bySymbol = new Map<string, Json>();
  for (let page = 1; page <= GECKO_PAGES; page++) {
    const url = `${GECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&price_change_percentage=7d,14d,30d`;
    try {
      const rows = await getJson<Json[]>(url, TTL_COINGECKO);
      for (const r of rows) {
        const id = str(r.id);
        if (id) byId.set(id, r);
        const sym = str(r.symbol)?.toLowerCase();
        if (sym) {
          const prev = bySymbol.get(sym);
          if (!prev || (num(r.market_cap) ?? 0) > (num(prev.market_cap) ?? 0)) {
            bySymbol.set(sym, r);
          }
        }
      }
    } catch {
      break; // 레이트리밋/실패 시 부분 보강 — FDV는 옵셔널
    }
  }
  return { byId, bySymbol };
}

// 한 그룹의 overview 집계 (연율화·30일·직전30일 합산)
interface Agg { annual: number; d7: number; prev7: number; d30: number; prev30: number; hit: boolean }

function aggregateByGroup(list: Json[], groupKey: (slug: string) => string): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const p of list) {
    const slug = str(p.slug);
    if (!slug) continue;
    const k = groupKey(slug);
    let a = m.get(k);
    if (!a) { a = { annual: 0, d7: 0, prev7: 0, d30: 0, prev30: 0, hit: false }; m.set(k, a); }
    const an = annualize(p); if (an) a.annual += an;
    const d7 = num(p.total7d); if (d7 && d7 > 0) a.d7 += d7;
    const p7 = num(p.total14dto7d); if (p7 && p7 > 0) a.prev7 += p7;
    const d30 = num(p.total30d); if (d30 && d30 > 0) a.d30 += d30;
    const pv = num(p.total60dto30d); if (pv && pv > 0) a.prev30 += pv;
    a.hit = true;
  }
  return m;
}

/**
 * DefiLlama 4종 + CoinGecko를 조인하되, **parent protocol 단위로 묶어** 집계한다.
 * (예: Hyperliquid Perps+Spot의 holder revenue를 합치고, gecko_id가 없으면 symbol로
 *  CoinGecko 시총을 매칭 → HYPE 같은 멀티-엔트리 토큰의 P/HR이 제대로 계산됨)
 */
export async function fetchCoins(): Promise<CoinRaw[]> {
  const [protocols, feesL, revL, hrL, dexsL, gecko] = await Promise.all([
    getJson<Json[]>(`${LLAMA}/protocols`, TTL_DEFILLAMA),
    fetchOverviewList("/overview/fees"),
    fetchOverviewList("/overview/fees?dataType=dailyRevenue"),
    fetchOverviewList("/overview/fees?dataType=dailyHoldersRevenue"),
    fetchOverviewList("/overview/dexs"),
    fetchGecko(),
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

  const feesAgg = aggregateByGroup(feesL, groupKey);
  const revAgg = aggregateByGroup(revL, groupKey);
  const hrAgg = aggregateByGroup(hrL, groupKey);
  const volAgg = aggregateByGroup(dexsL, groupKey);

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
    for (const m of members) {
      const v = num(m.mcap);
      if (v !== null && v > 0 && (dlMcap === null || v > dlMcap)) dlMcap = v;
      const t = num(m.tvl);
      if (t !== null) tvl = (tvl ?? 0) + t;
      if (!geckoId) geckoId = str(m.gecko_id);
      if (!symbol) { const s = str(m.symbol); if (s && s !== "-") symbol = s; }
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
    const hr = hrAgg.get(k);
    const vol = volAgg.get(k);
    const hasCashflow =
      (fees?.annual ?? 0) > 0 || (rev?.annual ?? 0) > 0 || (hr?.annual ?? 0) > 0;

    // CoinGecko 매칭: gecko_id가 있으면 그것만 사용(폴백 금지 — 상위 1000 밖이면 시총 없음).
    // gecko_id가 아예 없을 때만 symbol 폴백, 그것도 실제 현금흐름이 있는 그룹에만 적용해
    // 같은 심볼을 쓰는 무관한 엔트리(브릿지 등)에 시총이 잘못 붙는 것을 막는다.
    let g = geckoId ? gecko.byId.get(geckoId) : undefined;
    if (!geckoId && symbol && hasCashflow) {
      g = gecko.bySymbol.get(symbol.toLowerCase());
    }
    // CoinGecko로 매칭됐으면 그 id를 저장 (코인 링크용 — parent/폴백 코인도 CoinGecko 연결)
    if (!geckoId && g) geckoId = str(g.id);
    const gMcap = g ? num(g.market_cap) : null;

    // 시총: DefiLlama가 알면 그걸, 아니면 CoinGecko
    const mcap = dlMcap ?? gMcap;
    if (mcap === null && tvl === null) continue; // 둘 다 없으면 의미 없음

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
      logo: str(rep.logo),

      mcap,
      tvl,
      change1d: num(rep.change_1d),
      change7d: num(rep.change_7d),
      price: g ? num(g.current_price) : null,
      marketCapRank: g ? num(g.market_cap_rank) : null,
      totalVolume: g ? num(g.total_volume) : null,
      priceChange7d: g ? num(g.price_change_percentage_7d_in_currency) : num(rep.change_7d),
      priceChange14d: g ? num(g.price_change_percentage_14d_in_currency) : null,
      priceChange30d: g ? num(g.price_change_percentage_30d_in_currency) : null,

      feesAnnual: fees && fees.annual > 0 ? fees.annual : null,
      fees7d: fees && fees.d7 > 0 ? fees.d7 : null,
      fees30d: fees && fees.d30 > 0 ? fees.d30 : null,
      feesChange7dover7d: feesChange7,
      feesChange30dover30d: feesChange,

      revenueAnnual: rev && rev.annual > 0 ? rev.annual : null,
      revenue30d: rev && rev.d30 > 0 ? rev.d30 : null,

      holderRevenueAnnual: hr && hr.annual > 0 ? hr.annual : null,
      holderRevenue30d: hr && hr.d30 > 0 ? hr.d30 : null,

      volumeAnnual: vol && vol.annual > 0 ? vol.annual : null,
      volume30d: vol && vol.d30 > 0 ? vol.d30 : null,

      fdv: g ? num(g.fully_diluted_valuation) : null,
      circulatingSupply: g ? num(g.circulating_supply) : null,
      totalSupply: g ? num(g.total_supply) : null,
      maxSupply: g ? num(g.max_supply) : null,
    });
  }

  return coins;
}
