import { describe, expect, it, vi } from "vitest";
import { HISTORY_MAX_PAGES, detailChartDomain, detailChartPoints, detailHistoryBounds, detailHistoryUrl, detailSeriesSegments, loadDetailHistory, type DetailHistoryData, type DetailHistoryPoint } from "./detailHistory";

const now = new Date("2026-10-18T16:10:00Z");
const point = (day: string, extra: Partial<DetailHistoryPoint> = {}): DetailHistoryPoint => ({ day, price: 1, mcap: 100, fdv: null,
  marketAt: `${day}T00:00:00Z`, fdvAt: null, marketSource: "market", fdvSource: null, basis: "utc_midnight", valuation: null, valuationState: "unavailable", ...extra });
const page = (points: DetailHistoryPoint[], nextCursor: string | null = null): DetailHistoryData => ({ schema: 1, calculationVersion: "daily-reference-v1",
  asset: { slug: "parent#sky", identity: "gecko:sky" }, days: 30, convention: "UTC date D", points, fundamentals: [], sources: [], nextCursor });
const load = (fetcher: typeof fetch, extra: Partial<Parameters<typeof loadDetailHistory>[0]> = {}) => loadDetailHistory({ slug: "parent#sky", identity: "gecko:sky", range: "MAX", days: 30, now,
  signal: new AbortController().signal, fetcher, ...extra });

describe("detail chart range and revenue window", () => {
  it("uses exactly seven UTC dates and keeps the trailing revenue window independent", () => {
    expect(detailHistoryBounds("7D", now)).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    const params = new URL(detailHistoryUrl("parent#sky", "7D", 90, now), "https://example.com").searchParams;
    expect(params.get("slug")).toBe("parent#sky");
    expect(params.get("days")).toBe("90");
    expect(params.get("from")).toBe("2026-10-12");
    expect(params.get("limit")).toBe("1000");
  });
  it("maps 1M, 3M, YTD, 1Y and MAX explicitly without a 365-day MAX cap", () => {
    expect(detailHistoryBounds("1M", now).from).toBe("2026-09-19");
    expect(detailHistoryBounds("3M", now).from).toBe("2026-07-21");
    expect(detailHistoryBounds("YTD", now).from).toBe("2026-01-01");
    expect(detailHistoryBounds("1Y", now).from).toBe("2025-10-19");
    expect(detailHistoryBounds("MAX", now).from).toBe("2000-01-01");
    expect(detailHistoryBounds("7D", new Date("2024-03-01T00:10:00Z")).from).toBe("2024-02-24");
  });
  it("uses the actual available MAX domain and the same requested domain for every series", () => {
    const points = detailChartPoints([point("2020-02-01"), point("2026-10-17")], "mcap");
    expect(detailChartDomain("MAX", points, now)).toEqual([Date.parse("2020-02-01"), Date.parse("2026-10-17")]);
    expect(detailChartDomain("7D", points, now)).toEqual([Date.parse("2026-10-12"), Date.parse("2026-10-18")]);
  });
});

