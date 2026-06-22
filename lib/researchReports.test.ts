import { describe, expect, it } from "vitest";
import { PENDLE_REPORT, RESEARCH_REPORTS, recentResearchReports } from "./researchReports";

describe("curated research reports", () => {
  it("keeps the curated Pendle memo wired to app lookup and source evidence", () => {
    expect(PENDLE_REPORT.id).toBe("pendle");
    expect(PENDLE_REPORT.protocol.geckoId).toBe("pendle");
    expect(PENDLE_REPORT.protocol.slugMatchers).toContain("pendle");
    expect(PENDLE_REPORT.bucket).toBe("research-priority");
    expect(PENDLE_REPORT.metrics.map((metric) => metric.label)).toContain("TTM holder revenue");
    expect(PENDLE_REPORT.evidence.some((item) => item.sourceUrl.includes("docs.pendle.finance"))).toBe(true);
    expect(PENDLE_REPORT.scenarios.map((scenario) => scenario.name).join(" ")).toContain("Bull");
    expect(PENDLE_REPORT.openQuestions.join(" ")).toContain("Boros");
  });

  it("requires freshness metadata on every stock/token investigation", () => {
    expect(RESEARCH_REPORTS.length).toBeGreaterThan(0);
    for (const report of RESEARCH_REPORTS) {
      expect(report.researchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(report.dataAsOf).toContain(report.researchedAt);
      expect(report.reviewStatus).toMatch(/관찰 중|업데이트 필요|아카이브/);
      expect(report.nextReviewAt?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("returns recent reports capped at the requested count", () => {
    const recent = recentResearchReports(3);
    expect(recent.length).toBeLessThanOrEqual(3);
    expect(recent.map((report) => report.researchedAt)).toEqual(
      [...recent.map((report) => report.researchedAt)].sort().reverse(),
    );
  });
});
