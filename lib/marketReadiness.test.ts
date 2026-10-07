import {expect,it} from "vitest";
import {marketAcquisitionReadiness,failedIdentityChanges} from "./marketReadiness";
import {sample} from "./testFixtures";
import type {CoinRaw,QuoteLookup,ScreenerResponse} from "./types";

const at="2026-10-07T20:00:00Z";
function row(id:number,failed=false):CoinRaw {
 const q:QuoteLookup={id:String(id),status:failed?"error":"received",observedAt:at,available:failed?[]:["mcap","price","fdv"]};
 return sample({slug:`asset-${id}`,sourceSlugs:[`asset-${id}`],cmcId:id,geckoId:null,identityStatus:"verified",mcap:failed?null:10,price:failed?null:1,fdv:failed?null:20,
 marketSources:{mcap:failed?null:"CoinMarketCap",price:failed?null:"CoinMarketCap",fdv:failed?null:"CoinMarketCap",cmc:q,gecko:null,requests:{cmc:[q],gecko:[]}}});
}
const input=(coins:CoinRaw[])=>({coins}) as ScreenerResponse;
it("one of three comparable assets may fail, but exactly half blocks with explicit numerator/denominator",()=>{
 expect(marketAcquisitionReadiness(input([row(1,true),row(2),row(3)]),input([row(1),row(2),row(3)])).errors).toEqual([]);
 const r=marketAcquisitionReadiness(input([row(1,true),row(2)]),input([row(1),row(2)]));
 expect(r.errors).toContain("market_acquisition_failed:cmc:price:1/2");expect(r.coverage).toContainEqual({provider:"CoinMarketCap",field:"price",basis:"prior-dependencies",eligibleAssets:2,unavailable:1});
});
it("one usable row cannot conceal a2192asset outage, and duplicate projects do not change majority",()=>{
 const old=Array.from({length:2192},(_,i)=>row(i+1)),next=old.map((_,i)=>row(i+1,i!==0));
 expect(marketAcquisitionReadiness(input(next),input(old)).errors).toContain("market_acquisition_failed:cmc:price:2191/2192");
 const a=row(1),copy={...a,slug:"another-project",sourceSlugs:["another-project"]},bad={...row(1,true),slug:copy.slug,sourceSlugs:copy.sourceSlugs};
 expect(marketAcquisitionReadiness(input([row(1,true),bad,row(2)]),input([a,copy,row(2)])).coverage.find(c=>c.field==="price"&&c.basis==="prior-dependencies")).toMatchObject({eligibleAssets:2,unavailable:1});
});
it("a wholly failed provider cannot become optional after the degraded snapshot becomes baseline or during bootstrap",()=>{
 const bad=input([row(1,true),row(2,true)]);
 expect(marketAcquisitionReadiness(bad,bad).errors).toContain("market_acquisition_failed:cmc:zero_usable");
 expect(marketAcquisitionReadiness(bad,null).errors).toContain("market_acquisition_failed:cmc:zero_usable");
 const c=row(1,true);c.mcap=10;c.marketSources!.mcap="DefiLlama";
 expect(marketAcquisitionReadiness(input([c]),input([c])).errors).toContain("market_acquisition_failed:cmc:zero_usable");
 expect(marketAcquisitionReadiness(input([c]),null).errors).toContain("market_acquisition_failed:cmc:zero_usable");
});
it("current-request majority protects degraded/bootstrap baselines even with one usable asset, using field-specific fallback",()=>{
 const bad=input([row(1,true),row(2,true),row(3,true)]),next=input([row(1),row(2,true),row(3,true)]);
 expect(marketAcquisitionReadiness(next,bad).coverage.find(c=>c.provider==="CoinMarketCap"&&c.field==="price"&&c.basis==="current-requests")).toEqual({provider:"CoinMarketCap",field:"price",basis:"current-requests",eligibleAssets:3,unavailable:2});
 expect(marketAcquisitionReadiness(next,null).errors).toContain("market_acquisition_failed:cmc:price:2/3");
 for(const c of next.coins.slice(1)){c.mcap=10;c.marketSources!.mcap="DefiLlama";}
 expect(marketAcquisitionReadiness(next,bad).errors).toContain("market_acquisition_failed:cmc:price:2/3");
 expect(marketAcquisitionReadiness(next,bad).errors.some(e=>e.includes(":mcap:"))).toBe(false);
 const prior=input([row(1),...Array.from({length:2191},(_,i)=>row(i+2,true))]);
 const later=input([row(1),...Array.from({length:2191},(_,i)=>row(i+2,true))]);
 expect(marketAcquisitionReadiness(later,prior).errors).toContain("market_acquisition_failed:cmc:price:2191/2192");
 expect(marketAcquisitionReadiness(later,prior).coverage.find(c=>c.provider==="CoinMarketCap"&&c.field==="price"&&c.basis==="prior-dependencies")).toMatchObject({eligibleAssets:1,unavailable:0});
});
it("fresh fallback including explicitzero offsets provider failure; historical absence and new assets do not dilute denominator",()=>{
 const c=row(1,true);c.mcap=0;c.price=0;c.fdv=0;c.marketSources!.mcap=c.marketSources!.price=c.marketSources!.fdv="CoinGecko";
 c.marketSources!.gecko={id:"fallback",status:"received",observedAt:at,available:["mcap","price","fdv"]};
 expect(marketAcquisitionReadiness(input([c]),input([row(1)])).errors).toEqual([]);
 const absent=row(3);absent.mcap=absent.price=absent.fdv=null;absent.marketSources!.mcap=absent.marketSources!.price=absent.marketSources!.fdv=null;
 const old=input([row(1),row(2),absent]),next=input([row(1,true),row(2),absent,...Array.from({length:100},(_,i)=>row(i+100))]);
 expect(marketAcquisitionReadiness(next,old).coverage.find(c=>c.field==="price"&&c.basis==="prior-dependencies")).toMatchObject({eligibleAssets:2,unavailable:1});
});
it("systemically failed provider needs every requiredfield's freshfallback even if less than half the oldfields were lost",()=>{
 const old=input([row(1),row(2),row(3)]),c=row(2,true),d=row(3,true);
 for(const x of [c,d]){x.mcap=10;x.price=1;x.marketSources!.mcap="DefiLlama";x.marketSources!.price="CoinGecko";x.marketSources!.gecko={id:"fallback",status:"received",observedAt:at,available:["price"]};}
 const r=marketAcquisitionReadiness(input([row(1),c,d]),old);
 expect(r.providerHealth[0]).toEqual({provider:"CoinMarketCap",acquiredAssets:3,failedAssets:2,uncoveredAssets:2});
 expect(r.errors).toContain("market_acquisition_failed:cmc:essential_provider:2/3:2_uncovered");
 for(const x of [c,d]){x.fdv=0;x.marketSources!.fdv="CoinGecko";x.marketSources!.gecko!.available.push("fdv");}
 expect(marketAcquisitionReadiness(input([row(1),c,d]),old).errors).toEqual([]);
});
it("widespread malformed price requires fallback only forprice, preserving valid sameprovider mcap/FDV",()=>{
 const old=input([row(1),row(2)]),next=input([row(1),row(2)]);
 for(const c of next.coins){c.marketSources!.cmc!.available=["mcap","fdv"];c.marketSources!.cmc!.invalidFields=["quote.price"];c.price=0;c.marketSources!.price="CoinGecko";c.marketSources!.gecko={id:"fallback",status:"received",observedAt:at,available:["price"]};}
 expect(marketAcquisitionReadiness(next,old).errors).toEqual([]);
 next.coins[0].price=null;next.coins[0].marketSources!.price=null;
 expect(marketAcquisitionReadiness(next,old).errors.some(e=>e.includes(":essential_provider:"))).toBe(true);
});
it("a reliable prior FDV omission does not invent an FDV obligation when fresh fallback covers all required fields",()=>{
 const previous=row(1);previous.fdv=null;previous.marketSources!.fdv=null;previous.marketSources!.cmc!.available=["mcap","price"];
 const current=row(1,true);current.mcap=10;current.price=1;current.marketSources!.mcap=current.marketSources!.price="CoinGecko";
 current.marketSources!.gecko={id:"fallback",status:"received",observedAt:at,available:["mcap","price"]};
 const passed=marketAcquisitionReadiness(input([current]),input([previous]));
 expect(passed.errors).toEqual([]);expect(passed.coverage.find(c=>c.provider==="CoinMarketCap"&&c.field==="fdv"&&c.basis==="current-requests")).toMatchObject({eligibleAssets:0,unavailable:0});
 current.price=null;current.marketSources!.price=null;
 expect(marketAcquisitionReadiness(input([current]),input([previous])).errors).toContain("market_acquisition_failed:cmc:essential_provider:1/1:1_uncovered");
});
it("malformed200money and identitymismatch are unusable; explicitsuccessfulomission remains scoped",()=>{
 for(const status of ["received","identity_mismatch"] as const) {
  const c=row(1,true);c.marketSources!.cmc!.status=status;c.marketSources!.cmc!.invalidFields=["quote.price","quote.market_cap","quote.fully_diluted_market_cap"];
  expect(marketAcquisitionReadiness(input([c]),input([row(1)])).errors).toContain("market_acquisition_failed:cmc:zero_usable");
 }
 const c=row(1,true);c.marketSources!.cmc!.status="not_returned";
 expect(marketAcquisitionReadiness(input([c,row(2)]),input([row(1),row(2)])).errors).toEqual([]);
 expect(marketAcquisitionReadiness(input([c]),input([row(1)])).errors).toEqual(["market_acquisition_failed:cmc:zero_usable"]);
 c.marketSources!.cmc!.status="received";
 expect(marketAcquisitionReadiness(input([c,row(2)]),input([row(1),row(2)])).errors).toEqual([]);
});
it("transport identity loss or mismatch cannot be auto-reviewed, while currentpositive reassignment stays explicit",()=>{
 const old=input([row(1)]),c=row(1,true);c.cmcId=null;c.identityStatus="review";
 expect(failedIdentityChanges(input([c]),old,[{slug:c.slug,issue:"identity_changed"}])).toHaveLength(1);
 c.cmcId=2;c.marketSources!.cmc={...c.marketSources!.cmc!,id:"2",status:"received",available:["price"]};c.marketSources!.requests!.cmc=[c.marketSources!.cmc];
 expect(failedIdentityChanges(input([c]),old,[{slug:c.slug,issue:"identity_changed"}])).toEqual([]);
});
