import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_MAX_PAGES, detailChartDomain, detailChartPoints, detailHistoryBounds, detailHistoryUrl, detailObservationState, detailSeriesSegments, loadDetailHistory, type DetailHistoryData, type DetailHistoryPoint } from "./detailHistory";
import { calculateDailyValuation } from "./dailyValuation";
import type { DailyRawSource, DailyRawStoredPoint } from "./dailyRawData";
import type { CapitalBasis } from "./valuationMetrics";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoinDetailOverview } from "../components/CoinDetailOverview";
import { DetailHistoryChart } from "../components/DetailHistoryChart";
import { sample } from "./testFixtures";
import { scoreCoins } from "./valuation";

const now = new Date("2026-10-18T16:10:00Z"), day = 86400000;
const sources: DailyRawSource[] = ["price", "mcap", "fdv", "fees", "revenue", "holders"].map(metric => ({ key: metric, metric: metric as DailyRawSource["metric"], provider: ["price", "mcap", "fdv"].includes(metric) ? "CoinGecko" : "DefiLlama", url: `https://example.test/${metric}`, sha256: "a".repeat(64), archiveUrl: "https://example.test/archive", observedAt: now.toISOString(), scope: "exact-parent", definition: metric, basis: ["price", "mcap", "fdv"].includes(metric) ? "captured_quote;actual_provider_timestamp" : "completed_utc_day_flow;provider_reconstructed;original_dated_observations" }));
const sourceMap = new Map(sources.map(source => [source.key, source]));
const point = (date: string, extra: Partial<DailyRawStoredPoint> = {}, capital: CapitalBasis = "mcap"): DetailHistoryPoint => calculateDailyValuation({
  point: { day: date, price: { value: 1, state: "positive", source: "price", at: `${date}T12:00:00Z` }, mcap: { value: 36500, state: "positive", source: "mcap", at: `${date}T12:00:00Z` }, fdv: { value: null, state: "missing", source: "", at: null }, fees: { value: 100, state: "positive", source: "fees", at: null }, revenue: { value: 10, state: "positive", source: "revenue", at: null }, holders: { value: 2, state: "positive", source: "holders", at: null }, ...extra },
  sources: sourceMap, capital, eligible: true, completedThrough: "2026-10-17",
});
const page = (points: DetailHistoryPoint[], nextCursor: string | null = null): DetailHistoryData => ({ schema: 2, calculationVersion: "daily-raw-same-day-v1", asset: { slug: "parent#sky", identity: "gecko:sky", snapshotId: "snapshot-one" }, capital: "mcap", revenueDays: 1, asOf: "2026-10-17", rawRevision: "revision-one", freshness: { status: "current", lagDays: 0, reason: null }, convention: "same completed UTC date", points, sources, nextCursor });
const load = (fetcher: typeof fetch, extra: Partial<Parameters<typeof loadDetailHistory>[0]> = {}) => loadDetailHistory({ slug: "parent#sky", identity: "gecko:sky", range: "MAX", capital: "mcap", now, signal: new AbortController().signal, fetcher, ...extra });
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(now.getTime()); });
afterEach(() => { vi.restoreAllMocks(); });