describe("bounded full history loading", () => {
  it("follows cursors beyond the first 1000 dates and merges repeated source and flow metadata", async () => {
    const dates = Array.from({ length: 1000 }, (_, i) => point(new Date(Date.parse("2020-01-01") + i * 86_400_000).toISOString().slice(0, 10)));
    const source = { id: "source", url: "https://example.com", observedAt: now.toISOString(), archiveUrl: "https://example.com/archive", sha256: "hash" };
    const flow = { day: "2020-01-01", revenue: { value: 1, state: "complete" as const, source: "source", scope: "scope" }, holders: { value: null, state: "missing" as const, source: "source", scope: "scope" } };
    const a = { ...page(dates, dates.at(-1)!.day), sources: [source], fundamentals: [flow] };
    const b = { ...page([point("2024-01-01")]), sources: [source], fundamentals: [flow] };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(a)).mockResolvedValueOnce(Response.json(b));
    const result = await load(fetcher);
    expect(result.points).toHaveLength(1001);
    expect(result.sources).toEqual([source]);
    expect(result.fundamentals).toEqual([flow]);
    expect(new URL(fetcher.mock.calls[1][0], "https://example.com").searchParams.get("after")).toBe(dates.at(-1)!.day);
    expect(result.nextCursor).toBeNull();
  });
  it("rejects repeated/nonadvancing cursors instead of looping or returning a partial MAX", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(page([point("2026-10-16")], "2026-10-16")))
      .mockResolvedValueOnce(Response.json(page([point("2026-10-16")], "2026-10-16")));
    await expect(load(fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("refuses a token identity change between pages", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(page([point("2026-10-16")], "2026-10-16")))
      .mockResolvedValueOnce(Response.json({ ...page([point("2026-10-17")]), asset: { slug: "parent#sky", identity: "gecko:different" } }));
    await expect(load(fetcher)).rejects.toThrow("연결을 갱신");
  });
  it("refuses a changed snapshot between cursor pages", async () => {
    const a = { ...page([point("2026-10-16")], "2026-10-16"), asset: { slug: "parent#sky", identity: "gecko:sky", snapshotId: "one" } };
    const b = { ...page([point("2026-10-17")]), asset: { ...a.asset, snapshotId: "two" } };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(a)).mockResolvedValueOnce(Response.json(b));
    await expect(load(fetcher)).rejects.toThrow("이력 기준이 갱신");
  });
  it("bounds pagination even if a service continually returns an advancing cursor", async () => {
    let index = 0;
    const fetcher = vi.fn(async () => {
      const day = new Date(Date.parse("2020-01-01") + index++ * 86_400_000).toISOString().slice(0, 10);
      return Response.json(page([point(day)], day));
    });
    await expect(load(fetcher)).rejects.toThrow("한 번에 불러오지 못했습니다");
    expect(fetcher).toHaveBeenCalledTimes(HISTORY_MAX_PAGES);
  });
  it("withholds an older token identity before drawing even the first history page", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(page([point("2026-10-17")])));
    await expect(load(fetcher, { identity: "gecko:new-sky" })).rejects.toMatchObject({ status: 409 });
  });
  it("distinguishes no stored asset, a configured empty period, and service failure", async () => {
    await expect(load(vi.fn().mockResolvedValue(new Response(null, { status: 404 })))).rejects.toMatchObject({ status: 404 });
    await expect(load(vi.fn().mockResolvedValue(new Response(null, { status: 503 })))).rejects.toMatchObject({ status: 503 });
    const empty = vi.fn().mockResolvedValue(Response.json(page([])));
    await expect(load(empty)).resolves.toMatchObject({ points: [], nextCursor: null });
  });
  it("does not continue pagination after cancellation", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      return Response.json(page([point("2026-10-16")], "2026-10-16"));
    });
    await expect(load(fetcher, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("stored series and gaps", () => {
  const valuation = { day: "2026-10-18", days: 30, revenue: 50, holders: 10, revenueDays: 30, holderDays: 30,
    prMcap: 4, prFdv: null, phrMcap: 20, phrFdv: null, revenueReason: null, holderReason: null };
  it("projects only the selected stored numerator and never invents FDV or missing multiples", () => {
    const rows = [point("2026-10-18", { valuation, valuationState: "ready" })];
    expect(detailChartPoints(rows, "mcap")[0]).toMatchObject({ fdv: null, pr: 4, phr: 20 });
    expect(detailChartPoints(rows, "fdv")[0]).toMatchObject({ fdv: null, pr: null, phr: null });
    expect(detailChartPoints([point("2026-10-18", { valuation, valuationState: "updating" })], "mcap")[0].pr).toBeNull();
    expect(detailChartPoints(rows, "mcap", true)[0]).toMatchObject({ price: 1, mcap: 100, pr: null, phr: null });
  });
  it("breaks at missing calendar days and independent nulls; observed single days stay visible", () => {
    const rows = [point("2026-10-12"), point("2026-10-13"), point("2026-10-15"), point("2026-10-16", { price: null }), point("2026-10-17", { fdv: 130 })];
    const points = detailChartPoints(rows, "mcap");
    expect(detailSeriesSegments(points, "price").map(segment => segment.map(p => p.day))).toEqual([["2026-10-12", "2026-10-13"], ["2026-10-15"], ["2026-10-17"]]);
    expect(detailSeriesSegments(points, "mcap").map(segment => segment.length)).toEqual([2, 3]);
    expect(detailSeriesSegments(points, "fdv").map(segment => segment.map(p => p.day))).toEqual([["2026-10-17"]]);
    expect(detailSeriesSegments(points, "pr")).toEqual([]);
  });
});
