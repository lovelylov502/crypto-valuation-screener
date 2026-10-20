import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ValuationComparisonCell } from "../components/ValuationComparisonCell";
import { comparisonReading } from "./valuationComparison";

const asOf = "2026-10-19", now = Date.parse("2026-10-20T12:00:00Z");
const render = (metric: unknown, clock = now) => renderToStaticMarkup(createElement(ValuationComparisonCell, { reading: comparisonReading({ schema: 1, capital: "fdv", revenueDays: 1, asOf, baseline: { from: "2025-10-19", to: "2026-10-18", expectedDays: 365 }, rows: { sample: { pr: metric } } }, "fdv", "sample", "pr", clock), label: "P/R", capitalLabel: "FDV" }));
it("shows the known daily ratio and short-year count without inventing a rail or summary statistics", () => {
  const html = render({ status: "insufficient", validDays: 0, latest: { date: asOf, value: 25.046390846436676 } });
  expect(html).toContain("25.0x"); expect(html).toContain(`${asOf} UTC`); expect(html).toContain("1년 비교 자료 부족"); expect(html).toContain("0일 / 365일");
  for (const absent of ["comparison-rail", "comparison-labels", "최저", "중앙값", "최고"]) expect(html).not.toContain(absent);
});
it("draws the rail and min/median/max only with the full 365-day baseline", () => {
  const html = render({ status: "ready", validDays: 365, latest: { date: asOf, value: 5 }, minimum: 3, median: 15, maximum: 30 });
  for (const present of ["comparison-rail", "comparison-labels", "최저", "중앙값", "최고", "5.0x"]) expect(html).toContain(present);
});
it("preserves legacy numberless history and refuses missing, zero, wrong-date or stale latest observations", () => {
  const legacy = render({ status: "insufficient", validDays: 22 }); expect(legacy).toContain("22일 / 365일"); expect(legacy).not.toContain("comparison-latest");
  for (const metric of [{ status: "unavailable", validDays: 0, reason: "missing_revenue" }, { status: "unavailable", validDays: 0, reason: "non_positive_revenue" }, { status: "insufficient", validDays: 1, latest: { date: "2026-10-18", value: 9 } }, { status: "insufficient", validDays: 1, latest: { date: asOf, value: Infinity } }]) {
    const html = render(metric); expect(html).not.toContain("comparison-latest"); expect(html).not.toContain("comparison-rail");
  }
  expect(render({ status: "insufficient", validDays: 1, latest: { date: asOf, value: 5 } }, Date.parse("2026-10-22T12:00:00Z"))).not.toContain("comparison-latest");
});
