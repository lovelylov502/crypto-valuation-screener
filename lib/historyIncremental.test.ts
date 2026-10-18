import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { calculateDailyValuations, shiftDay, type FundamentalDay, type MarketDay, type ValuationDay } from "./dailyHistory";
import { historyDatabaseStats, initializeHistory, queryHistory, readSeries, saveSeries } from "./historyDatabase";
import { reconcileHistoryAsset, type StoredHistoryAsset } from "./historyIncremental";

let db:Client,previous:StoredHistoryAsset;
const day="2026-10-18",identity="gecko:token";
const asset={identity,identityStatus:"verified",snapshotId:"s1"};
const flow=(date:string,value=10):FundamentalDay=>({day:date,revenue:{value,state:"complete",scope:"r",source:"receipt-r"},holders:{value:5,state:"complete",scope:"h",source:"receipt-h"}});
const market=(date:string):MarketDay=>({day:date,identity,price:1,mcap:3650,fdv:null,marketAt:`${date}T00:00:00Z`,fdvAt:null,marketSource:"m",fdvSource:null,basis:"utc_midnight"});
const flows=()=>Array.from({length:729},(_,i)=>flow(shiftDay(day,-730+i)));
const markets=()=>Array.from({length:365},(_,i)=>market(shiftDay(day,-365+i)));
const reconcile=async(fundamentals:FundamentalDay[],points:MarketDay[]=[],extra:Record<string,unknown>={},now=new Date("2026-10-18T01:00:00Z"))=>{
  const result=await reconcileHistoryAsset(db,{slug:"a",asset:{...asset,...extra},fundamentals,markets:points,previous,now});previous=result.asset;return result;
};
async function agreesWithFull(eligible=true,currentIdentity=identity) {
  const f=await readSeries<FundamentalDay>(db,"history_fundamentals","a"),m=(await readSeries<MarketDay>(db,"history_market","a")).filter(p=>p.identity===currentIdentity);
  const expected=calculateDailyValuations(f,m,eligible).sort((a,b)=>a.day.localeCompare(b.day)||a.days-b.days);
  const actual=(await readSeries<ValuationDay>(db,"history_valuations","a")).filter(p=>m.some(q=>q.day===p.day)).sort((a,b)=>a.day.localeCompare(b.day)||a.days-b.days);
  expect(actual).toEqual(expected);
}
beforeEach(async()=>{
  db=createClient({url:":memory:"});await initializeHistory(db);
  previous=(await reconcileHistoryAsset(db,{slug:"a",asset,fundamentals:flows(),markets:markets(),previous:null,now:new Date("2026-10-18T00:00:00Z")})).asset;
});
afterEach(()=>{vi.restoreAllMocks();db.close();});

it("calculates five latest windows instead of recomputing 366 dates and ignores receipt-only changes",async()=>{
  const result=await reconcile([...flows(),flow(shiftDay(day,-1))],[market(day)],{snapshotId:"s2"});
  expect(result).toMatchObject({fundamentalWrites:1,marketWrites:1,valuationWrites:5,calculations:5,fullConsistency:false});
  expect(calculateDailyValuations([...flows(),flow(shiftDay(day,-1))],[...markets(),market(day)],true)).toHaveLength(1830);
  await agreesWithFull();
  const unchanged=await reconcile([...flows(),flow(shiftDay(day,-1))].map(p=>({...p,revenue:{...p.revenue,source:"new-capture"}})),[],{snapshotId:"s3"});
  expect(unchanged).toMatchObject({fundamentalWrites:0,marketWrites:0,valuationWrites:0,calculations:0});
  expect((await readSeries<FundamentalDay>(db,"history_fundamentals","a"))[0].revenue.source).toBe("receipt-r");
});

it("recalculates only the windows containing an old correction with their complete prior lookback",async()=>{
  const corrected=flows().map(p=>p.day===shiftDay(day,-60)?{...p,revenue:{...p.revenue,value:0}}:p);
  const result=await reconcile(corrected,[],{snapshotId:"corrected"});
  // One, seven and thirty affected dates; 59 available dates for 90 and 365.
  expect(result.calculations).toBe(1+7+30+59+59);
  expect(result.fundamentalWrites).toBe(1);await agreesWithFull();
  const missing=corrected.map(p=>p.day===shiftDay(day,-20)?{...p,revenue:{...p.revenue,value:null,state:"missing" as const}}:p);
  await reconcile(missing,[],{snapshotId:"missing"});await agreesWithFull();
});

