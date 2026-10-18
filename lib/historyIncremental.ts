import type { Client } from "@libsql/client";
import { calculateDailyValuations, historyHash, HISTORY_VERSION, mergeMarket, shiftDay, type FundamentalDay, type MarketDay } from "./dailyHistory";
import { REVENUE_WINDOWS } from "./revenueHistory";
import { assetStatement, historyContentHash, historyReadBatch, seriesKey, seriesStatements, writeHistoryChunks } from "./historyDatabase";

export interface StoredHistoryAsset { payload:Record<string,unknown>; hash:string }
interface ReconcileInput {
  slug:string;
  asset:Record<string,unknown> & {identity:string};
  fundamentals:FundamentalDay[];
  markets:MarketDay[];
  previous?:StoredHistoryAsset|null;
  now?:Date;
}
type ScopeDay={day:string;revenueScope:string;holderScope:string};
const lowerBound=(dates:string[],day:string)=>{
  let lo=0,hi=dates.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(dates[mid]<day)lo=mid+1;else hi=mid;}
  return lo;
};
const changedBetween=(dates:string[],from:string,to:string)=>dates[lowerBound(dates,from)]<to;

/** Hash every available source day so old provider corrections cannot be skipped.
 * Payload reads and calculations are limited to the windows those changes affect. */