describe("completed-day display ranges", () => {
  it("requests seven completed UTC dates and fixes the denominator to the same day", () => {
    expect(detailHistoryBounds("7D", now)).toEqual({ from: "2026-10-11", to: "2026-10-17" });
    const params = new URL(detailHistoryUrl("parent#sky", "gecko:sky", "fdv", "7D", now), "https://example.test").searchParams;
    expect(params.get("slug")).toBe("parent#sky"); expect(params.get("expectedIdentity")).toBe("gecko:sky"); expect(params.get("capital")).toBe("fdv");
    expect(params.has("days")).toBe(false); expect(params.get("to")).toBe("2026-10-17"); expect(params.get("limit")).toBe("1000");
  });
  it("handles YTD, leap days and MAX independently of revenue aggregation", () => {
    expect(detailHistoryBounds("1M", now).from).toBe("2026-09-18"); expect(detailHistoryBounds("3M", now).from).toBe("2026-07-20");
    expect(detailHistoryBounds("YTD", now).from).toBe("2026-01-01"); expect(detailHistoryBounds("1Y", now).from).toBe("2025-10-18");
    expect(detailHistoryBounds("MAX", now).from).toBe("1900-01-01"); expect(detailHistoryBounds("7D", new Date("2024-03-01T00:10:00Z"))).toEqual({ from: "2024-02-23", to: "2024-02-29" });
    expect(detailHistoryBounds("YTD", new Date("2026-01-01T00:10:00Z"))).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
  it("uses actual MAX history dates while every series shares the requested short range", () => {
    const points = detailChartPoints([point("2020-02-01"), point("2026-10-17")]);
    expect(detailChartDomain("MAX", points, now)).toEqual([Date.parse("2020-02-01"), Date.parse("2026-10-17")]);
    expect(detailChartDomain("7D", points, now)).toEqual([Date.parse("2026-10-11"), Date.parse("2026-10-17")]);
  });
});

describe("full raw-history loading", () => {
  it("accepts an advanced global asOf after UTC rollover while keeping every cursor request within the dialog's original range", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-19T00:05:00Z"));
    const first = { ...page([point("2026-10-15")], "2026-10-15"), asOf: "2026-10-18" }, last = { ...page([point("2026-10-17")]), asOf: "2026-10-18" };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(last));
    const result = await load(fetcher, { range: "7D" });
    expect(result.asOf).toBe("2026-10-18"); expect(result.points.map(point => point.day)).toEqual(["2026-10-15", "2026-10-17"]);
    for (const [url] of fetcher.mock.calls) {
      const params = new URL(String(url), "https://example.test").searchParams;
      expect(params.get("from")).toBe("2026-10-11"); expect(params.get("to")).toBe("2026-10-17");
    }
    expect(new URL(String(fetcher.mock.calls[1][0]), "https://example.test").searchParams.get("expectedRevision")).toBe("revision-one");
    await expect(load(vi.fn().mockResolvedValue(Response.json({ ...last, points: [point("2026-10-18")] })), { range: "7D" })).rejects.toThrow("응답을 확인");
  });
  it.each(["2026-10-19", "2026-10-20"])("rejects global asOf %s that is not completed on the current clock even if query bounds extend later", async asOf => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-19T00:05:00Z"));
    await expect(load(vi.fn().mockResolvedValue(Response.json({ ...page([point("2026-10-17")]), asOf })), { now: new Date("2026-10-22T00:00:00Z") })).rejects.toThrow("응답을 확인");
  });
  it("still aborts when a completed global asOf advances between pages of one bounded request", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-20T00:05:00Z"));
    const first = page([point("2026-10-15")], "2026-10-15"), next = { ...page([point("2026-10-16")]), asOf: "2026-10-18" };
    await expect(load(vi.fn().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(next)), { range: "7D" })).rejects.toThrow("이력 기준이 갱신");
  });
  it("loads all 32000 dates across 32 advancing pages and pins later pages to the first revision", async () => {
    let index = 0;
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => {
      const points = Array.from({ length: 1000 }, (_, i) => point(new Date(Date.parse("1900-01-01") + (index * 1000 + i) * day).toISOString().slice(0, 10)));
      return Response.json(page(points, ++index < HISTORY_MAX_PAGES ? points.at(-1)!.day : null));
    });
    const result = await load(fetcher);
    expect(result.points).toHaveLength(32000); expect(result.sources).toEqual(sources); expect(result.nextCursor).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(32);
    const second = new URL(fetcher.mock.calls[1][0] as string, "https://example.test").searchParams;
    expect(second.get("after")).toBe("1902-09-27"); expect(second.get("expectedRevision")).toBe("revision-one");
  });
  it.each(["rawRevision", "asOf", "calculationVersion"])("refuses a changed %s instead of mixing cursor pages", async field => {
    const a = page([point("2026-10-15")], "2026-10-15"), b = { ...page([point("2026-10-16")]), [field]: field === "asOf" ? "2026-10-16" : "different" };
    await expect(load(vi.fn().mockResolvedValueOnce(Response.json(a)).mockResolvedValueOnce(Response.json(b)))).rejects.toThrow("이력 기준이 갱신");
  });
  it("refuses changed snapshot identity, token identity, numerator and source evidence", async () => {
    const first = page([point("2026-10-15")], "2026-10-15"), second = page([point("2026-10-16")]);
    for (const changed of [{ ...second, asset: { ...second.asset, snapshotId: "new" } }, { ...second, asset: { ...second.asset, identity: "gecko:new" } }, { ...second, capital: "fdv" }, { ...second, sources: [{ ...sources[0], sha256: "b".repeat(64) }] }])
      await expect(load(vi.fn().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(changed)))).rejects.toThrow();
  });
  it("rejects a repeated cursor and bounds an endlessly advancing service", async () => {
    const repeated = vi.fn().mockResolvedValueOnce(Response.json(page([point("2026-10-15")], "2026-10-15"))).mockResolvedValueOnce(Response.json(page([point("2026-10-15")], "2026-10-15")));
    await expect(load(repeated)).rejects.toThrow(); expect(repeated).toHaveBeenCalledTimes(2);
    let index = 0; const endless = vi.fn(async () => { const date = new Date(Date.parse("2020-01-01") + index++ * day).toISOString().slice(0, 10); return Response.json(page([point(date)], date)); });
    await expect(load(endless)).rejects.toThrow("한 번에 불러오지 못했습니다"); expect(endless).toHaveBeenCalledTimes(HISTORY_MAX_PAGES);
  });
  it("rejects unfinished dates, legacy window responses and malformed cells", async () => {
    for (const invalid of [{ ...page([]), schema: 1 }, { ...page([]), revenueDays: 30 }, { ...page([]), points: [point("2026-10-18")] }, { ...page([]), points: [{ ...point("2026-10-17"), fdv: 36500 }] }])
      await expect(load(vi.fn().mockResolvedValue(Response.json(invalid)))).rejects.toThrow("응답을 확인");
  });
  it("distinguishes an absent identity, an empty period, a revision conflict and service failure", async () => {
    for (const status of [404, 409, 503]) await expect(load(vi.fn().mockResolvedValue(new Response(null, { status })))).rejects.toMatchObject({ status });
    await expect(load(vi.fn().mockResolvedValue(Response.json(page([]))))).resolves.toMatchObject({ points: [], nextCursor: null });
    await expect(load(vi.fn().mockResolvedValue(Response.json(page([point("2026-10-17")]))), { identity: "gecko:other" })).rejects.toMatchObject({ status: 409 });
  });
  it("does not continue after cancellation", async () => {
    const controller = new AbortController(), fetcher = vi.fn(async () => { controller.abort(); return Response.json(page([point("2026-10-15")], "2026-10-15")); });
    await expect(load(fetcher, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("same-date financial meaning and independent gaps", () => {
  it("pairs March5 capital with March5 Revenue and Holders, without a March4 or current-cap substitution", () => {
    const march4 = point("2026-03-04", { fdv: { value: 365000, state: "positive", source: "fdv", at: "2026-03-04T14:23:00Z" }, revenue: { value: 2, state: "positive", source: "revenue", at: null } }, "fdv");
    const march5 = point("2026-03-05", { fdv: { value: 73000, state: "positive", source: "fdv", at: "2026-03-05T14:23:00Z" }, revenue: { value: 20, state: "positive", source: "revenue", at: null }, holders: { value: 5, state: "positive", source: "holders", at: null } }, "fdv");
    expect(detailChartPoints([march4, march5])[1]).toMatchObject({ pr: 10, phr: 40, fdv: 73000 }); expect(march5.fdv.at).toBe("2026-03-05T14:23:00Z");
    const missingFdv = point("2026-03-06", {}, "fdv"); expect(detailChartPoints([missingFdv])[0]).toMatchObject({ mcap: 36500, fdv: null, pr: null, phr: null });
  });
  it("keeps zero, negative, partial and conflict evidence while withholding invalid ratios", () => {
    for (const [state, amount] of [["zero", 0], ["negative", -2], ["partial", 4], ["conflict", null], ["missing", null]] as const) {
      const raw = point("2026-03-05", { revenue: { value: amount, state, source: "revenue", at: null } });
      expect(detailChartPoints([raw])[0].pr).toBeNull(); expect(raw.revenue).toMatchObject({ value: amount, state }); expect(detailObservationState(raw.revenue)).not.toBe("확인값");
    }
    const unfinished = point("2026-10-18"); expect(detailChartPoints([unfinished])[0]).toMatchObject({ pr: null, phr: null });
  });
  it("breaks lines at missing days and partial market cells while showing a confirmed zero", () => {
    const rows = [point("2026-10-11"), point("2026-10-12"), point("2026-10-14"), point("2026-10-15", { price: { value: 2, state: "partial", source: "price", at: null } }), point("2026-10-16", { price: { value: 0, state: "zero", source: "price", at: "2026-10-16T12:00:00Z" } })];
    const points = detailChartPoints(rows);
    expect(detailSeriesSegments(points, "price").map(segment => segment.map(p => p.day))).toEqual([["2026-10-11", "2026-10-12"], ["2026-10-14"], ["2026-10-16"]]);
    expect(points.at(-1)!.price).toBe(0); expect(detailSeriesSegments(points, "fdv")).toEqual([]);
  });
  it("keeps valid historical definitions but breaks each ratio line when its own financial definition changes", () => {
    const changed = { ...sourceMap.get("revenue")!, key: "changed-revenue", scope: "new-exact-parent-scope" }, changedSources = new Map([...sourceMap, [changed.key, changed] as const]);
    const rows = [point("2026-03-04"), ...["2026-03-05", "2026-03-06"].map(day => { const raw = point(day); return calculateDailyValuation({ point: { ...raw, revenue: { ...raw.revenue, source: changed.key } }, sources: changedSources, capital: "mcap", eligible: true, completedThrough: "2026-10-17" }); })];
    const points = detailChartPoints(rows);
    expect(points.map(p => p.pr)).toEqual([10, 10, 10]);
    expect(detailSeriesSegments(points, "pr").map(segment => segment.map(p => p.day))).toEqual([["2026-03-04"], ["2026-03-05", "2026-03-06"]]);
    expect(detailSeriesSegments(points, "phr").map(segment => segment.length)).toEqual([3]);
  });
  it("withholds a positive reported market cell when its quote time or source meaning is unverified", () => {
    const missingTime = point("2026-03-05", { mcap: { value: 36500, state: "positive", source: "mcap", at: null } });
    expect(missingTime.mcap).toMatchObject({ value: 36500, state: "positive", reason: "invalid_timestamp" });
    expect(detailChartPoints([missingTime])[0]).toMatchObject({ mcap: null, pr: null, phr: null });
    const unverified = point("2026-03-05"); unverified.price.reason = "invalid_definition";
    expect(detailChartPoints([unverified])[0].price).toBeNull();
  });
});

describe("daily chart render contract", () => {
  it("renders the full long project introduction in the initial overview without a preview cut", () => {
    const introduction = "서로 다른 블록체인 사이에서 자산을 교환하는 프로젝트입니다. " + "소개 문장의 중간이나 끝이 잘리지 않고 모두 읽혀야 합니다. ".repeat(12) + "마지막 소개 문장입니다.";
    const c = scoreCoins([sample({ slug: "long-introduction", description: "", descriptionKo: introduction })], now.toISOString())[0];
    const html = renderToStaticMarkup(createElement(CoinDetailOverview, { coin: c, capital: "mcap", onClose: () => {} }));
    const intro = html.match(/class="detail-overview-intro"[\s\S]*?<\/section>/)?.[0];
    expect(intro).toContain(introduction);
    expect(intro).not.toContain("소개 더 보기");
    expect(html).toContain('aria-label="프로젝트 소개와 최신 지표" tabindex="0"');
  });
  it.each(["market", "valuation"])("keeps both crosshairs synchronized while only the active %s chart shows source evidence", activeChart => {
    const raw = point("2026-03-05"), shared = { points: detailChartPoints([raw]), historyPoints: [raw], sources, capital: "mcap" as const, domain: [Date.parse("2026-03-04"), Date.parse("2026-03-06")] as [number, number], activeDay: "2026-03-05", onActiveDay: () => {} };
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement(DetailHistoryChart, { ...shared, series: [{ key: "price", label: "가격", color: "blue", axis: "left" }], label: "시세", showTooltip: activeChart === "market" }),
      createElement(DetailHistoryChart, { ...shared, series: [{ key: "pr", label: "P/R", color: "green", axis: "left" }], label: "배수", valuation: true, showTooltip: activeChart === "valuation" }),
    ));
    expect(html.match(/class="detail-chart-crosshair"/g)).toHaveLength(2);
    expect(html.match(/class="detail-chart-tooltip(?: tooltip-left)?"/g)).toHaveLength(1);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html.includes("Fees · 원자료")).toBe(activeChart === "valuation");
  });
  it("retains the introduction, three external links, current capture and exact display periods with MAX selected", () => {
    const c = scoreCoins([sample({ slug: "parent#sky", geckoId: "sky", price: 123, descriptionKo: "프로젝트 소개 자료입니다." })], now.toISOString())[0];
    const html = renderToStaticMarkup(createElement(CoinDetailOverview, { coin: c, capital: "mcap", onClose: () => {} }));
    expect(html).toContain("어떤 프로젝트인가요?"); expect(html).toContain("공식 홈페이지"); expect(html).toContain("DefiLlama"); expect(html).toContain("CoinGecko");
    expect(html).toContain("현재 가격"); expect(html).toContain("최신 공개본"); expect(html).toContain("$123");
    for (const range of ["7D", "1M", "3M", "YTD", "1Y", "MAX"]) expect(html).toContain(`>${range}</button>`);
    expect(html).toMatch(/aria-pressed="true">MAX<\/button>/); expect(html).not.toContain("<select"); expect(html).not.toContain("직전 30일"); expect(html).toContain("같은 날짜 하루 수익 × 365");
  });
  it("shows the selected day's raw flows, Fees, numerator and actual quote time in the valuation tooltip", () => {
    const raw = point("2026-03-05", { fdv: { value: 73000, state: "positive", source: "fdv", at: "2026-03-05T14:23:00Z" }, revenue: { value: 20, state: "positive", source: "revenue", at: null }, holders: { value: 5, state: "positive", source: "holders", at: null } }, "fdv");
    const html = renderToStaticMarkup(createElement(DetailHistoryChart, { points: detailChartPoints([raw]), historyPoints: [raw], sources, capital: "fdv", series: [{ key: "pr", label: "P/R", color: "blue", axis: "left" }, { key: "phr", label: "P/HR", color: "green", axis: "left" }], domain: [Date.parse("2026-03-04"), Date.parse("2026-03-06")], activeDay: "2026-03-05", onActiveDay: () => {}, valuation: true, label: "일별 배수" }));
    expect(html).toContain("Revenue"); expect(html).toContain("Holders Revenue"); expect(html).toContain("Fees · 원자료"); expect(html).toContain("$20"); expect(html).toContain("$5"); expect(html).toContain("$73,000");
    expect(html).toContain("2026-03-05 14:23:00 UTC"); expect(html).toContain("10x"); expect(html).toContain("40x"); expect(html).toContain("실제 관측 시세"); expect(html).not.toContain("수익 기간");
  });
  it("keeps the UTC day and next-midnight close timestamp distinct in the tooltip", () => {
    const close = { ...sourceMap.get("fdv")!, provider: "CoinMetrics", basis: "utc_daily_close_verified_total_supply" }, raw = point("2026-03-05");
    const closed = calculateDailyValuation({ point: { ...raw, fdv: { value: 73000, state: "positive", source: close.key, at: "2026-03-06T00:00:00Z" } }, sources: new Map([...sourceMap, [close.key, close] as const]), capital: "fdv", eligible: true, completedThrough: "2026-10-17" });
    const html = renderToStaticMarkup(createElement(DetailHistoryChart, { points: detailChartPoints([closed]), historyPoints: [closed], sources: [...sources.filter(source => source.key !== close.key), close], capital: "fdv", series: [{ key: "pr", label: "P/R", color: "blue", axis: "left" }], domain: [Date.parse("2026-03-05"), Date.parse("2026-03-06")], activeDay: "2026-03-05", onActiveDay: () => {}, valuation: true, label: "일별 배수" }));
    expect(html).toContain("2026-03-05 <span>UTC</span>"); expect(html).toContain("2026-03-06 00:00:00 UTC"); expect(html).toContain("CoinMetrics"); expect(html).toContain("UTC 일 마감");
  });
});
