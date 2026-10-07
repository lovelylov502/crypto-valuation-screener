import {marketAcquisitionReadiness} from "./marketReadiness";
import {objectHash} from "./sourceBundle";
import {stateUrl} from "./publication";
import {parseJournal} from "./snapshotArchive";
import type {PublicationJournal} from "./publicationTypes";
import type {ScreenerResponse} from "./types";

export function preparePublicationCorrection(current:PublicationJournal,target:PublicationJournal,bad:ScreenerResponse,good:ScreenerResponse,baselinePublication:unknown,id:string,at:string,goodBaseline:ScreenerResponse|null,original=current) {
 if(current.schema!==2||!["published","blocked"].includes(current.attempt.outcome)||!Number.isFinite(Date.parse(current.attempt.completedAt??""))||!current.published||
  original.schema!==2||original.attempt.outcome!=="published"||original.published?.id!==`${original.attempt.id}-complete`||objectHash(original.published)!==objectHash(current.published)||
  target.attempt.outcome!=="published"||!target.published?.availabilityConfirmedAt||!/^data-[a-zA-Z0-9-]+-correction$/.test(id)||id===current.id||
  !Number.isFinite(Date.parse(at))||Date.parse(at)<Date.parse(current.createdAt)||Date.parse(good.updatedAt)>=Date.parse(bad.updatedAt)||
  objectHash(baselinePublication)!==objectHash(target.published)||bad.updatedAt!==current.published.dataAt||good.updatedAt!==target.published.dataAt)throw new Error("Invalid publication correction lineage");
 const failed=marketAcquisitionReadiness(bad,good),restored=marketAcquisitionReadiness(good,goodBaseline);
 if(!failed.errors.length||!failed.errors.some(e=>e.startsWith("market_acquisition_failed:"))||restored.errors.length)throw new Error("Correction requires a proved systemic market acquisition failure");
 const correction={schema:1 as const,journalId:id,reason:"systemic-market-acquisition" as const,observedAt:at,parentJournalUrl:stateUrl(current.id),originalJournalUrl:stateUrl(original.id),targetJournalUrl:stateUrl(target.id),from:current.published,to:target.published,readiness:failed};
 const journal:PublicationJournal={...current,id,createdAt:at,previousId:current.id,previousStateUrl:stateUrl(current.id),published:target.published,correction,
  incident:{firstFailureObservedAt:current.incident?.firstFailureObservedAt??at,lastFailureObservedAt:at,lastGoodDataAt:target.published.dataAt}};
 parseJournal(journal);
 return {journal,correction};
}
