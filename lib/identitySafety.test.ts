import { expect, it } from "vitest";
import { normalizeCoinInputs, type CoinInputs } from "./sources";
import { referenceMultiple } from "./referenceMetrics";

const at = "2026-10-12T00:15:00.000Z";
const address = "0x1111111111111111111111111111111111111111";
const asset = (id: number, name: string, symbol: string, slug: string) => ({ id, name, symbol, slug,
  platform: { token_address: address }, circulating_supply: 100000,
  quote: [{ symbol: "USD", price: 1, market_cap: 100000, fully_diluted_market_cap: 200000, last_updated: at }] });
function inputs(name = "Base", slug = "base"): CoinInputs {
  const chain = { slug, name, id: `chain#${slug}`, category: "Chain", total30d: 1000 };
  return { marketRevision: 3, sourceIdentitiesOnly: true, asOf: at, protocols: [], fees: [chain], revenue: [chain], holders: [], dexs: [], parents: [], stablecoins: [],
    cmc: [asset(27789, "BASE", "BASE", "swapbased-base")], cmcLookups: [[27789, {id:"27789",status:"received",observedAt:at,available:["mcap","price","fdv"]}]],
    cmcDiscoveryComplete: true, gecko: [], geckoLookups: [], revenueHistories: {}, holderHistories: {}, recoveredRevenue: [], observations: [], priorCmcTargets: [] } as CoinInputs;
}
it.each([["Base", "base", 27789, "swapbased-base"], ["Eden", "eden", 7750, "eden-network"]] as const)("does not price the %s chain with a same-named application token", (name,slug,id,cmcSlug) => {
  const i=inputs(name,slug); i.cmc=[asset(id,name,name.toUpperCase(),cmcSlug)];
  i.cmcLookups=[[id,{id:String(id),status:"received",observedAt:at,available:["mcap","price","fdv"]}]];
  const c=normalizeCoinInputs(i)[0];
  expect(c).toMatchObject({name,cmcId:null,identityStatus:"review",mcap:null,fdv:null,revenue30d:1000});
  expect(referenceMultiple(c,"revenue",30,"fdv")).toBeNull();
});
it("requires source identifiers for non-chain name matches too", () => {
  const i=inputs("Example","example"); i.fees[0].category=i.revenue[0].category="Dexs";
  i.cmc=[asset(27789,"Example","EX","example")];
  expect(normalizeCoinInputs(i)[0]).toMatchObject({cmcId:null,identityStatus:"review",revenue30d:1000});
});
it("keeps the original name match for historical acquisition inputs", () => {
  const i=inputs(); delete i.sourceIdentitiesOnly;
  expect(normalizeCoinInputs(i)[0]).toMatchObject({cmcId:27789,identityStatus:"verified",fdv:200000});
});
it.each(["id", "contract"])("retains a CMC connection proved by a source %s", basis => {
  const i=inputs();
  if(basis==="id")i.fees[0].cmcId=i.revenue[0].cmcId=27789;
  else i.fees[0].address=i.revenue[0].address=address;
  const c=normalizeCoinInputs(i)[0];
  expect(c).toMatchObject({cmcId:27789,identityStatus:"verified",fdv:200000});
  expect(referenceMultiple(c,"revenue",30,"fdv")).toBeCloseTo(200000*30/(1000*365));
});
function parentInputs(): CoinInputs {
  const i=inputs("Issuer","issuer");
  i.fees=i.revenue=[{slug:"product",name:"Product",parentProtocol:"parent#issuer",total30d:1000,gecko_id:"issuer",symbol:"OWN"}];
  i.parents=[{id:"parent#issuer",name:"Issuer",gecko_id:"issuer",symbol:"OWN"}];
  i.cmc=[];i.cmcLookups=[[99,{id:"99",status:"error",observedAt:at,available:[]}]];
  i.gecko=[{id:"issuer",name:"Issuer",symbol:"own",current_price:1,market_cap:100000,fully_diluted_valuation:200000,circulating_supply:100000,last_updated:at}];
  i.geckoLookups=[["issuer",{id:"issuer",status:"received",observedAt:at,available:["mcap","price","fdv"]}]];
  i.priorCmcTargets=[[99,["parent#issuer","product"]]];
  i.priorCmcIdentities=[{slug:"parent#issuer",name:"Issuer",sourceSlugs:["parent#issuer","product"],symbol:"OWN",geckoId:"issuer",cmcId:99,cmcSlug:"issuer-token",baselineAt:at}];
  return i;
}
it("preserves a declared parent's verified CMC ID and URL on request failure", () => {
  const c=normalizeCoinInputs(parentInputs())[0];
  expect(c).toMatchObject({slug:"parent#issuer",cmcId:99,cmcSlug:"issuer-token",identityStatus:"verified",identityContinuity:{id:99},marketSources:{cmc:{id:"99",status:"error"}}});
  expect(c.marketSources?.mcap).toBe("CoinGecko");
});
it("does not let another product token erase its parent's retained identity", () => {
  const i=parentInputs();
  i.protocols.push({slug:"other",name:"Other",parentProtocol:"parent#issuer",gecko_id:"other",symbol:"OTHER",cmcId:100});
  i.priorCmcIdentities![0].sourceSlugs.push("other");
  const c=normalizeCoinInputs(i)[0];
  expect(c).toMatchObject({cmcId:99,geckoId:"issuer",identityStatus:"verified",identityContinuity:{id:99}});
});
it("does not borrow old prices when both current quote providers fail", () => {
  const i=parentInputs();i.gecko=[];i.geckoLookups[0][1]={...i.geckoLookups[0][1],status:"error",available:[]};
  const c=normalizeCoinInputs(i)[0];
  expect(c).toMatchObject({cmcId:99,identityStatus:"verified",price:null,mcap:null,fdv:null});
});
it("retains a legacy declared parent's contract-backed ID without copying unavailable prices", () => {
  const i=parentInputs();delete i.parents[0].gecko_id;i.parents[0].address=address;
  i.priorCmcIdentities![0].geckoId=null;i.gecko=[];
  const c=normalizeCoinInputs(i)[0];
  expect(c).toMatchObject({cmcId:99,identityStatus:"verified",price:null,mcap:null,fdv:null,cmcIdentity:{basis:"retained",address}});
});
it("retains the parent's ID declared by a same-contract child despite other CoinGecko metadata", () => {
  const i=parentInputs();i.parents[0].address=address;i.priorCmcIdentities![0].geckoId=null;
  i.gecko[0].symbol="OTHER";
  i.protocols=[{slug:"child",name:"Child",parentProtocol:"parent#issuer",address,cmcId:99,gecko_id:"old-token",symbol:"OWN"}];
  i.priorCmcIdentities![0].sourceSlugs.push("child");
  const c=normalizeCoinInputs(i)[0];
  expect(c).toMatchObject({cmcId:99,geckoId:null,identityContinuity:{id:99},price:null,mcap:null,fdv:null});
});
it("retains a legacy standalone contract link on failure and records its address for future checks", () => {
  const i=inputs("Issuer","issuer");i.fees[0].address=i.revenue[0].address=address;
  i.fees[0].symbol=i.revenue[0].symbol="OWN";i.cmc=[];
  i.cmcLookups=[[99,{id:"99",status:"error",observedAt:at,available:[]}]];
  i.priorCmcIdentities=[{slug:"issuer",name:"Issuer",symbol:"OWN",sourceSlugs:["issuer"],geckoId:null,cmcId:99,cmcSlug:"issuer-token",baselineAt:at}];
  expect(normalizeCoinInputs(i)[0]).toMatchObject({cmcId:99,identityContinuity:{id:99},price:null,mcap:null,fdv:null,cmcIdentity:{basis:"retained",address}});
  i.priorCmcIdentities[0].address="0x2222222222222222222222222222222222222222";
  expect(normalizeCoinInputs(i)[0].identityContinuity).toBeUndefined();
});
it("does not preserve a CMC ID across a changed known parent contract", () => {
  const i=parentInputs();i.parents[0].address=address;
  i.priorCmcIdentities![0].address="0x2222222222222222222222222222222222222222";
  expect(normalizeCoinInputs(i)[0].identityContinuity).toBeUndefined();
});
it.each(["name","symbol","gecko","membership","returned-symbol"])("rejects continuity after a %s conflict", conflict => {
  const i=parentInputs();
  if(conflict==="name")i.parents[0].name="New owner";
  if(conflict==="symbol")i.parents[0].symbol="OTHER";
  if(conflict==="gecko"){i.parents[0].gecko_id="other";i.geckoLookups.push(["other",{id:"other",status:"error",observedAt:at,available:[]}]);}
  if(conflict==="membership")i.priorCmcIdentities![0].sourceSlugs.push("removed");
  if(conflict==="returned-symbol")i.gecko[0].symbol="OTHER";
  expect(normalizeCoinInputs(i)[0].identityContinuity).toBeUndefined();
});
it("does not resurrect a previously guessed Base asset when CMC fails", () => {
  const i=inputs();i.cmc=[];i.cmcLookups[0][1]={id:"27789",status:"error",observedAt:at,available:[]};
  i.priorCmcIdentities=[{slug:"base",name:"Base",sourceSlugs:["base"],symbol:"BASE",geckoId:null,cmcId:27789,cmcSlug:"swapbased-base",baselineAt:at}];
  const c=normalizeCoinInputs(i)[0];
  expect(c).toMatchObject({cmcId:null,identityStatus:"review",mcap:null,fdv:null});
  expect(c.identityContinuity).toBeUndefined();
});
