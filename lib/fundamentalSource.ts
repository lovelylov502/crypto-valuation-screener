import { createHash } from "node:crypto";
import registry from "./fundamentalDefinitions.legacy-b519.json";
import { economicDecision,metricSemanticIdentity } from "./economicDecisionSource";
import { sourceEconomicPolicy, sourceNow } from "./sourceBundle";
import { FUNDAMENTAL_VERSION, type Fundamentals, type RevenueKind, type FeeKind, type MetricDefinition, type DefinitionComponent } from "./fundamentals";

type Row = Record<string, unknown>;
type Review = { methodology: Record<string, string | null>; defillamaId?: string; revenueKind: RevenueKind; feeKind: FeeKind; holderShareReviewed: boolean; reviewedAt: string; reviewNote?: string };
const reviews = registry as Record<string, Review>;
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const method = (row: Row) => row.methodology && typeof row.methodology === "object" ? row.methodology as Row : {};

export function definitionReviewed(row: Row): boolean {
  const review = reviews[String(row.slug)];
  return !!review && (!review.defillamaId || String(row.defillamaId) === review.defillamaId) && sameMethodology(method(row), review.methodology);
}

export function sameMethodology(a: unknown, b: unknown): boolean {
  const left = a && typeof a === "object" ? a as Row : {};
  const right = b && typeof b === "object" ? b as Row : {};
  return ["Revenue", "Fees", "HoldersRevenue", "ProtocolRevenue", "SupplySideRevenue", "UserFees"].every(k => text(left[k]) === text(right[k]));
}

export function aggregateDefinitions(rows: Row[], groupKey: (slug: string) => string, field: "Revenue" | "Fees"): Map<string, MetricDefinition<RevenueKind | FeeKind>> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    if (typeof row.slug !== "string" || row.doublecounted === true) continue;
    const key = groupKey(row.slug);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return new Map([...groups].map(([key, components]) => {
    components.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
    const definitions: DefinitionComponent[] = components.map(row => {
      const slug = String(row.slug), review = reviews[slug], definition = text(method(row)[field]);
      const matched = definitionReviewed(row);
      const decision=economicDecision(row,field),approved=decision?.disposition==="approved"||decision?.disposition==="reviewed-unavailable";
      return { slug, definition, kind: decision?decision.kind as RevenueKind|FeeKind:matched ? (field === "Revenue" ? review.revenueKind : review.feeKind) : "unknown", reviewedAt: decision?decision.evidence.reviewedAt:matched ? review.reviewedAt : null, reviewNote: matched ? review.reviewNote : undefined, source: `https://defillama.com/protocol/${encodeURIComponent(slug)}`, status: decision?approved?"matched":!definition?"missing":decision.changedFields.length?"changed":"unreviewed":matched ? "matched" : !definition ? "missing" : review ? "changed" : "unreviewed",...(decision?{decision}:{}) };
    });
    const kinds = new Set(definitions.map(d => d.kind));
    const duplicate = new Set(components.map(c => c.slug)).size !== components.length;
    const kind = duplicate || kinds.has("unknown") ? "unknown" : kinds.size === 1 ? definitions[0].kind : "mixed";
    const legacyFingerprint=hash([FUNDAMENTAL_VERSION,field,components.map(r=>[r.slug,r.name,method(r),r.parentProtocol??null]),components.map(row=>definitionReviewed(row)?field==="Revenue"?reviews[String(row.slug)].revenueKind:reviews[String(row.slug)].feeKind:"unknown")]);
    return [key, { kind, fingerprint: sourceEconomicPolicy()?hash(components.map((row,i)=>[row.slug,row.name,row.parentProtocol??null,metricSemanticIdentity(row,definitions[i].decision!)])):legacyFingerprint, components: definitions,...(sourceEconomicPolicy()?{physicalFingerprint:physicalSeriesFingerprint(components,field),legacyPhysicalFingerprint:legacyFingerprint}:{}) }];
  }));
}

export function physicalSeriesFingerprint(rows:Row[],metric:"Revenue"|"Fees"|"HoldersRevenue"):string {
  return hash(["reported-series-v1",metric,rows.filter(r=>r.doublecounted!==true).map(r=>[r.slug,r.defillamaId??null,r.name,r.module??null,r.parentProtocol??null,text(method(r)[metric])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
}

export function combineFundamentals(revenue: MetricDefinition<RevenueKind> | undefined, fees: MetricDefinition<FeeKind> | undefined, holders: Row[]): Fundamentals {
  holders = [...holders].sort((a,b) => String(a.slug).localeCompare(String(b.slug)));
  const empty = { kind: "unknown" as const, fingerprint: hash(null), components: [] };
  const r = revenue ?? empty, f = fees ?? empty;
  // A numerical equality or a holder classification cannot prove denominator coverage.
  const holderShareReviewed = r.components.length > 0 && r.components.every(c => c.status === "matched" && reviews[c.slug]?.holderShareReviewed)
    && r.components.every(c=>!c.decision||c.decision.basis==="legacy-definition-only")
    && holders.length > 0 && holders.every(h => definitionReviewed(h))
    && r.components.map(c => c.slug).sort().join() === holders.map(h => String(h.slug)).sort().join();
  const holderDefinitions: DefinitionComponent[] = holders.map(h => {
    const slug = String(h.slug), definition = text(method(h).HoldersRevenue), matched = definitionReviewed(h);
    const decision=economicDecision(h,"HoldersRevenue"),approved=decision?.disposition==="approved"||decision?.disposition==="reviewed-unavailable";
    return { slug, definition, kind: decision?decision.kind as RevenueKind:matched ? "holder_return" : "unknown", reviewedAt: decision?decision.evidence.reviewedAt:matched ? reviews[slug].reviewedAt : null, source: `https://defillama.com/protocol/${encodeURIComponent(slug)}`, status: decision?approved?"matched":!definition?"missing":decision.changedFields.length?"changed":"unreviewed":matched ? "matched" : !definition ? "missing" : reviews[slug] ? "changed" : "unreviewed",...(decision?{decision}:{}) };
  });
  return { version: FUNDAMENTAL_VERSION, revenue: r, fees: f, holders: holderDefinitions, holderShareReviewed, fingerprint: hash([r.fingerprint, f.fingerprint, holderDefinitions]),...(sourceEconomicPolicy()?{economicPolicy:sourceEconomicPolicy(),economicAsOf:new Date(sourceNow()).toISOString()}:{}) };
}
