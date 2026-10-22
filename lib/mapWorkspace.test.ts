import { describe, expect, it } from "vitest";
import { buildTableCatalog, queryTableCatalog } from "./tableCatalog";
import { tableFixture, tableReference } from "./tableTestFixtures";
import { defaultPreferences } from "./workspacePreferences";
import type { DiscoveryRow } from "./discoveryTypes";
import { defaultMapFilters, mapFiltersFromTable, mapNamePosition, matchesMapFilters, nearestMapPoint, parseMapWorkspace } from "./mapWorkspace";

function coin(): DiscoveryRow {
  const data = tableFixture(1), { catalog } = buildTableCatalog(data, tableReference(data));
  const row = queryTableCatalog(catalog, defaultPreferences(), [], 1, 100).rows[0];
  return { ...row, mcap: 10_000_000, fdv: 1_000_000_000, revenue30d: 200, holders30d: 0,
    cells: { ...row.cells, pr: { value: 8, reason: "", basis: "completed_daily" } },
    past: { 7: { point: { date: "2026-10-15", pr: 6, revenue: 300 }, reason: "" }, 30: { point: { date: "2026-09-22", pr: 10, revenue: 100 }, reason: "" } } };
}
describe("map conditions", () => {
  it("uses latest circulating cap even while P/R uses FDV, preserving fractional and inclusive bounds", () => {
    const row = coin(), filters = { ...defaultMapFilters(), capital: "fdv" as const, minMcap: 10_000_000, maxMcap: 10_000_000 };
    expect(matchesMapFilters(row, filters)).toBe(true);
    expect(matchesMapFilters({ ...row, mcap: 9_999_999.99 }, filters)).toBe(false);
    expect(matchesMapFilters({ ...row, mcap: null }, filters)).toBe(false);
    expect(matchesMapFilters({ ...row, mcap: null }, defaultMapFilters())).toBe(true);
  });
  it("combines growth and falling multiples using the chosen historical 30-day endpoint", () => {
    const filters = { ...defaultMapFilters(), revenueGrowing: true, prFalling: true };
    expect(matchesMapFilters(coin(), filters)).toBe(true);
    expect(matchesMapFilters(coin(), { ...filters, period: 7 })).toBe(false);
    expect(matchesMapFilters({ ...coin(), past: {} }, filters)).toBe(false);
    expect(matchesMapFilters({ ...coin(), revenue30d: 100 }, filters)).toBe(false);
    expect(matchesMapFilters(coin(), { ...filters, prLimit: true, maxPr: 8 })).toBe(true);
    expect(matchesMapFilters(coin(), { ...filters, prLimit: true, maxPr: 7.9 })).toBe(false);
  });
  it("does not relabel the table's seven-day threshold as a 30-day map threshold", () => {
    expect(mapFiltersFromTable({ ...defaultPreferences(), rangeWindow: 7, maxPr: 5 })).toMatchObject({ prLimit: false });
    expect(mapFiltersFromTable({ ...defaultPreferences(), rangeWindow: 30, maxPr: 5 })).toMatchObject({ prLimit: true, maxPr: 5 });
  });
  it("round-trips named conditions with inherited filters, without rounding dollar amounts", () => {
    const filters = { ...defaultMapFilters(), minMcap: 100_000.125, maxMcap: 8_000_000, capital: "fdv", period: 180 };
    const inherited = { ...defaultPreferences(), search: "AERO", growingOnly: true };
    const value = { filters, inherited, selected: "연구", saved: [{ name: "연구", filters, inherited }] };
    expect(parseMapWorkspace(JSON.stringify(value))).toEqual(value);
    expect(parseMapWorkspace("broken").saved).toEqual([]);
    expect(parseMapWorkspace(JSON.stringify({ filters: { minMcap: -1, maxPr: "8", period: 999 }, saved: [null, {}] })).filters).toEqual(defaultMapFilters());
  });
});
describe("dense map picking", () => {
  const point = { slug: "point", x: 50, y: 50, px: 70, py: 60, hasPast: true };
  const crossing = { slug: "crossing", x: 110, y: 50, px: 0, py: 50, hasPast: true };
  it("selects the current point instead of the arrow crossing it, while still supporting arrow clicks", () => {
    expect(nearestMapPoint([point, crossing], 52, 50)?.slug).toBe("point");
    expect(nearestMapPoint([point, crossing], 12, 51)?.slug).toBe("crossing");
    expect(nearestMapPoint([point, crossing], 12, 70)).toBeUndefined();
  });
  it("keeps a nearby active coin stable, then transfers when the pointer clearly approaches its neighbor", () => {
    const neighbor = { ...point, slug: "neighbor", x: 60 };
    expect(nearestMapPoint([point, neighbor], 55.5, 50, "point")?.slug).toBe("point");
    expect(nearestMapPoint([point, neighbor], 59, 50, "point")?.slug).toBe("neighbor");
  });
  it("places the name within the chart and favors a gap beside the current dot", () => {
    const nearRight = { ...point, slug: "right", x: 75, y: 35 };
    const label = mapNamePosition(point, [point, nearRight], 40, 200, 150);
    expect(label.x).toBeLessThan(point.x);
    expect(label.x).toBeGreaterThanOrEqual(8);
    const edge = mapNamePosition({ ...point, x: 195, y: 3 }, [point], 80, 200, 150);
    expect(edge.x + 80).toBeLessThanOrEqual(192); expect(edge.y).toBeGreaterThanOrEqual(4);
  });
});
