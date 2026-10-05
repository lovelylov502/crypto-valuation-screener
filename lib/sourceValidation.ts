import type { SourceObservation } from "./types";
import { sourceObservedAt } from "./sourceBundle";

type Row = Record<string, unknown>;
const DAY = 86400;
const record = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const financialFields = ["total24h", "total48hto24h", "total7d", "total14dto7d", "total30d", "total60dto30d", "total1y"];

/** A census cannot silently discard unparseable or duplicate source membership. */
export function validateIdentityCensus(value: unknown, key: "slug" | "id", allowEmpty = false): Row[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length)) throw new Error("Source identity census is empty or invalid");
  const seen = new Set<string>();
  for (const row of value) {
    if (!record(row) || typeof row[key] !== "string" || !row[key].trim() || seen.has(row[key])) throw new Error(`Source identity census has invalid or duplicate ${key}`);
    seen.add(row[key]);
  }
  return value;
}

function issue(observations: SourceObservation[], url: string, sourceSlugs: string[], reason: "schema_mismatch" | "value_conflict") {
  const slugs = [...new Set(sourceSlugs)].sort();
  if (!slugs.length) throw new Error("Source schema has no accountable identity");
  if (!observations.some(s => s.url === url && s.reason === reason && JSON.stringify(s.sourceSlugs) === JSON.stringify(slugs)))
    observations.push({ url, observedAt: sourceObservedAt(url), status: "withheld", reason, sourceSlugs: slugs });
}

/** Missing/null is legitimate absence; a present malformed amount is a scoped source defect. */
export function validateProtocolFinancialRows(value: unknown, url: string, observations: SourceObservation[]): Row[] {
  return validateNumericRows(validateIdentityCensus(value, "slug", true), "slug", financialFields, url, observations);
}

export function validateDirectoryRows(value: unknown, key: "slug" | "id", url: string, observations: SourceObservation[]): Row[] {
  return validateNumericRows(validateIdentityCensus(value, key), key, ["mcap", "tvl"], url, observations);
}

function validateNumericRows(rows: Row[], key: "slug" | "id", fields: string[], url: string, observations: SourceObservation[]): Row[] {
  return rows.map(row => {
    const invalid = fields.filter(field => row[field] != null && !finite(row[field]));
    if (!invalid.length) return row;
    issue(observations, url, [row[key] as string], "schema_mismatch");
    return { ...row, ...Object.fromEntries(invalid.map(field => [field, null])) };
  });
}

/** Merge duplicate dates by cell; conflicting amounts are removed and never last-write-wins. */
export function validateHistoryBreakdown(protocols: Row[], chart: unknown, url: string, now: number, observations: SourceObservation[]): unknown[] {
  if (!Array.isArray(chart)) throw new Error("Source history has invalid schema");
  const names = new Map<string, string[]>();
  for (const p of protocols) {
    if (typeof p.name !== "string" || !p.name || typeof p.slug !== "string" || !p.slug) throw new Error("Source history identity has invalid schema");
    names.set(p.name, [...(names.get(p.name) ?? []), p.slug]);
  }
  const rows = new Map<number, Row>(), blocked = new Map<number, Set<string>>();
  const end = Math.floor(now / 1000 / DAY) * DAY - DAY;
  for (const point of chart) {
    if (!Array.isArray(point) || !Number.isInteger(point[0]) || point[0] % DAY !== 0 || !record(point[1])) throw new Error("Source history point has invalid schema");
    const [timestamp, values] = point as [number, Row];
    if (timestamp > end || timestamp <= end - 730 * DAY) continue;
    const row = rows.get(timestamp) ?? {}, excluded = blocked.get(timestamp) ?? new Set<string>();
    for (const [name, value] of Object.entries(values)) {
      const slugs = names.get(name);
      if (!slugs || value == null) continue;
      if (!finite(value)) {
        issue(observations, url, slugs, "schema_mismatch");
        excluded.add(name); delete row[name];
      } else if (!excluded.has(name)) {
        if (finite(row[name]) && row[name] !== value) {
          issue(observations, url, slugs, "value_conflict");
          excluded.add(name); delete row[name];
        } else row[name] = value;
      }
    }
    rows.set(timestamp, row); blocked.set(timestamp, excluded);
  }
  return [...rows].sort(([a], [b]) => a - b);
}

/** A summary's identity is already checked by its adapter, so malformed cells stay local. */
export function validateSummaryHistory(chart: unknown, url: string, sourceSlugs: string[], now: number, observations: SourceObservation[]): [number, number][] {
  if (!Array.isArray(chart)) { issue(observations, url, sourceSlugs, "schema_mismatch"); return []; }
  const rows = new Map<number, number>(), blocked = new Set<number>();
  const end = Math.floor(now / 1000 / DAY) * DAY - DAY;
  for (const point of chart) {
    if (!Array.isArray(point) || !Number.isInteger(point[0]) || point[0] % DAY !== 0) {
      issue(observations, url, sourceSlugs, "schema_mismatch"); continue;
    }
    const timestamp = point[0], value = point[1];
    if (timestamp > end || timestamp <= end - 730 * DAY || value == null) continue;
    if (!finite(value)) {
      issue(observations, url, sourceSlugs, "schema_mismatch"); blocked.add(timestamp); rows.delete(timestamp);
    } else if (!blocked.has(timestamp)) {
      if (rows.has(timestamp) && rows.get(timestamp) !== value) {
        issue(observations, url, sourceSlugs, "value_conflict"); blocked.add(timestamp); rows.delete(timestamp);
      } else rows.set(timestamp, value);
    }
  }
  return [...rows].sort(([a], [b]) => a - b);
}
