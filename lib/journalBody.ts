import {parseJournal,sha256} from "./snapshotArchive";
import {stateUrl} from "./publication";
import type {PublicationJournal} from "./publicationTypes";

export const MAX_JOURNAL_STATE_BYTES=30_000_000;
export interface JournalEnvelope {format:"screener-journal-reference";schema:1;journalId:string;state:{url:string;sha256:string;bytes:number}}
/** Release body stays small; the complete wire journal already belongs in immutable state.json. */
export function journalBody(journal:PublicationJournal) {
  const state=Buffer.from(JSON.stringify(journal));
  if(state.byteLength>MAX_JOURNAL_STATE_BYTES)throw Error("Journal state exceeds immutable metadata budget");
  const envelope:JournalEnvelope={format:"screener-journal-reference",schema:1,journalId:journal.id,state:{url:stateUrl(journal.id),sha256:sha256(state),bytes:state.byteLength}};
  return {body:JSON.stringify(envelope),state};
}
export async function journalFromRelease(release:{body:string;tag_name?:string},fetcher=fetch):Promise<PublicationJournal> {
  const value=JSON.parse(release.body);
  if(value.format===undefined)return parseJournal(value);
  const e=value as JournalEnvelope;
  if(e.format!=="screener-journal-reference"||e.schema!==1||!/^data-[a-zA-Z0-9-]+$/.test(e.journalId)||e.journalId!==release.tag_name||e.state?.url!==stateUrl(e.journalId)||
    !/^[a-f0-9]{64}$/.test(e.state.sha256)||!Number.isInteger(e.state.bytes)||e.state.bytes<1||e.state.bytes>MAX_JOURNAL_STATE_BYTES)throw Error("Invalid same-release journal envelope");
  const response=await fetcher(e.state.url,{cache:"no-store",redirect:"follow",signal:AbortSignal.timeout(15_000)});
  if(!response.ok||!response.body)throw Error("Immutable journal state unavailable");
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>e.state.bytes)throw Error("Immutable journal state length mismatch");parts.push(part.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=Buffer.concat(parts);
  if(size!==e.state.bytes||sha256(bytes)!==e.state.sha256)throw Error("Immutable journal state hash or length mismatch");
  const decoded=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  if(decoded.format!==undefined)throw Error("Nested journal envelope");
  const journal=parseJournal(decoded);
  if(journal.id!==e.journalId)throw Error("Immutable journal state identity mismatch");
  return journal;
}
