import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildTableCatalog } from "./tableCatalog";
import { tableFixture, tableReference } from "./tableTestFixtures";
import { defaultPreferences } from "./workspacePreferences";

const mocks = vi.hoisted(() => ({ current: vi.fn(), history: vi.fn() }));
vi.mock("./tableRead", () => ({ currentCatalog: mocks.current }));
vi.mock("./dailyValuationRead", () => ({ readMapHistoryBatch: mocks.history }));
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.resetModules(); mocks.current.mockReset(); mocks.history.mockReset();
  const data = tableFixture(20), reference = tableReference(data);
  mocks.current.mockResolvedValue({ ...buildTableCatalog(data, reference), publication: { published: reference } });
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.history.mockResolvedValue(new Map());
});
it("recovers once from a disconnected history read without dropping the current map rows", async () => {
  mocks.history.mockRejectedValueOnce(Object.assign(Error("private connection information"), { cause: { code: "UND_ERR_SOCKET" } }));
  const { readDiscovery } = await import("./discoveryRead");
  const result = await readDiscovery(defaultPreferences(), [], 1, "map");
  expect(result.historyStatus).toBe("ready"); expect(result.rows.length).toBeGreaterThan(0);
  expect(mocks.history).toHaveBeenCalledTimes(2); expect(console.error).not.toHaveBeenCalled();
});
it("limits disconnected reads to two attempts and leaves missing comparisons explicit", async () => {
  mocks.history.mockRejectedValue(Object.assign(Error("private connection information"), { code: "ECONNRESET" }));
  const { readDiscovery } = await import("./discoveryRead");
  const result = await readDiscovery(defaultPreferences(), [], 1, "map");
  expect(mocks.history).toHaveBeenCalledTimes(2); expect(result.historyStatus).toBe("unavailable");
  expect(result.rows.length).toBeGreaterThan(0);
  expect(result.rows.every(row => row.past[30]?.point === null && row.past[30]?.revenue === null)).toBe(true);
  expect(console.error).toHaveBeenCalledWith("discovery_history_unavailable", { codes: ["ECONNRESET"], reason: "history_read_failed" });
});
it("does not retry integrity failures or expose private error details", async () => {
  mocks.history.mockRejectedValue(Error("daily_valuation_invalid_source_reference private details"));
  const { readDiscovery } = await import("./discoveryRead");
  const result = await readDiscovery(defaultPreferences(), [], 1, "map");
  expect(mocks.history).toHaveBeenCalledOnce(); expect(result.historyStatus).toBe("unavailable");
  expect(JSON.stringify(result)).not.toContain("private details");
});
