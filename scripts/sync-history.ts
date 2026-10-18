import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { calculateDailyValuations, extractFundamentals, historyHash, historyIdentity, mergeMarket, parseMarketChart, snapshotMarket, HISTORY_VERSION, type FundamentalDay, type HistorySource, type MarketDay } from "../lib/dailyHistory";
import { connectHistory, getRecord, historyRead, initializeHistory, readSeries, saveAsset, saveSeries, saveSources, setRecord, storageBytes, HistoryBudgetExceeded } from "../lib/historyDatabase";
import { fetchHistoricalMarket, HistoryProviderDeferred, loadArchivedSnapshot, loadHistoryInputs } from "../lib/historyCollection";
import { eligibleCapital } from "../lib/capitalEligibility";
import { parseJournal } from "../lib/snapshotArchive";
import type { CoinRaw } from "../lib/types";
import type { SourceReceipt } from "../lib/sourceBundle";

async function main() {
const argv=process.argv.slice(2);
const arg=(name:string,fallback:string)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1]??fallback;};
const cache=resolve(arg("--cache","snapshot-output/history-cache"));
const maxMarket=Number(arg("--max-market","80"));
if(!Number.isInteger(maxMarket)||maxMarket<0||maxMarket>5000)throw Error("Invalid market request budget");
const timeBudget=Number(arg("--time-budget-seconds","2400"));
if(!Number.isInteger(timeBudget)||timeBudget<1||timeBudget>2400)throw Error("Invalid history time budget");
await mkdir(cache,{recursive:true});
const db=argv.includes("--local")?createClient({url:`file:${join(cache,arg("--database","history.sqlite")).replaceAll("\\","/")}`}):connectHistory();
const startedAt=new Date().toISOString(),runId=`history-${startedAt.replace(/[^0-9]/g,"")}`;
const report={schema:1,runId,calculationVersion:HISTORY_VERSION,startedAt,completedAt:"",snapshot:"",assets:0,fundamentalWrites:0,marketWrites:0,valuationWrites:0,marketFetched:0,marketRequests:0,marketPending:0,reconciliationPending:0,storageBytes:0,status:"running",issues:[] as {scope:string;reason:string}[]};
const fail=(scope:string,error:unknown)=>{
  const codes:string[]=[];
  for(let cause:unknown=error,depth=0;cause&&typeof cause==="object"&&depth<5;depth++){
    if("code" in cause&&typeof cause.code==="string"&&/^[A-Z0-9_]+$/.test(cause.code))codes.push(cause.code);
    cause="cause" in cause?cause.cause:null;
  }
  report.issues.push({scope,reason:`${error instanceof Error?error.message:String(error)}${codes.length?` [${codes.join(" > ")}]`:""}`});
};
const archiveTag=arg("--archive-tag",runId);
const marketArchive=`https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${archiveTag}/market-sources.json.gz`;
const captured:SourceReceipt[]=[];
let fundamentalDay="";
let previousFundamentalDay="";
let phase="initialize";
try {
  await initializeHistory(db);
  const last=await getRecord<{completedAt:string;fundamentalDay?:string;marketPending?:number}>(db,"history_fetches","sync:last");
  previousFundamentalDay=last?.fundamentalDay??"";
  if(!argv.includes("--local")&&!argv.includes("--force")&&last&&Date.parse(startedAt)-Date.parse(last.completedAt)<5*3600_000){report.status="not-due";return;}
  await writeFile(join(cache,"history-report.json"),JSON.stringify(report,null,2));
  phase="load-inputs";
  const {snapshot,bundle,ref}=await loadHistoryInputs(cache);
  report.snapshot=ref.id;
  fundamentalDay=snapshot.updatedAt.slice(0,10);
  const backfillOnly=!argv.includes("--local")&&!argv.includes("--reconcile")&&last?.fundamentalDay===fundamentalDay;
  if(backfillOnly&&last?.marketPending===0){report.status="not-due";return;}
  phase="extract-inputs";
  const inputs=extractFundamentals(bundle,ref.rawBundleUrl!);
  const current=new Map(snapshot.coins.map(c=>[c.slug,c]));
  const quotes=new Map<string,Map<string,MarketDay>>();
  const source= (url:string,at:string,hash:string):HistorySource=>({id:historyHash([url,at,hash]),url,observedAt:at,archiveUrl:url,sha256:hash});
  const sources=[...inputs.sources];
  const addSnapshot=(coins:CoinRaw[],url:string,at:string,hash:string)=>{
    const origin=source(url,at,hash);sources.push(origin);
    for(const coin of coins) {
      const target=current.get(coin.slug);if(!target)continue;
      const point=snapshotMarket(coin,target,origin.id,at);if(!point)continue;
      const rows=quotes.get(coin.slug)??new Map<string,MarketDay>();
      rows.set(point.day,mergeMarket(rows.get(point.day),point));quotes.set(coin.slug,rows);
    }
  };
  addSnapshot(snapshot.coins,ref.url,snapshot.updatedAt,ref.sha256);
  if(argv.includes("--archives")) {
    let releases:{tag:string;at:string;url:string}[];
    const metadata=join(cache,"release-index.json");
    try {releases=JSON.parse(await readFile(metadata,"utf8"));}
    catch {
      const r=spawnSync("gh",["api","repos/lovelylov502/crypto-valuation-screener/releases?per_page=100","--paginate","--slurp"],{encoding:"utf8",maxBuffer:200_000_000});
      if(r.status!==0)throw Error("Cannot list historical release metadata");
      const entries=JSON.parse(r.stdout).flat() as {tag_name:string;published_at:string;assets:{name:string;browser_download_url:string}[]}[];
      releases=entries.filter(p=>p.tag_name.endsWith("-complete")&&p.assets.some(a=>a.name==="state.json")).map(p=>({tag:p.tag_name,at:p.published_at,url:p.assets.find(a=>a.name==="state.json")!.browser_download_url}));
      await writeFile(metadata,JSON.stringify(releases));
    }
    const seenDays=new Set<string>();
    for(const release of releases.sort((a,b)=>b.at.localeCompare(a.at))) {
      if(seenDays.has(release.at.slice(0,10)))continue;
      if(!argv.includes("--replay-archives")&&await getRecord(db,"history_fetches",`archive:${release.tag}`)){seenDays.add(release.at.slice(0,10));continue;}
      try {
        const journalFile=join(cache,`journal-${release.tag}.json`);
        let journal;
        try{journal=JSON.parse(await readFile(journalFile,"utf8"));}catch{
          const response=await fetch(release.url,{signal:AbortSignal.timeout(30_000)});
          if(!response.ok)throw Error(`Archive journal HTTP ${response.status}`);
          journal=await response.json();await writeFile(journalFile,JSON.stringify(journal));
        }
        const pastRef=parseJournal(journal).published;if(!pastRef)continue;
        const past=await loadArchivedSnapshot(pastRef,cache);
        addSnapshot(past.coins,pastRef.url,past.updatedAt,pastRef.sha256);
        seenDays.add(release.at.slice(0,10));
        console.log(JSON.stringify({archivedDate:past.updatedAt.slice(0,10),release:release.tag}));
        // Checkpoints are committed only after the resulting market rows are persisted below.
        report.issues.push({scope:`archive-pending:${release.tag}`,reason:past.updatedAt});
      } catch(error) {fail(release.tag,error);}
    }
  }
  phase="save-sources";
  await saveSources(db,sources);
  phase="read-checkpoints";
  const complete=new Set((await historyRead(db,"SELECT id FROM history_fetches WHERE id LIKE 'gecko:%' AND json_extract(payload,'$.state')='complete'")).rows.map(r=>String(r.id)));
  const reconciled=new Set(!backfillOnly&&!argv.includes("--local")?(await historyRead(db,{sql:"SELECT slug FROM history_assets WHERE json_extract(payload,'$.reconciledDay')=?",args:[fundamentalDay]})).rows.map(r=>String(r.slug)):[]);
  const coins=[...snapshot.coins].filter(c=>!reconciled.has(c.slug)&&(!backfillOnly||eligibleCapital(c)&&c.geckoId&&!complete.has(`gecko:${c.geckoId}`)))
    .filter(c=>inputs.series.get(c.slug)?.length||quotes.has(c.slug)||eligibleCapital(c))
    .sort((a,b)=>Number(inputs.series.has(b.slug))-Number(inputs.series.has(a.slug))||(b.mcap??0)-(a.mcap??0)||a.slug.localeCompare(b.slug));
  const provider=await getRecord<{retryAt:string}>(db,"history_fetches","provider:coingecko");
  let marketStopped=!!provider&&provider.retryAt>startedAt;
  const marketById=new Map<string,MarketDay[]>();
  for(const coin of coins) {
    if(Date.now()-Date.parse(startedAt)>=timeBudget*1000){
      if(!backfillOnly)report.reconciliationPending++;
      if(eligibleCapital(coin)&&coin.geckoId&&!complete.has(`gecko:${coin.geckoId}`)&&!marketById.has(coin.geckoId))report.marketPending++;
      continue;
    }
    // Full source/valuation scans run once per UTC day. Other wakes only fill missing assets.
    if(backfillOnly&&(marketStopped||report.marketRequests>=maxMarket)){report.marketPending++;continue;}
    phase=`asset:${coin.slug}`;
    const freshFlows=inputs.series.get(coin.slug)??[];
    if(!freshFlows.length&&!quotes.has(coin.slug)&&!eligibleCapital(coin))continue;
    let flows=freshFlows;
    const oldFlows=await readSeries<FundamentalDay>(db,"history_fundamentals",coin.slug);
    if(oldFlows.length) {
      const merged=new Map(oldFlows.map(p=>[p.day,p]));
      for(const p of freshFlows)merged.set(p.day,p);
      flows=[...merged.values()].sort((a,b)=>a.day.localeCompare(b.day));
    }
    report.fundamentalWrites+=await saveSeries(db,"history_fundamentals",coin.slug,freshFlows);
    const markets=new Map((await readSeries<MarketDay>(db,"history_market",coin.slug)).filter(p=>p.identity===historyIdentity(coin)).map(p=>[p.day,p]));
    for(const p of quotes.get(coin.slug)?.values()??[])markets.set(p.day,mergeMarket(markets.get(p.day),p));
    if(eligibleCapital(coin)&&coin.geckoId) {
      const key=`gecko:${coin.geckoId}`;
      const previous=await getRecord<{state:string;retryAt?:string;points?:MarketDay[]}>(db,"history_fetches",key);
      if(previous?.state==="complete"&&previous.points&&!marketById.has(coin.geckoId))marketById.set(coin.geckoId,previous.points);
      if(!marketById.has(coin.geckoId)&&previous?.state!=="complete") {
        report.marketPending++;
        if(!marketStopped&&report.marketRequests<maxMarket&&(!previous?.retryAt||previous.retryAt<=startedAt)) {
          let networkRequest=true;
          report.marketRequests++;
          try {
            const market=await fetchHistoricalMarket(coin.geckoId,cache,marketArchive);
            networkRequest=!market.cached;
            const points=parseMarketChart(market.data,market.source.id,Date.now());
            if(!points.length)throw Error("No historical midnight points");
            captured.push(market.receipt);
            // Persist originals before any database row can reference this release.
            await writeFile(join(cache,"market-sources.json.gz"),gzipSync(JSON.stringify({schema:1,runId,receipts:captured})));
            await saveSources(db,[market.source]);
            marketById.set(coin.geckoId,points);
            report.marketFetched++;report.marketPending--;
          } catch(error) {
            fail(key,error);
            const retryAt=new Date(Date.now()+(error instanceof HistoryProviderDeferred?error.retryAfter:86400)*1000).toISOString();
            if(error instanceof HistoryProviderDeferred){marketStopped=true;await setRecord(db,"history_fetches","provider:coingecko",{retryAt,status:error.status});}
            await setRecord(db,"history_fetches",key,{state:"deferred",retryAt});
          }
          // Five anonymous requests per minute, and honor provider-wide Retry-After.
          if(networkRequest)await new Promise(resolve=>setTimeout(resolve,12_000));
        }
      }
      for(const raw of marketById.get(coin.geckoId)??[]){const p={...raw,identity:historyIdentity(coin)};markets.set(p.day,mergeMarket(markets.get(p.day),p));}
    }
    const marketRows=[...markets.values()].sort((a,b)=>a.day.localeCompare(b.day));
    report.marketWrites+=await saveSeries(db,"history_market",coin.slug,marketRows);
    // No market observation => no made-up ratio date. Fundamentals are still retained for the whole source span.
    const valuations=flows.length?calculateDailyValuations(flows,marketRows,eligibleCapital(coin)):[];
    report.valuationWrites+=await saveSeries(db,"history_valuations",coin.slug,valuations);
    await saveAsset(db,coin.slug,{slug:coin.slug,name:coin.name,symbol:coin.symbol,geckoId:coin.geckoId,cmcId:coin.cmcId,identity:historyIdentity(coin),identityStatus:coin.identityStatus,
      capitalExclusionReason:coin.capitalExclusionReason??null,sourceFrom:flows[0]?.day??null,sourceTo:flows.at(-1)?.day??null,marketFrom:marketRows[0]?.day??null,marketTo:marketRows.at(-1)?.day??null,
      fundamentalDays:flows.length,marketDays:marketRows.length,snapshotId:ref.id,reconciledDay:fundamentalDay,marketHistoryLimit:"CoinGecko anonymous: up to 365 days at initial acquisition; captured quotes retained indefinitely",revenueHistoryBasis:"provider-reconstructed; original receipts retained"});
    if(coin.geckoId&&marketById.has(coin.geckoId)&&!(await getRecord<{state:string}>(db,"history_fetches",`gecko:${coin.geckoId}`))?.state.includes("complete"))await setRecord(db,"history_fetches",`gecko:${coin.geckoId}`,{state:"complete",at:startedAt,limitDays:365,points:marketById.get(coin.geckoId)});
    report.assets++;
    if(report.assets%50===0){
      console.log(JSON.stringify({assets:report.assets,marketFetched:report.marketFetched,writes:report.fundamentalWrites+report.marketWrites+report.valuationWrites}));
      await writeFile(join(cache,"history-report.json"),JSON.stringify(report,null,2));
    }
  }
  for(const entry of report.issues.filter(e=>e.scope.startsWith("archive-pending:")))await setRecord(db,"history_fetches",`archive:${entry.scope.slice(16)}`,{state:"complete",at:entry.reason});
  report.issues=report.issues.filter(e=>!e.scope.startsWith("archive-pending:"));
  const acquired=new Set((await historyRead(db,"SELECT id FROM history_fetches WHERE id LIKE 'gecko:%' AND json_extract(payload,'$.state')='complete'")).rows.map(r=>String(r.id)));
  report.marketPending=snapshot.coins.filter(c=>eligibleCapital(c)&&c.geckoId&&!acquired.has(`gecko:${c.geckoId}`)).length;
  report.storageBytes=await storageBytes(db);
  report.status=marketStopped||report.marketPending||report.reconciliationPending||report.issues.length?"partial":"complete";
} catch(error) {
  report.status=error instanceof HistoryBudgetExceeded?"budget-paused":"failed";fail(`run:${phase}`,error);
} finally {
  report.completedAt=new Date().toISOString();
  // Include every cached original, also after a partial run or a resumed local import.
  const receipts:SourceReceipt[]=[];
  for(const file of await readdir(cache))if(/^market-[a-f0-9]{64}\.json\.gz$/.test(file))receipts.push(JSON.parse(gunzipSync(await readFile(join(cache,file))).toString()) as SourceReceipt);
  await writeFile(join(cache,"market-sources.json.gz"),gzipSync(JSON.stringify({schema:1,runId,receipts})));
  await writeFile(join(cache,"history-report.json"),JSON.stringify(report,null,2));
  try {
    if(report.status!=="not-due")await setRecord(db,"history_runs",runId,report);
    if(["complete","partial"].includes(report.status))await setRecord(db,"history_fetches","sync:last",{completedAt:report.completedAt,snapshot:report.snapshot,fundamentalDay:report.reconciliationPending?(previousFundamentalDay===fundamentalDay?"":previousFundamentalDay):fundamentalDay,marketPending:report.marketPending});
  }catch{}
  db.close();console.log(JSON.stringify(report));
  if(report.status==="failed")process.exitCode=1;
}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"History synchronization failed");process.exitCode=1;});
