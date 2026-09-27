import { afterEach, expect, it, vi } from "vitest";
import reviews from "./fundamentalDefinitions.json";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

it("recovers all-missing child series from the exact parent, including an empty overview chart", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T00:01:00Z"));
  const end = Date.parse("2026-09-27") / 1000, key = "parent#fake-world-assets";
  const members = ["v1","v2"].map((v,i) => ({slug:`fake-world-assets-${v}`,name:`Fake World Assets ${v.toUpperCase()}`,defillamaId:i?"8767":"8292",parentProtocol:key,total30d:100,linkedProtocols:["Fake World Assets"],methodology:reviews[`fake-world-assets-${v}` as keyof typeof reviews].methodology}));
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/overview/")) return new Response(JSON.stringify({protocols:members,totalDataChartBreakdown:[]}));
    if (url.includes("/fake-world-assets?")) return new Response(JSON.stringify({defillamaId:key,childProtocols:members,totalDataChart:Array.from({length:30},(_,i)=>[end-i*86400,10])}));
    return new Response("",{status:404});
  });
  vi.stubGlobal("fetch",fetcher);
  const { fetchRevenueHistory } = await import("./revenueSource");
  const result = await fetchRevenueHistory([]);
  expect(result[key].periods[30]).toMatchObject({total:300,reportedDays:30,end:"2026-09-27"});
  expect(result[key].periods[365].total).toBeNull();
});

it("reserves supplemental requests for reviewed revenue while retaining unreviewed overview history", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
  const end = Date.parse("2026-09-26") / 1000;
  const key = "parent#fake-world-assets";
  const fwa = ["v1", "v2"].map((v, i) => ({
    slug: `fake-world-assets-${v}`, name: `Fake World Assets ${v.toUpperCase()}`,
    defillamaId: i ? "8767" : "8292", parentProtocol: key, total30d: 100,
    linkedProtocols: ["Fake World Assets"], methodology: reviews[`fake-world-assets-${v}` as keyof typeof reviews].methodology,
  }));
  const unknown = [1, 2].map(i => ({ slug: `unknown-${i}`, name: `Unknown ${i}`, defillamaId: String(i), parentProtocol: "parent#unknown", total30d: 100, methodology: { Revenue: "Unreviewed" } }));
  const chart = Array.from({ length: 30 }, (_, i) => [end - i * 86400, {
    [fwa[0].name]: 10, ...(i < 9 ? { [fwa[1].name]: 2 } : {}),
    [unknown[0].name]: 10, ...(i < 9 ? { [unknown[1].name]: 2 } : {}),
  }]);
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/overview/")) return new Response(JSON.stringify({ protocols: [...unknown, ...fwa], totalDataChartBreakdown: chart }));
    if (url.includes("/fake-world-assets?")) return new Response(JSON.stringify({ defillamaId: key, childProtocols: fwa, totalDataChart: chart.map(([t], i) => [t, i < 9 ? 12 : 10]) }));
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  const { fetchRevenueHistory } = await import("./revenueSource");
  const result = await fetchRevenueHistory([]);
  expect(result[key].periods[30]).toMatchObject({ total: 318, reportedDays: 30 });
  expect(result["parent#unknown"].periods[30].reportedDays).toBe(9);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("/summary/fees/unknown"))).toBe(false);
});
