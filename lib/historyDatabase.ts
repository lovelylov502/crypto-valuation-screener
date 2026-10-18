import { createClient, type Client, type InStatement } from "@libsql/client";
import { calculateDailyValuations, historyHash, HISTORY_VERSION, shiftDay, type FundamentalDay, type MarketDay, type ValuationDay, type HistorySource } from "./dailyHistory";
import { eligibleCapital } from "./capitalEligibility";

const statistics=new WeakMap<Client,{readRequests:number;rowsReturned:number;writeBatches:number;statementsWritten:number}>();
export function historyDatabaseStats(db:Client) {
  let stats=statistics.get(db);
  if(!stats){stats={readRequests:0,rowsReturned:0,writeBatches:0,statementsWritten:0};statistics.set(db,stats);}
  return stats;
}

// Keep headroom below Turso Free's 10M monthly writes / 5GB. A PK write is conservatively charged twice.
export const HISTORY_WRITE_LIMIT = 8_000_000;
export const HISTORY_STORAGE_LIMIT = 4_000_000_000;
export function connectHistory() {
  const url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw Error("History database is not configured");
  if (!/^libsql:\/\/[a-z0-9.-]+\.turso\.io$/.test(url)) throw Error("Invalid history database URL");
  return createClient({ url, authToken });
}

async function retryDisconnectedRead<T>(db:Client, read:()=>Promise<T>):Promise<T> {
  try {return await read();} catch(error) {
    // A long source decode can outlive an idle HTTP socket. Retry only reads;
    // an interrupted write may already have committed its quota reservation.
    let disconnected=false;
    for(let cause:unknown=error,depth=0;cause&&typeof cause==="object"&&depth<5;depth++){
      if("code" in cause&&["UND_ERR_SOCKET","ECONNRESET","EPIPE"].includes(String(cause.code)))disconnected=true;
      cause="cause" in cause?cause.cause:null;
    }
    if(!disconnected)throw error;
    await db.reconnect();
    await new Promise(resolve=>setTimeout(resolve,250));
    return read();
  }
}
export function historyRead(db:Client, statement:InStatement) {
  const sql=typeof statement==="string"?statement:statement.sql;
  if(!/^\s*SELECT\b/i.test(sql))throw Error("History read requires SELECT");
  return retryDisconnectedRead(db,async()=>{
    const stats=historyDatabaseStats(db);stats.readRequests++;
    const result=await db.execute(statement);stats.rowsReturned+=result.rows.length;return result;
  });
}
export function historyReadBatch(db:Client, statements:InStatement[]) {
  for(const statement of statements)if(!/^\s*SELECT\b/i.test(typeof statement==="string"?statement:statement.sql))throw Error("History read requires SELECT");
  return retryDisconnectedRead(db,async()=>{
    const stats=historyDatabaseStats(db);stats.readRequests++;
    const results=await db.batch(statements,"read");stats.rowsReturned+=results.reduce((n,r)=>n+r.rows.length,0);return results;
  });
}

