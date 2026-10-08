export type EconomicMetric = "Revenue" | "Fees" | "HoldersRevenue";
export type EconomicDisposition = "approved" | "pending" | "evidence-unavailable" | "reviewed-unavailable";
export interface EconomicPolicyIdentity { algorithm: "metric-decisions-v1"; artifact: "economic-policy-2026-10-08"; sha256: string }
export interface EconomicProvenance {
  state: "verified" | "unavailable" | "changed";
  repository: "DefiLlama/dimension-adapters";
  observedAt: string;
  commit: string | null;
  tree: string | null;
  receiptHashes: string[];
  files: { path: string; expected: string; actual: string | null }[];
  limitation: "provider-execution-revision-unattested";
}
export interface EconomicDecision {
  key: string;
  provider: "DefiLlama";
  componentId: string;
  metric: EconomicMetric;
  policy: EconomicPolicyIdentity;
  basis: "legacy-definition-only" | "reviewed-code-contract" | "unreviewed";
  disposition: EconomicDisposition;
  kind: string;
  holderEligible?: boolean;
  holderType?: import("./holderValue").HolderEconomicType;
  holderReason?: string;
  changedFields: string[];
  requiredFields: string[];
  affectedOutputs: string[];
  recipient: string | null;
  funding: string | null;
  temporal: string | null;
  limits: string[];
  comparabilityBoundary?: { at: string; before: string; after: string };
  reason: string;
  missingProof?: string;
  evidence: { reviewedAt: string | null; commit: string | null; tree: string | null; receiptHashes: string[]; dependencyPaths: string[]; limitation: string };
}
