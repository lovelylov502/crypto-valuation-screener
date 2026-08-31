export type RangeHandle = "min" | "max";

export function hasEligibleCurrentHolderValue(holderValue: {
  eligibleRunRate: number | null;
  rawTtm: number | null;
}): boolean {
  return (
    holderValue.eligibleRunRate !== null &&
    Number.isFinite(holderValue.eligibleRunRate) &&
    holderValue.eligibleRunRate > 0
  );
}

export function matchesRange(value: number | null, min: number, max: number): boolean {
  if (min <= 0 && max <= 0) return true;
  if (value === null) return false;
  if (min > 0 && value < min) return false;
  if (max > 0 && value > max) return false;
  return true;
}

export function parseFavoriteSlugs(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((slug): slug is string => typeof slug === "string" && slug.length > 0));
  } catch {
    return new Set();
  }
}

export function serializeFavoriteSlugs(slugs: Set<string>): string {
  return JSON.stringify([...slugs].sort());
}

export function parseStoredSelection<T extends string>(
  raw: string | null,
  validKeys: readonly T[],
  fallback: readonly T[],
): Set<T> {
  if (!raw) return new Set(fallback);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(fallback);
    const valid = new Set<string>(validKeys);
    const selected = parsed.filter(
      (key): key is T => typeof key === "string" && valid.has(key),
    );
    return selected.length > 0 ? new Set(selected) : new Set(fallback);
  } catch {
    return new Set(fallback);
  }
}

export function serializeStoredSelection<T extends string>(selection: Set<T>): string {
  return JSON.stringify([...selection].sort());
}

export function clampRangePosition(
  handle: RangeHandle,
  next: number,
  currentMin: number,
  currentMax: number,
): number {
  if (handle === "min") return Math.min(next, currentMax);
  return Math.max(next, currentMin);
}
