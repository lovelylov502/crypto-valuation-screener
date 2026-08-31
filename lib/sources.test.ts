import { describe, expect, it } from "vitest";
import { aggregateOverviewByGroup } from "./sources";

describe("aggregateOverviewByGroup", () => {
  it("excludes DefiLlama overview rows marked doublecounted from parent sums", () => {
    const rows = [
      {
        slug: "parent-primary",
        total1y: 1_200,
        total7d: 70,
        total14dto7d: 60,
        total30d: 300,
        total60dto30d: 250,
      },
      {
        slug: "parent-duplicate",
        total1y: 9_999,
        total7d: 999,
        total14dto7d: 999,
        total30d: 999,
        total60dto30d: 999,
        doublecounted: true,
      },
    ];

    const aggregate = aggregateOverviewByGroup(rows, () => "parent#protocol").get(
      "parent#protocol",
    );

    expect(aggregate).toEqual({
      annual: 1_200,
      y1: 1_200,
      d7: 70,
      prev7: 60,
      d30: 300,
      prev30: 250,
      hit: true,
    });
  });
});
