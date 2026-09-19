import type { CoinScored } from "./types";
import { FUNDAMENTAL_VERSION, KIND_ORDER, businessRevenue, businessFees } from "./fundamentals";
import { researchMultiple } from "./research";

/** Applied to generated snapshots, browser refreshes, and replay tests. Fail closed on schema drift. */
export function fundamentalErrors(c: CoinScored): string[] {
  const errors: string[] = [];
  const f = c.fundamentals;
  if (!f || f.version !== FUNDAMENTAL_VERSION || !KIND_ORDER.includes(f.revenue?.kind) ||
    !["user_fees", "asset_yield", "holder_return", "mixed", "unknown"].includes(f.fees?.kind) ||
    ![f.fingerprint, f.revenue?.fingerprint, f.fees?.fingerprint].every(h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)) ||
    !Array.isArray(f.revenue?.components) || !Array.isArray(f.fees?.components) || !Array.isArray(f.holders) || typeof f.holderShareReviewed !== "boolean") return ["definition schema"];
  if ([...f.revenue.components, ...f.fees.components, ...f.holders].some(p => !p || typeof p.slug !== "string" || !["matched", "changed", "unreviewed", "missing"].includes(p.status))) errors.push("definition component");
  const expected = researchMultiple(c), actual = c.multiples.revenueMultiple;
  if (expected === null ? actual !== null : typeof actual !== "number" || !Number.isFinite(actual) || Math.abs(actual - expected) > Math.max(1, expected) * 1e-10) errors.push("multiple basis");
  if (Object.hasOwn(c.multiples, "ps")) errors.push("legacy sales field");
  if (c.identityStatus !== "verified" && [c.multiples.pf, c.multiples.revenueMultiple, c.multiples.phr].some(v => v !== null)) errors.push("unverified token multiple");
  if (!businessFees(c) && c.multiples.pf !== null) errors.push("non-fee P/F");
  if (!businessRevenue(c) && c.sectorPercentiles.revenueMultiple !== null) errors.push("non-business percentile");
  if (!businessRevenue(c) && !businessFees(c) && c.opportunities.business) errors.push("non-business growth");
  if ((!f.holderShareReviewed || !businessRevenue(c)) && (c.valueCapture.eligibleHolderValueShare !== null || c.valueCapture.shareBasis !== null)) errors.push("unreviewed share");
  return errors;
}
