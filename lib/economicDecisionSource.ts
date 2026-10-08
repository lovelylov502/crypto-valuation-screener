import * as legacy from "./economicDecisionSourceV1";
import * as current from "./economicDecisionSourceV2";
import {acquireEconomicProvenanceV2} from "./economicProvenanceV2";
import {sourceEconomicPolicy} from "./sourceBundle";
export {PROVENANCE_COMMIT_URL,provenanceTreeUrl} from "./economicDecisionSourceV1";
const selected=()=>sourceEconomicPolicy()?.algorithm==="metric-decisions-v2"?current:legacy;
export const economicDecision:typeof legacy.economicDecision=(...args)=>selected().economicDecision(...args);
export const metricSemanticIdentity:typeof legacy.metricSemanticIdentity=(...args)=>selected().metricSemanticIdentity(...args);
export const acquireEconomicProvenance=()=>sourceEconomicPolicy()?.algorithm==="metric-decisions-v2"?acquireEconomicProvenanceV2():legacy.acquireEconomicProvenance();
