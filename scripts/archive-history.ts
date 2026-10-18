import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { sha256 } from "../lib/snapshotArchive";
import type { SourceReceipt } from "../lib/sourceBundle";

async function main() {
  const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]??fallback;};
  const cache=resolve(arg("--cache","snapshot-output/history-cache")),tag=arg("--tag","");
  if(!/^history-[a-zA-Z0-9-]+$/.test(tag))throw Error("An immutable history release tag is required");
  const bytes=await readFile(join(cache,"market-sources.json.gz"));
  const bundle=JSON.parse(gunzipSync(bytes).toString()) as {receipts:SourceReceipt[]};
  if(!bundle.receipts.length){console.log(JSON.stringify({tag,receipts:0,skipped:true}));return;}
  for(const r of bundle.receipts)if(sha256(Buffer.from(r.body))!==r.sha256||new URL(r.url).hostname!=="api.coingecko.com")throw Error("Historical receipt integrity failed");
  const repo="lovelylov502/crypto-valuation-screener";
  const existing=spawnSync("gh",["release","view",tag,"--repo",repo,"--json","tagName"],{encoding:"utf8"});
  if(existing.status!==0) {
    const result=spawnSync("gh",["release","create",tag,join(cache,"market-sources.json.gz"),join(cache,"history-report.json"),"--repo",repo,"--target",process.env.GITHUB_SHA??"main","--latest=false","--title",tag,"--notes","Original public historical market receipts and collection coverage. Provider revisions and missing dates remain explicit."],{encoding:"utf8"});
    if(result.status!==0)throw Error("Historical source archive upload failed");
  }
  const url=`https://github.com/${repo}/releases/download/${tag}/market-sources.json.gz`;
  const response=await fetch(url,{signal:AbortSignal.timeout(120_000)});
  if(!response.ok||sha256(Buffer.from(await response.arrayBuffer()))!==sha256(bytes))throw Error("Immutable historical archive readback mismatch");
  console.log(JSON.stringify({tag,receipts:bundle.receipts.length,bytes:bytes.length,sha256:sha256(bytes),verified:true}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Historical archive failed");process.exitCode=1;});
