import { createHash } from "node:crypto";
import artifactV1 from "./economic-policy-v1.json";
import artifact from "./economic-policy-v2.json";
import legacy from "./fundamentalDefinitions.legacy-b519.json";
import type { EconomicPolicyIdentity } from "./economicTypes";
import { knownEconomicPolicy } from "./economicPolicyIdentity";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]));
  return value;
}
export const ECONOMIC_POLICY_V1: EconomicPolicyIdentity = { algorithm: "metric-decisions-v1", artifact: "economic-policy-2026-10-08",
  sha256: createHash("sha256").update(JSON.stringify(canonical({artifact:artifactV1,legacy}))).digest("hex") };
export const ECONOMIC_POLICY: EconomicPolicyIdentity = { algorithm: "metric-decisions-v2", artifact: "economic-policy-2026-10-08-v2",
  sha256: createHash("sha256").update(JSON.stringify(canonical({artifact,legacy}))).digest("hex") };
if(![ECONOMIC_POLICY_V1,ECONOMIC_POLICY].every(knownEconomicPolicy))throw new Error("Immutable economic artifact content changed");
export interface EconomicContract {
  providerId:string;slug:string;expectedName:string;expectedModule:string;expectedParent:string|null;expectedDefinitions:Record<string,string|null>;reviewedAt:string;
  sourceClosure:{path:string;blobSha1:string;sha256:string;role?:string}[];
  runtimeContext?:{roots:string[];sha256:string;packageCount:number};
  decisions:{metric:string;decision:string;kind?:string;requiredDefinitionFields:string[];affectedOutputs:string[];recipient:string;funding:string;temporal:string;limits:string[];reviewReason?:string;missingProof?:string|null;comparabilityBoundary?:{at:string;before:string;after:string}}[];
}
export const economicArtifact = artifact as unknown as {contracts:EconomicContract[]};
export const economicArtifactV1 = artifactV1 as unknown as {contracts:EconomicContract[]};
export const economicArtifactFor=(policy:EconomicPolicyIdentity)=>policy.algorithm==="metric-decisions-v1"?economicArtifactV1:economicArtifact;
export function validateEconomicPolicy(value: unknown): asserts value is EconomicPolicyIdentity {
  const p = value as EconomicPolicyIdentity;
  if (!knownEconomicPolicy(p)) throw new Error("Unknown or mismatched economic policy artifact");
}
