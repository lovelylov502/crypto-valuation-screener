import { afterEach, expect, it, vi } from "vitest";
import { fetchCoins, fetchGecko, fetchCmc } from "./sources";
import { collectionErrors } from "./collectionQuality";
import type { SourceObservation } from "./types";
import { GECKO_BUDGET_MS } from "./geckoRequests";
import { sample } from "./testFixtures";
import { assembleScreener } from "./screener";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });

it.each(["absent", "partial"])("rechecks a previously identified CMC asset with a %s listings record using current direct quotes", async scenario => {
  const asset = { id: 99999, slug: "token", name: "Token", symbol: "T", quote: [{ symbol: "USD", fully_diluted_market_cap: 400 }] };
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input); calls.push(url);
    const body = url.endsWith("/protocols") ? [{ slug: "token", name: "Token", symbol: "T" }]
      : url.endsWith("/config") ? { parentProtocols: [] }
      : url.includes("/quotes/latest") ? { data: [{ ...asset, quote: [{ symbol: "USD", market_cap: 250, price: 2.5, fully_diluted_market_cap: 500 }] }] }
      : url.includes("coinmarketcap") ? { data: scenario === "partial" ? [asset] : [{ id: 1, slug: "other" }] }
      : url.includes("stablecoins") ? { peggedAssets: [{ gecko_id: "usdd", symbol: "USDD" }] }
      : { protocols: [{ slug: "token", name: "Token", total30d: 30 }], totalDataChartBreakdown: [] };
    return new Response(JSON.stringify(body));
  }));
  const baseline = assembleScreener([sample({ slug: "token", name: "Token", symbol: "T", geckoId: null, cmcId: 99999, cmcSlug: "token", sourceSlugs: ["token"], price: 1, mcap: 100 })], "2026-09-30T10:00:00Z", []);
  const [coin] = await fetchCoins([], baseline);
  expect(calls.some(url => url.includes("/quotes/latest?id=99999"))).toBe(true);
  expect(coin).toMatchObject({ cmcId: 99999, price: 2.5, mcap: 250, fdv: 500 });
  expect(collectionErrors([coin])).toEqual([]);
});

it("respects a CMC rate-limit cooldown before retrying discovery", async () => {
  vi.useFakeTimers();
  const times: number[] = [];
  vi.stubGlobal("fetch",vi.fn(async()=>{
    times.push(Date.now());
    return times.length === 1 ? new Response("",{status:429,headers:{"retry-after":"8"}}) : new Response(JSON.stringify({data:[{id:1,slug:"recovered"}]}));
  }));
  const observations:SourceObservation[]=[];
  const pending=fetchCmc(observations);
  await vi.runAllTimersAsync();
  expect((await pending).byId.has(1)).toBe(true);
  expect(times[1]-times[0]).toBeGreaterThanOrEqual(8000);
  expect(observations.map(s=>s.status)).toEqual(["ok"]);
});

it("continues CMC discovery past 5000 and reports a failed later page without hiding it", async () => {
  const pages = [Array.from({length:5000},(_,i)=>({id:i+1,slug:`asset-${i+1}`})),[{id:5001,slug:"low-ranked"}]];
  const observations: SourceObservation[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const start = Number(new URL(input).searchParams.get("start"));
    return new Response(JSON.stringify({data:pages[start===1?0:1]}));
  }));
  expect((await fetchCmc(observations)).bySlug.get("low-ranked")?.id).toBe(5001);
  expect(observations.every(s=>s.status==="ok")).toBe(true);
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (new URL(input).searchParams.get("start") !== "1") throw new TypeError("fetch failed");
    return new Response(JSON.stringify({data:pages[0]}));
  }));
  const failures: SourceObservation[] = [];
  expect((await fetchCmc(failures)).byId.size).toBe(5000);
  expect(failures.at(-1)).toMatchObject({status:"error"});
});

it.each([0, 200])("does not let an unverified zero CMC cap hide a Gecko cap (%s), while retaining actual zeros", async geckoCap => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    const body = url.endsWith("/protocols") ? [{slug:"token",name:"Token",symbol:"T",gecko_id:"token"}]
      : url.endsWith("/config") ? {parentProtocols:[]}
      : url.includes("/coins/markets") ? [{id:"token",symbol:"t",market_cap:geckoCap,circulating_supply:100,current_price:2,fully_diluted_valuation:400}]
      : url.includes("coinmarketcap") ? {data:[{id:1,slug:"token",symbol:"T",circulating_supply:0,quote:[{symbol:"USD",market_cap:0,price:0,fully_diluted_market_cap:0}]}]}
      : url.includes("stablecoins") ? {peggedAssets:[{gecko_id:"usdd",symbol:"USDD"}]}
      : {protocols:[{slug:"token",name:"Token",total30d:0}],totalDataChartBreakdown:[]};
    return new Response(JSON.stringify(body));
  }));
  const [coin] = await fetchCoins([]);
  expect(coin).toMatchObject({mcap:geckoCap,price:2,fdv:400,revenue30d:0});
  expect(coin.marketSources?.mcap).toBe(geckoCap ? "CoinGecko" : "CoinMarketCap");
  if (geckoCap) expect(coin.circulatingSupply).toBe(100);
  expect(collectionErrors([coin])).toEqual([]);
});

it("backs off on rate limits and bounds retries inside the collection time budget", async () => {
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
  expect(Date.now()-start).toBeLessThanOrEqual(GECKO_BUDGET_MS);
  expect(observations[0].httpStatus).toBe(429);
});

it("queries every explicit ID beyond 1000 and preserves low-ranked and zero-valued quotes", async () => {
  vi.useFakeTimers();
  const ids = Array.from({ length: 1251 }, (_, i) => `token-${String(i).padStart(4,"0")}`);
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input), batch = url.searchParams.get("ids")!.split(",");
    expect(url.searchParams.get("per_page")).toBe("250");
    expect(batch.length).toBeLessThanOrEqual(150);
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
  expect(coin.cmcId).toBe(99999); // Canonical metadata survives a rejected/failed quote.
  expect(coin.marketSources?.cmc?.status).toBe(conflict ? "identity_mismatch" : "received");
  expect(coin.marketSources?.price).toBe("CoinGecko");
  expect(collectionErrors([coin])).toEqual([]);
});
