import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ValuationComparisonCell } from "../components/ValuationComparisonCell";
import { comparisonReading } from "./valuationComparison";
import { ScreenerClient } from "../components/ScreenerClient";

const asOf = "2026-10-19", now = Date.parse("2026-10-20T12:00:00Z");
const render = (metric: unknown, clock = now) => renderToStaticMarkup(createElement(ValuationComparisonCell, { reading: comparisonReading({ schema: 1, capital: "fdv", revenueDays: 1, asOf, baseline: { from: "2025-10-19", to: "2026-10-18", expectedDays: 365 }, rows: { sample: { pr: metric } } }, "fdv", "sample", "pr", clock), label: "P/R", capitalLabel: "FDV" }));
it("shows the known daily ratio with zero prior dates without inventing a rail or summary statistics", () => {
  const html = render({ status: "insufficient", validDays: 0, latest: { date: asOf, value: 25.046390846436676 } });
  expect(html).toContain("25.0x"); expect(html).toContain(`${asOf} UTC`); expect(html).toContain("과거 비교 자료 없음"); expect(html).toContain("0일 / 365일"); expect(html).not.toContain("1년 비교 자료 부족");
  for (const absent of ["comparison-rail", "comparison-labels", "최저", "중앙값", "최고"]) expect(html).not.toContain(absent);
});
it.each([
  { validDays: 1, minimum: 5, median: 5, maximum: 5, value: 5 },
  { validDays: 2, minimum: 2, median: 6, maximum: 10, value: 3 },
  { validDays: 8, minimum: 1, median: 5, maximum: 12, value: 7 },
  { validDays: 365, minimum: 3, median: 15, maximum: 30, value: 5 },
])("draws available-data statistics with a visible $validDays/365 count", ({ value, ...baseline }) => {
  const html = render({ status: "ready", ...baseline, latest: { date: asOf, value } });
  for (const present of ["comparison-rail", "comparison-labels", "comparison-median", "최저", "중앙값", "최고"]) expect(html).toContain(present);
  expect(html).toContain(`<small>비교에 사용: ${baseline.validDays}일 / 365일</small>`); expect(html).not.toContain("1년 비교 자료 부족");
  const medianPosition = Number(html.match(/comparison-median" style="left:([\d.]+)%/)?.[1]);
  expect(medianPosition).toBeCloseTo(baseline.maximum === baseline.minimum ? 50 : (baseline.median - baseline.minimum) / (baseline.maximum - baseline.minimum) * 100, 10);
  expect(html).toContain(value < baseline.median ? "comparison-below" : value > baseline.median ? "comparison-above" : "comparison-equal");
});
it.each([{ value: 0.5, badge: "과거 최저 미만" }, { value: 40, badge: "과거 최고 초과" }])("retains the visible count when the latest ratio has an out-of-range badge: $badge", ({ value, badge }) => {
  const html = render({ status: "ready", validDays: 8, latest: { date: asOf, value }, minimum: 3, median: 15, maximum: 30 });
  expect(html).toContain(`<small>${badge}</small>`); expect(html).toContain("comparison-rail"); expect(html).toContain("<small>비교에 사용: 8일 / 365일</small>");
  expect(html.indexOf("<small>비교에 사용:")).toBeGreaterThan(html.indexOf("comparison-labels"));
});
it("preserves legacy numberless history and refuses missing, zero, wrong-date or stale latest observations", () => {
  const legacy = render({ status: "insufficient", validDays: 22 }); expect(legacy).toContain("22일 / 365일"); expect(legacy).not.toContain("comparison-latest");
  for (const metric of [{ status: "unavailable", validDays: 0, reason: "missing_revenue" }, { status: "unavailable", validDays: 0, reason: "missing_capital" }, { status: "unavailable", validDays: 0, reason: "non_positive_revenue" }, { status: "insufficient", validDays: 0, latest: { date: asOf, value: 0 } }, { status: "insufficient", validDays: 1, latest: { date: "2026-10-18", value: 9 } }, { status: "insufficient", validDays: 1, latest: { date: asOf, value: Infinity } }]) {
    const html = render(metric); expect(html).not.toContain("comparison-latest"); expect(html).not.toContain("comparison-rail");
  }
  expect(render({ status: "insufficient", validDays: 1, latest: { date: asOf, value: 5 } }, Date.parse("2026-10-22T12:00:00Z"))).not.toContain("comparison-latest");
});
it("explains the available dates without implying that all365 days are required or filling missing dates", () => {
  const html = renderToStaticMarkup(createElement(ScreenerClient, { initialData: null }));
  expect(html).toContain("비교 범위: 이전 365일 중 계산 가능한 날짜"); expect(html).toContain("이전 365일 중 배수를 계산할 수 있는 날짜만 비교하고, 사용한 일수를 표시합니다.");
  expect(html).toContain("해당 날짜"); expect(html).toContain("그날 24시간 수익 × 365");
});
