import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCoins } from "./sources";
import { summarizeRevenueHistory } from "./revenueHistory";
import { sample } from "./testFixtures";
import { protocolMultiple, holderMultiple, holderScope } from "./valuationMetrics";
import { growthLabel, revenueTrend } from "./revenueTrend";
import { assembleScreener } from "./screener";
import { queryScreener } from "./screenerQuery";
import { defaultPreferences, parseWorkspace } from "./workspacePreferences";
import { coinUrl } from "./coinLinks";

const at = "2026-09-26T01:00:00Z";
const end = Date.parse("2026-09-25") / 1000;
const history = (count = 730, amount: (i: number) => number = i => i < 7 ? 200 : 100) => summarizeRevenueHistory(
  [{ slug: "sample", name: "Sample" }], Array.from({ length: count }, (_, i) => [end - i * 86400, { Sample: amount(i) }]), Date.parse(at), "test",
  new Map([["sample", { fingerprint: sample().fundamentals.revenue.fingerprint }]]),
).sample;

describe("complete directory", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("recovers AERO from parent metadata and retains both missing-cap and overview-only projects", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      const body = url.endsWith("/config") ? { parentProtocols: [{ id: "parent#aerodrome", name: "Aerodrome", symbol: "AERO", gecko_id: "aerodrome-finance" }] }
        : url.endsWith("/protocols") ? [{ slug: "aerodrome-v1", name: "Aerodrome V1", symbol: "AERO", parentProtocol: "parent#aerodrome" }, { slug: "unknown", name: "Unknown" }]
        : url.includes("coinmarketcap.com") ? { data: [{ id: 1, slug: "aerodrome-finance", name: "Aerodrome Finance", symbol: "AERO", quote: [{ symbol: "USD", market_cap: 100000000 }] }] }
        : url.includes("/coins/markets") ? []
        : url.includes("stablecoins.llama.fi") ? { peggedAssets: [{ symbol: "USDD", gecko_id: "usdd" }] }
        : { protocols: [{ slug: "aerodrome-v1", name: "Aerodrome V1", parentProtocol: "parent#aerodrome", total24h: 2, total48hto24h: 1 }, { slug: "only-fees", name: "Only Fees" }] };
      return new Response(JSON.stringify(body));
    }));
    const coins = await fetchCoins();
    expect(coins.map(c => c.slug).sort()).toEqual(["only-fees", "parent#aerodrome", "unknown"]);
    expect(coins.find(c => c.slug === "parent#aerodrome")).toMatchObject({ symbol: "AERO", cmcSlug: "aerodrome-finance", mcap: 100000000, identityStatus: "verified", revenue24h: 2, revenuePrev24h: 1 });
  });
});

describe("short-window signals", () => {
  it("uses only a completed UTC day for both 24h multiples and keeps FDV independent", () => {
    const c = sample({ revenueHistory: history(), fdv: null, revenue24h: 9999 });
    c.holderHistory = { ...history(), definitionFingerprint: holderScope(c) };
    expect(protocolMultiple(c, 1)).toBeCloseTo(100000000 / (200 * 365));
    expect(holderMultiple(c, 1)).toBeCloseTo(protocolMultiple(c, 1)!);
    expect(protocolMultiple(c, 1, "fdv")).toBeNull();
    expect(protocolMultiple(sample({ revenue24h: 9999 }), 1)).toBeNull();
    expect(history().periods[1]).toMatchObject({ start: "2026-09-25", end: "2026-09-25", reportedDays: 1 });
  });
  it("compares adjacent windows and requires both full years for yearly growth", () => {
    const c = sample({ revenueHistory: history() });
    expect(revenueTrend(c, 7)).toMatchObject({ current: 1400, previous: 700, delta: 700, percent: 100 });
    expect(c.revenueHistory!.peakDayShare7d).toBeCloseTo(100 / 7);
    expect(revenueTrend(c, 365).previous).toBe(36500);
    expect(revenueTrend(sample({ revenueHistory: history(365) }), 365)).toMatchObject({ previous: null, delta: null, percent: null });
  });
  it("distinguishes zero-to-positive, zero, missing history and changed definitions", () => {
    const c = sample({ revenueHistory: history(14, i => i < 7 ? 100 : 0) });
    expect(revenueTrend(c, 7)).toMatchObject({ previous: 0, fromZero: true, delta: 700, percent: null });
    expect(revenueTrend(sample({ revenueHistory: history(7) }), 7)).toMatchObject({ previous: null, fromZero: false });
    expect(revenueTrend(sample({ revenueHistory: { ...history(), definitionFingerprint: "changed" } }), 7).current).toBeNull();
    expect(protocolMultiple(sample({ revenueHistory: history(14, () => 0) }), 1)).toBeNull();
    expect(growthLabel(revenueTrend(sample({ revenueHistory: history(14, () => 0) }), 7))).toBe("0 유지");
  });
});

