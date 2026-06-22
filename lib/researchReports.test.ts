import { describe, expect, it } from "vitest";
import { PENDLE_REPORT } from "./researchReports";

describe("PENDLE_REPORT", () => {
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
});
