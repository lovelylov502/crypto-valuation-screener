import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { fetchCoins } from "../lib/sources";
import { scoreCoins } from "../lib/valuation";
import { assembleScreener } from "../lib/screener";
import { fundamentalErrors } from "../lib/fundamentalContract";
import { holderMultiple, holderAmount, salesMultiple } from "../lib/valuationMetrics";
import type { CoinScored, SourceObservation } from "../lib/types";

async function main() {
  const out = resolve(process.argv[2] ?? "audit-output");
  const baselineRoot = process.argv[3];
  if (!baselineRoot) throw new Error("Supply the read-only baseline checkout path");
  await mkdir(out, { recursive:true });
  const replayRoot = process.argv[4] ? resolve(process.argv[4]) : null;
  const replayReceipts: {url:string;status:number;file:string}[] = replayRoot ? JSON.parse(await readFile(resolve(replayRoot,"source-manifest.json"),"utf8")) : [];
  const originalFetch=globalThis.fetch;
  const pending=new Map<string,Promise<{body:string,status:number}>>();
  const receipts: {url:string;status:number;sha256:string;bytes:number;file:string}[]=[];
  globalThis.fetch=(async (input: string|URL|Request) => {
    const url=String(input);
    if (!/^https:\/\/(api\.llama\.fi|stablecoins\.llama\.fi|api\.coingecko\.com|pro-api\.coinmarketcap\.com)\//.test(url)) throw new Error("Unexpected source URL");
    if(!pending.has(url)) pending.set(url,(async()=>{
      const receipt = replayReceipts.find(r=>r.url===url && r.status===200);
      const response=receipt ? new Response(gunzipSync(await readFile(resolve(replayRoot!,receipt.file))).toString("utf8"), {status:200}) : await originalFetch(url,{signal:AbortSignal.timeout(60000),headers:{accept:"application/json"}});
      const body=await response.text(), key=createHash("sha256").update(url).digest("hex").slice(0,16), file=key+".json.gz";
      await writeFile(resolve(out,file),gzipSync(body));
      receipts.push({url,status:response.status,sha256:createHash("sha256").update(body).digest("hex"),bytes:Buffer.byteLength(body),file});
      return {body,status:response.status};
    })());
    const r=await pending.get(url)!;
    return new Response(r.body,{status:r.status,headers:{"content-type":"application/json"}});
  }) as typeof fetch;
  const oldSources=await import(pathToFileURL(resolve(baselineRoot,"lib/sources.ts")).href);
  const oldScreener=await import(pathToFileURL(resolve(baselineRoot,"lib/screener.ts")).href);
  const oldObservations:SourceObservation[]=[], newObservations:SourceObservation[]=[];
  const beforeRaw=await oldSources.fetchCoins(oldObservations);
  const afterRaw=await fetchCoins(newObservations);
  const at=new Date().toISOString();
  const before=oldScreener.assembleScreener(beforeRaw,at,oldObservations);
  const after=assembleScreener(afterRaw,at,newObservations);
  const beforeMap=new Map<string,CoinScored>(before.coins.map((c:CoinScored)=>[c.slug,c]));
  const afterMap=new Map<string,CoinScored>(after.coins.map(c=>[c.slug,c]));
  const directoryReceipt = receipts.find(r => r.url === "https://api.llama.fi/protocols");
  const directory = directoryReceipt ? JSON.parse((await pending.get(directoryReceipt.url)!).body) : [];
  const parentBySlug = new Map<string,string>(directory.filter((p:{slug?:string;parentProtocol?:string}) => p.slug && p.parentProtocol).map((p:{slug:string;parentProtocol:string}) => [p.slug,p.parentProtocol]));
  const all=[...new Set([...beforeMap.keys(),...afterMap.keys()])].sort();
  const failures:string[]=[];
  for (const c of scoreCoins(afterRaw,at)) for (const e of fundamentalErrors(c)) failures.push("raw "+c.slug+":"+e);
  const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const rows=all.map(slug=>{
    const a=beforeMap.get(slug),b=afterMap.get(slug);
    const changedFields:string[]=[];
    if(a&&b) for(const k of ["mcap","fdv","price","cmcId","symbol","geckoId","identityStatus","capitalExclusionReason","tvl","revenue30d","fees30d","holderValue","scoreAxes","valueScore","status","valueCapture","confidence","confidenceGrade","gates","scoreNotes","peerCounts","sectorPercentiles"] as const) if(!equal(a[k] ?? null,b[k] ?? null)) changedFields.push(k);
    if(a&&b) for (const key of ["phr","revenueMultiple","pf","mcapTvl","fdvTvl","dilution"] as const) if(!equal(a.multiples[key],b.multiples[key])) changedFields.push(key);
    if(a&&b&&!equal(a.opportunities,b.opportunities)) changedFields.push("opportunities");
    if(b) {
      const errors=fundamentalErrors(b);
      if(errors.length) failures.push(slug+":"+errors.join(","));
      for(const days of [7,30,90,365] as const) {
        const n=holderMultiple(b,days), amount=holderAmount(b,days);
        if(n!==null && (amount===null || b.holderHistory?.periods[days].reportedDays!==days || Math.abs(n-b.mcap!/(amount*365/days))>Math.max(1,n)*1e-10)) failures.push(slug+":holder "+days);
      }
      if(b.multiples.psSales!==null && (!b.sales || b.sales.status!=="current" || Math.abs(b.multiples.psSales-b.mcap!/b.sales.amountUsd)>1e-8)) failures.push(slug+":sales");
      if(b.price!==null&&b.circulatingSupply!==null&&b.mcap!==null&&b.cmcId!==null&&Math.abs(b.price*b.circulatingSupply/b.mcap-1)>.05) failures.push(slug+":market cap does not reconcile");
    }
    const nextRaw=afterRaw.find(c=>c.slug===slug);
    const parent = parentBySlug.get(slug);
    const removalReason = !b ? parent && afterRaw.some(c=>c.slug===parent) ? "grouped_into_parent" : nextRaw ? "below_market_cap_screen_threshold" : "no_supported_market_or_tvl_identity" : null;
    return {parent:parent??null,removalReason,slug,name:b?.name??a!.name,symbol:b?.symbol??a!.symbol,disposition:!a?"added":!b?"removed_or_grouped":changedFields.length?"changed":"unchanged",changedFields,
      before:a?{mcap:a.mcap,cmcId:a.cmcId,phr:a.multiples.phr,revenueMultiple:a.multiples.revenueMultiple,valueScore:a.valueScore}:null,
      after:b?{mcap:b.mcap,cmcId:b.cmcId,ps:salesMultiple(b),psFdv:salesMultiple(b,"fdv"),pr:b.multiples.pr,phr:b.multiples.phr,valueScore:b.valueScore}:null,
      rawStillPresent:!!nextRaw,excludedRaw:!b && nextRaw ? {mcap:nextRaw.mcap,cmcId:nextRaw.cmcId,fdv:nextRaw.fdv,identityReason:nextRaw.identityReason}:null,identity:b?.identityStatus??nextRaw?.identityStatus??null,
      sales:b?.sales?.status??"no separate sales evidence",revenueKind:b?.fundamentals.revenue.kind??null,
      definitionStatuses:b?[...new Set([...b.fundamentals.revenue.components,...b.fundamentals.fees.components,...b.fundamentals.holders].map(p=>p.status))]:[],
      holderDays:b?.holderHistory?Object.fromEntries([7,30,90,365].map(n=>[n,b.holderHistory!.periods[n as 7|30|90|365].reportedDays])):null,
      issues:b?.opportunities.dataIssues??[]};
  });
  const stats={at,replayedFrom:replayRoot,sourceCollectionAt:replayRoot ? (JSON.parse(await readFile(resolve(replayRoot,"audit.json"),"utf8")).stats.sourceCollectionAt ?? JSON.parse(await readFile(resolve(replayRoot,"audit.json"),"utf8")).stats.at) : at,beforeUniverseRows:beforeRaw.length,afterUniverseRows:afterRaw.length,allRawRowsContractChecked:afterRaw.length,beforeRows:before.coins.length,afterRows:after.coins.length,examinedUnion:rows.length,
    changed:rows.filter(r=>r.disposition==="changed").length,removedOrGrouped:rows.filter(r=>r.disposition==="removed_or_grouped").length,added:rows.filter(r=>r.disposition==="added").length,
    removalsByReason:Object.fromEntries(["grouped_into_parent","below_market_cap_screen_threshold","no_supported_market_or_tvl_identity"].map(k=>[k,rows.filter(r=>r.removalReason===k).length])),
    capitalExclusions:after.coins.filter(c=>c.capitalExclusionReason).map(c=>c.slug),
    numeratorChanges:rows.filter(r=>r.changedFields.some(f=>["mcap","fdv","cmcId","price"].includes(f))).length,
    phrChanges:rows.filter(r=>r.changedFields.includes("phr")).length,scoreChanges:rows.filter(r=>r.changedFields.includes("valueScore")).length,
    sales:after.coins.filter(c=>c.multiples.psSales!==null).length,pr:after.coins.filter(c=>c.multiples.pr!==null).length,
    phr:Object.fromEntries(([7,30,90,365] as const).map(n=>[n,after.coins.filter(c=>holderMultiple(c,n)!==null).length])),
    failures, sourceFailures:receipts.filter(r=>r.status!==200).map(r=>r.url),payloadBytes:Buffer.byteLength(JSON.stringify(after)),
    scope:"Same public source responses replayed into v6 and v7. Every screenable row checked. Provider definitions and formulas are checked; this is not an independent financial/onchain audit of every protocol."};
  await writeFile(resolve(out,"audit.json"),JSON.stringify({stats,rows},null,2));
  await writeFile(resolve(out,"source-manifest.json"),JSON.stringify(receipts,null,2));
  await writeFile(resolve(out,"before.json.gz"),gzipSync(JSON.stringify(before)));
  await writeFile(resolve(out,"after.json.gz"),gzipSync(JSON.stringify(after)));
  await writeFile(resolve(out,"inputs-after.json.gz"),gzipSync(JSON.stringify(afterRaw)));
  console.log(JSON.stringify(stats,null,2));
  if(failures.length||stats.sourceFailures.length||stats.payloadBytes>=4500000) process.exitCode=1;
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1;});

