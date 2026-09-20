import { describe, expect, it } from "vitest";
import { compareTableValues } from "./screenerFilters";
import { metricCoverage, visibleMetricCoverage } from "./metricCoverage";
import { defaultPreferences, parseWorkspace, resetWorkspaceFilters, withVisibleColumns, workspaceMigrationNotice } from "./workspacePreferences";
import { DEFAULT_VISIBLE_COLUMNS } from "./screenerColumns";
import { sample } from "./testFixtures";

describe("table-first comparison workspace", () => {
  it("removes sales-only controls without converting their threshold into protocol revenue", () => {
    const raw=JSON.stringify({columns:["phr90d","psSales","price","pr"],capital:"fdv",search:"VVV",maxPs:20,maxPhr:90,available:"sales",sortKey:"psSales",sortDir:"asc"});
    const p=parseWorkspace(raw);
    expect(p).toMatchObject({columns:["phr90d","price","pr"],capital:"fdv",search:"VVV",maxPr:0,maxPhr:90,rangeWindow:30,available:"all",sortKey:"name",sortDir:"asc"});
    expect(p).not.toHaveProperty("maxPs");
    expect(workspaceMigrationNotice(raw)).toContain("P/S");
    expect(workspaceMigrationNotice(JSON.stringify(p))).toBeNull();
  });
  it("uses a valid default when the only saved column was sales", () => {
    const p=parseWorkspace('{"columns":["psSales"],"sortKey":"psSales","maxPs":200}');
    expect(p.columns).toEqual(DEFAULT_VISIBLE_COLUMNS);
    expect(p.columns).not.toContain("psSales");
    expect(p.sortKey).toBe("mcap");
    expect(p.maxPr).toBe(0);
  });
  it("keeps the exact valid personal order, independent filter periods and visible sorting after reload", () => {
    const p={...defaultPreferences(),columns:["phr90d","price","pr7d"] as const,sortKey:"pr7d" as const,sortDir:"asc" as const,rangeWindow:90 as const,coverageWindow:365 as const,maxPr:50,maxPhr:100,capital:"fdv" as const};
    expect(parseWorkspace(JSON.stringify(p))).toEqual(p);
  });
  it("falls back to an observable sort when its column is hidden or defaults are restored", () => {
    const p={...defaultPreferences(),sortKey:"phr90d" as const,sortDir:"asc" as const,search:"VVV",capital:"fdv" as const,view:"favorites" as const};
    expect(withVisibleColumns(p,["price","mcap","pr"])).toMatchObject({sortKey:"mcap",sortDir:"desc",search:"VVV",capital:"fdv",view:"favorites"});
    expect(withVisibleColumns(p,["price","pr"])).toMatchObject({sortKey:"name",sortDir:"asc"});
    expect(withVisibleColumns(p,[...DEFAULT_VISIBLE_COLUMNS]).columns).not.toContain("psSales");
  });
  it("filter reset does not reset chosen columns or the numerator", () => {
    const p=parseWorkspace(JSON.stringify({...defaultPreferences(),columns:["phr1y","price"],sortKey:"phr1y",capital:"fdv",maxPr:12,maxPhr:30}));
    expect(resetWorkspaceFilters(p)).toMatchObject({columns:p.columns,sortKey:"phr1y",capital:"fdv",maxPr:0,maxPhr:0});
  });
  it("sorts numeric values across sources and leaves missing data last in both directions", () => {
    const values=[100,null,2,20,0,null];
    expect([...values].sort((a,b)=>compareTableValues(a,b,"asc"))).toEqual([0,2,20,100,null,null]);
    expect([...values].sort((a,b)=>compareTableValues(a,b,"desc"))).toEqual([100,20,2,0,null,null]);
  });
  it("counts only selected periods, deduplicating rows rather than summing metrics", () => {
    const both=sample({slug:"both"});
    const historical=sample({slug:"historical",revenue30d:null,holderValue:{eligibleCurrent30d:0,eligibleTtm:10000}});
    expect(metricCoverage([both,historical],"mcap","any",false).unique).toBe(2);
    expect(visibleMetricCoverage([both,historical],"mcap",["price","pr","phr"])).toMatchObject({total:2,unique:1,metrics:[{key:"pr",count:1},{key:"phr",count:1}]});
    expect(visibleMetricCoverage([both,historical],"mcap",["phr1y"]).unique).toBe(2);
    expect(visibleMetricCoverage([both],"mcap",["price"])).toMatchObject({unique:0,metrics:[]});
  });
  it("never counts the separate market-cap reference as available FDV data", () => {
    const c=sample({fdv:null});
    expect(visibleMetricCoverage([c],"fdv",["pr","phr"]).unique).toBe(0);
    expect(visibleMetricCoverage([c],"mcap",["pr","phr"]).unique).toBe(1);
  });
});
