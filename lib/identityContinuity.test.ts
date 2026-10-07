import {expect,it} from "vitest";
import {normalizeCoinInputs,type CoinInputs} from "./sources";

const at="2026-10-07T20:51:50.777Z";
function inputs():CoinInputs {
 return {asOf:at,protocols:[{slug:"ethereum",name:"Ethereum"}],fees:[],revenue:[],holders:[],dexs:[],parents:[],stablecoins:[],cmc:[],cmcDiscoveryComplete:false,
  cmcLookups:[[1027,{id:"1027",status:"error",observedAt:at,available:[]}]],gecko:[],geckoLookups:[],revenueHistories:{},holderHistories:{},recoveredRevenue:[],observations:[],priorCmcTargets:[[1027,["ethereum"]]],
  priorCmcIdentities:[{slug:"ethereum",name:"Ethereum",sourceSlugs:["ethereum"],symbol:"ETH",geckoId:null,cmcId:1027,cmcSlug:"ethereum",baselineAt:"2026-10-07T20:11:00.227Z"}]};
}
it("provider error retains exact prior verified identity only, with original proof time and no financial data",()=>{
 const i=inputs(),c=normalizeCoinInputs(i)[0];
 expect(c).toMatchObject({slug:"ethereum",cmcId:1027,cmcSlug:"ethereum",symbol:"ETH",identityStatus:"verified",mcap:null,price:null,fdv:null,marketDataUpdatedAt:null,listedAt:null,
 identityContinuity:{provider:"CoinMarketCap",id:1027,baselineAt:"2026-10-07T20:11:00.227Z",baselineSlug:"ethereum"},marketSources:{cmc:{id:"1027",status:"error"}}});
 expect(c.identityReason).toContain("현재 시세 조회 실패");
 delete i.priorCmcIdentities;expect(normalizeCoinInputs(i)[0]).toMatchObject({cmcId:null,identityStatus:"review"});
});
it.each(["symbol","name","membership","CMC conflict","Gecko conflict","fresh Gecko symbol conflict","not_returned","successful omission"])("cannot preserve a prior identity across %s",reason=>{
 const i=inputs();
 if(reason==="symbol")i.protocols[0].symbol="OTHER";
 if(reason==="name")i.protocols[0].name="Different";
 if(reason==="membership")i.priorCmcIdentities![0].sourceSlugs.push("removed-child");
 if(reason==="CMC conflict")i.protocols[0].cmcId=999;
 if(reason==="Gecko conflict"){i.protocols[0].gecko_id="different";i.geckoLookups=[["different",{id:"different",status:"error",observedAt:at,available:[]}]];}
 if(reason==="fresh Gecko symbol conflict"){i.protocols[0].gecko_id="ethereum";i.priorCmcIdentities![0].geckoId="ethereum";i.gecko=[{id:"ethereum",symbol:"OTHER",name:"Ethereum",current_price:1}];i.geckoLookups=[["ethereum",{id:"ethereum",status:"received",observedAt:at,available:["price"]}]];}
 if(reason==="not_returned")i.cmcLookups[0][1].status="not_returned";
 if(reason==="successful omission")i.cmcLookups[0][1].status="received";
 expect(normalizeCoinInputs(i)[0].identityContinuity).toBeUndefined();
});
