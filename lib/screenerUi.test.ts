import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScreenerClient } from "../components/ScreenerClient";
import { buildTableCatalog, queryTableCatalog } from "./tableCatalog";
import { tableFixture, tableReference } from "./tableTestFixtures";
import { TABLE_METRICS } from "./tableDto";
import { defaultPreferences } from "./workspacePreferences";
import { fmtMult } from "./format";
import {
  DEFAULT_VISIBLE_COLUMNS,
  SCREENER_COLUMNS,
} from "./screenerColumns";

describe("holder-value screener columns", () => {
  it("shows an unambiguous current run-rate in the default single screen", () => {
    const current = SCREENER_COLUMNS.find(
      (column) => column.key === "holderValueRunRate",
    );

    expect(current).toMatchObject({ label: "현재 홀더가치/년" });
    expect(current?.title).toContain("적격 최근 30일");
    expect(current?.title).toContain("365/30");
    expect(DEFAULT_VISIBLE_COLUMNS).not.toContain("psSales");
    expect(SCREENER_COLUMNS.some(c=>c.key==="psSales")).toBe(false);
    expect(DEFAULT_VISIBLE_COLUMNS).toContain("pr");
    expect(DEFAULT_VISIBLE_COLUMNS).toContain("phr");
    expect(DEFAULT_VISIBLE_COLUMNS).not.toContain("captureScore");
  });

  it("labels source-reference P/HR separately from the reviewed holder run-rate", () => {
    const ttm = SCREENER_COLUMNS.find((column) => column.key === "holderValueTtm");
    const phr = SCREENER_COLUMNS.find((column) => column.key === "phr");

    expect(ttm).toMatchObject({ label: "홀더 원천 1년" });
    expect(ttm?.title).toContain("제외 유형 포함");
    expect(phr?.title).toContain("원천 참고 배수");
    expect(phr?.title).toContain("검토는 별도 표시");
    expect(DEFAULT_VISIBLE_COLUMNS).not.toContain("revenueReview");
    expect(SCREENER_COLUMNS.map((column) => column.title).join(" ")).not.toContain(
      "실질 배당",
    );
  });
});

it("keeps every period and both daily comparisons in one labeled coin row for responsive reflow", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-20T12:00:00Z"));
  try {
    const data = tableFixture(1), { catalog } = buildTableCatalog(data, tableReference(data));
    const page = queryTableCatalog(catalog, defaultPreferences(), [], 1, 100), row = page.rows[0];
    TABLE_METRICS.forEach((key, index) => { row.cells[key] = { value: index === 8 ? null : index + 1.25, basis: index === 1 ? "provider_total" : "completed_daily", reason: index === 8 ? "일별 이력 부족" : "" }; });
    page.valuationComparison = { schema: 1, capital: "mcap", revenueDays: 1, asOf: "2026-10-19", baseline: { from: "2025-10-19", to: "2026-10-18", expectedDays: 365 }, rows: { [row.slug]: {
      pr: { status: "ready", validDays: 8, latest: { date: "2026-10-19", value: 4 }, minimum: 2, median: 6, maximum: 10 },
      phr: { status: "insufficient", validDays: 0, latest: { date: "2026-10-19", value: 12 } },
    } } };
    const html = renderToStaticMarkup(createElement(ScreenerClient, { initialData: page }));
    const coinRows = [...html.matchAll(/<tr class="coin-row"[^>]*>([\s\S]*?)<\/tr>/g)];
    expect(coinRows).toHaveLength(1);
    const content = coinRows[0][1];
    expect([...content.matchAll(/<td\b/g)]).toHaveLength(12);
    expect([...content.matchAll(/class="compact-period-label"/g)]).toHaveLength(10);
    for (const key of TABLE_METRICS) {
      const cell = content.match(new RegExp(`<td headers="period-${key}"[^>]*>([\\s\\S]*?)</td>`))?.[1];
      expect(cell).toBeDefined(); expect(cell).toContain(fmtMult(row.cells[key].value));
      expect(cell).toContain(`<b>${key.startsWith("phr") ? "P/HR" : "P/R"}</b>`);
      expect(html).toContain(`id="period-${key}"`);
      expect(html).toContain(`aria-label="${SCREENER_COLUMNS.find(column => column.key === key)!.label} 정렬"`);
    }
    expect(content).toContain("제공처 집계"); expect(content).toContain("자료 부족"); expect(content).toContain("일별 이력 부족");
    expect(content).toContain('headers="history-pr-column"'); expect(content).toContain('headers="history-phr-column"');
    expect(content).toContain("P/R 과거 비교"); expect(content).toContain("P/HR 과거 비교");
    expect(content).toContain("비교에 사용: 8일 / 365일"); expect(content).toContain("0일 / 365일"); expect(content).toContain("과거 비교 자료 없음");
    expect([...content.matchAll(/class="coin-open"/g)]).toHaveLength(1);
    expect(content).toContain(`${row.name} 관심종목 추가`); expect(content).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="검색 결과 전체 내보내기"'); expect(html).not.toContain("가로 스크롤 가능");
  } finally { clock.mockRestore(); }
});
