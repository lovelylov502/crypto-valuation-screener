import { describe, expect, it } from "vitest";
import {
  clampRangePosition,
  hasEligibleCurrentHolderValue,
  matchesRange,
  parseFavoriteSlugs,
  parseStoredSelection,
  serializeFavoriteSlugs,
  serializeStoredSelection,
} from "./screenerFilters";

describe("hasEligibleCurrentHolderValue", () => {
  it("requires a positive eligible current run-rate and ignores positive raw TTM", () => {
    expect(
      hasEligibleCurrentHolderValue({ eligibleRunRate: null, rawTtm: 25_657_324 }),
    ).toBe(false);
    expect(
      hasEligibleCurrentHolderValue({ eligibleRunRate: 0, rawTtm: 554_426_081 }),
    ).toBe(false);
    expect(
      hasEligibleCurrentHolderValue({ eligibleRunRate: 12_166_667, rawTtm: 1_000_000 }),
    ).toBe(true);
  });
});

describe("clampRangePosition", () => {
  it("prevents the minimum handle from crossing the maximum handle", () => {
    expect(clampRangePosition("min", 80, 30, 70)).toBe(70);
  });

  it("prevents the maximum handle from crossing the minimum handle", () => {
    expect(clampRangePosition("max", 20, 30, 70)).toBe(30);
  });
});

describe("matchesRange", () => {
  it("applies optional bounds and rejects missing values when a bound is active", () => {
    expect(matchesRange(null, 80, 0)).toBe(false);
    expect(matchesRange(85, 80, 0)).toBe(true);
    expect(matchesRange(21, 0, 20)).toBe(false);
  });
});

describe("favorite slug storage", () => {
  it("keeps only unique string slugs from stored JSON", () => {
    expect([...parseFavoriteSlugs('["zinc","quick","zinc",3]')]).toEqual(["zinc", "quick"]);
  });

  it("falls back to an empty set for malformed storage", () => {
    expect([...parseFavoriteSlugs("not-json")]).toEqual([]);
  });

  it("serializes favorites in stable order", () => {
    expect(serializeFavoriteSlugs(new Set(["zinc", "quick"]))).toBe('["quick","zinc"]');
  });
});

describe("column selection storage", () => {
  const valid = ["score", "mcap", "oneYear"] as const;
  const fallback = ["score", "mcap"] as const;

  it("keeps valid stored columns and drops unknown values", () => {
    expect([...parseStoredSelection('["mcap","unknown","oneYear"]', valid, fallback)])
      .toEqual(["mcap", "oneYear"]);
  });

  it("uses the fallback when storage is malformed or has no valid columns", () => {
    expect([...parseStoredSelection("not-json", valid, fallback)]).toEqual(["score", "mcap"]);
    expect([...parseStoredSelection('["unknown"]', valid, fallback)]).toEqual(["score", "mcap"]);
  });

  it("serializes selected columns in stable order", () => {
    expect(serializeStoredSelection(new Set(["oneYear", "mcap"]))).toBe('["mcap","oneYear"]');
  });
});
