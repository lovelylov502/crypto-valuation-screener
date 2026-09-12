import { describe, expect, it } from "vitest";
import { psMultiple, summarizeRevenueHistory } from "./revenueHistory";

const now = Date.parse("2026-09-12T13:00:00Z");
const end = Date.parse("2026-09-11T00:00:00Z") / 1000;
const protocols = [{ slug: "a", name: "A", parentProtocol: "parent#x" }, { slug: "b", name: "B", parentProtocol: "parent#x" }];
const series = (): [number, Record<string, number>][] => Array.from({ length: 365 }, (_, i) => [end - i * 86400, { A: 100, B: 20 }]);

describe("revenue research periods", () => {
  it("uses a fixed cap and annualizes every short window with the actual day count", () => {
    expect(psMultiple(120, 12, 365)).toBe(10);
    expect(psMultiple(120, 6, 90)).toBeCloseTo(4.931506849);
    expect(psMultiple(120, 3, 30)).toBeCloseTo(3.287671233);
    expect(psMultiple(120, 1, 7)).toBeCloseTo(2.301369863);
    expect(psMultiple(120, 0, 30)).toBeNull();
    expect(psMultiple(120, -1, 30)).toBeNull();
    expect(psMultiple(120, null, 30)).toBeNull();
  });
  it("sums matched children, excludes partial today and keeps all windows at the same endpoint", () => {
    const history = summarizeRevenueHistory([...protocols, { slug: "dup", name: "Dup", doublecounted: true, parentProtocol: "parent#x" }], [...series(), [end + 86400, { A: 9999999, B: 9999999 }]], now, "source")["parent#x"];
    for (const days of [7, 30, 90, 365] as const) {
      expect(history.periods[days].total).toBe(120 * days);
      expect(history.periods[days].end).toBe("2026-09-11");
      expect(history.periods[days].reportedDays).toBe(days);
    }
    expect(history.previous30.start).toBe("2026-07-14");
    expect(history.weeks).toHaveLength(13);
  });
  it("does not fill a missing child/day with zero or annualize a partial year", () => {
    const rows = series();
    rows[5] = [end - 5 * 86400, { A: 100 }];
    const h = summarizeRevenueHistory(protocols, rows, now, "source")["parent#x"];
    expect(h.periods[7].total).toBeNull();
    expect(h.periods[7].reportedDays).toBe(6);
    expect(h.periods[365].total).toBeNull();
    expect(h.previous30.total).toBe(3600);
  });
  it("preserves reported zero and negative net revenue and rejects ambiguous names", () => {
    const rows = series().map(([day]) => [day, { A: 0, B: -20 }]);
    expect(summarizeRevenueHistory(protocols, rows, now, "s")["parent#x"].periods[30].total).toBe(-600);
    const ambiguous = summarizeRevenueHistory([...protocols, { slug: "other", name: "A" }], series(), now, "s");
    expect(ambiguous["parent#x"].periods[30].total).toBeNull();
  });
});
