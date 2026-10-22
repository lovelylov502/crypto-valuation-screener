import { beforeEach, expect, it, vi } from "vitest";
import { defaultPreferences } from "./workspacePreferences";

const read = vi.hoisted(() => vi.fn());
vi.mock("./discoveryRead", () => ({ readDiscovery: read }));
import { GET, POST } from "../app/api/discovery/route";
beforeEach(() => { read.mockReset(); read.mockResolvedValue({ rows: [], total: 0 }); });
it("reads large saved lists through a bounded POST without putting personal notes or long lists into a URL", async () => {
  const favorites = Array.from({ length: 1000 }, (_, i) => `parent#asset-${i}`);
  const response = await POST(new Request("https://test/api/discovery", { method: "POST", body: JSON.stringify({ mode: "watchlist", prefs: defaultPreferences(), favorites, page: 1 }) }));
  expect(response.status).toBe(200); expect(read.mock.calls[0][1]).toHaveLength(1000);
  expect((await POST(new Request("https://test/api/discovery", { method: "POST", body: "{" }))).status).toBe(400);
});
it("shares the complete table filter when explicitly opening its map", async () => {
  const prefs = { ...defaultPreferences(), search: "aero", minSourceAmount: 100, capital: "fdv", view: "favorites" };
  const response = await GET(new Request("https://test/api/discovery?" + new URLSearchParams({ mode: "map", prefs: JSON.stringify(prefs), favorites: "alpha,beta", page: "2" })));
  expect(response.status).toBe(200); expect(read).toHaveBeenCalledWith(prefs, ["alpha", "beta"], 2, "map");
});
it("keeps watchlist results independent of the table's filters", async () => {
  await GET(new Request("https://test/api/discovery?" + new URLSearchParams({ mode: "watchlist", prefs: JSON.stringify({ ...defaultPreferences(), search: "hidden", minSourceAmount: 999999, capital: "fdv" }), favorites: "alpha" })));
  expect(read).toHaveBeenCalledWith({ ...defaultPreferences(), capital: "fdv", view: "favorites" }, ["alpha"], 1, "watchlist");
});
it("rejects unbounded queries and returns a safe failure when the publication is unavailable", async () => {
  for (const query of ["page=0", "page=1001", "mode=unknown", "prefs=" + "x".repeat(10001)]) expect((await GET(new Request(`https://test/api/discovery?${query}`))).status).toBe(400);
  expect(read).not.toHaveBeenCalled(); read.mockRejectedValue(Error("private backend diagnostic"));
  const response = await GET(new Request("https://test/api/discovery")); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private");
});
