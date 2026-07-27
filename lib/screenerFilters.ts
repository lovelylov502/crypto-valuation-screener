export type RangeHandle = "min" | "max";
export type ValuationPreset = "undervalued" | "overvalued";

export function scoreRangeForPreset(preset: ValuationPreset): { min: number; max: number } {
  if (preset === "undervalued") return { min: 80, max: 0 };
  return { min: 0, max: 20 };
}

export function matchesRange(value: number | null, min: number, max: number): boolean {
  if (min <= 0 && max <= 0) return true;
  if (value === null) return false;
  if (min > 0 && value < min) return false;
  if (max > 0 && value > max) return false;
  return true;
}

export function isNewListing(
  listedAt: number | null,
  referenceIso: string,
  days = 30,
): boolean {
  if (listedAt === null || !Number.isFinite(listedAt)) return false;
  const referenceMs = Date.parse(referenceIso);
  if (!Number.isFinite(referenceMs)) return false;
  const ageMs = referenceMs - listedAt * 1000;
  return ageMs >= 0 && ageMs <= days * 24 * 60 * 60 * 1000;
}

export function isNewCandidate({
  listedAt,
  referenceIso,
  feesChange7d,
  fees30d,
  revenue30d,
  holderRevenue30d,
}: {
  listedAt: number | null;
  referenceIso: string;
  feesChange7d: number | null;
  fees30d: number | null;
  revenue30d: number | null;
  holderRevenue30d: number | null;
}): boolean {
  if (isNewListing(listedAt, referenceIso)) return true;
  const activity30d = Math.max(fees30d ?? 0, revenue30d ?? 0, holderRevenue30d ?? 0);
  return (feesChange7d ?? 0) >= 50 && activity30d >= 10_000;
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
