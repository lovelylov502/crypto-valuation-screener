import identity from "./economic-policy-v1.identity.json";
import type { EconomicPolicyIdentity } from "./economicTypes";
export const ECONOMIC_POLICY_IDENTITY = identity as EconomicPolicyIdentity;
export function knownEconomicPolicy(value: unknown): value is EconomicPolicyIdentity {
  const p=value as EconomicPolicyIdentity;
  return !!p&&p.algorithm===identity.algorithm&&p.artifact===identity.artifact&&p.sha256===identity.sha256;
}
