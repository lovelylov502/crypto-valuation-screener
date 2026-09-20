import { createHash } from "node:crypto";
import registry from "./fundamentalDefinitions.json";
import { FUNDAMENTAL_VERSION, type Fundamentals, type RevenueKind, type FeeKind, type MetricDefinition, type DefinitionComponent } from "./fundamentals";

type Row = Record<string, unknown>;
type Review = { methodology: Record<string, string | null>; revenueKind: RevenueKind; feeKind: FeeKind; holderShareReviewed: boolean; reviewedAt: string; reviewNote?: string };
const reviews = registry as Record<string, Review>;
const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const method = (row: Row) => row.methodology && typeof row.methodology === "object" ? row.methodology as Row : {};

export function definitionReviewed(row: Row): boolean {
  const review = reviews[String(row.slug)];
  return !!review && ["Revenue", "Fees", "HoldersRevenue", "ProtocolRevenue", "SupplySideRevenue", "UserFees"].every(k => text(method(row)[k]) === text(review.methodology[k]));
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
      return { slug, definition, kind: matched ? (field === "Revenue" ? review.revenueKind : review.feeKind) : "unknown", reviewedAt: matched ? review.reviewedAt : null, reviewNote: matched ? review.reviewNote : undefined, source: `https://defillama.com/protocol/${encodeURIComponent(slug)}`, status: matched ? "matched" : !definition ? "missing" : review ? "changed" : "unreviewed" };
    });
    const kinds = new Set(definitions.map(d => d.kind));
    const duplicate = new Set(components.map(c => c.slug)).size !== components.length;
    const kind = duplicate || kinds.has("unknown") ? "unknown" : kinds.size === 1 ? definitions[0].kind : "mixed";
    return [key, { kind, fingerprint: hash([FUNDAMENTAL_VERSION, field, components.map(r => [r.slug, r.name, method(r), r.parentProtocol ?? null]), definitions.map(d => d.kind)]), components: definitions }];
  }));
}

export function combineFundamentals(revenue: MetricDefinition<RevenueKind> | undefined, fees: MetricDefinition<FeeKind> | undefined, holders: Row[]): Fundamentals {
  holders = [...holders].sort((a,b) => String(a.slug).localeCompare(String(b.slug)));
  const empty = { kind: "unknown" as const, fingerprint: hash(null), components: [] };
  const r = revenue ?? empty, f = fees ?? empty;
  // A numerical equality or a holder classification cannot prove denominator coverage.
  const holderShareReviewed = r.components.length > 0 && r.components.every(c => c.status === "matched" && reviews[c.slug]?.holderShareReviewed)
    && holders.length > 0 && holders.every(h => definitionReviewed(h))
    && r.components.map(c => c.slug).sort().join() === holders.map(h => String(h.slug)).sort().join();
  const holderDefinitions: DefinitionComponent[] = holders.map(h => {
    const slug = String(h.slug), definition = text(method(h).HoldersRevenue), matched = definitionReviewed(h);
    return { slug, definition, kind: matched ? "holder_return" : "unknown", reviewedAt: matched ? reviews[slug].reviewedAt : null, source: `https://defillama.com/protocol/${encodeURIComponent(slug)}`, status: matched ? "matched" : !definition ? "missing" : reviews[slug] ? "changed" : "unreviewed" };
  });
  return { version: FUNDAMENTAL_VERSION, revenue: r, fees: f, holders: holderDefinitions, holderShareReviewed, fingerprint: hash([r.fingerprint, f.fingerprint, holderDefinitions]) };
}
