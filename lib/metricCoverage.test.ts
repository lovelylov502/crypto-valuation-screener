import { describe, it, expect } from "vitest";
import { sample } from "./testFixtures";
import { metricCoverage, matchesAvailability, definitionReviewQueue } from "./metricCoverage";
import { holderMultiple, holderReason, protocolMultiple, protocolReason } from "./valuationMetrics";
import { parseWorkspace } from "./workspacePreferences";

describe("coverage counts and period filters",()=>{
  it("counts overlapping revenue and holder ratios only once in the universe total",()=>{
    const c=sample();
    const coverage=metricCoverage([c],"mcap",30);
    expect(coverage).toMatchObject({total:1,revenue:1,holder:1,unique:1,review:0,missing:0});
    expect(coverage.unique+coverage.review+coverage.missing).toBe(coverage.total);
  });
  it("keeps an Aave-like historical return visible when recent 30 days are zero",()=>{
    const c=sample({holderValue:{eligibleCurrent30d:0,eligibleTtm:10000}});
    expect(matchesAvailability(c,"holder","mcap",30)).toBe(false);
    expect(matchesAvailability(c,"holder","mcap",365)).toBe(true);
    expect(matchesAvailability(c,"holder","mcap","any")).toBe(true);
  });
  it("never substitutes market cap into an FDV ratio or its availability count",()=>{
    const c=sample({fdv:null});
    expect(protocolMultiple(c,30,"fdv")).toBeNull();
    expect(holderMultiple(c,30,"fdv")).toBeNull();
    expect(protocolMultiple(c,30,"mcap")).not.toBeNull();
    expect(holderMultiple(c,30,"mcap")).not.toBeNull();
    expect(protocolReason(c,30,"fdv")).toBe("FDV 미확인");
    expect(holderReason(c,30,"fdv")).toBe("FDV 미확인");
    expect(metricCoverage([c],"fdv",30)).toMatchObject({unique:0,review:1,missing:0});
  });
  it("distinguishes reported zero from missing data and keeps unresolved definitions in the review queue",()=>{
    const zero=sample({revenue30d:0,holderValue:{rawCurrent30d:0,eligibleCurrent30d:0}});
    const missing=sample({revenue30d:null,holderHistory:null,holderValue:{rawCurrent30d:null}});
    expect(metricCoverage([zero,missing],"mcap",30)).toMatchObject({unique:0,review:1,missing:1});
    const f=structuredClone(zero.fundamentals);
    f.revenue.components=[{slug:"new-source",kind:"unknown",definition:"New fees",status:"unreviewed",reviewedAt:null,source:"https://defillama.com"}];
    expect(definitionReviewQueue([{...zero,fundamentals:f}])[0].components).toEqual(["new-source"]);
  });
  it("migrates saved columns without reopening the removed sidebar and persists the selected window",()=>{
    expect(parseWorkspace(JSON.stringify({columns:["phr1y","pr","price"],capital:"fdv",sidebarOpen:true,coverageWindow:365}))).toMatchObject({columns:["phr1y","pr","price"],capital:"fdv",coverageWindow:365,sidebarOpen:false});
    expect(parseWorkspace('{"coverageWindow":15}').coverageWindow).toBe("any");
  });
});
