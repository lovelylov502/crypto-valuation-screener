import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildTableCatalog } from "./tableCatalog";
import { tableFixture, tableReference } from "./tableTestFixtures";
import { defaultPreferences } from "./workspacePreferences";
const mocks = vi.hoisted(() => ({ current: vi.fn(), set: vi.fn(), file: vi.fn(), database: vi.fn() }));
vi.mock("./tableRead", () => ({ currentCatalog: mocks.current }));
vi.mock("./readArtifacts", () => ({ currentArtifactSet: mocks.set, readArtifact: mocks.file }));
vi.mock("./dailyValuationRead", () => ({ readMapHistoryBatch: mocks.database }));
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  const data = tableFixture(420), ref = tableReference(data), set = { ...buildTableCatalog(data, ref), publication: { published: ref }, manifest: {} };
  mocks.current.mockResolvedValue(set); mocks.set.mockResolvedValue(set); mocks.file.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
it("uses prepared map files across pages and capital bases without SQL", async () => {
  const { readDiscovery } = await import("./discoveryRead");
  for (const capital of ["fdv", "mcap"] as const) for (const page of [1, 2, 3, 1]) {
    const result = await readDiscovery({ ...defaultPreferences(), capital }, [], page, "map");
    expect(result.historyStatus).toBe("ready"); expect(result.rows.length).toBeGreaterThan(0);
  }
  expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.file.mock.calls.every(call => call[1] === "map.json.gz")).toBe(true);
});
it("keeps dots and explicit missing comparisons on file failure without a SQL fallback", async () => {
  mocks.file.mockRejectedValue(Error("private connection information"));
  const result = await (await import("./discoveryRead")).readDiscovery(defaultPreferences(), [], 1, "map");
  expect(result.historyStatus).toBe("unavailable"); expect(result.rows.length).toBeGreaterThan(0);
  expect(result.rows.every(row => row.past[30]?.point === null && row.past[30]?.revenue === null)).toBe(true);
  expect(mocks.database).not.toHaveBeenCalled(); expect(mocks.file).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain("private");
});
it("rejects another publication's history and skips history for watchlists", async () => {
  mocks.set.mockResolvedValue({ catalog: { publicationId: "data-other" } });
  const { readDiscovery } = await import("./discoveryRead");
  expect((await readDiscovery(defaultPreferences(), [], 1, "map")).historyStatus).toBe("unavailable");
  expect((await readDiscovery(defaultPreferences(), [], 1, "watchlist")).historyStatus).toBe("not-requested");
  expect(mocks.file).not.toHaveBeenCalled(); expect(mocks.database).not.toHaveBeenCalled();
});
