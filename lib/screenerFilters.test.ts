import { describe, expect, it } from "vitest";
import { clampRangePosition, matchesRange, scoreRangeForPreset } from "./screenerFilters";

describe("clampRangePosition", () => {
  it("prevents the minimum handle from crossing the maximum handle", () => {
    expect(clampRangePosition("min", 80, 30, 70)).toBe(70);
  });

  it("prevents the maximum handle from crossing the minimum handle", () => {
    expect(clampRangePosition("max", 20, 30, 70)).toBe(30);
  });
});

describe("scoreRangeForPreset", () => {
  it("sets the undervalued preset to scores of 80 and above", () => {
    expect(scoreRangeForPreset("undervalued")).toEqual({ min: 80, max: 0 });
  });

  it("sets the overvalued preset to scores of 20 and below", () => {
    expect(scoreRangeForPreset("overvalued")).toEqual({ min: 0, max: 20 });
  });
});

describe("matchesRange", () => {
  it("applies optional bounds and rejects missing values when a bound is active", () => {
    expect(matchesRange(null, 80, 0)).toBe(false);
    expect(matchesRange(85, 80, 0)).toBe(true);
    expect(matchesRange(21, 0, 20)).toBe(false);
  });
});