export async function initializeHistory(db: Client) {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS history_assets (slug TEXT PRIMARY KEY, payload TEXT NOT NULL, content_hash TEXT NOT NULL) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS history_sources (id TEXT PRIMARY KEY, payload TEXT NOT NULL) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS history_fundamentals (slug TEXT NOT NULL, day TEXT NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL, PRIMARY KEY(slug,day)) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS history_market (slug TEXT NOT NULL, day TEXT NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL, PRIMARY KEY(slug,day)) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS history_valuations (slug TEXT NOT NULL, days INTEGER NOT NULL, day TEXT NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL, PRIMARY KEY(slug,days,day)) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS history_fetches (id TEXT PRIMARY KEY, payload TEXT NOT NULL) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS history_runs (id TEXT PRIMARY KEY, payload TEXT NOT NULL) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS history_budget (month TEXT PRIMARY KEY, reserved INTEGER NOT NULL CHECK(reserved<=8000000)) WITHOUT ROWID`,
  ], "write");
}

export class HistoryBudgetExceeded extends Error {}
export async function storageBytes(db: Client) {
  const [count, size] = await retryDisconnectedRead(db,async()=>{
    const stats=historyDatabaseStats(db);stats.readRequests++;
    const results=await db.batch(["PRAGMA page_count", "PRAGMA page_size"], "read");stats.rowsReturned+=2;return results;
  });
  return Number(count.rows[0][0]) * Number(size.rows[0][0]);
}

/** The quota reservation and data writes commit atomically; concurrent jobs cannot overspend it. */
export async function budgetedWrite(db: Client, statements: InStatement[], now = new Date()) {
  if (!statements.length) return;
  if (statements.length > 500) throw Error("History write batch exceeds 500 statements");
  const size = await storageBytes(db);
  const bytes = Buffer.byteLength(JSON.stringify(statements)) * 2;
  if (size + bytes >= HISTORY_STORAGE_LIMIT) throw new HistoryBudgetExceeded("history_storage_budget");
  const month = now.toISOString().slice(0, 7), cost = statements.length * 2 + 4;
  try {
    const stats=historyDatabaseStats(db);stats.writeBatches++;stats.statementsWritten+=statements.length+1;
    await db.batch([{sql:"INSERT INTO history_budget(month,reserved) VALUES(?,?) ON CONFLICT(month) DO UPDATE SET reserved=reserved+excluded.reserved",args:[month,cost]},...statements],"write");
  } catch(error) {
    if(error instanceof Error&&/CHECK constraint failed.*reserved/i.test(error.message))throw new HistoryBudgetExceeded("history_monthly_write_budget");
    throw error;
  }
}

export async function writeHistoryChunks(db: Client, statements: InStatement[]) {
  for (let i=0;i<statements.length;i+=500) await budgetedWrite(db,statements.slice(i,i+500));
  return statements.length;
}
export type SeriesTable = "history_fundamentals" | "history_market" | "history_valuations";
export const seriesKey=(point:{day:string;days?:number})=>`${point.day}:${point.days??""}`;
export function historyContentHash(table:SeriesTable,point:FundamentalDay|MarketDay|ValuationDay) {
  // New receipts with unchanged financial evidence retain their original witness.
  const content=table==="history_fundamentals"?(()=>{const p=point as FundamentalDay;return [p.day,p.revenue.value,p.revenue.state,p.revenue.scope,p.holders.value,p.holders.state,p.holders.scope];})():point;
  return historyHash([HISTORY_VERSION,content]);
}
export async function readSeries<T>(db: Client, table: SeriesTable, slug: string): Promise<T[]> {
  const result = await historyRead(db,{sql:`SELECT payload FROM ${table} WHERE slug=? ORDER BY day`, args:[slug]});
  return result.rows.map(row=>JSON.parse(String(row.payload)) as T);
}

export async function saveSeries(db: Client, table: SeriesTable, slug: string, points: (FundamentalDay | MarketDay | ValuationDay)[]) {
  if(!points.length)return 0;
  const dates=points.map(p=>p.day).sort();
  const existing = await historyRead(db,{sql:`SELECT day,${table === "history_valuations" ? "days," : ""}content_hash FROM ${table} WHERE slug=? AND day>=? AND day<=?`,args:[slug,dates[0],dates.at(-1)!]});
  const hashes = new Map(existing.rows.map(r=>[`${r.day}:${r.days ?? ""}`,String(r.content_hash)]));
  return writeHistoryChunks(db,seriesStatements(table,slug,points,hashes));
}
export function seriesStatements(table:SeriesTable,slug:string,points:(FundamentalDay|MarketDay|ValuationDay)[],hashes:Map<string,string>) {
  const statements: InStatement[] = [];
  for (const point of points) {
    const hash = historyContentHash(table,point), days = "days" in point ? point.days : undefined;
    if (hashes.get(`${point.day}:${days ?? ""}`) === hash) continue;
    const payload=JSON.stringify(point);
    statements.push(days === undefined
      ? {sql:`INSERT INTO ${table}(slug,day,payload,content_hash) VALUES(?,?,?,?) ON CONFLICT(slug,day) DO UPDATE SET payload=excluded.payload,content_hash=excluded.content_hash`,args:[slug,point.day,payload,hash]}
      : {sql:`INSERT INTO ${table}(slug,days,day,payload,content_hash) VALUES(?,?,?,?,?) ON CONFLICT(slug,days,day) DO UPDATE SET payload=excluded.payload,content_hash=excluded.content_hash`,args:[slug,days,point.day,payload,hash]});
  }
  return statements;
}

export async function saveSources(db: Client, sources: HistorySource[]) {
  const statements: InStatement[]=[];
  const ids=new Set<string>();
  for(let i=0;i<sources.length;i+=400){
    const wanted=sources.slice(i,i+400).map(s=>s.id);
    for(const row of (await historyRead(db,{sql:`SELECT id FROM history_sources WHERE id IN (${wanted.map(()=>"?").join(",")})`,args:wanted})).rows)ids.add(String(row.id));
  }
  for (const source of sources) {
    if (!ids.has(source.id)) {statements.push({sql:"INSERT OR IGNORE INTO history_sources(id,payload) VALUES(?,?)",args:[source.id,JSON.stringify(source)]});ids.add(source.id);}
  }
  return writeHistoryChunks(db,statements);
}
export const assetStatement=(slug:string,payload:unknown):InStatement=>({sql:"INSERT INTO history_assets(slug,payload,content_hash) VALUES(?,?,?) ON CONFLICT(slug) DO UPDATE SET payload=excluded.payload,content_hash=excluded.content_hash",args:[slug,JSON.stringify(payload),historyHash(payload)]});
export async function saveAsset(db: Client, slug: string, payload: unknown) {
  const hash=historyHash(payload);
  const row=await historyRead(db,{sql:"SELECT content_hash FROM history_assets WHERE slug=?",args:[slug]});
  if(row.rows[0]?.content_hash===hash)return 0;
  await budgetedWrite(db,[assetStatement(slug,payload)]);
  return 1;
}
export async function getRecord<T>(db: Client, table:"history_fetches"|"history_runs", id:string):Promise<T|null> {
  const r=await historyRead(db,{sql:`SELECT payload FROM ${table} WHERE id=?`,args:[id]});
  return r.rows.length?JSON.parse(String(r.rows[0].payload)) as T:null;
}
export async function setRecord(db: Client, table:"history_fetches"|"history_runs", id:string, payload:unknown) {
  await budgetedWrite(db,[{sql:`INSERT INTO ${table}(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`,args:[id,JSON.stringify(payload)]}]);
}

export interface HistoryQuery { slug:string; days:number; from:string; to:string; after:string; limit:number }
export async function queryHistory(db:Client,q:HistoryQuery) {
  const asset=await historyRead(db,{sql:"SELECT payload FROM history_assets WHERE slug=?",args:[q.slug]});
  if(!asset.rows.length)return null;
  const info=JSON.parse(String(asset.rows[0].payload));
  const result=await historyRead(db,{sql:`SELECT m.day,m.payload AS market,v.payload AS valuation FROM history_market m
    LEFT JOIN history_valuations v ON v.slug=m.slug AND v.days=? AND v.day=m.day
    WHERE m.slug=? AND m.day>=? AND m.day<=? AND m.day>? AND COALESCE(json_extract(m.payload,'$.identity'),'')=? ORDER BY m.day LIMIT ?`,args:[q.days,q.slug,q.from,q.to,q.after,info.identity??"",q.limit+1]});
  const rows=result.rows.slice(0,q.limit);
  const points=rows.map(r=>({...(JSON.parse(String(r.market)) as MarketDay),valuation:r.valuation?JSON.parse(String(r.valuation)) as ValuationDay:null,valuationState:r.valuation?"ready":"unavailable"}));
  const flowResult=points.length?await historyRead(db,{sql:"SELECT payload FROM history_fundamentals WHERE slug=? AND day>=? AND day<=? ORDER BY day",args:[q.slug,shiftDay(points[0].day,-q.days),shiftDay(points.at(-1)!.day,-1)]}):{rows:[]};
  const fundamentals=flowResult.rows.map(r=>JSON.parse(String(r.payload)) as FundamentalDay);
  // A batch can be observed between its market and valuation commits. Never
  // return an old stored multiple alongside newly updated inputs.
  const expected=new Map(calculateDailyValuations(fundamentals,points,eligibleCapital(info),[q.days]).map(v=>[v.day,v]));
  for(const point of points)if(point.valuation){
    const value=expected.get(point.day)!;
    const agrees=(Object.keys(value) as (keyof ValuationDay)[]).every(key=>{
      const actual=point.valuation![key],wanted=value[key];
      return typeof actual==="number"&&typeof wanted==="number"?Math.abs(actual-wanted)<=Math.max(1,Math.abs(wanted))*1e-8:actual===wanted;
    });
    if(!agrees||info.reconciliationState==="updating"){point.valuation=null;point.valuationState="updating";}
  }
  // The writer marks an asset before changing any input. A query which began
  // just before that marker must also withhold its ratios if the marker moved.
  const finalAsset=await historyRead(db,{sql:"SELECT payload FROM history_assets WHERE slug=?",args:[q.slug]});
  if(String(finalAsset.rows[0]?.payload)!==String(asset.rows[0].payload))for(const point of points){point.valuation=null;point.valuationState="updating";}
  const ids=[...new Set([...points.flatMap(p=>[p.marketSource,p.fdvSource]),...fundamentals.flatMap(p=>[p.revenue.source,p.holders.source])].filter((s):s is string=>!!s))];
  const sources=ids.length?await historyRead(db,{sql:`SELECT payload FROM history_sources WHERE id IN (${ids.map(()=>"?").join(",")})`,args:ids}):{rows:[]};
  return {schema:1,calculationVersion:HISTORY_VERSION,asset:info,days:q.days,
    convention:"UTC date D quote; trailing completed revenue dates end D-1. Actual quote times retained. Historical revenues may be revised by the provider.",
    points,fundamentals,sources:sources.rows.map(r=>JSON.parse(String(r.payload))),nextCursor:result.rows.length>q.limit?String(rows.at(-1)!.day):null};
}
