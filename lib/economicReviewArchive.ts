import {createHash} from "node:crypto";
import type {PublicationJournal} from "./publicationTypes";
import {validateEconomicReview,summarizeEconomicReview,type EconomicReviewState} from "./economicReview";
import {objectHash} from "./sourceBundle";
export interface EconomicReviewRef {schema:1;url:string;sha256:string;stateSha256:string;bytes:number}
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
export function validateEconomicReviewRef(ref:EconomicReviewRef) {
  if(ref?.schema!==1||!/^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/data-[a-zA-Z0-9-]+\/economic-review\.json$/.test(ref.url)||![ref.sha256,ref.stateSha256].every(h=>/^[a-f0-9]{64}$/.test(h))||!Number.isInteger(ref.bytes)||ref.bytes<1||ref.bytes>30_000_000)throw Error("Invalid economic review archive reference");
}
/** Full state stays in its immutable asset; unchanged journals retain the original reference. */
export function archiveEconomicReview(j:PublicationJournal):{journal:PublicationJournal;files:Record<string,Uint8Array>} {
  const {economicReview,...wire}=j;
  if(!economicReview)return {journal:wire,files:{}};
  validateEconomicReview(economicReview);
  const bytes=Buffer.from(JSON.stringify(economicReview)),sha256=digest(bytes),stateSha256=objectHash(economicReview);
  const same=j.economicReviewRef?.sha256===sha256&&j.economicReviewRef.stateSha256===stateSha256&&j.economicReviewRef.bytes===bytes.byteLength;
  const ref=same?j.economicReviewRef!:{schema:1 as const,url:`https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${j.id}/economic-review.json`,sha256,stateSha256,bytes:bytes.byteLength};
  validateEconomicReviewRef(ref);
  return {journal:{...wire,economicReviewRef:ref,publicEconomicReview:summarizeEconomicReview(economicReview,objectHash)},files:same?{}:{"economic-review.json":bytes}};
}
export async function hydrateEconomicReview(j:PublicationJournal,fetcher=fetch):Promise<PublicationJournal> {
  const ref=j.economicReviewRef;if(!ref)return j;
  validateEconomicReviewRef(ref);
  if(j.economicReview) {
    const archive=archiveEconomicReview(j);if(objectHash(archive.journal.economicReviewRef)!==objectHash(ref)||objectHash(archive.journal.publicEconomicReview)!==objectHash(j.publicEconomicReview))throw Error("Hydrated economic review differs from reference");return j;
  }
  const response=await fetcher(ref.url,{cache:"no-store",redirect:"follow",signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw Error("Economic review archive unavailable");
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.byteLength!==ref.bytes||digest(bytes)!==ref.sha256)throw Error("Economic review archive hash mismatch");
  const state=JSON.parse(Buffer.from(bytes).toString("utf8")) as EconomicReviewState;validateEconomicReview(state);
  if(objectHash(state)!==ref.stateSha256||objectHash(summarizeEconomicReview(state,objectHash))!==objectHash(j.publicEconomicReview))throw Error("Economic review archive accounting mismatch");
  return {...j,economicReview:state};
}
