import {afterEach,expect,it,vi} from "vitest";
vi.mock("./pipelineRelease",async original=>({...await original<typeof import("./pipelineRelease")>(),activeEconomicPolicy:()=>ECONOMIC_POLICY,activeWriterSchema:()=>2}));
import {ECONOMIC_POLICY,economicArtifact} from "./economicPolicy";
import inputs from "./fixtures/economic-current-inputs.json";
import {captureDataPipeline,replayDataPipeline,assessPipelineCandidate} from "./dataPipeline";
import {PROVENANCE_COMMIT_URL} from "./economicDecisionSource";
import {protocolMultiple,holderMultiple} from "./valuationMetrics";
import {businessFees,metricDecisionHeld} from "./fundamentals";
import {economicAccountingErrors} from "./economicContract";
import {queryScreener} from "./screenerQuery";
import {defaultPreferences} from "./workspacePreferences";
import {publicationVerdicts} from "./publicationVerdicts";
const at="2026-10-08T02:00:00.000Z",end=Date.parse("2026-10-07")/1000,tree="2".repeat(40);
// Amounts/kinds are independent reviewed algebraic examples; no adapter is executed by this test.
const expected=[{slug:"fake-world-assets-v1",revenue:730,fees:1250,holders:300,kind:"protocol_revenue",feeKind:"user_fees"},
  {slug:"lido",revenue:65,fees:1000,holders:0,kind:"protocol_revenue",feeKind:"asset_yield"},
  {slug:"ssv-network",revenue:100,fees:150,holders:100,kind:"protocol_revenue",feeKind:"user_fees"},
  {slug:"lighter-perps",revenue:35,fees:39,holders:50,kind:"protocol_revenue",feeKind:"user_fees"},
  {slug:"euler-v2",revenue:5,fees:100,holders:0,kind:"protocol_revenue",feeKind:"user_fees"},
  {slug:"geodnet",revenue:100,fees:100,holders:80,kind:"unknown",feeKind:"unknown"}];
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
function upstream(provenanceFails=false) {
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(at));vi.stubEnv("GITHUB_TOKEN","test-only-source-token");
  const rows=inputs.rows.map((r,i)=>({...r,gecko_id:`source-${i}`,symbol:`SRC${i}`}));
  return vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const u=new URL(String(input));
    if(u.hostname==="api.github.com") {
      expect(init?.headers).toMatchObject({authorization:"Bearer test-only-source-token"});expect(init?.redirect).toBe("error");
      return String(input)===PROVENANCE_COMMIT_URL?Response.json({sha:"1".repeat(40),commit:{tree:{sha:tree},committer:{date:at}}},{status:provenanceFails?503:200}):Response.json({sha:tree,url:`https://api.github.com/repos/DefiLlama/dimension-adapters/git/trees/${tree}`,truncated:false,tree:[...new Map(economicArtifact.contracts.flatMap(c=>c.sourceClosure).map(f=>[f.path,f])).values()].map(f=>({path:f.path,sha:f.blobSha1,type:"blob"}))});
    }
    const metric=u.searchParams.get("dataType")==="dailyRevenue"?"revenue":u.searchParams.get("dataType")==="dailyHoldersRevenue"?"holders":"fees";
    const valued=rows.map(r=>{const amount=expected.find(e=>e.slug===r.slug)![metric];return {...r,total24h:amount,total7d:amount*7,total30d:amount*30,total60dto30d:amount*30,total1y:amount*365};});
    const chart=Array.from({length:730},(_,i)=>[end-i*86400,Object.fromEntries(valued.map(r=>[r.name,r.total24h]))]);
    if(u.hostname==="stablecoins.llama.fi")return Response.json({peggedAssets:[{gecko_id:"tether",symbol:"USDT"}]});
    if(u.hostname.includes("coinmarketcap"))return Response.json({data:[{id:9999,slug:"unrelated",name:"Unrelated",symbol:"UNR"}]});
    if(u.hostname.includes("coingecko"))return Response.json(rows.map((r,i)=>({id:`source-${i}`,symbol:r.symbol.toLowerCase(),name:r.name,current_price:1,market_cap:36500,fully_diluted_valuation:73000,last_updated:at})));
    if(u.pathname==="/protocols")return Response.json(rows);
    if(u.pathname==="/config")return Response.json({parentProtocols:rows.filter(r=>r.parentProtocol).map(r=>({id:r.parentProtocol,name:r.parentProtocol!.replace("parent#",""),gecko_id:r.gecko_id,symbol:r.symbol}))});
    if(u.pathname.startsWith("/summary/fees/")) {const r=valued.find(r=>u.pathname.endsWith(r.slug));return Response.json(r?{...r,totalDataChart:chart.map(p=>[p[0],r.total24h])}:{});}
    return Response.json({protocols:valued,totalDataChartBreakdown:chart});
  });
}
it("binds all ten reviewed metric decisions to a captured immutable policy and offline replay, while every newly unresolved holder remains held",async()=>{
  const fetcher=upstream();vi.stubGlobal("fetch",fetcher);const result=await captureDataPipeline(null,at,async()=>{});
  expect(result.bundle.economicPolicy).toEqual(ECONOMIC_POLICY);expect(result.bundle.receipts.filter(r=>r.url.startsWith("https://api.github.com/"))).toHaveLength(2);
  expect(JSON.stringify(result.bundle)).not.toContain("test-only-source-token");expect(economicAccountingErrors(result.data)).toEqual([]);
  for(const e of expected) {
    const input=inputs.rows.find(r=>r.slug===e.slug)!,c=result.data.coins.find(c=>c.slug===(input.parentProtocol??e.slug))!;
    expect(c.fundamentals.revenue.kind).toBe(e.kind);expect(c.fundamentals.fees.kind).toBe(e.feeKind);
    expect(metricDecisionHeld(c,"HoldersRevenue")).toBe(true);expect(c.fundamentals.holderShareReviewed).toBe(false);
    for(const days of [1,7,30,90,365] as const)for(const basis of ["mcap","fdv"] as const) {
      expect(holderMultiple(c,days,basis)).toBeNull();
      if(e.slug!=="geodnet")expect(protocolMultiple(c,days,basis)).toBeCloseTo(c[basis]!/(e.revenue*365));else expect(protocolMultiple(c,days,basis)).toBeNull();
    }
    if(e.slug==="lido")expect(businessFees(c)).toBe(false);
  }
  vi.stubGlobal("fetch",()=>{throw new Error("Offline replay must not acquire later evidence");});
  const replayed=await replayDataPipeline(result.bundle);expect(replayed).toEqual(result.data);
  expect(assessPipelineCandidate(result.data,result.bundle,null,at,at,replayed).errors).toEqual([]);
  const prefs=defaultPreferences();prefs.search="lido";const filtered=queryScreener(result.data,prefs);
  expect(filtered.coins.length).toBeLessThan(result.data.coins.length);expect(filtered.economicReview).toEqual(result.data.economicReview);
  expect(filtered.coverage.total).toBe(result.data.coins.length);
  expect(publicationVerdicts(result.data,Date.parse(at),[])).toMatchObject({economicAccountingPassed:true,economicReviewComplete:false});
});
it("failed provenance remains independently explained and replayable, with no weaker fallback or fabricated economic approval",async()=>{
  vi.stubGlobal("fetch",upstream(true));const result=await captureDataPipeline(null,at,async()=>{});
  expect(result.data.coins.flatMap(c=>c.fundamentals.revenue.components).every(p=>p.decision?.disposition==="evidence-unavailable")).toBe(true);
  expect(result.data.economicReview!.summary.evidenceUnavailable).toBeGreaterThan(0);
  expect(economicAccountingErrors(result.data)).toEqual([]);vi.stubGlobal("fetch",()=>{throw Error("network");});expect(await replayDataPipeline(result.bundle)).toEqual(result.data);
});
