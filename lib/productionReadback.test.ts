import { expect, it } from "vitest";
import { inspectFwa } from "../scripts/verify-production.mjs";

it("verifies source amounts while keeping incomplete current FWA windows unavailable", () => {
  const coin = { mcap: 100, revenue30d: 30, fundamentals: { revenue: { kind: "protocol_revenue" } },
    revenueHistory: { periods: { 30: { reportedDays: 15, total: null as number | null } } },
    holderHistory: { periods: { 30: { reportedDays: 15, total: null as number | null } } }, multiples: { pr: null, phr: null } };
  expect(inspectFwa(coin)).toEqual([]);
  expect(inspectFwa({ ...coin, multiples: { pr: 10, phr: null } })).toContain("FWA pr uses incomplete history");
  expect(inspectFwa({ ...coin, mcap: null })).toContain("FWA source/quote regression");
  coin.revenueHistory.periods[30] = { reportedDays: 30, total: 30 };
  expect(inspectFwa(coin)).toContain("FWA pr arithmetic regression");
  expect(inspectFwa({ ...coin, multiples: { pr: 100 / 365, phr: null } })).toEqual([]);
});
