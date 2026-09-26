import { describe, expect, it } from "vitest";
import { addColumn, reorderColumn, showMetricPeriods } from "./columnOrder";
import { defaultPreferences, parseWorkspace, resetWorkspaceFilters } from "./workspacePreferences";
import type { SortKey } from "./screenerColumns";

describe("personal comparison layout", () => {
  it("moves in either direction without dropping columns or changing the others' order", () => {
    const columns: SortKey[] = ["price", "mcap", "psSales", "phr"];
    const moved = reorderColumn(columns, "phr", "mcap");
    expect(moved).toEqual(["price", "phr", "mcap", "psSales"]);
    expect(reorderColumn(moved, "phr", "psSales")).toEqual(columns);
    expect(columns).toEqual(["price", "mcap", "psSales", "phr"]);
    expect(reorderColumn(columns, "name", "price")).toBe(columns);
    expect(reorderColumn(columns, "price", "fdv")).toBe(columns);
  });
  it("adds a new period alongside the same metric, preserving custom order", () => {
    const columns: SortKey[] = ["phr90d", "phr", "price", "psSales", "pr", "mcap"];
    expect(addColumn(columns, "phr7d")).toEqual(["phr7d", "phr90d", "phr", "price", "psSales", "pr", "mcap"]);
    expect(addColumn(columns, "pr1y")).toEqual(["phr90d", "phr", "price", "psSales", "pr", "pr1y", "mcap"]);
    expect(addColumn(columns, "phr")).toBe(columns);
  });
  it("groups five periods even when previously scattered, without reordering other metrics", () => {
    const columns: SortKey[] = ["price", "phr", "psSales", "pr", "phr90d", "mcap", "phr7d"];
    const grouped = showMetricPeriods(columns, "phr");
    expect(grouped).toEqual(["price", "phr24h", "phr7d", "phr", "phr90d", "phr1y", "psSales", "pr", "mcap"]);
    expect(showMetricPeriods(grouped, "phr")).toEqual(grouped);
    expect(showMetricPeriods(["price"], "pr")).toEqual(["price", "pr24h", "pr7d", "pr", "pr90d", "pr1y"]);
  });
  it("restores an old v7 layout without losing its filters or exact column order", () => {
    const old = { columns: ["phr", "psSales", "price"], view: "holder", capital: "fdv", available: "holder", minMcap: 50_000_000, sortKey: "phr", sortDir: "asc" };
    expect(parseWorkspace(JSON.stringify(old))).toMatchObject({ ...old, view: "all", holderOnly: true, columns:["phr","price"], panel: "columns", sidebarOpen: false });
  });
  it("round-trips the last workspace, without reopening a settings popup", () => {
    const saved = { ...defaultPreferences(), panel: "filters" as const, sidebarOpen: false, search: "VVV", sortKey:"phr" as const, columns: ["phr", "pr"] as SortKey[] };
    expect(parseWorkspace(JSON.stringify(saved))).toEqual(saved);
    expect(resetWorkspaceFilters(saved)).toMatchObject({ panel: "filters", sidebarOpen: false, columns: saved.columns, search: "" });
  });
});
