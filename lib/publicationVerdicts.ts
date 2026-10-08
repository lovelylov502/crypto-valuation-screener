import { freshnessAccountingErrors,publicFreshness } from "./datedFreshness";
import { reconcileRecovery,recoveryVerdicts } from "./freshnessRecovery";
import type { ScreenerResponse } from "./types";
import {economicAccountingErrors} from "./economicContract";

/** Reproduction, scheduler execution, and source currency are independent verdicts. */
export function publicationVerdicts(data:ScreenerResponse,now:number,integrityErrors:string[]) {
  const freshness=publicFreshness(data.freshness,now);
  return {integrityPassed:integrityErrors.length===0,...recoveryVerdicts(data.publication,now),
    economicAccountingPassed:data.pipeline?.economicPolicy?economicAccountingErrors(data).length===0:null,
    economicReviewComplete:data.economicReview?data.economicReview.summary.pending===0&&data.economicReview.summary.evidenceUnavailable===0:null,
    economicReview:data.economicReview??null,
    freshnessAccountingPassed:data.pipeline?.schema===2&&freshnessAccountingErrors(data).length===0,
    allApplicableDataCurrent:!!freshness&&!freshness.unassessed&&freshness.current>0&&freshness.pending===0&&freshness.unknown===0&&freshness.conflict===0&&freshness.insufficient===0,
    freshness: freshness??null,
    unresolvedDateObligations:data.publication?.recovery?reconcileRecovery(data.publication,now).obligations.filter(o=>o.disposition!=="resolved"):[] };
}
