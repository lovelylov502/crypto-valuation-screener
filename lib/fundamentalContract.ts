import type { CoinScored } from "./types";
import { FUNDAMENTAL_VERSION, KIND_ORDER, businessRevenue, businessFees } from "./fundamentals";
import { researchMultiple } from "./research";
import { salesMultiple, protocolMultiple, holderMultiple } from "./valuationMetrics";

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
  for (const [key, expectedValue] of [["psSales", salesMultiple(c)], ["pr", protocolMultiple(c)], ["phr", holderMultiple(c)]] as const) {
    const value = c.multiples[key];
    if (expectedValue === null ? value !== null : typeof value !== "number" || !Number.isFinite(value) || Math.abs(value - expectedValue) > Math.max(1, expectedValue) * 1e-10) errors.push(`${key} basis`);
  }
  if (c.sales && (!/^https:\/\//.test(c.sales.url) || !(c.sales.amountUsd > 0) || !["annualized_estimate", "reported_ttm"].includes(c.sales.basis) || !Number.isFinite(Date.parse(c.sales.validUntil)))) errors.push("sales evidence schema");
  for (const h of [c.revenueHistory, c.holderHistory]) if (h) {
    for (const days of [1, 7, 30, 90, 365] as const) {
      const p = h.periods?.[days];
      if (!p || p.days !== days || !Number.isInteger(p.reportedDays) || p.reportedDays < 0 || p.reportedDays > days || (p.total !== null && (!Number.isFinite(p.total) || p.reportedDays !== days)) || Date.parse(p.end) - Date.parse(p.start) !== (days - 1) * 86400000) errors.push("period coverage");
    }
  }
  if (c.identityStatus !== "verified" && [c.multiples.pf, c.multiples.revenueMultiple, c.multiples.phr].some(v => v !== null)) errors.push("unverified token multiple");
  if (c.capitalExclusionReason && (Object.values(c.multiples).some(v => v !== null) || c.valueScore !== null || c.opportunities.business || c.opportunities.holder || c.opportunities.transition)) errors.push("ineligible capital used");
  if (!businessFees(c) && c.multiples.pf !== null) errors.push("non-fee P/F");
  if (!businessRevenue(c) && c.sectorPercentiles.revenueMultiple !== null) errors.push("non-business percentile");
  if (!businessRevenue(c) && !businessFees(c) && c.opportunities.business) errors.push("non-business growth");
  if ((!f.holderShareReviewed || !businessRevenue(c)) && (c.valueCapture.eligibleHolderValueShare !== null || c.valueCapture.shareBasis !== null)) errors.push("unreviewed share");
  return errors;
}
