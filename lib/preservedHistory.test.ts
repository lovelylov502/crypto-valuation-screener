import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("rechecks previously complete unreviewed parent sources without assigning an economic classification", async () => {
  vi.resetModules();
  const at = Date.now(), day = Math.floor(at / 86400000) * 86400 - 86400;
  const child = { slug: "new-child", name: "New Child", defillamaId: "99999", parentProtocol: "parent#new", linkedProtocols: ["New"], total30d: 30, methodology: { Revenue: "Unreviewed receipts" } };
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    requests.push(input);
    const body = input.includes("/overview/") ? { protocols: [child], totalDataChartBreakdown: [] }
      : { defillamaId: "parent#new", childProtocols: [child], totalDataChart: Array.from({ length: 30 }, (_, i) => [day - i * 86400, 1]) };
    return new Response(JSON.stringify(body));
  }));
  const { fetchRevenueHistory } = await import("./revenueSource");
  const { definitionReviewed } = await import("./fundamentalSource");
  const observations: import("./types").SourceObservation[] = [];
  const result = await fetchRevenueHistory(observations, new Map([["parent#new", [30]]]));
  expect(requests.some(url => url.includes("/summary/fees/new?"))).toBe(true);
  expect(result["parent#new"].periods[30]).toMatchObject({ total: 30, reportedDays: 30 });
  expect(result["parent#new"].periods[1].end).toBe(new Date(day * 1000).toISOString().slice(0, 10));
  expect(definitionReviewed(child)).toBe(false);
  expect(observations.some(o => o.status === "error")).toBe(false);
});
