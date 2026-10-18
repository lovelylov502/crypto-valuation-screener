import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import type { SourceBundle, SourceReceipt } from "./sourceBundle";
import { validateSourceBundle } from "./sourceBundle";
import { checkArchiveUrl, decodeSnapshot, parseJournal, sha256 } from "./snapshotArchive";
import { JOURNAL_LATEST } from "./publication";
import type { PublishedSnapshot } from "./publicationTypes";
import { historyHash, HISTORY_VERSION, parseMarketChart, type HistorySource } from "./dailyHistory";

export class HistoryProviderDeferred extends Error { constructor(public status:number,public retryAfter:number) { super(`Historical provider deferred: HTTP ${status}`); } }
export class HistoryAssetDeferred extends Error { constructor(message:string,public retryAfter=3600) { super(message); } }
export class HistorySourceIntegrityError extends Error {}
export function historyRetrySeconds(status:number,header:string|null,now=Date.now()) {
  const parsed=header&&/^\d+$/.test(header)?Number(header):header?Math.ceil((Date.parse(header)-now)/1000):NaN;
  // Forbidden/authentication responses are not transient rate-limit signals.
  return Math.max(status===401||status===403?86400:0,Number.isFinite(parsed)&&parsed>0?parsed:status===429?900:3600);
}
export async function cachedArchive(url:string,hash:string,cache:string) {
  checkArchiveUrl(url);
  const file=join(cache,`${hash}.gz`);
  try { const bytes=await readFile(file); if(sha256(bytes)===hash)return bytes; } catch {}
  const response=await fetch(url,{signal:AbortSignal.timeout(120_000)});
  if(!response.ok)throw Error(`History archive HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(sha256(bytes)!==hash)throw new HistorySourceIntegrityError("History archive hash mismatch");
  await mkdir(cache,{recursive:true}); await writeFile(file,bytes);
  return bytes;
}
export async function loadHistoryReference() {
  const response=await fetch(JOURNAL_LATEST,{cache:"no-store",signal:AbortSignal.timeout(30_000)});
  if(!response.ok)throw Error(`History journal HTTP ${response.status}`);
  const journal=parseJournal(await response.json()),ref=journal.published;
  if(!ref?.rawBundleUrl||!ref.rawBundleSha256)throw Error("No verified historical source archive");
  return ref;
}
export async function loadHistoryInputs(cache:string,reference?:PublishedSnapshot) {
  const ref=reference??await loadHistoryReference();
  if(!ref.rawBundleUrl||!ref.rawBundleSha256)throw Error("No verified historical source archive");
  const [snapshotBytes,bundleBytes]=await Promise.all([cachedArchive(ref.url,ref.sha256,cache),cachedArchive(ref.rawBundleUrl,ref.rawBundleSha256,cache)]);
  const snapshot=decodeSnapshot(snapshotBytes,ref);
  const bundle=JSON.parse(gunzipSync(bundleBytes,{maxOutputLength:500_000_000}).toString()) as SourceBundle;
  validateSourceBundle(bundle);
  return {snapshot,bundle,ref};
}
export async function loadArchivedSnapshot(ref:PublishedSnapshot,cache:string) {
  const bytes=await cachedArchive(ref.url,ref.sha256,cache);
  try {return decodeSnapshot(bytes,ref);}catch {throw new HistorySourceIntegrityError("Historical snapshot validation failed");}
}

/** Anonymous free endpoint only. Its 365-day limit is recorded, not bypassed. */
export async function fetchHistoricalMarket(geckoId:string,cache:string,archiveUrl:string,onRequest?:()=>void,refresh=false) {
  const url=`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(geckoId)}/market_chart?vs_currency=usd&days=365&interval=daily`;
  const file=join(cache,`market-${historyHash(geckoId)}.json.gz`);
  let receipt:SourceReceipt|null=null;
  let cachedBytes:Buffer|null=null;
  try {cachedBytes=await readFile(file);}catch(error){if(!(error&&typeof error==="object"&&"code" in error&&error.code==="ENOENT"))throw error;}
  if(cachedBytes)try {receipt=JSON.parse(gunzipSync(cachedBytes).toString()) as SourceReceipt;}catch {throw new HistorySourceIntegrityError("Historical market cache cannot be decoded");}
  const valid=(r:SourceReceipt)=>r.url===url&&r.status===200&&typeof r.body==="string"&&sha256(Buffer.from(r.body))===r.sha256;
  if(receipt&&!valid(receipt))throw new HistorySourceIntegrityError("Historical market cache integrity failed");
  let refreshEmpty=false;
  if(refresh&&receipt)try {refreshEmpty=!parseMarketChart(JSON.parse(receipt.body),"",Date.now()).length;}catch {throw new HistorySourceIntegrityError("Invalid cached historical market series");}
  if(refreshEmpty&&receipt){
    // Retain a formerly empty response before refreshing this asset's cache.
    await writeFile(join(cache,`market-${historyHash([geckoId,receipt.observedAt,receipt.sha256])}.json.gz`),cachedBytes!);
    receipt=null;
  }
  const cached=!!receipt;
  if(!receipt) {
    const requestedAt=new Date().toISOString();
    onRequest?.();
    let response:Response;
    try {response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(30_000)});}catch {throw new HistoryAssetDeferred("Historical market request failed");}
    if([401,403,429].includes(response.status)) {
      throw new HistoryProviderDeferred(response.status,historyRetrySeconds(response.status,response.headers.get("retry-after")));
    }
    if(!response.ok)throw new HistoryAssetDeferred(`Historical market HTTP ${response.status}`,response.status===404?86400:historyRetrySeconds(response.status,response.headers.get("retry-after")));
    let body:string;
    try {body=await response.text();}catch {throw new HistoryAssetDeferred("Historical market response interrupted");}
    receipt={url,requestedAt,observedAt:new Date().toISOString(),status:200,headers:{"content-type":"application/json"},body,sha256:sha256(Buffer.from(body))};
    await mkdir(cache,{recursive:true});await writeFile(file,gzipSync(JSON.stringify(receipt)));
  }
  if(!valid(receipt))throw new HistorySourceIntegrityError("Historical market cache integrity failed");
  const id=historyHash([receipt.url,receipt.observedAt,receipt.sha256]);
  const source:HistorySource={id,url,observedAt:receipt.observedAt,archiveUrl,sha256:receipt.sha256};
  let data:unknown;
  try {data=JSON.parse(receipt.body);}catch {throw new HistorySourceIntegrityError("Invalid historical market JSON");}
  return {source,data,receipt,file,cached};
}

export function historyWorkPlan<T extends {slug:string;geckoId?:string|null}>(coins:T[],assets:Map<string,{payload:Record<string,unknown>}>,snapshot:string,reconcileAll=false) {
  return {
    latest:coins.filter(c=>reconcileAll||assets.get(c.slug)?.payload.snapshotId!==snapshot||assets.get(c.slug)?.payload.reconciliationState!=="ready"||assets.get(c.slug)?.payload.calculationVersion!==HISTORY_VERSION),
    backfill:coins.filter(c=>c.geckoId&&assets.get(c.slug)?.payload.marketHistoryId!==`gecko:${c.geckoId}`),
  };
}

export const historyMarketRetryDue=(retryAt:string|undefined,now=Date.now())=>!retryAt||Date.parse(retryAt)<=now;

/** Historical requests cannot take time away from an unfinished latest pass. */
export async function reconcileLatestBeforeBackfill<T>(latest:T[],hasTime:()=>boolean,reconcile:(asset:T)=>Promise<void>,backfill:()=>Promise<void>) {
  let pending=latest.length;
  for(const asset of latest){if(!hasTime())break;await reconcile(asset);pending--;}
  if(!pending)await backfill();
  return pending;
}
