import { afterEach, expect, it, vi } from "vitest";
import { fetchCoins, fetchGecko } from "./sources";
import { collectionErrors } from "./collectionQuality";
import type { SourceObservation } from "./types";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });

it("backs off on rate limits and bounds retries inside the server time budget", async () => {
  vi.useFakeTimers();
  const start = Date.now(), times: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async () => { times.push(Date.now()); return new Response("", {status:429,headers:{"retry-after":"60"}}); }));
  const observations: SourceObservation[] = [];
  const pending = fetchGecko(Array.from({length:1000},(_,i)=>`asset-${i}`), observations);
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(result.lookups.size).toBe(1000);
  expect([...result.lookups.values()].every(v=>v.status==="error")).toBe(true);
  expect(times[1]-times[0]).toBeGreaterThanOrEqual(60_000);
  expect(Date.now()-start).toBeLessThanOrEqual(260_000);
  expect(observations[0].httpStatus).toBe(429);
});

it("queries every explicit ID beyond 1000 and preserves low-ranked and zero-valued quotes", async () => {
  vi.useFakeTimers();
  const ids = Array.from({ length: 1251 }, (_, i) => `token-${String(i).padStart(4,"0")}`);
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input), batch = url.searchParams.get("ids")!.split(",");
    expect(url.searchParams.get("per_page")).toBe("250");
    expect(batch.length).toBeLessThanOrEqual(250);
    requested.push(...batch);
    return new Response(JSON.stringify(batch.map(id => ({ id, market_cap_rank: 20000, market_cap: id === ids[1250] ? 0 : 10 }))));
  }));
  const pending = fetchGecko([...ids, ids[0]], []);
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(new Set(requested).size).toBe(1251);
  expect(requested).toHaveLength(1251);
  expect(result.byId.get(ids[1250])?.market_cap).toBe(0);
  expect(result.lookups.get(ids[1250])).toMatchObject({ status: "received", available: ["mcap"] });
});

it("accounts for absent IDs and failed batches without skipping later IDs", async () => {
  vi.useFakeTimers();
  const ids = Array.from({ length: 751 }, (_, i) => `id-${String(i).padStart(4,"0")}`);
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const batch = new URL(input).searchParams.get("ids")!.split(",");
    if (batch.includes(ids[250])) throw new Error("transient network failure");
    return new Response(JSON.stringify(batch.filter(id => id !== ids[2]).map(id => ({ id }))));
  }));
  const observations: SourceObservation[] = [];
  const pending = fetchGecko(ids, observations);
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(result.lookups.size).toBe(ids.length);
  expect(result.lookups.get(ids[2])?.status).toBe("not_returned");
  expect(result.lookups.get(ids[250])?.status).toBe("error");
  expect(result.lookups.get(ids[750])?.status).toBe("received");
  expect(observations.filter(s => s.status === "error")).toHaveLength(1);
});

it.each([false, true])("supplements canonical CMC IDs outside listings and uses field-level fallback (conflict=%s)", async conflict => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input); requests.push(url);
    const body = url.endsWith("/protocols") ? [{ slug: "token", name: "Token", symbol: "T", cmcId: "99999", gecko_id: null }]
      : url.endsWith("/config") ? { parentProtocols: [] }
      : url.includes("/coins/markets") ? [{ id: "token", symbol: "t", market_cap: 200, current_price: 2, fully_diluted_valuation: 400, last_updated: "2026-09-28T00:00:00Z" }]
      : url.includes("/quotes/latest") ? { data: [{ id: 99999, symbol: conflict ? "WRONG" : "T", slug: "token", quote: [{ symbol: "USD", market_cap: 100, price: null }] }] }
      : url.includes("coinmarketcap") ? { data: [] }
      : url.includes("stablecoins") ? { peggedAssets: [{ gecko_id: "usdd", symbol: "USDD" }] }
      : { protocols: [{ slug: "token", name: "Token", symbol: "T", gecko_id: "token", total30d: 30 }], totalDataChartBreakdown: [] };
    return new Response(JSON.stringify(body));
  }));
  const [coin] = await fetchCoins([]);
  expect(requests.some(u => u.includes("/quotes/latest?id=99999"))).toBe(true);
  expect(coin).toMatchObject({ geckoId: "token", mcap: conflict ? 200 : 100, price: 2, fdv: 400, marketDataUpdatedAt: "2026-09-28T00:00:00Z" });
  expect(coin.marketSources?.cmc?.status).toBe(conflict ? "identity_mismatch" : "received");
  expect(coin.marketSources?.price).toBe("CoinGecko");
  expect(collectionErrors([coin])).toEqual([]);
});
