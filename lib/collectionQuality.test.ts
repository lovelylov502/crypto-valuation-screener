import { describe, expect, it } from "vitest";
import { collectionCoverage, collectionErrors, collectionRegressions, collectionState } from "./collectionQuality";
import { sample } from "./testFixtures";
import { assembleScreener } from "./screener";
import { queryScreener } from "./screenerQuery";
import { inspectApi, inspectHome } from "../scripts/verify-production.mjs";
import { aggregateRevenueSource } from "./sources";
import { revenueReading } from "./revenueReading";
import { protocolMultiple } from "./valuationMetrics";
import { hasSourceData } from "./metricCoverage";

const at = "2026-09-28T00:00:00Z";
function coin() {
  return sample({ sourceSlugs: ["sample"], marketSources: { mcap: "CoinGecko", price: "CoinGecko", fdv: "CoinGecko", cmc: null,
    gecko: { id: "test-token", status: "received", observedAt: at, available: ["mcap", "price", "fdv"] } } });
}
describe("source completeness independently of financial calculation", () => {
  it("rejects a page collected separately from the API snapshot", () => {
    const home = { status:200, body: `<script>{"updatedAt":"${at}"}</script>` };
    expect(inspectHome(home, at).errors).not.toContain("HTML and API snapshots differ");
    expect(inspectHome(home, "2026-09-28T00:03:00Z").errors).toContain("HTML and API snapshots differ");
  });
  it("rejects a lost source-backed quote even if all multiples are withheld", () => {
    const c = coin(); c.mcap = null; c.marketSources!.mcap = null;
    expect(collectionErrors([c])).toContain("sample: dropped mcap");
    expect(() => assembleScreener([c], at, [])).toThrow("dropped mcap");
    const valid = queryScreener(assembleScreener([coin()], at, []));
    const response = { ...valid, coins: valid.coins.map(c => ({ ...c, mcap: null, multiples: Object.fromEntries(Object.keys(c.multiples).map(k => [k,null])) })) };
    const body = JSON.stringify(response);
    expect(inspectApi({ status: 200, bytes: Buffer.byteLength(body), body }).errors).toContain("source-backed mcap missing: sample");
  });
  it("accounts for provider absence separately from request errors", () => {
    const first = coin(), second = coin(), third = coin();
    second.slug = "absent"; second.geckoId = "absent"; second.sourceSlugs = ["absent"];
    third.slug = "failed"; third.geckoId = "failed"; third.sourceSlugs = ["failed"];
    second.marketSources!.gecko = { id:"absent", status:"not_returned", available:[], observedAt:at };
    third.marketSources!.gecko = { id:"failed", status:"error", available:[], observedAt:at };
    expect(collectionCoverage([first,second,third]).gecko).toEqual({ requested:3, received:1, notReturned:1, failed:1 });
    third.marketSources!.gecko = null;
    expect(collectionErrors([third])).toContain("failed: unaccounted Gecko ID");
  });
  it("shows partial child totals without turning them into a complete denominator", () => {
    const periods = aggregateRevenueSource([{slug:"v1",total30d:100},{slug:"v2"},{slug:"excluded",total30d:999,doublecounted:true}],()=>"parent").get("parent");
    const c = sample({ revenue30d:null, revenueHistory:null, revenueSource:{url:"https://api.llama.fi/example",observedAt:at,periods} });
    expect(revenueReading(c,30)).toMatchObject({amount:100,basis:"provider_partial",basisLabel:"부분 집계 · 1/2개 구성요소"});
    expect(protocolMultiple(c,30)).toBeNull();
    expect(hasSourceData(c,30)).toBe(true);
    expect(collectionCoverage([c])).toMatchObject({sourceRevenue30d:1,displayedRevenue30d:1,partialRevenue30d:1});
  });
  it("detects losses on later collection, while preserving explicit zero and renamed parent membership", () => {
    const old = collectionState(assembleScreener([coin()],at,[]));
    const next = structuredClone(old); next.at = "2026-09-29T00:00:00Z";
    next.coins.sample.mcap = null; next.coins.sample.revenue[2] = null; next.coins.sample.holderDays[2] = 29;
    expect(collectionRegressions(old,next)).toEqual(expect.arrayContaining([{slug:"sample",issue:"mcap_lost"},{slug:"sample",issue:"revenue_30d_lost"},{slug:"sample",issue:"holder_30d_history_lost"}]));
    next.coins.sample.mcap = 0; next.coins.sample.revenue[2] = 0; next.coins.sample.holderDays[2] = 30;
    expect(collectionRegressions(old,next)).toEqual([]);
    next.coins = { renamed: next.coins.sample };
    expect(collectionRegressions(old,next)).toEqual([]);
    next.coins.renamed.sourceSlugs = ["other"];
    expect(collectionRegressions(old,next)).toEqual([{slug:"sample",issue:"project_removed"}]);
  });
});
