import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchParentHistorySources, mergeParentHistories, sameParentScope } from "./parentHistorySource";
import { summarizeRevenueHistory } from "./revenueHistory";
import type { SourceObservation } from "./types";

const now = Date.parse("2026-09-27T12:00:00Z"), end = Date.parse("2026-09-26") / 1000;
const key = "parent#old-name";
const members = [
  { slug: "v1", name: "V1", defillamaId: "1", parentProtocol: key, total30d: 300, linkedProtocols: ["New Name", "V1", "V2"], methodology: { Revenue: "Team fees" } },
  { slug: "v2", name: "V2", defillamaId: "2", parentProtocol: key, total30d: 18, linkedProtocols: ["New Name", "V1", "V2"], methodology: { Revenue: "Team fees" } },
];
const chart = Array.from({ length: 30 }, (_, i) => [end - i * 86400, i < 9 ? { V1: 10, V2: 2 } : { V1: 10 }]);
const summary = () => ({ defillamaId: key, parentProtocol: null, childProtocols: members.map(({ name, defillamaId, methodology }) => ({ name, defillamaId, methodology })), totalDataChart: Array.from({ length: 30 }, (_, i) => [end - i * 86400, i < 9 ? 12 : 10]) });
afterEach(() => vi.unstubAllGlobals());

describe("verified parent histories", () => {
  it("recovers the provider's full parent without fabricating a child's missing observations", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(summary())));
    vi.stubGlobal("fetch", fetcher);
    const observations: SourceObservation[] = [];
    const histories = summarizeRevenueHistory(members, chart, now, "overview", new Map([[key, { fingerprint: "scope" }]]));
    expect(histories[key].periods[30].reportedDays).toBe(9);
    const parents = await fetchParentHistorySources(members, chart, now, "dailyRevenue", () => true, observations);
    mergeParentHistories(histories, chart, parents, now, observations);
    expect(histories[key].periods[30]).toMatchObject({ total: 318, reportedDays: 30 });
    expect(histories[key].periods[365].total).toBeNull();
    expect(histories[key].definitionFingerprint).toBe("scope");
    expect(histories[key].source).toContain("/new-name?dataType=dailyRevenue");
    expect(chart[29][1]).toEqual({ V1: 10 });
    expect(observations.at(-1)?.status).toBe("ok");
  });
  it.each(["id", "definition", "extra", "duplicate", "doublecounted"])("rejects a parent with %s scope drift", problem => {
    const s = summary();
    if (problem === "id") s.defillamaId = "parent#other";
    if (problem === "definition") s.childProtocols[0].methodology = { Revenue: "All customer deposits" };
    if (problem === "extra") s.childProtocols.push({ ...s.childProtocols[0], defillamaId: "3" });
    if (problem === "duplicate") s.childProtocols[1] = s.childProtocols[0];
    if (problem === "doublecounted") Object.assign(s.childProtocols[0], { doublecounted: true });
    expect(sameParentScope(key, members, s)).toBe(false);
  });
  it("does not use an entire parent for an eligible holder subset", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(summary()))));
    const sources: SourceObservation[] = [];
    // A complete eligible child needs no recovery; a parent cannot add the ineligible second child.
    expect(sameParentScope(key, members.slice(0, 1), summary())).toBe(false);
    expect(await fetchParentHistorySources(members, chart, now, "dailyHoldersRevenue", p => p.slug === "v1", sources)).toEqual([]);
  });
  it("retains the old history on conflicting overlaps and ignores partial today", async () => {
    const s = summary();
    s.totalDataChart[0][1] = 99;
    s.totalDataChart.push([end + 86400, 99999]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(s))));
    const sources: SourceObservation[] = [];
    const histories = summarizeRevenueHistory(members, chart, now, "overview");
    const before = structuredClone(histories);
    const parents = await fetchParentHistorySources(members, chart, now, "dailyRevenue", () => true, sources);
    mergeParentHistories(histories, chart, parents, now, sources);
    expect(histories).toEqual(before);
    expect(sources.at(-1)).toMatchObject({ status: "withheld", reason: "value_conflict" });
  });
  it("distinguishes a received scope mismatch from a failed source request", async () => {
    const s = summary();
    s.childProtocols.push({ ...s.childProtocols[0], defillamaId: "extra" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(s))));
    const sources: SourceObservation[] = [];
    expect(await fetchParentHistorySources(members, chart, now, "dailyRevenue", () => true, sources)).toEqual([]);
    expect(sources[0]).toMatchObject({ status: "withheld", reason: "scope_mismatch" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await fetchParentHistorySources(members, chart, now, "dailyRevenue", () => true, sources);
    expect(sources[1].status).toBe("error");
  });
});
