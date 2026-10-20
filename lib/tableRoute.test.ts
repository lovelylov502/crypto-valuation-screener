import { beforeEach, expect, it, vi } from "vitest";
import { tableFixture, tableReference } from "./tableTestFixtures";
import { queryScreener } from "./screenerQuery";
import { defaultPreferences } from "./workspacePreferences";
import type { PublicationJournal } from "./publicationTypes";
const mocks = vi.hoisted(() => ({ full: vi.fn(), summary: vi.fn(), table: vi.fn(), detail: vi.fn(), Changed: class TablePublicationChanged extends Error {} }));
vi.mock("./serverScreener", () => ({ getScreener: mocks.full }));
vi.mock("./dailyValuationRead", () => ({ readDailyComparisonBatch: mocks.summary }));
vi.mock("./tableRead", () => ({ readTablePage: mocks.table, readTableDetail: mocks.detail, TablePublicationChanged: mocks.Changed }));
import { GET as screener } from "../app/api/screener/route";
import { GET as detail } from "../app/api/coin/route";
const request = (path: string) => new Request(`https://test${path}`);
beforeEach(() => { vi.clearAllMocks(); });
it("keeps the default full snapshot/page contract byte-for-value equivalent and reserves table mode for explicit requests", async () => {
  const data = tableFixture(3), publication = { published: tableReference(data) } as PublicationJournal, full = { ...data, publication }, expected = queryScreener(full, defaultPreferences());
  mocks.full.mockResolvedValue(full); mocks.summary.mockResolvedValue({ exact: "existing daily comparison path" });
  const response = await screener(request("/api/screener")); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...expected, valuationComparison: { exact: "existing daily comparison path" } }); expect(response.headers.has("X-Tovenit-Read-Model")).toBe(false); expect(mocks.table).not.toHaveBeenCalled();
});
it("serves the explicit minimal DTO with a prepared/fallback transport witness and no fullcoin read", async () => {
  mocks.table.mockResolvedValue({ schema: 1, view: "table", rows: [{ slug: "aave", identity: "gecko:aave" }], readModel: "prepared" });
  const response = await screener(request("/api/screener?view=table&favorites=parent%23alpha&page=2&size=50"));
  expect(response.status).toBe(200); expect(response.headers.get("X-Tovenit-Read-Model")).toBe("prepared"); expect(await response.json()).not.toHaveProperty("coins");
  expect(mocks.table.mock.calls[0].slice(1)).toEqual([["parent#alpha"], 2, 50]); expect(mocks.full).not.toHaveBeenCalled(); expect(mocks.summary).not.toHaveBeenCalled();
});
it("requires exact detail publication/identity and returns409 for a stale dialog rather than mixing fullcoin evidence", async () => {
  const url = "/api/coin?slug=parent%23aave&publicationId=data-current&identity=gecko%3Aaave";
  mocks.detail.mockResolvedValue({ schema: 1, publicationId: "data-current", identity: "gecko:aave", coin: { slug: "parent#aave", original: "full evidence" }, readModel: "prepared" });
  const response = await detail(request(url)); expect(response.headers.get("X-Tovenit-Read-Model")).toBe("prepared"); expect((await response.json()).coin.original).toBe("full evidence");
  expect(mocks.detail).toHaveBeenCalledWith("parent#aave", "data-current", "gecko:aave");
  mocks.detail.mockRejectedValue(new mocks.Changed()); expect((await detail(request(url))).status).toBe(409);
  mocks.detail.mockClear(); expect((await detail(request("/api/coin?slug=aave&publicationId=data-current"))).status).toBe(400); expect(mocks.detail).not.toHaveBeenCalled();
});
