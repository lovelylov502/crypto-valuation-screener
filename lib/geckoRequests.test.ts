import { afterEach, expect, it, vi } from "vitest";
import { geckoRequests, GECKO_BUDGET_MS, GECKO_INTERVAL_MS } from "./geckoRequests";
import { fetchGecko } from "./sources";
import type { SourceObservation } from "./types";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("bounds encoded URLs for long and non-ASCII IDs without losing or duplicating assets", () => {
  const ids = Array.from({ length: 351 }, (_, i) => `asset-${i}-${"long id 한글".repeat(i % 4 + 1)}`);
  const requests = geckoRequests([...ids, ids[0]]);
  expect(requests.flatMap(r => r.ids)).toEqual([...ids].sort());
  for (const request of requests) {
    expect(request.url.length).toBeLessThanOrEqual(1800);
    expect(request.ids.length).toBeLessThanOrEqual(150);
    expect(new URL(request.url).searchParams.get("ids")!.split(",")).toEqual(request.ids);
  }
  expect(geckoRequests([])).toEqual([]);
});

it("recovers the full 2769-asset universe from size-based 403s within the paced job budget", async () => {
  vi.useFakeTimers();
  const ids = Array.from({ length: 2769 }, (_, i) => `asset-${String(i).padStart(4, "0")}`);
  const times: number[] = [], received: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    times.push(Date.now());
    if (input.length > 2048) return new Response("Request blocked", { status: 403 });
    const batch = new URL(input).searchParams.get("ids")!.split(",");
    received.push(...batch);
    return new Response(JSON.stringify(batch.map(id => ({ id, current_price: 1, market_cap: 100, fully_diluted_valuation: 200 }))));
  }));
  const observations: SourceObservation[] = [], started = Date.now();
  const pending = fetchGecko([...ids, ids[0]], observations);
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(received).toEqual(ids);
  expect(result.lookups.size).toBe(ids.length);
  expect([...result.lookups.values()].every(r => r.status === "received")).toBe(true);
  expect(observations.every(o => o.status === "ok")).toBe(true);
  expect(times.slice(1).every((t, i) => t - times[i] >= GECKO_INTERVAL_MS)).toBe(true);
  expect(Date.now() - started).toBeLessThan(GECKO_BUDGET_MS);
});
