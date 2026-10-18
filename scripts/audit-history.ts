import { writeFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { connectHistory, queryHistory, readSeries, storageBytes } from "../lib/historyDatabase";
import { shiftDay, type FundamentalDay } from "../lib/dailyHistory";

async function main() {
  const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]??fallback;};
  const local=arg("--local","");
  const db=local?createClient({url:`file:${local.replaceAll("\\","/")}`}):connectHistory();
  try {
    const counts:Record<string,unknown>={};
    for(const table of ["history_fundamentals","history_market","history_valuations"])
      counts[table]=(await db.execute(`SELECT count(*) AS rows,min(day) AS firstDay,max(day) AS lastDay FROM ${table}`)).rows[0];
    counts.assets=(await db.execute("SELECT count(*) AS n FROM history_assets")).rows[0].n;
    counts.monthlyReservedWrites=(await db.execute("SELECT month,reserved FROM history_budget")).rows;
    const checks=[];
    for(const slug of ["parent#maker","parent#aave","ethereum"]) {
      const result=await queryHistory(db,{slug,days:30,from:"2000-01-01",to:new Date().toISOString().slice(0,10),after:"1999-12-31",limit:1000});
      if(!result?.points.length)throw Error(`Missing representative history: ${slug}`);
      const flows=await readSeries<FundamentalDay>(db,"history_fundamentals",slug);
      let checked=0;
      for(const p of result.points.filter((_,i)=>i%30===0||i===result.points.length-1)) {
        const window=flows.filter(f=>f.day>=shiftDay(p.day,-30)&&f.day<p.day);
        for(const [metric,capital,field] of [["revenue","mcap","prMcap"],["revenue","fdv","prFdv"],["holders","mcap","phrMcap"],["holders","fdv","phrFdv"]] as const) {
          const stored=p.valuation?.[field] as number|null|undefined;
          if(stored==null)continue;
          if(window.length!==30||window.some(f=>f[metric].state!=="complete"||f[metric].value===null)||new Set(window.map(f=>f[metric].scope)).size!==1||!p[capital])throw Error(`Invalid nonnull multiple: ${slug}/${p.day}/${field}`);
          const denominator=window.reduce((sum,f)=>sum+f[metric].value!,0);
          const independentlyCalculated=p[capital]!/(denominator/30*365);
          if(denominator<=0||Math.abs(stored-independentlyCalculated)>Math.max(1,Math.abs(stored))*1e-8)throw Error(`Arithmetic mismatch: ${slug}/${p.day}/${field}`);
          checked++;
        }
      }
      if(!checked)throw Error(`No representative multiples were verified: ${slug}`);
      checks.push({slug,sourceFrom:result.asset.sourceFrom,marketFrom:result.asset.marketFrom,marketDays:result.points.length,fdvDays:result.points.filter(p=>p.fdv!==null).length,checkedMultiples:checked,last:result.points.at(-1)});
    }
    const report={at:new Date().toISOString(),passed:true,counts,storageBytes:await storageBytes(db),checks};
    const output=arg("--output","");if(output)await writeFile(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }finally{db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Historical audit failed");process.exitCode=1;});