describe("server-side discovery", () => {
  const data = () => assembleScreener([
    sample({ slug: "cheap-declining", mcap: 1000000, revenueHistory: history(730, i => i < 7 ? 2 : 100) }),
    sample({ slug: "small-base", mcap: 10000000, revenueHistory: history(730, i => i < 7 ? 2 : 1) }),
    sample({ slug: "large-growth", mcap: 10000000, revenueHistory: history(730, i => i < 7 ? 1500 : 1000) }),
    ...Array.from({ length: 105 }, (_, i) => sample({ slug: `unknown-${i}`, mcap: null })),
  ], at, []);
  it("searches beyond the current page and never drops unknown market caps", () => {
    const full = data();
    const first = queryScreener(full, defaultPreferences(), [], 1, 50);
    expect(first.pagination).toMatchObject({ total: 108, filtered: 108, size: 50 });
    expect(first.coins).toHaveLength(50);
    expect(queryScreener(full, { ...defaultPreferences(), search: "unknown-104" }).coins[0].slug).toBe("unknown-104");
  });
  it("sorts by dollar growth or percentage growth and filters declining cheap revenue", () => {
    const full = data(), p = { ...defaultPreferences(), sortKey: "revenue7d" as const, sortDir: "desc" as const };
    expect(queryScreener(full, { ...p, revenueSort: "delta" }).coins[0].slug).toBe("large-growth");
    expect(queryScreener(full, { ...p, revenueSort: "percent" }).coins[0].slug).toBe("small-base");
    expect(queryScreener(full, { ...p, view: "growth", rangeWindow: 7 }).coins.map(c => c.slug)).toEqual(["large-growth", "small-base"]);
    expect(queryScreener(full, { ...p, view: "favorites" }, ["unknown-104"]).coins[0].slug).toBe("unknown-104");
  });
  it("migrates the old default while keeping custom columns and filters", () => {
    expect(parseWorkspace(JSON.stringify({ columns: ["price", "change1d", "mcap", "pr", "phr"], capital: "fdv", maxPr: 10 }))).toMatchObject({ columns: defaultPreferences().columns, capital: "fdv", maxPr: 10, sortKey: "pr", sortDir: "asc" });
    expect(parseWorkspace(JSON.stringify({ columns: ["phr90d", "price"], sortKey: "phr90d", sortDir: "asc" })).columns).toEqual(["phr90d", "price"]);
    expect(parseWorkspace(JSON.stringify({ view: "growth" }))).toMatchObject({ view: "all", growingOnly: true });
  });
  it("combines low multiples, growth, holder flow and favorites instead of switching presets", () => {
    const c = sample({ slug: "combined", revenueHistory: history(), mcap: 10000 });
    c.holderHistory = { ...history(), definitionFingerprint: holderScope(c) };
    const full = assembleScreener([c, sample({ slug: "no-growth", revenueHistory: history(730, () => 100) })], at, []);
    const prefs = { ...defaultPreferences(), growingOnly: true, holderOnly: true, maxPr: 10, rangeWindow: 7 as const, view: "favorites" as const };
    expect(queryScreener(full, prefs, ["combined"]).coins.map(c => c.slug)).toEqual(["combined"]);
    expect(queryScreener(full, prefs, []).coins).toEqual([]);
  });
  it("links to CMC first and otherwise to DefiLlama, never a symbol-based market URL", () => {
    const [c] = data().coins;
    expect(coinUrl(c)).toContain("coinmarketcap.com/currencies/test-token/");
    expect(coinUrl({ ...c, cmcSlug: null, slug: "parent#aerodrome" })).toBe("https://defillama.com/protocol/aerodrome");
  });
});
