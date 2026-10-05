import { afterEach, expect, it, vi } from "vitest";
import { collectCoinInputs, getJson, normalizeCoinInputs, type CoinInputs } from "./sources";
import { captureSourceBundle, objectHash, replaySourceBundle } from "./sourceBundle";
import { protocolMultiple } from "./valuationMetrics";
import type { SourceObservation } from "./types";
import { annotateDataQuality, scopedSourceErrors } from "./dataQuality";
import { collectionCoverage } from "./collectionQuality";

afterEach(()=>vi.unstubAllGlobals());

it("replays captured source bytes without network and recovers WBTC zero without approving its ratios",async()=>{
  const asOf="2026-10-04T14:10:00.000Z",end=Date.parse("2026-10-03")/1000;
  const wbtc={slug:"wbtc",name:"WBTC",defillamaId:"2",methodology:{Revenue:"All fees are revenue."},total24h:0,total7d:0.31,total30d:0.31,total1y:1};
  const rush={slug:"sat-rush",name:"Sat Rush",defillamaId:"3",methodology:{Revenue:"Protocol receipts"},total24h:5536,total7d:23884,total30d:23884,total1y:23884};
  const protocols=[wbtc,rush];
  const chart=[[end-86400,{WBTC:0.31,"Sat Rush":18348}],[end,{"Sat Rush":5536}]];
  vi.stubGlobal("fetch",vi.fn(async(input:string)=>{
    const url=String(input);
    const body=url.includes("stablecoins.llama.fi")?{peggedAssets:[{gecko_id:"usdd",symbol:"USDD"}]}
      :url.includes("coinmarketcap.com")?{data:[{id:1,name:"Unrelated",symbol:"U",slug:"unrelated",quote:[]}]}
      :url.endsWith("/protocols")?protocols.map(p=>({...p,id:p.defillamaId,gecko_id:null,cmcId:null}))
      :url.endsWith("/config")?{parentProtocols:[{id:"parent#unrelated",name:"Unrelated"}]}
      :url.includes("/summary/fees/wbtc?")?{...wbtc,totalDataChart:[[end-86400,0.31],[end,0]]}
      :url.includes("/summary/fees/sat-rush?")?{...rush,totalDataChart:[[end-86400,18348],[end,5536]]}
      :{protocols,totalDataChartBreakdown:chart};
    return new Response(JSON.stringify(body));
  }));
  const captured=await captureSourceBundle(asOf,null,()=>collectCoinInputs());
  expect(captured.error).toBeUndefined();
  expect(captured.value).toBeDefined();
  const before=JSON.stringify(captured.value),coins=normalizeCoinInputs(captured.value!);
  expect(JSON.stringify(captured.value)).toBe(before);
  expect(coins.find(c=>c.slug==="wbtc")?.revenueHistory?.periods[1]).toMatchObject({total:0,reportedDays:1,end:"2026-10-03"});
  expect(coins.find(c=>c.slug==="sat-rush")?.revenueHistory?.periods[1].total).toBe(5536);
  expect(protocolMultiple(coins.find(c=>c.slug==="wbtc")!)).toBeNull();
  const network=vi.fn(async()=>{throw new Error("Replay attempted network");});
  vi.stubGlobal("fetch",network);
  const replayed=await replaySourceBundle(captured.bundle,()=>collectCoinInputs());
  expect(objectHash(replayed)).toBe(objectHash(captured.value));
  expect(objectHash(normalizeCoinInputs(replayed))).toBe(objectHash(coins));
  expect(network).not.toHaveBeenCalled();
  const serialized=JSON.parse(JSON.stringify(captured.value));
  expect(objectHash(normalizeCoinInputs(serialized))).toBe(objectHash(coins));
});

it("retains every requested child and withdrawn quote identity under one ambiguous parent",()=>{
  const asOf="2026-10-04T14:10:00.000Z",parent="parent#group";
  const protocols=[{slug:"child-a",name:"Child A",parentProtocol:parent,gecko_id:"alpha",cmcId:101,symbol:"A"},
    {slug:"child-b",name:"Child B",parentProtocol:parent,gecko_id:"beta",cmcId:102,symbol:"B"}];
  const failed=(id:string)=>({id,status:"error" as const,observedAt:asOf,available:[]});
  const observations:SourceObservation[]=[
    {url:"https://api.coingecko.com/api/v3/coins/markets?ids=alpha,beta",status:"error",observedAt:asOf,httpStatus:503},
    {url:"https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=77,101,102",status:"error",observedAt:asOf,httpStatus:503},
  ];
  const inputs:CoinInputs={asOf,protocols,fees:[],revenue:[],holders:[],dexs:[],parents:[{id:parent,name:"Group"}],stablecoins:[],
    cmc:[],cmcLookups:[[77,failed("77")],[101,failed("101")],[102,failed("102")]],cmcDiscoveryComplete:true,
    gecko:[],geckoLookups:[["alpha",failed("alpha")],["beta",failed("beta")]],revenueHistories:{},holderHistories:{},
    recoveredRevenue:[],observations,priorCmcTargets:[[77,["child-b"]]]};
  const rows=annotateDataQuality(normalizeCoinInputs(inputs),observations);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({slug:parent,identityStatus:"ambiguous",geckoId:"alpha",cmcId:null});
  expect(rows[0].marketSources?.requests?.gecko.map(q=>q.id)).toEqual(["alpha","beta"]);
  expect(rows[0].marketSources?.requests?.cmc.map(q=>q.id)).toEqual(["77","101","102"]);
  expect(rows[0].dataQuality?.issues).toHaveLength(2);
  expect(scopedSourceErrors(observations,rows)).toEqual([]);
  expect(collectionCoverage(rows)).toMatchObject({gecko:{requested:2,failed:2},cmc:{requested:3,failed:3}});
  inputs.geckoLookups=inputs.geckoLookups.filter(([id])=>id!=="beta");
  expect(scopedSourceErrors(observations,annotateDataQuality(normalizeCoinInputs(inputs),observations))).not.toEqual([]);
});

it("records budget-aborted requests so failed acquisition also replays without live timing",async()=>{
  const url="https://api.llama.fi/protocols";
  vi.stubGlobal("fetch",vi.fn(async(_input:string,init?:RequestInit)=>{
    expect(init?.signal?.aborted).toBe(true);
    throw new Error("aborted");
  }));
  const task=async()=>{
    const observations:SourceObservation[]=[];
    try {await getJson(url,observations,{deadline:Date.now()-1});} catch {}
    return observations;
  };
  const captured=await captureSourceBundle("2026-10-04T14:10:00.000Z",null,task);
  expect(captured.bundle.receipts).toHaveLength(3);
  expect(captured.value).toMatchObject([{url,status:"error"}]);
  const network=vi.fn(async()=>{throw new Error("unexpected network");});
  vi.stubGlobal("fetch",network);
  expect(await replaySourceBundle(captured.bundle,task)).toEqual(captured.value);
  expect(network).not.toHaveBeenCalled();
});
