import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregateOverviewByGroup, fetchCoins, fetchGecko, findCmc } from "./sources";
import { sample } from "./testFixtures";
import { assembleScreener } from "./screener";
import { annotateDataQuality, scopedSourceErrors } from "./dataQuality";
import type { SourceObservation } from "./types";

describe("quote changes", () => {
  afterEach(() => vi.unstubAllGlobals());
  const mockSources = (quote: boolean) => vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    const body = url.includes("/coins/markets")
      ? quote ? [{ id: "token", current_price: 1, market_cap: 10000000, price_change_percentage_24h: 3, price_change_percentage_7d_in_currency: 5 }] : []
      : url.includes("stablecoins.llama.fi") ? { peggedAssets: [{gecko_id:"usdd",symbol:"USDD"}] }
      : url.includes("coinmarketcap.com") ? { data: [] }
      : url.endsWith("/config") ? { parentProtocols: [{id:"parent#unrelated",name:"Unrelated"}] }
      : url.endsWith("/protocols") ? [{ slug: "token", name: "Token", symbol: "T", gecko_id: "token", mcap: 10000000, change_1d: 99, change_7d: 88 }]
      : { protocols: [{ slug: "token", total30d: 100, total60dto30d: 90 }] };
    return new Response(JSON.stringify(body));
  }));
  it("groups children using the protocol directory even when the overview omits parent links", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      const body = url.includes("stablecoins.llama.fi") ? {peggedAssets:[{gecko_id:"usdd",symbol:"USDD"}]} : url.includes("coinmarketcap.com") ? {data:[]} : url.includes("/coins/markets") ? []
        : url.endsWith("/config") ? {parentProtocols:[{id:"parent#token",name:"Token"}]}
        : url.endsWith("/protocols") ? [{slug:"child-a",name:"A",symbol:"T",gecko_id:"token",mcap:10000000,parentProtocol:"parent#token"},{slug:"child-b",name:"B",symbol:"T",gecko_id:"token",mcap:10000000,parentProtocol:"parent#token"}]
        : {protocols:[{slug:"child-a",total30d:100},{slug:"child-b",total30d:200}]};
      return new Response(JSON.stringify(body));
    }));
    const coins = await fetchCoins([]);
    expect(coins).toHaveLength(1);
    expect(coins[0].slug).toBe("parent#token");
    expect(coins[0].mcap).toBe(10000000);
    expect(coins[0].revenue30d).toBe(300);
  });
  it("refuses to disable stablecoin valuation exclusions when their identity registry is empty", async () => {
    mockSources(true);
    const fetchSource = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => String(input).includes("stablecoins.llama.fi") ? new Response(JSON.stringify({peggedAssets:[]})) : fetchSource(input)));
    await expect(fetchCoins([])).rejects.toThrow("Stablecoin identity registry unavailable");
  });
  it("never fills missing price changes with DefiLlama TVL changes", async () => {
    mockSources(false);
    const [coin] = await fetchCoins([]);
    expect([coin.change1d, coin.change7d, coin.priceChange7d]).toEqual([null, null, null]);
  });
  it("uses actual CoinGecko price changes when CMC is unavailable", async () => {
    mockSources(true);
    const [coin] = await fetchCoins([]);
    expect([coin.change1d, coin.change7d, coin.priceChange7d]).toEqual([3, 5, 5]);
  });
  it("discards failed direct CMC quote values but retains identity and successful provider fallback",async()=>{
    const row={slug:"token",name:"Token",symbol:"T",defillamaId:"123",gecko_id:"token",cmcId:123,total30d:100};
    vi.stubGlobal("fetch",vi.fn(async(input:string)=>{
      const url=String(input);
      if(url.includes("/quotes/latest"))return new Response("",{status:403});
      const body=url.includes("/coins/markets")?[{id:"token",symbol:"t",current_price:4,market_cap:200,fully_diluted_valuation:500,circulating_supply:50,total_supply:125}]
        :url.includes("coinmarketcap.com")?{data:[{id:123,name:"Token",symbol:"T",slug:"token",circulating_supply:33,total_supply:100,quote:[{symbol:"USD",price:3,market_cap:100,fully_diluted_market_cap:null}]}]}
        :url.includes("stablecoins.llama.fi")?{peggedAssets:[{gecko_id:"usdd",symbol:"USDD"}]}
        :url.endsWith("/config")?{parentProtocols:[{id:"parent#unrelated",name:"Unrelated"}]}
        :url.endsWith("/protocols")?[row]
        :{protocols:[row]};
      return new Response(JSON.stringify(body));
    }));
    const baseline=assembleScreener([sample({slug:"token",sourceSlugs:["token"],cmcId:123,geckoId:"token",fdv:300})],"2026-10-03T14:00:00Z",[]);
    const [coin]=await fetchCoins([],baseline);
    expect(coin).toMatchObject({cmcId:123,identityStatus:"verified",price:4,mcap:200,fdv:500,totalSupply:125});
    expect(coin.marketSources).toMatchObject({price:"CoinGecko",mcap:"CoinGecko",fdv:"CoinGecko",cmc:{status:"error",available:[]}});
  });
  it("does not request an old optional quote after its whole project leaves the current source universe",async()=>{
    mockSources(true);
    const baseline=assembleScreener([sample({slug:"removed",sourceSlugs:["removed"],cmcId:999,geckoId:"removed"})],"2026-10-03T14:00:00Z",[]);
    await fetchCoins([],baseline);
    expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes("/quotes/latest") && String(url).includes("999"))).toBe(false);
  });
  it("marks malformed linked CMC fields while retaining valid amounts and ignoring unused discovery rows",async()=>{
    const row={slug:"token",name:"Token",symbol:"T",defillamaId:"123",gecko_id:"token",cmcId:123,total30d:100};
    vi.stubGlobal("fetch",vi.fn(async(input:string)=>{
      const url=String(input);
      const body=url.includes("/coins/markets")?[{id:"token",symbol:"t",current_price:4,market_cap:200,fully_diluted_valuation:500}]
        :url.includes("coinmarketcap.com")?{data:[{id:123,name:"Token",symbol:"T",slug:"token",quote:[{symbol:"USD",price:"3",market_cap:100,fully_diluted_market_cap:300}]},{id:999,name:"Other",symbol:"O",slug:"other",quote:[{symbol:"USD",price:"malformed-unused"}]}]}
        :url.includes("stablecoins.llama.fi")?{peggedAssets:[{gecko_id:"usdd",symbol:"USDD"}]}
        :url.endsWith("/config")?{parentProtocols:[{id:"parent#unrelated",name:"Unrelated"}]}
        :url.endsWith("/protocols")?[row]
        :{protocols:[row]};
      return new Response(JSON.stringify(body));
    }));
    const observations:SourceObservation[]=[];
    const raw=await fetchCoins(observations),schema=observations.filter(s=>s.reason === "schema_mismatch");
    expect(schema).toHaveLength(1);
    expect(schema[0].quoteIds).toEqual(["123"]);
    const rows=annotateDataQuality(raw,schema);
    expect(rows[0]).toMatchObject({price:4,mcap:100,fdv:300,marketSources:{price:"CoinGecko",mcap:"CoinMarketCap",cmc:{status:"received",invalidFields:["quote.price"]}}});
    expect(rows[0].dataQuality?.issues).toMatchObject([{code:"schema_mismatch",scope:"market"}]);
    expect(scopedSourceErrors(schema,rows)).toEqual([]);
  });
  it("distinguishes malformed Gecko price from a genuinely absent price within the same successful batch",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify([{id:"bad",current_price:"9",market_cap:5},{id:"missing",current_price:null,market_cap:7}]))));
    const observations:SourceObservation[]=[];
    const result=await fetchGecko(["bad","missing"],observations);
    expect(result.byId.get("bad")?.current_price).toBeNull();
    expect(result.lookups.get("bad")).toMatchObject({status:"received",available:["mcap"],invalidFields:["current_price"]});
    expect(result.lookups.get("missing")?.invalidFields).toBeUndefined();
    expect(observations.filter(s=>s.status === "withheld")).toMatchObject([{reason:"schema_mismatch",quoteIds:["bad"]}]);
  });
});

