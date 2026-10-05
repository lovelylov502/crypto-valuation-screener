import { describe, expect, it } from "vitest";
import { annotateDataQuality, dataQualitySummary, scopedSourceErrors } from "./dataQuality";
import { sample, fixtureFundamentals } from "./testFixtures";
import type { CoinRaw, SourceObservation } from "./types";
import { summarizeRevenueHistory } from "./revenueHistory";
import { protocolMultiple, protocolReason, holderAmount, holderReason } from "./valuationMetrics";
import { researchMultiple } from "./research";
import { revenueTrend } from "./revenueTrend";
import { revenueReading } from "./revenueReading";
import { collectionCoverage } from "./collectionQuality";

const at = "2026-10-05T03:00:00Z", end = Date.parse("2026-10-04") / 1000;
const summary = (slug = "sample", changes: Partial<SourceObservation> = {}): SourceObservation => ({
  url: `https://api.llama.fi/summary/fees/${slug}?dataType=dailyRevenue`, observedAt: at, status: "error", httpStatus: 503, ...changes,
});
const coin = (slug = "sample", changes: Partial<CoinRaw> = {}) => sample({ slug, sourceSlugs: [slug], ...changes });
const marketUrl = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=one,two";
function failedQuote(slug: string) {
  return coin(slug, { geckoId: slug, marketSources: { gecko: { id: slug, status: "error", observedAt: at, available: [] }, cmc: null,
    price: null, mcap: null, fdv: null }, price: null, mcap: null, fdv: null });
}
function historyCoin() {
  const history = summarizeRevenueHistory([{ slug: "sample", name: "Sample" }], Array.from({ length: 365 }, (_, i) => [end - i * 86400, { Sample: 1 }]),
    Date.parse(at), "https://api.llama.fi/overview/fees?dataType=dailyRevenue", new Map([["sample", fixtureFundamentals.revenue]])).sample;
  return coin("sample", { revenueHistory: history, revenue30d: 30, revenue7d: 7, revenue24h: 1 });
}

