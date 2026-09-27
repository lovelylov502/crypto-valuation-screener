import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const cache = vi.hoisted(() => ({ entries: new Map<string, unknown>(), bypass: false, sizes: [] as number[], build: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>, keys: string[]) => async () => {
  const key = keys.join(":");
  if (!cache.bypass && cache.entries.has(key)) return cache.entries.get(key);
  const value = await fn();
  cache.sizes.push(Buffer.byteLength(JSON.stringify(value)));
  cache.entries.set(key, value);
  return value;
} }));
vi.mock("./screener", () => ({ buildScreener: cache.build }));

beforeEach(() => { vi.resetModules(); cache.entries.clear(); cache.sizes = []; cache.bypass = false; cache.build.mockReset(); });
afterEach(() => vi.useRealTimers());

it("collects a new UTC date even when the old snapshot is less than 30 minutes old", async () => {
  vi.useFakeTimers({toFake:["Date"]});
  vi.setSystemTime(new Date("2026-09-27T23:59:00Z"));
  cache.build.mockImplementation(async () => ({ updatedAt:new Date().toISOString(),scoreVersion:"research-v10-source-revenue-recovery",coins:[] }));
  const module = await import("./serverScreener");
  const before = await module.getScreener();
  vi.setSystemTime(new Date("2026-09-28T00:01:00Z"));
  const after = await module.getScreener();
  expect(after.updatedAt).not.toBe(before.updatedAt);
  expect(cache.build).toHaveBeenCalledTimes(2);
});

it("restores a large identical snapshot after a cold start with bounded cache entries", async () => {
  const data = { updatedAt: new Date().toISOString(), scoreVersion: "research-v10-source-revenue-recovery", coins: [{ description: randomBytes(2_000_000).toString("base64") }] };
  cache.build.mockResolvedValue(data);
  expect(await (await import("./serverScreener")).getScreener()).toEqual(data);
  vi.resetModules();
  expect(await (await import("./serverScreener")).getScreener()).toEqual(data);
  expect(cache.build).toHaveBeenCalledTimes(1);
  expect(cache.sizes.every(n => n < 2_000_000)).toBe(true);
  expect(cache.entries.size).toBeGreaterThan(3);
});

it("serves a freshly built snapshot when cache reads are bypassed or chunks are evicted", async () => {
  const data = { updatedAt: new Date().toISOString(), scoreVersion: "research-v10-source-revenue-recovery", coins: [] };
  cache.build.mockResolvedValue(data);
  await (await import("./serverScreener")).getScreener();
  for (const key of cache.entries.keys()) if (key.startsWith("screener-chunk:")) cache.entries.delete(key);
  vi.resetModules();
  expect(await (await import("./serverScreener")).getScreener()).toEqual(data);
  cache.bypass = true;
  vi.resetModules();
  expect(await (await import("./serverScreener")).getScreener()).toEqual(data);
  expect(cache.build).toHaveBeenCalledTimes(3);
});
