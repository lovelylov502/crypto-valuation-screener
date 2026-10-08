import identity from "./economic-policy-v1.identity.json";
import current from "./economic-policy-v2.identity.json";
import type { EconomicPolicyIdentity } from "./economicTypes";
export const ECONOMIC_POLICY_V1_IDENTITY = identity as EconomicPolicyIdentity;
export const ECONOMIC_POLICY_IDENTITY = current as EconomicPolicyIdentity;
export const ECONOMIC_POLICIES = [identity,current] as EconomicPolicyIdentity[];
export function knownEconomicPolicy(value: unknown): value is EconomicPolicyIdentity {
  const p=value as EconomicPolicyIdentity;
  return !!p&&ECONOMIC_POLICIES.some(i=>p.algorithm===i.algorithm&&p.artifact===i.artifact&&p.sha256===i.sha256);
}
