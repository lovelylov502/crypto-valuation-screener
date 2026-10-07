import type {CoinRaw,QuoteLookup,ScreenerResponse} from "./types";

const fields=["mcap","price","fdv"] as const;
const providers={cmc:"CoinMarketCap",gecko:"CoinGecko"} as const;
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const membership=(c:CoinRaw)=>JSON.stringify([...(c.sourceSlugs??[c.slug])].sort());
function lookup(c:CoinRaw,vendor:"cmc"|"gecko",id:string):QuoteLookup|undefined {
 return [...(c.marketSources?.requests?.[vendor]??[]),...(c.marketSources?.[vendor]?[c.marketSources[vendor]!]:[])].find(q=>q.id===id);
}
function unusable(q:QuoteLookup|undefined,field:typeof fields[number],vendor:"cmc"|"gecko") {
 const name=field==="mcap"?"market_cap":field==="fdv"?vendor==="cmc"?"fully_diluted_market_cap":"fully_diluted_valuation":vendor==="cmc"?"price":"current_price";
 return q?.status==="error"||q?.status==="identity_mismatch"||q?.invalidFields?.some(f=>f===name||f===`quote.${name}`||f==="quote")===true;
}
function currentField(c:CoinRaw,field:typeof fields[number]) {
 if(!finite(c[field])||c.identityStatus!=="verified")return false;
 const source=c.marketSources?.[field];
 if(source==="DefiLlama")return field==="mcap";
 const vendor=source==="CoinMarketCap"?"cmc":source==="CoinGecko"?"gecko":null,q=vendor?c.marketSources?.[vendor]:null;
 return !!vendor&&q?.status==="received"&&q.available.includes(field)&&!unusable(q,field,vendor);
}
/** Acquisition acceptance is stricter than historical archive integrity. Local failures remain publishable. */
export function marketAcquisitionReadiness(data:Pick<ScreenerResponse,"coins">,baseline:Pick<ScreenerResponse,"coins">|null) {
 const errors:string[]=[],coverage:{provider:string;field:string;basis:"prior-dependencies"|"current-requests";eligibleAssets:number;unavailable:number}[]=[],providerHealth:{provider:string;acquiredAssets:number;failedAssets:number;uncoveredAssets:number}[]=[];
 const next=new Map(data.coins.map(c=>[c.slug,c]));
 for(const vendor of ["cmc","gecko"] as const) {
  const provider=providers[vendor],dependencies=new Map<string,CoinRaw[]>();
  for(const old of baseline?.coins??[]) {
   const id=old.marketSources?.[vendor]?.id,current=next.get(old.slug);
   if(old.identityStatus!=="verified"||!id||!current||membership(current)!==membership(old))continue;
   dependencies.set(id,[...(dependencies.get(id)??[]),old]);
  }
  let uncovered=false;
  const requiredFields=(q:QuoteLookup)=>{
   if(q.status==="received"&&fields.some(f=>unusable(q,f,vendor)))return fields.filter(f=>unusable(q,f,vendor));
   const known=(dependencies.get(q.id)??[]).filter(c=>{const previous=lookup(c,vendor,q.id);return previous?.status==="received"&&!previous.invalidFields?.length;});
   return known.length?fields.filter(f=>known.some(c=>finite(c[f])&&c.marketSources?.[f]===provider)):fields;
  };
  const acquisition=new Map<string,{failed:boolean;uncovered:boolean}>();
  for(const c of data.coins)for(const q of [...(c.marketSources?.requests?.[vendor]??[]),...(c.marketSources?.[vendor]?[c.marketSources[vendor]!]:[])]) {
   const failed=q.status==="error"||q.status==="identity_mismatch"||fields.some(f=>unusable(q,f,vendor));
   if(!failed&&!(q.status==="received"&&q.available.some(f=>!unusable(q,f,vendor))))continue;
   const required=requiredFields(q);
   const missing=failed&&required.some(f=>!currentField(c,f)||c.marketSources![f]===provider),old=acquisition.get(q.id);
   acquisition.set(q.id,{failed:(old?.failed??false)||failed,uncovered:(old?.uncovered??false)||missing});
  }
  const failedAssets=[...acquisition.values()].filter(q=>q.failed).length,uncoveredAssets=[...acquisition.values()].filter(q=>q.uncovered).length;
  providerHealth.push({provider,acquiredAssets:acquisition.size,failedAssets,uncoveredAssets});
  if(acquisition.size&&failedAssets/acquisition.size>=0.5&&uncoveredAssets)errors.push(`market_acquisition_failed:${vendor}:essential_provider:${failedAssets}/${acquisition.size}:${uncoveredAssets}_uncovered`);
  for(const field of fields) {
   const eligible=[...dependencies].filter(([,rows])=>rows.some(c=>finite(c[field])&&c.marketSources?.[field]===provider));
   if(eligible.some(([,rows])=>rows.some(old=>finite(old[field])&&old.marketSources?.[field]===provider&&!currentField(next.get(old.slug)!,field))))uncovered=true;
   const lost=eligible.filter(([id,rows])=>rows.some(old=>{
    if(!finite(old[field])||old.marketSources?.[field]!==provider)return false;
    const c=next.get(old.slug)!,q=lookup(c,vendor,id);
    const available=currentField(c,field);
    return !available&&unusable(q,field,vendor);
   }));
   const requests=new Map<string,{lost:boolean}>();
   for(const c of data.coins)for(const q of [...(c.marketSources?.requests?.[vendor]??[]),...(c.marketSources?.[vendor]?[c.marketSources[vendor]!]:[])]) {
    if(!(unusable(q,field,vendor)&&requiredFields(q).includes(field))&&!(q.status==="received"&&q.available.includes(field)))continue;
    requests.set(q.id,{lost:(requests.get(q.id)?.lost??false)||unusable(q,field,vendor)&&!currentField(c,field)});
   }
   // Evaluate both scopes: new assets cannot dilute previous coverage, and an already degraded baseline cannot hide current failure.
   for(const [basis,denominator,numerator] of [["prior-dependencies",eligible.length,lost.length],["current-requests",requests.size,[...requests.values()].filter(q=>q.lost).length]] as const) {
    coverage.push({provider,field,basis,eligibleAssets:denominator,unavailable:numerator});
    if(denominator&&numerator/denominator>=0.5)errors.push(`market_acquisition_failed:${vendor}:${field}:${numerator}/${denominator}`);
   }
  }
  const usable=data.coins.some(c=>c.identityStatus==="verified"&&[...(c.marketSources?.requests?.[vendor]??[]),...(c.marketSources?.[vendor]?[c.marketSources[vendor]!]:[])].some(q=>q.status==="received"&&q.available.some(f=>!unusable(q,f,vendor))));
  // A degraded/absent baseline cannot make a whole requested provider optional.
  const currentUncovered=data.coins.some(c=>[...(c.marketSources?.requests?.[vendor]??[]),...(c.marketSources?.[vendor]?[c.marketSources[vendor]!]:[])].some(q=>(c.identityStatus==="verified"||q.status==="error"||q.status==="identity_mismatch"||!!q.invalidFields?.length||q.status==="not_returned"&&(vendor==="cmc"?c.cmcId!==null:c.geckoId!==null))&&
    !requiredFields(q).every(f=>currentField(c,f)&&c.marketSources![f]!==provider)));
  uncovered||=currentUncovered;
  if(uncovered&&!usable)errors.push(`market_acquisition_failed:${vendor}:zero_usable`);
 }
 return {errors:[...new Set(errors)],coverage,providerHealth};
}

export function failedIdentityChanges(data:ScreenerResponse,baseline:ScreenerResponse|null,changes:{slug:string;issue:string}[]) {
 return changes.filter(change=>{
  if(change.issue!=="identity_changed")return false;
  const old=baseline?.coins.find(c=>c.slug===change.slug),c=data.coins.find(c=>c.slug===change.slug);
  return !!old&&!!c&&(["cmc","gecko"] as const).some(vendor=>{
   const id=old.marketSources?.[vendor]?.id;if(!id)return false;
   const current=c.marketSources?.[vendor];
   return (current?.id!==id||c.identityStatus!=="verified")&&(lookup(c,vendor,id)?.status==="error"||lookup(c,vendor,id)?.status==="identity_mismatch");
  });
 });
}
