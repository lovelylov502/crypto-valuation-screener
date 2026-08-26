import { describe, expect, it } from "vitest";
import {
  clampRangePosition,
  isNewCandidate,
  isNewListing,
  matchesRange,
  parseFavoriteSlugs,
  scoreRangeForPreset,
  serializeFavoriteSlugs,
} from "./screenerFilters";

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

describe("isNewListing", () => {
  const reference = "2026-07-15T12:00:00.000Z";

  it("marks listings from the last 30 days as new", () => {
    const listedAt = Date.parse("2026-07-01T00:00:00.000Z") / 1000;
    expect(isNewListing(listedAt, reference)).toBe(true);
  });

  it("rejects old, missing, and future listing timestamps", () => {
    expect(isNewListing(Date.parse("2026-05-01T00:00:00.000Z") / 1000, reference)).toBe(false);
    expect(isNewListing(null, reference)).toBe(false);
    expect(isNewListing(Date.parse("2026-07-16T00:00:00.000Z") / 1000, reference)).toBe(false);
  });

  it("keeps the 30-day boundary inclusive and rejects invalid references", () => {
    expect(isNewListing(Date.parse("2026-06-15T12:00:00.000Z") / 1000, reference)).toBe(true);
    expect(isNewListing(Date.parse("2026-06-15T11:59:59.000Z") / 1000, reference)).toBe(false);
    expect(isNewListing(Date.parse("2026-07-01T00:00:00.000Z") / 1000, "invalid")).toBe(false);
  });
});

describe("isNewCandidate", () => {
  const referenceIso = "2026-07-15T12:00:00.000Z";

  it("detects a recently listed project", () => {
    expect(isNewCandidate({
      listedAt: Date.parse("2026-07-01T00:00:00.000Z") / 1000,
      referenceIso,
      feesChange7d: null,
      fees30d: null,
      revenue30d: null,
      holderRevenue30d: null,
    })).toBe(true);
  });

  it("detects an active project with at least 50 percent weekly fee growth", () => {
    expect(isNewCandidate({
      listedAt: null,
      referenceIso,
      feesChange7d: 50,
      fees30d: 12_000,
      revenue30d: null,
      holderRevenue30d: null,
    })).toBe(true);
  });

  it("rejects old projects whose activity is too small", () => {
    expect(isNewCandidate({
      listedAt: null,
      referenceIso,
      feesChange7d: 200,
      fees30d: 9_999,
      revenue30d: null,
      holderRevenue30d: null,
    })).toBe(false);
  });

  it("requires finite weekly growth and finite 30-day activity", () => {
    const candidate = {
      listedAt: null,
      referenceIso,
      fees30d: 50_000,
      revenue30d: null,
      holderRevenue30d: null,
    };
    expect(isNewCandidate({ ...candidate, feesChange7d: 49.9 })).toBe(false);
    expect(isNewCandidate({ ...candidate, feesChange7d: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isNewCandidate({ ...candidate, feesChange7d: Number.NaN })).toBe(false);
    expect(isNewCandidate({ ...candidate, feesChange7d: 50, fees30d: Number.POSITIVE_INFINITY })).toBe(false);
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
