import {readFile,writeFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {JOURNAL_LATEST} from "../lib/publication";
import {checkArchiveUrl,parseJournal} from "../lib/snapshotArchive";
import {scheduledAcceptance,validateAcceptanceWindow,type AcceptanceWindow} from "../lib/scheduledAcceptance";
import type {SlotLedger} from "../lib/freshnessRecovery";

const [command,...args]=process.argv.slice(2);
async function read(url:string) {const r=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(15_000)});if(!r.ok)throw new Error(`Acceptance evidence HTTP ${r.status}: ${url}`);return r.json();}
async function main() {
  if(command==="start") {
    const [startsAt,codeCommit,path,previousPath]=args;
    if(!path)throw new Error("Usage: start <future UTC slot> <Phase B commit> <new manifest path> [previous manifest path]");
    let previousWindow:AcceptanceWindow["previousWindow"];
    if(previousPath) {const bytes=await readFile(previousPath),previous=JSON.parse(bytes.toString("utf8"));validateAcceptanceWindow(previous);previousWindow={id:previous.id,sha256:createHash("sha256").update(bytes).digest("hex")};}
    const w:AcceptanceWindow={schema:1,id:randomUUID(),recordedAt:new Date().toISOString(),startsAt:new Date(startsAt).toISOString(),endsAt:new Date(Date.parse(startsAt)+72*3_600_000).toISOString(),codeCommit,...(previousWindow?{previousWindow}:{})};
    validateAcceptanceWindow(w);await writeFile(path,JSON.stringify(w,null,2),{flag:"wx"});console.log(JSON.stringify(w,null,2));return;
  }
  if(command!=="check"||!args[0])throw new Error("Usage: check <recorded manifest path> [new report path]");
  const w=JSON.parse(await readFile(args[0],"utf8")) as AcceptanceWindow;validateAcceptanceWindow(w);
  const j=parseJournal(await read(JOURNAL_LATEST)),retired:SlotLedger[]=[],visited=new Set<string>(),missing:string[]=[];
  let url=j.recovery?.history?.archiveUrl;
  while(url) {
    checkArchiveUrl(url);if(!url.endsWith("/recovery-history.json")||visited.has(url))throw new Error("Invalid or cyclic acceptance history");visited.add(url);
    let h:any;try {h=await read(url);}catch(e){missing.push(e instanceof Error?e.message:String(e));break;}
    if(h.schema!==1||!Array.isArray(h.slots)||h.previousHistory!==null&&typeof h.previousHistory!=="string")throw new Error("Invalid acceptance history asset");
    retired.push(...h.slots);url=h.previousHistory;
    if(h.slots.length&&Math.min(...h.slots.map((s:SlotLedger)=>Date.parse(s.slotAt)))<=Date.parse(w.startsAt))break;
  }
  const verdict=scheduledAcceptance(w,j,retired,Date.now()),report={...verdict,readJournal:j.id,historyAssets:[...visited],missingEvidence:missing};
  if(missing.length){report.acceptancePassed=false;report.evidenceComplete=false;}
  if(args[1])await writeFile(args[1],JSON.stringify(report,null,2),{flag:"wx"});console.log(JSON.stringify(report,null,2));
  if(!report.acceptancePassed)process.exitCode=1;
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