describe("failure scope and current-data quality", () => {
  it("contains a failed source to its own project while retaining other current rows and explicit zero", () => {
    const raw = [coin("sample", { revenue30d: 0 }), coin("other", { revenue30d: 77 })];
    const snapshot = structuredClone(raw), sources = [summary()];
    const rows = annotateDataQuality(raw, sources);
    expect(rows[0].dataQuality).toMatchObject({ state: "partial", issues: [{ scope: "revenue", code: "request_failed", retryable: true }] });
    expect(rows[0].revenue30d).toBe(0);
    expect(rows[1]).toMatchObject({ revenue30d: 77, dataQuality: { state: "complete", issues: [] } });
    expect(raw).toEqual(snapshot);
    expect(scopedSourceErrors(sources, rows)).toEqual([]);
    expect(dataQualitySummary(rows)).toEqual({ affectedProjects: 1, issueCount: 1 });
  });
  it.each([summary("unknown"), { ...summary(), url: "https://api.llama.fi/overview/fees?dataType=dailyRevenue" },
    { ...summary(), sourceSlugs: ["sample", "missing"] }, { ...summary(), url: "invalid" }])("keeps unaccounted or global source failure blocking: $url", source => {
    const rows = annotateDataQuality([coin()], [source]);
    expect(scopedSourceErrors([source], rows)).toHaveLength(1);
  });
  it("maps renamed parent summaries through exact component lineage", () => {
    const source = summary("renamed-parent", { sourceSlugs: ["old-child"], status: "withheld", reason: "scope_mismatch" });
    const rows = annotateDataQuality([coin("parent#old", { sourceSlugs: ["parent#old", "old-child"] }), coin("unrelated")], [source]);
    expect(rows[0].dataQuality?.issues).toHaveLength(1);
    expect(rows[1].dataQuality?.issues).toEqual([]);
    expect(scopedSourceErrors([source], rows)).toEqual([]);
  });
  it.each([undefined,408,429,503])("distinguishes required source transport failure %s from validation errors",httpStatus=>{
    const url="https://api.llama.fi/overview/fees?dataType=dailyRevenue&excludeTotalDataChart=true&excludeTotalDataChartBreakdown=false";
    const source={...summary(),url,httpStatus};
    expect(scopedSourceErrors([source],[coin()])).toEqual([`source_request_failed:${httpStatus ?? "network"}:${url}`]);
    expect(scopedSourceErrors([{...source,httpStatus:200}],[coin()])).toEqual([`unaccounted_source_error:${url}`]);
    expect(scopedSourceErrors([{...source,url:url+"&unknown=true"}],[coin()])).toEqual([`unaccounted_source_error:${url}&unknown=true`]);
  });
  it("retries a local HTTP 408 while keeping permanent client and schema failures nonretryable",()=>{
    expect(annotateDataQuality([coin()],[summary("sample",{httpStatus:408})])[0].dataQuality?.issues[0].retryable).toBe(true);
    for(const httpStatus of [200,400,403,404]) expect(annotateDataQuality([coin()],[summary("sample",{httpStatus})])[0].dataQuality?.issues[0].retryable).toBe(false);
  });
  it("requires every failed market batch ID and refuses values attributed to the failed vendor", () => {
    const source = { url: marketUrl, status: "error" as const, observedAt: at, httpStatus: 429 };
    const rows = annotateDataQuality([failedQuote("one"), failedQuote("two")], [source]);
    expect(scopedSourceErrors([source], rows)).toEqual([]);
    expect(scopedSourceErrors([source], rows.slice(0, 1))).not.toEqual([]);
    rows[0].price = 2; rows[0].marketSources!.price = "CoinGecko";
    expect(scopedSourceErrors([source], rows)).not.toEqual([]);
  });
  it("keeps current alternate-provider values when one quote provider fails", () => {
    const source = { url: marketUrl, status: "error" as const, observedAt: at, httpStatus: 503 };
    const first = failedQuote("one"), second = failedQuote("two");
    first.price = 8; first.marketSources!.price = "CoinMarketCap";
    first.marketSources!.cmc = { id: "1", status: "received", observedAt: at, available: ["price"] };
    const rows = annotateDataQuality([first, second], [source]);
    expect(rows[0].price).toBe(8);
    expect(scopedSourceErrors([source], rows)).toEqual([]);
    expect(scopedSourceErrors([], rows)).toHaveLength(2);
  });
  it("accounts an unselected failed identity without discarding another successful ID from the same vendor",()=>{
    const source={url:marketUrl.replace("one,two","two"),status:"error" as const,observedAt:at,httpStatus:503};
    const raw=failedQuote("one");
    raw.price=8;raw.marketSources!.price="CoinGecko";
    raw.marketSources!.gecko={id:"one",status:"received",observedAt:at,available:["price"]};
    raw.marketSources!.requests={gecko:[{id:"two",status:"error",observedAt:at,available:[]}],cmc:[]};
    const rows=annotateDataQuality([raw],[source]);
    expect(rows[0].dataQuality?.issues).toHaveLength(1);
    expect(rows[0].price).toBe(8);
    expect(scopedSourceErrors([source],rows)).toEqual([]);
    expect(collectionCoverage(rows).gecko).toEqual({requested:2,received:1,failed:1,notReturned:0});
    expect(scopedSourceErrors([{...source,url:source.url.replace("ids=two","ids=two,unaccounted")}],rows)).not.toEqual([]);
  });
  it("discloses optional market discovery failure while retaining independently available current fields", () => {
    const source = { url: "https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/listings/latest?start=1&limit=5000&convert=USD",
      status: "error" as const, observedAt: at, httpStatus: 503 };
    const raw = [coin("one", { price: 8, revenue30d: 100 }), coin("two", { price: null, revenue30d: 0 })];
    const rows = annotateDataQuality(raw, [source]);
    expect(rows.map(c => c.price)).toEqual([8, null]);
    expect(rows.map(c => c.revenue30d)).toEqual([100, 0]);
    expect(rows.every(c => c.dataQuality?.issues[0].code === "discovery_failed")).toBe(true);
    expect(scopedSourceErrors([source], rows)).toEqual([]);
  });
  it("withholds disputed dated calculations but preserves raw totals and observed day counts", () => {
    const raw = historyCoin(), source = summary("sample", { status: "withheld", reason: "value_conflict" });
    const [row] = annotateDataQuality([raw], [source]);
    expect(row.revenueHistory!.periods[30]).toMatchObject({ reportedDays: 30, total: null });
    expect(raw.revenueHistory!.periods[30].total).toBe(30);
    expect(row.revenue30d).toBe(30);
    expect(protocolMultiple(row)).toBeNull();
    expect(researchMultiple(row)).toBeNull();
    expect(revenueTrend(row, 30)).toMatchObject({ current: null, previous: null, delta: null });
    expect(revenueReading(row, 30)).toMatchObject({ amount: 30, basis: "provider_total" });
    expect(protocolReason(row, 30)).toBe("원천 금액 충돌 · 계산 보류");
    const [withoutHistory] = annotateDataQuality([coin()], [source]);
    expect(protocolMultiple(withoutHistory)).toBeNull();
    expect(researchMultiple(withoutHistory)).toBeNull();
  });
  it("withholds disputed holder history while keeping original holder totals", () => {
    const source = { ...summary(), url: summary().url.replace("dailyRevenue", "dailyHoldersRevenue"), status: "withheld" as const, reason: "value_conflict" as const };
    const [row] = annotateDataQuality([coin()], [source]);
    expect(holderAmount(row, 30)).toBeNull();
    expect(row.holderValue.rawCurrent30d).toBe(300_000);
    expect(row.holderHistory!.periods[30].reportedDays).toBe(30);
    expect(holderReason(row, 30)).toBe("원천 금액 충돌 · 계산 보류");
  });
  it.each(["scope_mismatch", "request_budget"] as const)("preserves independently complete history when a supplemental source is %s", reason => {
    const raw = historyCoin(), [row] = annotateDataQuality([raw], [summary("sample", { status: "withheld", reason })]);
    expect(row.revenueHistory).toEqual(raw.revenueHistory);
    expect(protocolMultiple(row)).not.toBeNull();
    expect(row.dataQuality?.issues[0].retryable).toBe(false);
  });
  it("does not turn unavailable current values into synthetic zeros", () => {
    const raw = coin("sample", { price: null, mcap: null, fdv: null, tvl: null, fees7d: null, fees30d: null, fees1y: null, revenue24h: null, revenue7d: null,
      revenue30d: null, revenue1y: null, holderHistory: null, holderValue: { ...coin().holderValue, rawCurrent30d: null, rawTtm: null }, volume30d: null });
    const [row] = annotateDataQuality([raw], [summary()]);
    expect(row.dataQuality?.state).toBe("unavailable");
    expect(revenueReading(row, 30).amount).toBeNull();
    expect(row.price).toBeNull();
  });
  it("does not waive malformed local source evidence", () => {
    const source = summary("sample", { observedAt: "invalid" });
    expect(scopedSourceErrors([source], annotateDataQuality([coin()], [source]))).toEqual([`invalid_source_observation:${source.url}`]);
  });
});
