import { describe, expect, it } from "vitest";
import {
  clampRangePosition,
  hasEligibleCurrentHolderValue,
  matchesRange,
  parseFavoriteSlugs,
  parseStoredSelection,
  serializeFavoriteSlugs,
  serializeStoredSelection,
  sliderToUsd,
  usdToSlider,
} from "./screenerFilters";
import { defaultPreferences, parseWorkspace } from "./workspacePreferences";
import { sample } from "./testFixtures";
import { assembleScreener } from "./screener";
import { queryScreener } from "./screenerQuery";

describe("decimal circulating-cap ranges", () => {
  it("represents and restores sub-million bounds exactly without the inactive position", () => {
    for (const usd of [0.1, 1, 100000, 250000, 125000.5, 1000000, 1e11]) {
      expect(usdToSlider(usd)).toBeGreaterThan(0);
      expect(sliderToUsd(usdToSlider(usd))).toBe(usd);
      expect(sliderToUsd(Number(usdToSlider(usd).toPrecision(15)))).toBe(usd);
    }
    expect(usdToSlider(0)).toBe(0);
    expect(sliderToUsd(0)).toBe(0);
    expect(usdToSlider(100000)).toBeLessThan(usdToSlider(250000));
    expect(sliderToUsd(100)).toBe(1e11);
  });
  it("persists decimal-million minimum and maximum as exact USD bounds", () => {
    const saved = { ...defaultPreferences(), minMcap: 0.1 * 1e6, maxMcap: 0.25 * 1e6 };
    const restored = parseWorkspace(JSON.stringify(saved));
    expect(restored.minMcap).toBe(100000);
    expect(restored.maxMcap).toBe(250000);
    expect(restored.minMcap / 1e6).toBe(0.1);
    expect(restored.maxMcap / 1e6).toBe(0.25);
  });
  it("includes exact 100K boundaries and excludes amounts immediately outside them", () => {
    const rows = assembleScreener([
      sample({ slug: "below", mcap: 99999.99 }), sample({ slug: "equal", mcap: 100000 }),
      sample({ slug: "above", mcap: 100000.01 }), sample({ slug: "missing", mcap: null }),
    ], "2026-10-11T11:50:00Z", []);
    const prefs = parseWorkspace(JSON.stringify({ ...defaultPreferences(), minMcap: sliderToUsd(usdToSlider(100000)), maxMcap: 100000 }));
    expect(queryScreener(rows, prefs).coins.map(c => c.slug)).toEqual(["equal"]);
    expect(new Set(queryScreener(rows, { ...prefs, maxMcap: 0 }).coins.map(c => c.slug))).toEqual(new Set(["equal", "above"]));
    expect(new Set(queryScreener(rows, { ...prefs, minMcap: 0 }).coins.map(c => c.slug))).toEqual(new Set(["below", "equal"]));
  });
});

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