it("carries each prior metric scope separately across gaps and invalidates a later scope boundary",async()=>{
  const sparse:FundamentalDay[]=[
    {day:shiftDay(day,-500),revenue:{value:3,state:"complete",scope:"old-r",source:"r"},holders:{value:null,state:"missing",scope:"",source:""}},
    {day:shiftDay(day,-490),revenue:{value:null,state:"missing",scope:"",source:""},holders:{value:2,state:"complete",scope:"old-h",source:"h"}},
    flow(shiftDay(day,-10)),
  ];
  await db.execute("DELETE FROM history_fundamentals");
  await saveSeries(db,"history_fundamentals","a",sparse);
  previous.payload.reconciliationState="updating";
  await reconcile(sparse,[],{snapshotId:"sparse"});await agreesWithFull();
  const result=await reconcile([{...sparse[0],revenue:{...sparse[0].revenue,scope:"r"}}],[],{snapshotId:"old-scope"});
  // The edit is older than any live 365-day denominator, but it changes the
  // scope boundary at D-10, so those later windows still need updating.
  expect(result.calculations).toBeGreaterThan(0);await agreesWithFull();
});

it("does not splice token identities and recalculates eligibility changes",async()=>{
  await reconcile([],[],{identityStatus:"conflict",snapshotId:"hold"});await agreesWithFull(false);
  await reconcile([],[],{snapshotId:"restore"});await agreesWithFull();
  const result=await reconcile([],[{...market(day),identity:"gecko:new",mcap:7300}],{identity:"gecko:new",snapshotId:"migration"});
  expect(result.calculations).toBe(5);await agreesWithFull(true,"gecko:new");
  const response=await queryHistory(db,{slug:"a",days:30,from:shiftDay(day,-365),to:day,after:"2000-01-01",limit:1000});
  expect(response!.points.map(p=>p.day)).toEqual([day]);
});

it("withholds every stored multiple after an interrupted chunk and forces a complete resume",async()=>{
  const original=db.batch.bind(db);let writes=0;
  vi.spyOn(db,"batch").mockImplementation((statements,mode)=>{
    if(mode==="write"&&++writes===2)return Promise.reject(new Error("interrupted write"));
    return original(statements,mode);
  });
  const corrected=flows().map(p=>({...p,revenue:{...p.revenue,value:20}}));
  await expect(reconcile(corrected,[],{snapshotId:"interrupted"})).rejects.toThrow("interrupted write");
  const q={slug:"a",days:1,from:shiftDay(day,-10),to:day,after:"2000-01-01",limit:1000};
  const partial=await queryHistory(db,q);
  expect(partial!.points.every(p=>p.valuation===null&&p.valuationState==="updating")).toBe(true);
  vi.restoreAllMocks();
  // Reload the durable marker, as a fresh process must; the old in-memory
  // ready asset is intentionally not trusted after an unknown write outcome.
  const resumed=await reconcileHistoryAsset(db,{slug:"a",asset:{...asset,snapshotId:"resumed"},fundamentals:corrected,markets:[],now:new Date("2026-10-18T02:00:00Z")});
  expect(resumed.fullConsistency).toBe(true);await agreesWithFull();
  expect((await queryHistory(db,q))!.points.every(p=>p.valuationState==="ready")).toBe(true);
});

it("performs a periodic consistency pass and batches a small dated update into one write transaction",async()=>{
  const before={...historyDatabaseStats(db)};
  await reconcile([...flows(),flow(shiftDay(day,-1))],[market(day)],{snapshotId:"s2"});
  const after=historyDatabaseStats(db);
  expect(after.writeBatches-before.writeBatches).toBe(1);
  const monthly=await reconcile([],[],{snapshotId:"monthly"},new Date("2026-11-19T01:00:00Z"));
  expect(monthly).toMatchObject({calculations:1830,valuationWrites:0,fullConsistency:true});
  await agreesWithFull();
});
