import { afterEach, expect, it, vi } from "vitest";
import { aggregateRevenueSource, chainIdentityRows, collectCoinInputs, normalizeCoinInputs, type CoinInputs } from "./sources";
import { referenceMultiple } from "./referenceMetrics";
import { captureSourceBundle, replaySourceBundle } from "./sourceBundle";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const at = "2026-10-11T09:14:58.237Z";
function chainInputs(): CoinInputs {
  const chain = { slug: "near", name: "Near", id: "chain#near", category: "Chain", total30d: 1200 };
  return { marketRevision: 3, asOf: at, protocols: [], fees: [chain], revenue: [chain], holders: [], dexs: [], parents: [], stablecoins: [],
    chainIdentities: [{ slug: "near", gecko_id: "near", cmcId: "6535", symbol: "NEAR" }], providerHolderWindows: true,
    cmc: [], cmcLookups: [], cmcDiscoveryComplete: true,
    gecko: [{ id: "near", symbol: "near", name: "NEAR Protocol", current_price: 2, market_cap: 200000, fully_diluted_valuation: 240000, circulating_supply: 100000, total_supply: 120000, last_updated: at }],
    geckoLookups: [["near", { id: "near", status: "received", observedAt: at, available: ["price", "mcap", "fdv"], positive: ["price", "mcap", "fdv"] }]],
    revenueHistories: {}, holderHistories: {}, recoveredRevenue: [], observations: [], priorCmcTargets: [] } as CoinInputs;
}
it("connects a fee-only chain to its official registry identity without changing revenue", () => {
  const [c] = normalizeCoinInputs(chainInputs());
  expect(c).toMatchObject({ identityStatus: "verified", geckoId: "near", symbol: "NEAR", revenue30d: 1200, mcap: 200000 });
  expect(referenceMultiple(c, "revenue", 30, "fdv")).toBeCloseTo(240000 * 30 / (1200 * 365));
});
it("retains the previous unlinked interpretation when the archive contains no chain registry identities", () => {
  const i = chainInputs(); delete i.chainIdentities; delete i.providerHolderWindows;
  expect(normalizeCoinInputs(i)[0]).toMatchObject({ identityStatus: "review", geckoId: null, mcap: null });
});
it("retains all complete raw holder windows and counts missing group components", () => {
  const i = chainInputs();
  i.holders = [{ slug: "near", name: "Near", total24h: 10, total7d: 70, total30d: 300, total1y: 3650 }];
  const [c] = normalizeCoinInputs(i);
  expect(c.holderSource?.periods?.[7]).toEqual({ total: 70, reported: 1, expected: 1 });
  expect(referenceMultiple(c, "holders", 7, "fdv")).toBeCloseTo(240000 * 7 / (70 * 365));
});
it("retains the individual holder source URL and its actual observation time after overview recovery", () => {
  const i = chainInputs(), url = "https://api.llama.fi/summary/fees/near?dataType=dailyHoldersRevenue", observedAt = "2026-10-11T09:15:20.000Z";
  i.holders = [{ slug: "near", name: "Near", total7d: 70 }];
  i.recoveredHolders = [["near", url]];
  i.observations = [{ url, observedAt, sourceSlugs: ["near"], status: "ok" }];
  const [c] = normalizeCoinInputs(i);
  expect(c.holderSource).toMatchObject({ url, observedAt });
  expect(referenceMultiple(c, "holders", 7, "fdv")).toBeCloseTo(240000 * 7 / (70 * 365));
});
it("uses a chain's own official token, never its gas token or a similarly named protocol", () => {
  const registry = { "OP Mainnet": { geckoId: "optimism", cmcId: "11840", symbol: "OP", gasTokenGeckoId: "ethereum" },
    "Gas only": { gasTokenGeckoId: "ethereum", symbol: "ETH" } };
  const row = { slug: "op-mainnet", name: "OP Mainnet", id: "chain#optimism", category: "Chain" };
  expect(chainIdentityRows(registry, [row, row])).toEqual([{ slug: "op-mainnet", gecko_id: "optimism", cmcId: 11840, symbol: "OP" }]);
  expect(chainIdentityRows(registry, [{ ...row, category: "Lending" }, { ...row, id: "123" },
    { ...row, name: "OP Mainnet Lending" }, { ...row, name: "Gas only" }])).toEqual([]);
  expect(chainIdentityRows({ ...registry, "OP-Mainnet": registry["OP Mainnet"] }, [row])).toEqual([]);
});
it("counts missing holder components while excluding explicitly double-counted rows", () => {
  const periods = aggregateRevenueSource([{ slug: "a", total7d: 10 }, { slug: "b", total7d: null },
    { slug: "duplicate", total7d: 100, doublecounted: true }], () => "parent#token").get("parent#token");
  expect(periods?.[7]).toEqual({ total: 10, reported: 1, expected: 2 });
  expect(periods?.[365]).toEqual({ total: null, reported: 0, expected: 2 });
});
it("captures and replays source connections according to their acquisition revision", async () => {
  vi.useFakeTimers(); vi.setSystemTime(at);
  const i = chainInputs(), chain = i.revenue[0];
  const network = () => vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const u = new URL(String(input));
    const body = u.hostname.includes("coinmarketcap") ? { data: [] }
      : u.hostname.includes("coingecko") ? i.gecko
      : u.hostname.includes("stablecoins") ? { peggedAssets: [{ gecko_id: "tether", symbol: "USDT" }] }
      : u.pathname === "/protocols" ? [{ slug: "unrelated", name: "Unrelated" }]
      : u.pathname === "/config" ? { parentProtocols: [{ id: "parent#unrelated", name: "Unrelated" }], chainCoingeckoIds: { Near: { geckoId: "near", cmcId: "6535", symbol: "NEAR" } } }
      : { protocols: u.pathname.includes("dexs") ? [{ slug: "unrelated", name: "Unrelated" }] : [{ ...chain, total7d: 70 }], totalDataChartBreakdown: [] };
    return Response.json(body);
  });
  for (const revision of [6, 7, 8, 9] as const) {
    network();
    const pending = captureSourceBundle(at, null, () => collectCoinInputs(), undefined, 2, revision);
    await vi.runAllTimersAsync();
    const captured = await pending;
    expect(captured.error).toBeUndefined();
    expect(captured.value?.providerHolderWindows).toBe(revision >= 7 ? true : undefined);
    expect(captured.value?.chainIdentities?.[0]?.gecko_id).toBe(revision >= 7 ? "near" : undefined);
    expect(captured.value?.recoveredHolders).toEqual(revision >= 8 ? [] : undefined);
    expect(captured.value?.sourceIdentitiesOnly).toBe(revision >= 9 ? true : undefined);
    vi.stubGlobal("fetch", () => { throw new Error("Offline only"); });
    expect(await replaySourceBundle(captured.bundle, () => collectCoinInputs())).toEqual(captured.value);
    const c = normalizeCoinInputs(captured.value!).find(c => c.slug === "near")!;
    expect(referenceMultiple(c, "holders", 7, "fdv") !== null).toBe(revision >= 7);
  }
});