describe("aggregateOverviewByGroup", () => {
  it("preserves zeros but marks incomplete parent periods as unknown", () => {
    const result = aggregateOverviewByGroup([{slug:"a",total30d:100,total60dto30d:0},{slug:"b",total30d:100}],()=>"parent").get("parent")!;
    expect(result.d30).toBe(200);
    expect(result.prev30).toBeNull();
    const zero = aggregateOverviewByGroup([{slug:"a",total30d:0,total60dto30d:0}],s=>s).get("a")!;
    expect(zero.d30).toBe(0); expect(zero.prev30).toBe(0);
  });
  it("uses a single common annual window instead of mixing TTM and run-rate components", () => {
    const result = aggregateOverviewByGroup([{slug:"a",total1y:5000,total30d:100},{slug:"b",total30d:100}],()=>"parent").get("parent")!;
    expect(result.y1).toBeNull();
    expect(result.annual).toBeCloseTo(200*365/30);
  });
  it("excludes DefiLlama overview rows marked doublecounted from parent sums", () => {
    const rows = [
      {
        slug: "parent-primary",
        total1y: 1_200,
        total7d: 70,
        total14dto7d: 60,
        total30d: 300,
        total60dto30d: 250,
      },
      {
        slug: "parent-duplicate",
        total1y: 9_999,
        total7d: 999,
        total14dto7d: 999,
        total30d: 999,
        total60dto30d: 999,
        doublecounted: true,
      },
    ];

    const aggregate = aggregateOverviewByGroup(rows, () => "parent#protocol").get(
      "parent#protocol",
    );

    expect(aggregate).toEqual({
      annual: 300 * 365 / 30,
      y1: 1_200,
      d1: null,
      prev1: null,
      d7: 70,
      prev7: 60,
      d30: 300,
      prev30: 250,
      hit: true,
    });
  });
});

it("does not infer name/symbol uniqueness from an incomplete discovery list",()=>{
  const row={id:123,name:"Token",symbol:"T",slug:"token-asset"};
  const index={byId:new Map([[123,row]]),bySlug:new Map([[row.slug,row]]),byNameSymbol:new Map([["token#t",[row]]]),bySymbol:new Map([["t",[row]]]),discoveryComplete:false};
  const identity={name:"Token",symbol:"T",groupKey:"unlinked-project",geckoId:null,cmc:index};
  expect(findCmc(identity)).toBeUndefined();
  expect(findCmc({...identity,cmcIds:[123]})).toBe(row);
  expect(findCmc({...identity,geckoId:"token-asset"})).toBe(row);
  expect(findCmc({...identity,cmc:{...index,discoveryComplete:true}})).toBe(row);
});
