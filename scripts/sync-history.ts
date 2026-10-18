import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { extractFundamentals, historyHash, historyIdentity, mergeMarket, parseMarketChart, snapshotMarket, HISTORY_VERSION, type HistorySource, type MarketDay } from "../lib/dailyHistory";
import { connectHistory, getRecord, historyDatabaseStats, historyRead, initializeHistory, saveSources, setRecord, storageBytes, HistoryBudgetExceeded } from "../lib/historyDatabase";
import { fetchHistoricalMarket, historyMarketRetryDue, historyWorkPlan, reconcileLatestBeforeBackfill, HistoryAssetDeferred, HistoryProviderDeferred, HistorySourceIntegrityError, loadArchivedSnapshot, loadHistoryInputs, loadHistoryReference } from "../lib/historyCollection";
import { reconcileHistoryAsset, type StoredHistoryAsset } from "../lib/historyIncremental";
import { eligibleCapital } from "../lib/capitalEligibility";
import { parseJournal, sha256 } from "../lib/snapshotArchive";
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
const report={schema:1,runId,calculationVersion:HISTORY_VERSION,startedAt,completedAt:"",snapshot:"",assets:0,latestAssets:0,backfillAssets:0,fundamentalWrites:0,marketWrites:0,valuationWrites:0,valuationCalculations:0,fullConsistencyAssets:0,marketFetched:0,marketCached:0,marketUnavailable:0,marketRequests:0,marketPending:0,marketApplicationPending:0,reconciliationPending:0,storageBytes:0,database:historyDatabaseStats(db),status:"running",issues:[] as {scope:string;reason:string}[]};
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
let phase="initialize";
try {
  await initializeHistory(db);
  const last=await getRecord<{completedAt:string;snapshot?:string}>(db,"history_fetches","sync:last");
  await writeFile(join(cache,"history-report.json"),JSON.stringify(report,null,2));
  phase="load-reference";
  const reference=await loadHistoryReference();
  report.snapshot=reference.id;
  // A new publication always gets its latest-date pass. The cooldown limits
  // repeated continuation of the same snapshot, not fresh source corrections.
  if(!argv.includes("--local")&&!argv.includes("--force")&&last?.snapshot===reference.id&&Date.parse(startedAt)-Date.parse(last.completedAt)<5*3600_000){report.status="not-due";return;}
  phase="load-inputs";
  const {snapshot,bundle,ref}=await loadHistoryInputs(cache,reference);
  fundamentalDay=snapshot.updatedAt.slice(0,10);
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
        let pastRef;
        try {pastRef=parseJournal(journal).published;}catch {throw new HistorySourceIntegrityError("Historical journal validation failed");}
        if(!pastRef)continue;
        const past=await loadArchivedSnapshot(pastRef,cache);
        addSnapshot(past.coins,pastRef.url,past.updatedAt,pastRef.sha256);
        seenDays.add(release.at.slice(0,10));
        console.log(JSON.stringify({archivedDate:past.updatedAt.slice(0,10),release:release.tag}));
        // Checkpoints are committed only after the resulting market rows are persisted below.
        report.issues.push({scope:`archive-pending:${release.tag}`,reason:past.updatedAt});
      } catch(error) {if(error instanceof HistorySourceIntegrityError)throw error;fail(release.tag,error);}
    }
  }
  phase="save-sources";
  await saveSources(db,sources);
  phase="read-checkpoints";
  const checkpoints=new Map((await historyRead(db,"SELECT id,json_extract(payload,'$.state') AS state,json_extract(payload,'$.retryAt') AS retry_at FROM history_fetches WHERE id LIKE 'gecko:%'")).rows.map(r=>[String(r.id),{state:String(r.state),retryAt:r.retry_at?String(r.retry_at):undefined}]));
  const assets=new Map<string,StoredHistoryAsset>((await historyRead(db,"SELECT slug,payload,content_hash FROM history_assets")).rows.map(r=>[String(r.slug),{payload:JSON.parse(String(r.payload)) as Record<string,unknown>,hash:String(r.content_hash)}]));
  const coins=[...snapshot.coins].filter(c=>inputs.series.get(c.slug)?.length||quotes.has(c.slug)||eligibleCapital(c)||assets.has(c.slug))
    .sort((a,b)=>Number(inputs.series.has(b.slug))-Number(inputs.series.has(a.slug))||(b.mcap??0)-(a.mcap??0)||a.slug.localeCompare(b.slug));
  const provider=await getRecord<{retryAt:string}>(db,"history_fetches","provider:coingecko");
  let marketStopped=!historyMarketRetryDue(provider?.retryAt,Date.parse(startedAt));
  const marketById=new Map<string,MarketDay[]>();
  const hasTime=()=>Date.now()-Date.parse(startedAt)<timeBudget*1000;
  const processed=new Set<string>();
  const reconcile=async(coin:CoinRaw,marketRows:MarketDay[],latest:boolean,marketHistoryId?:string)=>{
    phase=`asset:${coin.slug}`;
    const previous=assets.get(coin.slug)??null;
    const result=await reconcileHistoryAsset(db,{slug:coin.slug,previous,fundamentals:latest?inputs.series.get(coin.slug)??[]:[],markets:marketRows,
      asset:{slug:coin.slug,name:coin.name,symbol:coin.symbol,geckoId:coin.geckoId,cmcId:coin.cmcId,identity:historyIdentity(coin),identityStatus:coin.identityStatus,
        capitalExclusionReason:coin.capitalExclusionReason??null,snapshotId:ref.id,reconciledDay:fundamentalDay,
        marketHistoryId:marketHistoryId??(previous?.payload.identity===historyIdentity(coin)?previous.payload.marketHistoryId??null:null),
        marketHistoryLimit:"CoinGecko anonymous: up to 365 days at initial acquisition; captured quotes retained indefinitely",revenueHistoryBasis:"provider-reconstructed; original receipts retained"}});
    assets.set(coin.slug,result.asset);processed.add(coin.slug);report.assets=processed.size;
    report.fundamentalWrites+=result.fundamentalWrites;report.marketWrites+=result.marketWrites;report.valuationWrites+=result.valuationWrites;
    report.valuationCalculations+=result.calculations;report.fullConsistencyAssets+=Number(result.fullConsistency);
    if(latest)report.latestAssets++;else report.backfillAssets++;
    if(report.assets%50===0){
      console.log(JSON.stringify({assets:report.assets,latestAssets:report.latestAssets,backfillAssets:report.backfillAssets,marketFetched:report.marketFetched,calculations:report.valuationCalculations,writes:report.fundamentalWrites+report.marketWrites+report.valuationWrites}));
      await writeFile(join(cache,"history-report.json"),JSON.stringify(report,null,2));
    }
  };
  // Latest quotes, flow corrections and identity changes across the universe
  // finish before historical downloads can spend the remaining wall-clock time.
  const latest=historyWorkPlan(coins,assets,ref.id,argv.includes("--reconcile")||argv.includes("--archives")).latest;
  report.reconciliationPending=latest.length;
  report.reconciliationPending=await reconcileLatestBeforeBackfill(latest,hasTime,async coin=>{
    await reconcile(coin,[...(quotes.get(coin.slug)?.values()??[])],true);
    report.reconciliationPending--;
  },async()=>{
  for(const entry of report.issues.filter(e=>e.scope.startsWith("archive-pending:")))await setRecord(db,"history_fetches",`archive:${entry.scope.slice(16)}`,{state:"complete",at:entry.reason});
  const backfill=historyWorkPlan(coins.filter(eligibleCapital),assets,ref.id).backfill;
  for(const coin of backfill){
    if(report.reconciliationPending||!hasTime())break;
    const geckoId=coin.geckoId!,key=`gecko:${geckoId}`,previous=checkpoints.get(key);
    phase=`market:${geckoId}`;
    if(!marketById.has(geckoId)&&previous?.state==="complete"){
      const record=await getRecord<{points?:MarketDay[]}>(db,"history_fetches",key);
      if(!record?.points?.length)throw new HistorySourceIntegrityError("Completed historical checkpoint is missing its points");
      marketById.set(geckoId,record.points);
    }
    if(!marketById.has(geckoId)){
      if(marketStopped||report.marketRequests>=maxMarket||!historyMarketRetryDue(previous?.retryAt))continue;
      let networkRequest=false,market:Awaited<ReturnType<typeof fetchHistoricalMarket>>|null=null;
      try {
        market=await fetchHistoricalMarket(geckoId,cache,marketArchive,()=>{networkRequest=true;report.marketRequests++;},!!previous);
      }catch(error){
        if(!(error instanceof HistoryProviderDeferred)&&!(error instanceof HistoryAssetDeferred))throw error;
        fail(key,error);
        const retryAt=new Date(Date.now()+error.retryAfter*1000).toISOString();
        if(error instanceof HistoryProviderDeferred){marketStopped=true;await setRecord(db,"history_fetches","provider:coingecko",{retryAt,status:error.status});}
        await setRecord(db,"history_fetches",key,{state:"deferred",retryAt});checkpoints.set(key,{state:"deferred",retryAt});
      }
      if(market){
        let points:MarketDay[];
        try {points=parseMarketChart(market.data,market.source.id,Date.now());}catch {throw new HistorySourceIntegrityError("Invalid historical market series");}
        captured.push(market.receipt);
        // Original receipts must exist before a database row references this run.
        await writeFile(join(cache,"market-sources.json.gz"),gzipSync(JSON.stringify({schema:1,runId,receipts:captured})));
        await saveSources(db,[market.source]);
        if(!points.length){
          const retryAt=new Date(Date.now()+86400_000).toISOString();
          await setRecord(db,"history_fetches",key,{state:"unavailable",retryAt,source:market.source.id});
          checkpoints.set(key,{state:"unavailable",retryAt});report.marketUnavailable++;
        }else{
          await setRecord(db,"history_fetches",key,{state:"complete",at:startedAt,limitDays:365,points});
          checkpoints.set(key,{state:"complete",retryAt:undefined});marketById.set(geckoId,points);
          if(market.cached)report.marketCached++;else report.marketFetched++;
        }
      }
      if(networkRequest)await new Promise(resolve=>setTimeout(resolve,12_000));
    }
    const points=marketById.get(geckoId);
    if(points)await reconcile(coin,points.map(p=>({...p,identity:historyIdentity(coin)})),false,key);
  }
  });
  report.issues=report.issues.filter(e=>!e.scope.startsWith("archive-pending:"));
  report.marketPending=coins.filter(c=>eligibleCapital(c)&&c.geckoId&&checkpoints.get(`gecko:${c.geckoId}`)?.state!=="complete").length;
  report.marketApplicationPending=historyWorkPlan(coins.filter(eligibleCapital),assets,ref.id).backfill.length;
  report.storageBytes=await storageBytes(db);
  report.status=report.marketPending||report.marketApplicationPending||report.reconciliationPending||report.issues.length?"partial":"complete";
} catch(error) {
  report.status=error instanceof HistoryBudgetExceeded?"budget-paused":"failed";fail(`run:${phase}`,error);
} finally {
  report.completedAt=new Date().toISOString();
  // Include every cached original, also after a partial run or a resumed local import.
  const receipts:SourceReceipt[]=[];
  try {
    for(const file of await readdir(cache))if(/^market-[a-f0-9]{64}\.json\.gz$/.test(file)){
      try {
        const receipt=JSON.parse(gunzipSync(await readFile(join(cache,file))).toString()) as SourceReceipt;
        if(receipt.status!==200||typeof receipt.body!=="string"||sha256(Buffer.from(receipt.body))!==receipt.sha256||new URL(receipt.url).hostname!=="api.coingecko.com")throw Error("Invalid original receipt");
        receipts.push(receipt);
      }catch(error){report.status="failed";fail(`cache:${file}`,new HistorySourceIntegrityError("Cannot preserve an original historical receipt"));}
    }
    await writeFile(join(cache,"market-sources.json.gz"),gzipSync(JSON.stringify({schema:1,runId,receipts})));
  }catch(error){report.status="failed";fail("run:preserve-receipts",error);}
  try {
    if(["complete","partial"].includes(report.status)){
      await setRecord(db,"history_runs",runId,report);
      await setRecord(db,"history_fetches","sync:last",{completedAt:report.completedAt,snapshot:report.snapshot,fundamentalDay:report.reconciliationPending?"":fundamentalDay,marketPending:report.marketPending,reconciliationPending:report.reconciliationPending});
    }
  }catch(error){report.status=error instanceof HistoryBudgetExceeded?"budget-paused":"failed";fail("run:checkpoint",error);}
  try {await writeFile(join(cache,"history-report.json"),JSON.stringify(report,null,2));}
  finally {db.close();console.log(JSON.stringify(report));}
  if(["failed","budget-paused"].includes(report.status))process.exitCode=1;
}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"History synchronization failed");process.exitCode=1;});
