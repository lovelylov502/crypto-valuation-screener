import { describe, expect, it } from "vitest";
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
    expect(DEFAULT_VISIBLE_COLUMNS).toContain("holderValueRunRate");
  });

  it("offers raw TTM separately and explains P/HR with eligible current semantics", () => {
    const ttm = SCREENER_COLUMNS.find((column) => column.key === "holderValueTtm");
    const phr = SCREENER_COLUMNS.find((column) => column.key === "phr");

    expect(ttm).toMatchObject({ label: "원천 HR TTM" });
    expect(ttm?.title).toContain("제외 유형 포함");
    expect(phr?.title).toContain("적격 최근 30일");
    expect(SCREENER_COLUMNS.map((column) => column.title).join(" ")).not.toContain(
      "실질 배당",
    );
  });
});
