import { describe, expect, it } from "vitest";
import { calculateDailyValuations, extractFundamentals, mergeMarket, parseMarketChart, shiftDay, snapshotMarket, type FundamentalDay, type MarketDay } from "./dailyHistory";
import type { SourceBundle, SourceReceipt } from "./sourceBundle";
import type { CoinRaw } from "./types";

const market=(day="2026-01-31"):MarketDay=>({day,price:1,mcap:3650,fdv:7300,marketAt:`${day}T00:00:00.000Z`,fdvAt:`${day}T00:00:00.000Z`,marketSource:"market",fdvSource:"fdv",basis:"utc_midnight"});
const flows=(days=30):FundamentalDay[]=>Array.from({length:days},(_,i)=>({day:shiftDay("2026-01-31",-i-1),revenue:{value:10,state:"complete",source:"r",scope:"r1"},holders:{value:5,state:"complete",source:"h",scope:"h1"}}));
function receipt(url:string,body:unknown):SourceReceipt {return {url,body:JSON.stringify(body),sha256:"a".repeat(64),observedAt:"2026-02-01T00:00:00Z",requestedAt:"2026-02-01T00:00:00Z",status:200,headers:{}};}
describe("dated source-reference valuations",()=>{
  it("uses each day's own capital and only completed preceding revenue days",()=>{
    const input=flows();input.push({day:"2026-01-31",revenue:{value:1e9,state:"complete",source:"r",scope:"r1"},holders:{value:1e9,state:"complete",source:"h",scope:"h1"}});
    const v=calculateDailyValuations(input,[market()],true).find(p=>p.days===30)!;
    expect(v).toMatchObject({revenue:300,holders:150,prMcap:1,prFdv:2,phrMcap:2,phrFdv:4});
    expect(calculateDailyValuations(input,[{...market(),mcap:7300}],true).find(p=>p.days===30)!.prMcap).toBe(2);
  });
  it("does not zero-fill gaps, promote a partial group, or replace unavailable FDV",()=>{
    const input=flows();input[0].revenue.state="partial";
    const v=calculateDailyValuations(input,[{...market(),fdv:null}],true).find(p=>p.days===30)!;
    expect(v).toMatchObject({revenue:null,revenueDays:29,prMcap:null,prFdv:null,phrMcap:2,phrFdv:null,revenueReason:"incomplete_window"});
  });
  it("distinguishes zero, negative, conflicting and differently scoped source windows",()=>{
    for(const amount of [0,-10]){
      const input=flows();for(const p of input)p.revenue.value=amount;
      expect(calculateDailyValuations(input,[market()],true).find(p=>p.days===30)).toMatchObject({revenue:amount*30,prMcap:null,revenueReason:"nonpositive_denominator"});
    }
    const input=flows();input[3].revenue.scope="r2";
    expect(calculateDailyValuations(input,[market()],true).find(p=>p.days===30)?.revenueReason).toBe("scope_changed");
    input[3].revenue.state="conflict";
    expect(calculateDailyValuations(input,[market()],true).find(p=>p.days===30)?.revenueReason).toBe("source_conflict");
  });
  it("does not gate source arithmetic on economic review; token identity still gates it",()=>{
    expect(calculateDailyValuations(flows(),[market()],false).find(p=>p.days===30)).toMatchObject({revenue:300,prMcap:null,revenueReason:"unverified_token"});
  });
  it("retains pre-730-day source data and refuses partial multi-component totals",()=>{
    const t=Date.parse("2018-04-01")/1000;
    const protocols=[{slug:"a",name:"A",defillamaId:"1",parentProtocol:"parent#p"},{slug:"b",name:"B",defillamaId:"2",parentProtocol:"parent#p"}];
    const r=receipt("https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChartBreakdown=false",{protocols,totalDataChartBreakdown:[[t,{A:2}],[t+86400,{A:0,B:0}]]});
    const bundle={asOf:"2026-02-01T00:00:00Z",receipts:[r]} as SourceBundle;
    const p=extractFundamentals(bundle,"archive").series.get("parent#p")!;
    expect(p[0]).toMatchObject({day:"2018-04-01",revenue:{value:2,state:"partial"}});
    expect(p[1].revenue).toMatchObject({value:0,state:"complete"});
    expect(p[0].holders.state).toBe("missing");
  });
  it("accepts an exact parent history and rejects a differently composed parent",()=>{
    const t=Date.parse("2018-04-01")/1000,protocols=[{slug:"a",name:"A",defillamaId:"1",parentProtocol:"parent#p"}];
    const overview=receipt("https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChartBreakdown=false",{protocols,totalDataChartBreakdown:[]});
    const summary=(id:string)=>receipt("https://api.llama.fi/summary/fees/p?dataType=dailyRevenue",{defillamaId:"parent#p",childProtocols:[{name:"A",defillamaId:id}],totalDataChart:[[t,10]]});
    expect(extractFundamentals({asOf:"2026-02-01",receipts:[overview,summary("1")]} as SourceBundle,"a").series.get("parent#p")![0].revenue.value).toBe(10);
    expect(extractFundamentals({asOf:"2026-02-01",receipts:[overview,summary("2")]} as SourceBundle,"a").series.get("parent#p")).toEqual([]);
  });
  it("drops intraday chart tails and treats cap zero as unavailable",()=>{
    const t=Date.parse("2026-01-31");
    expect(parseMarketChart({prices:[[t,1],[t+1234,2]],market_caps:[[t,0],[t+1234,100]]},"r",t+5000)).toEqual([{...market(),mcap:null,price:1,fdv:null,fdvAt:null,fdvSource:null,marketSource:"r"}]);
  });
  it("keeps independently captured FDV without overwriting the midnight price",()=>{
    const old={...market(),basis:"captured_quote" as const,marketAt:"2026-01-31T12:00:00Z",fdvAt:"2026-01-31T12:00:00Z"};
    const midnight={...market(),price:2,fdv:null,fdvSource:null,fdvAt:null};
    expect(mergeMarket(old,midnight)).toMatchObject({price:2,fdv:7300,fdvAt:old.fdvAt,basis:"utc_midnight"});
  });
  it("rejects stale and mismatched archived token identities",()=>{
    const coin={identityStatus:"verified",geckoId:"one",marketDataUpdatedAt:"2026-01-31T12:00:00Z",marketSources:{price:"CoinGecko",mcap:"CoinGecko",fdv:"CoinGecko"},price:1,mcap:100,fdv:200} as CoinRaw;
    expect(snapshotMarket(coin,{...coin,geckoId:"two"},"s","2026-01-31T13:00:00Z")).toBeNull();
    expect(snapshotMarket(coin,coin,"s","2026-02-02T00:00:00Z")).toBeNull();
  });
  it("does not assign the preferred provider's timestamp to fallback FDV",()=>{
    const coin={identityStatus:"verified",geckoId:"one",cmcId:1,cmcIdentity:{basis:"source-id"},marketDataUpdatedAt:"2026-01-31T12:00:00Z",marketSources:{price:"CoinGecko",mcap:"CoinGecko",fdv:"CoinMarketCap"},price:1,mcap:100,fdv:200} as CoinRaw;
    expect(snapshotMarket(coin,coin,"s","2026-01-31T13:00:00Z")).toMatchObject({mcap:100,fdv:null,fdvAt:null});
  });
  it("validates quotes against their response receipt, not collection start",()=>{
    const coin={identityStatus:"verified",geckoId:"one",marketDataUpdatedAt:"2026-01-31T12:02:00Z",marketSources:{price:"CoinGecko",mcap:"CoinGecko",fdv:"CoinGecko",gecko:{observedAt:"2026-01-31T12:03:00Z"}},price:1,mcap:100,fdv:200} as CoinRaw;
    expect(snapshotMarket(coin,coin,"s","2026-01-31T12:00:00Z")).toMatchObject({mcap:100,fdv:200,marketAt:"2026-01-31T12:02:00Z"});
  });
});
