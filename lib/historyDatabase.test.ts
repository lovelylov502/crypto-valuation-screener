import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { budgetedWrite, historyRead, HistoryBudgetExceeded, initializeHistory, queryHistory, saveAsset, saveSeries, saveSources, HISTORY_WRITE_LIMIT } from "./historyDatabase";
import { calculateDailyValuations, type FundamentalDay, type MarketDay } from "./dailyHistory";
let db:Client;
beforeEach(async()=>{db=createClient({url:":memory:"});await initializeHistory(db);});
afterEach(()=>{vi.restoreAllMocks();db.close();});
const disconnected=()=>new TypeError("fetch failed",{cause:Object.assign(new Error("other side closed"),{code:"UND_ERR_SOCKET"})});
it("reconnects a stale read once without duplicating any write",async()=>{
  const execute=vi.spyOn(db,"execute").mockRejectedValueOnce(disconnected());
  const reconnect=vi.spyOn(db,"reconnect").mockResolvedValueOnce();
  const batch=vi.spyOn(db,"batch");
  expect(await saveSources(db,[])).toBe(0);
  expect(reconnect).toHaveBeenCalledTimes(1);expect(execute).toHaveBeenCalledTimes(2);expect(batch).not.toHaveBeenCalled();
  expect(()=>historyRead(db,"DELETE FROM history_sources")).toThrow("requires SELECT");
});
it("bounds read retries and does not retry permission failures",async()=>{
  const execute=vi.spyOn(db,"execute").mockRejectedValue(disconnected());
  const reconnect=vi.spyOn(db,"reconnect").mockResolvedValue();
  await expect(historyRead(db,"SELECT 1")).rejects.toThrow("fetch failed");
  expect(execute).toHaveBeenCalledTimes(2);expect(reconnect).toHaveBeenCalledTimes(1);
  execute.mockClear().mockRejectedValue(Object.assign(new Error("permission denied"),{code:"BLOCKED"}));
  reconnect.mockClear();
  await expect(historyRead(db,"SELECT 1")).rejects.toThrow("permission denied");
  expect(execute).toHaveBeenCalledTimes(1);expect(reconnect).not.toHaveBeenCalled();
});
it("does not replay a write with an unknown transport outcome",async()=>{
  const original=db.batch.bind(db);
  const batch=vi.spyOn(db,"batch").mockImplementation((statements,mode)=>mode==="write"?Promise.reject(disconnected()):original(statements,mode));
  await expect(budgetedWrite(db,[{sql:"INSERT INTO history_fetches VALUES(?,?)",args:["x","{}"]}])).rejects.toThrow("fetch failed");
  expect(batch.mock.calls.filter(([,mode])=>mode==="write")).toHaveLength(1);
});
it("resumes idempotently without charging unchanged historical flow observations",async()=>{
  const p:FundamentalDay={day:"2020-01-01",revenue:{value:3,state:"complete",source:"r1",scope:"s"},holders:{value:null,state:"missing",source:"",scope:""}};
  expect(await saveSeries(db,"history_fundamentals","a",[p])).toBe(1);
  const before=await db.execute("SELECT reserved FROM history_budget");
  expect(await saveSeries(db,"history_fundamentals","a",[{...p,revenue:{...p.revenue,source:"r2"}}])).toBe(0);
  expect((await db.execute("SELECT reserved FROM history_budget")).rows).toEqual(before.rows);
  expect(await saveSeries(db,"history_fundamentals","a",[{...p,revenue:{...p.revenue,value:4,source:"r2"}}])).toBe(1);
});
it("rejects an over-budget batch atomically and allows the next UTC month's allowance",async()=>{
  const now=new Date("2026-10-31T23:59:59Z");
  await db.execute({sql:"INSERT INTO history_budget VALUES(?,?)",args:["2026-10",HISTORY_WRITE_LIMIT-1]});
  const statement={sql:"INSERT INTO history_fetches VALUES(?,?)",args:["x","{}"]};
  await expect(budgetedWrite(db,[statement],now)).rejects.toBeInstanceOf(HistoryBudgetExceeded);
  expect((await db.execute("SELECT * FROM history_fetches")).rows).toHaveLength(0);
  await budgetedWrite(db,[statement],new Date("2026-11-01T00:00:00Z"));
  expect((await db.execute("SELECT * FROM history_fetches")).rows).toHaveLength(1);
});
it("queries bounded date ranges with stable cursors and keeps missing valuations explicit",async()=>{
  await saveAsset(db,"a",{name:"A"});
  const points:MarketDay[]=["2020-01-01","2020-01-02"].map(day=>({day,price:1,mcap:10,fdv:null,marketAt:`${day}T00:00:00Z`,fdvAt:null,marketSource:"s",fdvSource:null,basis:"utc_midnight"}));
  await saveSeries(db,"history_market","a",points);
  const result=await queryHistory(db,{slug:"a",days:30,from:"2020-01-01",to:"2020-01-03",after:"2019-12-31",limit:1});
  expect(result?.nextCursor).toBe("2020-01-01");expect(result?.points[0].valuation).toBeNull();
  expect((await queryHistory(db,{slug:"a",days:30,from:"2020-01-01",to:"2020-01-03",after:result!.nextCursor!,limit:1}))?.points[0].day).toBe("2020-01-02");
});
it("returns the dated denominator evidence and rejects a replaced token's old market points",async()=>{
  await saveAsset(db,"a",{name:"A",identity:"gecko:current"});
  const p:MarketDay={day:"2020-01-02",price:1,mcap:10,fdv:null,marketAt:"2020-01-02T00:00:00Z",fdvAt:null,marketSource:"market",fdvSource:null,basis:"utc_midnight",identity:"gecko:current"};
  await saveSeries(db,"history_market","a",[p,{...p,day:"2020-01-01",identity:"gecko:old"}]);
  await saveSeries(db,"history_fundamentals","a",[{day:"2020-01-01",revenue:{value:3,state:"complete",scope:"r",source:"revenue"},holders:{value:null,state:"missing",scope:"",source:""}}]);
  await saveSources(db,[{id:"revenue",url:"source",observedAt:"2026-01-01",archiveUrl:"archive",sha256:"a".repeat(64)}]);
  const result=await queryHistory(db,{slug:"a",days:1,from:"2020-01-01",to:"2020-01-03",after:"2019-12-31",limit:1000});
  expect(result?.points.map(p=>p.day)).toEqual(["2020-01-02"]);
  expect(result?.fundamentals[0].revenue.value).toBe(3);
  expect(result?.sources[0].id).toBe("revenue");
});
it("withholds a stored multiple while its market input is being updated",async()=>{
  await saveAsset(db,"a",{identityStatus:"verified"});
  const flow:FundamentalDay={day:"2020-01-01",revenue:{value:10,state:"complete",scope:"r",source:"r"},holders:{value:5,state:"complete",scope:"h",source:"h"}};
  const market:MarketDay={day:"2020-01-02",price:1,mcap:3650,fdv:null,marketAt:"2020-01-02T00:00:00Z",fdvAt:null,marketSource:"m",fdvSource:null,basis:"utc_midnight"};
  await saveSeries(db,"history_fundamentals","a",[flow]);
  await saveSeries(db,"history_market","a",[market]);
  await saveSeries(db,"history_valuations","a",calculateDailyValuations([flow],[market],true));
  const q={slug:"a",days:1,from:"2020-01-01",to:"2020-01-03",after:"2019-12-31",limit:10};
  expect((await queryHistory(db,q))?.points[0].valuation?.prMcap).toBe(1);
  const changed={...market,mcap:7300};await saveSeries(db,"history_market","a",[changed]);
  expect((await queryHistory(db,q))?.points[0]).toMatchObject({valuation:null,valuationState:"updating"});
  await saveSeries(db,"history_valuations","a",calculateDailyValuations([flow],[changed],true));
  expect((await queryHistory(db,q))?.points[0].valuation?.prMcap).toBe(2);
});
