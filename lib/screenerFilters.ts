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

export function clampRangePosition(
  handle: RangeHandle,
  next: number,
  currentMin: number,
  currentMax: number,
): number {
  if (handle === "min") return Math.min(next, currentMax);
  return Math.max(next, currentMin);
}