export async function reconcileHistoryAsset(db:Client,input:ReconcileInput) {
  const {slug,asset,fundamentals,markets}=input, now=input.now??new Date();
  const results=await historyReadBatch(db,[
    {sql:"SELECT day,content_hash,json_extract(payload,'$.revenue.scope') AS revenue_scope,json_extract(payload,'$.holders.scope') AS holder_scope FROM history_fundamentals WHERE slug=? ORDER BY day",args:[slug]},
    {sql:"SELECT day,content_hash,COALESCE(json_extract(payload,'$.identity'),'') AS identity FROM history_market WHERE slug=? ORDER BY day",args:[slug]},
    ...(input.previous===undefined?[{sql:"SELECT payload,content_hash FROM history_assets WHERE slug=?",args:[slug]}]:[]),
  ]);
  const previous=input.previous===undefined?(results[2].rows[0]?{payload:JSON.parse(String(results[2].rows[0].payload)) as Record<string,unknown>,hash:String(results[2].rows[0].content_hash)}:null):input.previous;
  const old=previous?.payload??{};
  const flowHashes=new Map(results[0].rows.map(r=>[`${r.day}:`,String(r.content_hash)]));
  const oldScopes=new Map<string,ScopeDay>(results[0].rows.map(r=>[String(r.day),{day:String(r.day),revenueScope:String(r.revenue_scope??""),holderScope:String(r.holder_scope??"")}]));
  const scopes=new Map(oldScopes);
  const changedFlows=fundamentals.filter(p=>flowHashes.get(seriesKey(p))!==historyContentHash("history_fundamentals",p));
  for(const p of changedFlows)scopes.set(p.day,{day:p.day,revenueScope:p.revenue.scope,holderScope:p.holders.scope});
  const orderedScopes=[...scopes.values()].sort((a,b)=>a.day.localeCompare(b.day));
  const changedDates=changedFlows.map(p=>p.day).sort(),boundaryDates=new Set<string>();
  // Changing a scope can also change the next nonempty scope boundary across a
  // gap. Its later windows need invalidating even if they exclude the edited day.
  for(const metric of ["revenueScope","holderScope"] as const){
    const before=[...oldScopes.values()].filter(p=>p[metric]).map(p=>p.day).sort();
    const after=orderedScopes.filter(p=>p[metric]).map(p=>p.day);
    for(const p of changedFlows){
      if((oldScopes.get(p.day)?.[metric]??"")===scopes.get(p.day)![metric])continue;
      for(const dates of [before,after]){const next=dates[lowerBound(dates,shiftDay(p.day,1))];if(next)boundaryDates.add(next);}
    }
  }
  const boundaries=[...boundaryDates].sort();
  const eligible=asset.identityStatus==="verified"&&!asset.capitalExclusionReason;
  const wasEligible=old.identityStatus==="verified"&&!old.capitalExclusionReason;
  const full=old.reconciliationState==="updating"||old.calculationVersion!==HISTORY_VERSION||old.identity!==asset.identity||eligible!==wasEligible
    ||!old.consistencyCheckedAt||now.getTime()-Date.parse(String(old.consistencyCheckedAt))>=30*86400_000;
  const marketHashes=new Map(results[1].rows.map(r=>[`${r.day}:`,String(r.content_hash)]));
  const currentDates=results[1].rows.filter(r=>r.identity===asset.identity).map(r=>String(r.day));
  const incoming=markets.filter(p=>p.identity===asset.identity);
  const incomingDays=new Set(incoming.map(p=>p.day));
  const dates=[...new Set([...currentDates,...incomingDays])].sort();
  const affected=new Map<string,number[]>();
  for(const day of dates){
    const windows=REVENUE_WINDOWS.filter(days=>full||changedBetween(changedDates,shiftDay(day,-days),day)||changedBetween(boundaries,shiftDay(day,1-days),day));
    if(windows.length)affected.set(day,windows);
  }
  const candidates=[...new Set([...affected.keys(),...incomingDays])].sort();
  let marketRows:MarketDay[]=[],valuations:ReturnType<typeof calculateDailyValuations>=[];
  let valuationHashes=new Map<string,string>();
  const changedMarkets:MarketDay[]=[];
  if(candidates.length){
    const from=candidates[0],to=candidates.at(-1)!,flowFrom=shiftDay(from,-365),flowTo=shiftDay(to,-1);
    const [marketResult,flowResult,valuationResult]=await historyReadBatch(db,[
      {sql:"SELECT payload FROM history_market WHERE slug=? AND day>=? AND day<=? ORDER BY day",args:[slug,from,to]},
      {sql:"SELECT payload FROM history_fundamentals WHERE slug=? AND day>=? AND day<=? ORDER BY day",args:[slug,flowFrom,flowTo]},
      {sql:"SELECT day,days,content_hash FROM history_valuations WHERE slug=? AND day>=? AND day<=?",args:[slug,from,to]},
    ]);
    const mergedMarkets=new Map<string,MarketDay>(marketResult.rows.map(r=>JSON.parse(String(r.payload)) as MarketDay).filter(p=>p.identity===asset.identity).map(p=>[p.day,p]));
    for(const p of incoming){
      const merged=mergeMarket(mergedMarkets.get(p.day),p);mergedMarkets.set(p.day,merged);
    }
    for(const day of incomingDays){
      const p=mergedMarkets.get(day)!;
      if(marketHashes.get(seriesKey(p))!==historyContentHash("history_market",p)){changedMarkets.push(p);affected.set(day,[...REVENUE_WINDOWS]);}
    }
    marketRows=[...mergedMarkets.values()].filter(p=>affected.has(p.day)).sort((a,b)=>a.day.localeCompare(b.day));
    const flows=new Map<string,FundamentalDay>(flowResult.rows.map(r=>JSON.parse(String(r.payload)) as FundamentalDay).map(p=>[p.day,p]));
    for(const p of changedFlows)if(p.day>=flowFrom&&p.day<=flowTo)flows.set(p.day,p);
    // The predecessor preserves scope transitions when the bounded read begins
    // with a gap. It is outside every requested financial denominator.
    const seed:FundamentalDay={day:shiftDay(flowFrom,-1),revenue:{value:null,state:"missing",scope:"",source:""},holders:{value:null,state:"missing",scope:"",source:""}};
    for(const p of orderedScopes){if(p.day>=flowFrom)break;if(p.revenueScope)seed.revenue.scope=p.revenueScope;if(p.holderScope)seed.holders.scope=p.holderScope;}
    flows.set(seed.day,seed);
    if(scopes.size)for(const days of REVENUE_WINDOWS){
      const selected=marketRows.filter(p=>affected.get(p.day)!.includes(days));
      valuations.push(...calculateDailyValuations([...flows.values()],selected,eligible,[days]));
    }
    valuationHashes=new Map(valuationResult.rows.map(r=>[`${r.day}:${r.days}`,String(r.content_hash)]));
  }
  const fundamentalStatements=seriesStatements("history_fundamentals",slug,changedFlows,flowHashes);
  const marketStatements=seriesStatements("history_market",slug,changedMarkets,marketHashes);
  const valuationStatements=seriesStatements("history_valuations",slug,valuations,valuationHashes);
  const final={...old,...asset,sourceFrom:orderedScopes[0]?.day??null,sourceTo:orderedScopes.at(-1)?.day??null,fundamentalDays:scopes.size,
    marketFrom:dates[0]??null,marketTo:dates.at(-1)??null,marketDays:dates.length,calculationVersion:HISTORY_VERSION,reconciliationState:"ready",
    consistencyCheckedAt:full?now.toISOString():old.consistencyCheckedAt};
  const statements=[...fundamentalStatements,...marketStatements,...valuationStatements];
  // Marker and final checkpoint share the ordered, quota-reserved write stream.
  // A crash after any chunk forces a consistency pass on the next attempt.
  if(statements.length)statements.unshift(assetStatement(slug,{...final,reconciliationState:"updating"}));
  if(statements.length||previous?.hash!==historyHash(final))statements.push(assetStatement(slug,final));
  await writeHistoryChunks(db,statements);
  return {fundamentalWrites:fundamentalStatements.length,marketWrites:marketStatements.length,valuationWrites:valuationStatements.length,
    calculations:valuations.length,fullConsistency:full,asset:{payload:final,hash:historyHash(final)} satisfies StoredHistoryAsset};
}
