import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createClient, type InValue } from "@libsql/client";
import { budgetedWrite, connectHistory, initializeHistory, setRecord, storageBytes } from "../lib/historyDatabase";

/** Resumable import of the locally audited database. Never copies its quota counter. */
async function main() {
  const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]??fallback;};
  const cache=resolve(arg("--cache","snapshot-output/history-cache"));
  const local=createClient({url:`file:${join(cache,arg("--database","history.sqlite")).replaceAll("\\","/")}`}),remote=connectHistory();
  let writes=0;
  const counts:Record<string,number>={};
  try {
    await initializeHistory(remote);
    for(const [table,keys] of [
      ["history_sources",["id"]], ["history_fundamentals",["slug","day"]],
      ["history_market",["slug","day"]], ["history_valuations",["slug","days","day"]],
      ["history_assets",["slug"]], ["history_fetches",["id"]],
    ] as const) {
      if(process.argv.includes("--fundamentals-only")&&table!=="history_sources"&&table!=="history_fundamentals")continue;
      let cursor:InValue[]=[];counts[table]=0;
      const tuple=`(${keys.join(",")})`,slots=`(${keys.map(()=>"?").join(",")})`;
      const empty=!(await remote.execute(`SELECT 1 FROM ${table} LIMIT 1`)).rows.length;
      while(true) {
        const chunk=await local.execute({sql:`SELECT * FROM ${table} ${cursor.length?`WHERE ${tuple}>${slots}`:""} ORDER BY ${keys.join(",")} LIMIT ${table==="history_fetches"?5:500}`,args:cursor});
        if(!chunk.rows.length)break;
        const first=keys.map(k=>chunk.rows[0][k] as InValue),last=keys.map(k=>chunk.rows.at(-1)![k] as InValue);
        const old=empty?{rows:[]}:await remote.execute({sql:`SELECT * FROM ${table} WHERE ${tuple}>=${slots} AND ${tuple}<=${slots}`,args:[...first,...last]});
        const previous=new Map(old.rows.map(r=>[JSON.stringify(keys.map(k=>r[k])),String(r.content_hash??r.payload)]));
        const changed=chunk.rows.filter(r=>previous.get(JSON.stringify(keys.map(k=>r[k])))!==String(r.content_hash??r.payload));
        const columns=chunk.columns;
        await budgetedWrite(remote,changed.map(r=>({sql:`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")}) ON CONFLICT(${keys.join(",")}) DO UPDATE SET ${columns.filter(c=>!(keys as readonly string[]).includes(c)).map(c=>`${c}=excluded.${c}`).join(",")}`,args:columns.map(c=>r[c] as InValue)})));
        writes+=changed.length;counts[table]+=chunk.rows.length;cursor=last;
        if(counts[table]%50_000===0)console.log(JSON.stringify({table,rows:counts[table],writes}));
      }
      console.log(JSON.stringify({table,rows:counts[table],writes}));
    }
    const report=JSON.parse(await readFile(join(cache,"history-report.json"),"utf8"));
    if(!process.argv.includes("--fundamentals-only"))await setRecord(remote,"history_runs",report.runId,report);
    const result={counts,writes,storageBytes:await storageBytes(remote),at:new Date().toISOString()};
    await writeFile(join(cache,"published-report.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally {local.close();remote.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"History upload failed");process.exitCode=1;});
