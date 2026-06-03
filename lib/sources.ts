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
  });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// total1y 우선, 없으면 30일 → 연율화
function annualize(p: Json): number | null {
  const y = num(p.total1y);
  if (y !== null && y > 0) return y;
  const m = num(p.total30d);
  if (m !== null && m > 0) return (m * 365) / 30;
  return null;
}

// DefiLlama overview 응답을 slug→protocol 맵으로
async function fetchOverview(
  path: string,
): Promise<Map<string, Json>> {
  const url = `${LLAMA}${path}${path.includes("?") ? "&" : "?"}excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
  const data = await getJson<{ protocols?: Json[] }>(url, TTL_DEFILLAMA);
  const map = new Map<string, Json>();
  for (const p of data.protocols ?? []) {
    const slug = typeof p.slug === "string" ? p.slug : null;
    if (slug) map.set(slug, p);
  }
  return map;
}

// CoinGecko 상위 코인 FDV/공급량: id(=geckoId) 맵
async function fetchGeckoMarkets(): Promise<Map<string, Json>> {
  const map = new Map<string, Json>();
  for (let page = 1; page <= GECKO_PAGES; page++) {
    const url = `${GECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`;
    try {
      const rows = await getJson<Json[]>(url, TTL_COINGECKO);
      for (const r of rows) {
        const id = typeof r.id === "string" ? r.id : null;
        if (id) map.set(id, r);
      }
    } catch {
      // 레이트리밋/실패 시 보강은 부분적으로만 — FDV는 옵셔널
      break;
    }
  }
  return map;
}

// 4개 DefiLlama 엔드포인트 + CoinGecko를 slug/geckoId로 조인
export async function fetchCoins(): Promise<CoinRaw[]> {
  const [protocols, fees, revenue, dexs, gecko] = await Promise.all([
    getJson<Json[]>(`${LLAMA}/protocols`, TTL_DEFILLAMA),
    fetchOverview("/overview/fees"),
    fetchOverview("/overview/fees?dataType=dailyRevenue"),
    fetchOverview("/overview/dexs"),
    fetchGeckoMarkets(),
  ]);

  const coins: CoinRaw[] = [];

  for (const p of protocols) {
    const slug = typeof p.slug === "string" ? p.slug : null;
    if (!slug) continue;

    const mcap = num(p.mcap);
    const tvl = num(p.tvl);
    // 시총·TVL 둘 다 없으면 밸류에이션 의미 없음 → 제외
    if (mcap === null && tvl === null) continue;

    const feeP = fees.get(slug);
    const revP = revenue.get(slug);
    const dexP = dexs.get(slug);

    const geckoId = typeof p.gecko_id === "string" ? p.gecko_id : null;
    const g = geckoId ? gecko.get(geckoId) : undefined;

    coins.push({
      slug,
      name: typeof p.name === "string" ? p.name : slug,
      symbol: typeof p.symbol === "string" && p.symbol !== "-" ? p.symbol : null,
      category: typeof p.category === "string" ? p.category : null,
      chains: Array.isArray(p.chains) ? (p.chains as string[]) : [],
      geckoId,
      logo: typeof p.logo === "string" ? p.logo : null,

      mcap,
      tvl,
      change1d: num(p.change_1d),
      change7d: num(p.change_7d),

      feesAnnual: feeP ? annualize(feeP) : null,
      fees30d: feeP ? num(feeP.total30d) : null,
      feesChange30dover30d: feeP ? num(feeP.change_30dover30d) : null,

      revenueAnnual: revP ? annualize(revP) : null,
      revenue30d: revP ? num(revP.total30d) : null,

      volumeAnnual: dexP ? annualize(dexP) : null,
      volume30d: dexP ? num(dexP.total30d) : null,

      fdv: g ? num(g.fully_diluted_valuation) : null,
      circulatingSupply: g ? num(g.circulating_supply) : null,
      totalSupply: g ? num(g.total_supply) : null,
      maxSupply: g ? num(g.max_supply) : null,
    });
  }

  return coins;
}
