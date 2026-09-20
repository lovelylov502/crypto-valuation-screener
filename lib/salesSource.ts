import registry from "./salesEvidence.json";
import type { CoinRaw } from "./types";
import type { SalesEvidence } from "./valuationMetrics";

export function resolveSalesEvidence(c: Pick<CoinRaw, "slug" | "geckoId" | "symbol" | "identityStatus">, at: string): SalesEvidence | null {
  const r = (registry as Record<string, Omit<SalesEvidence, "status">>)[c.slug];
  if (!r) return null;
  const now = Date.parse(at), expires = Date.parse(`${r.validUntil}T00:00:00Z`);
  const identity = c.identityStatus === "verified" && r.geckoId === c.geckoId && r.symbol === c.symbol;
  return { ...r, status: !identity ? "identity_mismatch" : !Number.isFinite(now) || now >= expires || now < Date.parse(`${r.reviewedAt}T00:00:00Z`) ? "expired" : "current" };
}
