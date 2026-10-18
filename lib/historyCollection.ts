import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import type { SourceBundle, SourceReceipt } from "./sourceBundle";
import { validateSourceBundle } from "./sourceBundle";
import { checkArchiveUrl, decodeSnapshot, parseJournal, sha256 } from "./snapshotArchive";
import { JOURNAL_LATEST } from "./publication";
import type { PublishedSnapshot } from "./publicationTypes";
import { historyHash, type HistorySource } from "./dailyHistory";

export class HistoryProviderDeferred extends Error { constructor(public status:number,public retryAfter:number) { super(`Historical provider deferred: HTTP ${status}`); } }
export async function cachedArchive(url:string,hash:string,cache:string) {
  checkArchiveUrl(url);
  const file=join(cache,`${hash}.gz`);
  try { const bytes=await readFile(file); if(sha256(bytes)===hash)return bytes; } catch {}
  const response=await fetch(url,{signal:AbortSignal.timeout(120_000)});
  if(!response.ok)throw Error(`History archive HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(sha256(bytes)!==hash)throw Error("History archive hash mismatch");
  await mkdir(cache,{recursive:true}); await writeFile(file,bytes);
  return bytes;
}
export async function loadHistoryInputs(cache:string) {
  const response=await fetch(JOURNAL_LATEST,{cache:"no-store",signal:AbortSignal.timeout(30_000)});
  if(!response.ok)throw Error(`History journal HTTP ${response.status}`);
  const journal=parseJournal(await response.json()),ref=journal.published;
  if(!ref?.rawBundleUrl||!ref.rawBundleSha256)throw Error("No verified historical source archive");
  const [snapshotBytes,bundleBytes]=await Promise.all([cachedArchive(ref.url,ref.sha256,cache),cachedArchive(ref.rawBundleUrl,ref.rawBundleSha256,cache)]);
  const snapshot=decodeSnapshot(snapshotBytes,ref);
  const bundle=JSON.parse(gunzipSync(bundleBytes,{maxOutputLength:500_000_000}).toString()) as SourceBundle;
  validateSourceBundle(bundle);
  return {snapshot,bundle,ref};
}
export async function loadArchivedSnapshot(ref:PublishedSnapshot,cache:string) {
  return decodeSnapshot(await cachedArchive(ref.url,ref.sha256,cache),ref);
}

/** Anonymous free endpoint only. Its 365-day limit is recorded, not bypassed. */
export async function fetchHistoricalMarket(geckoId:string,cache:string,archiveUrl:string) {
  const url=`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(geckoId)}/market_chart?vs_currency=usd&days=365&interval=daily`;
  const file=join(cache,`market-${historyHash(geckoId)}.json.gz`);
  let receipt:SourceReceipt|null=null;
  try { receipt=JSON.parse(gunzipSync(await readFile(file)).toString()) as SourceReceipt; } catch {}
  const cached=!!receipt;
  if(!receipt) {
    const requestedAt=new Date().toISOString();
    const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(30_000)});
    if([401,403,429].includes(response.status)) {
      const header=response.headers.get("retry-after");
      const retry=header&&/^\d+$/.test(header)?Number(header):header?Math.ceil((Date.parse(header)-Date.now())/1000):NaN;
      throw new HistoryProviderDeferred(response.status,Number.isFinite(retry)&&retry>0?retry:900);
    }
    if(!response.ok)throw Error(`Historical market HTTP ${response.status}`);
    const body=await response.text();
    receipt={url,requestedAt,observedAt:new Date().toISOString(),status:200,headers:{"content-type":"application/json"},body,sha256:sha256(Buffer.from(body))};
    await mkdir(cache,{recursive:true});await writeFile(file,gzipSync(JSON.stringify(receipt)));
  }
  if(receipt.url!==url||receipt.status!==200||sha256(Buffer.from(receipt.body))!==receipt.sha256)throw Error("Historical market cache integrity failed");
  const id=historyHash([receipt.url,receipt.observedAt,receipt.sha256]);
  const source:HistorySource={id,url,observedAt:receipt.observedAt,archiveUrl,sha256:receipt.sha256};
  return {source,data:JSON.parse(receipt.body),receipt,file,cached};
}
