import { afterEach, expect, it, vi } from "vitest";
import { fetchCoins, normalizeCoinInputs, type CoinInputs } from "./sources";
import { collectionErrors, marketDataReason } from "./collectionQuality";
import { referenceMultiple } from "./referenceMetrics";
import { fmtMult } from "./format";
import { checkedMarketRow, marketValueErrors, resolveCmcAsset } from "./marketSelection";
import { captureSourceBundle, replaySourceBundle } from "./sourceBundle";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const at = "2026-10-11T04:42:52.555Z";
const address = "0xdA5e1988097297dCdc1f90D4dFE7909e847CBeF6";
const official = { id: 33251, name: "World Liberty Financial", symbol: "WLFI", slug: "world-liberty-financial-wlfi",
  platform: { token_address: address }, circulating_supply: 31_778_344_460, total_supply: 100_000_000_000, max_supply: 100_000_000_000,
  quote: [{ symbol: "USD", price: .0571580231217724, market_cap: 1_816_387_347.416328, fully_diluted_market_cap: 5_715_802_312.18, volume_24h: 33_343_427.82, last_updated: at }] };
const namesake = { id: 33023, name: "World Liberty Financial (wlfi.club)", symbol: "WLFI", slug: "world-liberty-financial",
  platform: { token_address: "Cq1y5UdQfqf1JMFw98iEYHRXm1VY7aLxhdShxGbffp7e" }, circulating_supply: 0, total_supply: 1e17, max_supply: 1e17,
  quote: [{ symbol: "USD", price: 3.943038593616917e-13, market_cap: 0, fully_diluted_market_cap: 39430.39, volume_24h: 0, last_updated: at }] };
const gecko = { id: "world-liberty-financial", name: "World Liberty Financial", symbol: "wlfi", current_price: .057141,
  market_cap: 1_815_783_202, fully_diluted_valuation: 5_713_902_355, circulating_supply: 31_778_337_976,
  total_supply: 100_000_000_000, max_supply: 100_000_000_000, total_volume: 22_374_502, last_updated: at };
function inputs(): CoinInputs {
  const p = { slug: "world-liberty-financial", name: "World Liberty Financial", symbol: "WLFI", address, gecko_id: gecko.id };
  const r = { ...p, total30d: 12_205_535 };
  return { marketRevision: 2, asOf: at, protocols: [{ ...p }], fees: [{ ...r }], revenue: [{ ...r }], holders: [], dexs: [], parents: [], stablecoins: [],
    cmc: structuredClone([official, namesake]), cmcLookups: [official, namesake].map(row => [row.id, { id: String(row.id), status: "received", observedAt: at, available: ["price", "mcap", "fdv"] }]),
    cmcDiscoveryComplete: true, gecko: [structuredClone(gecko)], geckoLookups: [[gecko.id, { id: gecko.id, status: "received", observedAt: at, available: ["price", "mcap", "fdv"] }]],
    revenueHistories: {}, holderHistories: {}, recoveredRevenue: [], observations: [], priorCmcTargets: [] } as CoinInputs;
}
function parentInputs(): CoinInputs {
  const i = inputs(); i.marketRevision = 3;
  const parent = { id: "parent#sun", name: "SUN", symbol: "SUN", gecko_id: "sun-token", cmcId: "10529", address: "tron:TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S" };
  const member = { slug: "sunswap-v1", name: "Sunswap V1", parentProtocol: parent.id, symbol: "SUN", cmcId: "1116", address: parent.address };
  i.parents = [parent]; i.protocols = [member]; i.fees = i.revenue = [{ ...member, total30d: 1000 }];
  i.cmc = [{ ...official, id: 10529, name: "SUN", symbol: "SUN", slug: "sun", platform: { token_address: parent.address.slice(5) } }];
  i.cmcLookups = [[10529, { id: "10529", status: "received", observedAt: at, available: ["mcap", "price", "fdv"] }], [1116, { id: "1116", status: "not_returned", observedAt: at, available: [] }]];
  i.gecko = [{ ...gecko, id: "sun-token", name: "SUN", symbol: "sun" }];
  i.geckoLookups = [["sun-token", { id: "sun-token", status: "received", observedAt: at, available: ["mcap", "price", "fdv"] }]];
  return i;
}
it("uses SUN's declared parent token despite a stale child CMC ID", () => {
  const i = parentInputs(), [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ identityStatus: "verified", cmcId: 10529, geckoId: "sun-token", symbol: "SUN" });
  expect(referenceMultiple(c, "revenue", 30, "fdv")).toBeCloseTo(gecko.fully_diluted_valuation * 30 / (1000 * 365));
  expect(c.marketSources?.requests?.cmc.map(q => q.id)).toEqual(["1116", "10529"]);
  expect(c.sourceSlugs).toContain("sunswap-v1"); expect(collectionErrors([c])).toEqual([]);
});
it("preserves revision 5's ambiguous parent interpretation on replay", () => {
  const i = parentInputs(); i.marketRevision = 2;
  expect(normalizeCoinInputs(i)[0].identityStatus).toBe("ambiguous");
});
it("does not let another child token block the parent's explicit asset", () => {
  const i = parentInputs(); i.protocols.push({ slug: "product", name: "Product", parentProtocol: "parent#sun", symbol: "OTHER", gecko_id: "other" });
  i.gecko.push({ ...gecko, id: "other", symbol: "other", market_cap: 10 });
  i.geckoLookups.push(["other", { id: "other", status: "received", observedAt: at, available: ["price", "fdv"] }]);
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ identityStatus: "verified", geckoId: "sun-token", mcap: gecko.market_cap });
  expect(collectionErrors([c])).toEqual([]);
});
it("uses a child's asset ID only when its contract matches the declared parent", () => {
  const i = parentInputs(); delete i.parents[0].gecko_id; delete i.parents[0].cmcId;
  i.protocols.unshift({ slug: "other", name: "Other", parentProtocol: "parent#sun", symbol: "OTHER", gecko_id: "other", address: "tron:other", mcap: 100e9 });
  i.protocols[1].gecko_id = "sun-token";
  i.geckoLookups.push(["other", { id: "other", status: "not_returned", observedAt: at, available: [] }]);
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ identityStatus: "verified", geckoId: "sun-token", cmcId: 10529, mcap: gecko.market_cap });
  expect(collectionErrors([c])).toEqual([]);
});
it("does not borrow another child's market cap when the declared parent quote is missing", () => {
  const i = parentInputs(); i.cmc = []; i.cmcLookups = []; i.gecko = []; i.geckoLookups[0][1] = { id: "sun-token", status: "not_returned", observedAt: at, available: [] };
  i.protocols.unshift({ slug: "other", name: "Other", parentProtocol: "parent#sun", symbol: "OTHER", gecko_id: "other", address: "tron:other", mcap: 100e9 });
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ geckoId: "sun-token", mcap: null, fdv: null, price: null });
  expect(referenceMultiple(c, "revenue", 30)).toBeNull(); expect(collectionErrors([c])).toEqual([]);
});
it("withholds a parent asset whose returned symbol conflicts with its declared token", () => {
  const i = parentInputs(); i.cmc = []; i.cmcLookups = []; i.gecko[0].symbol = "WATT";
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ identityStatus: "review", geckoId: null, mcap: null, fdv: null, price: null });
  expect(c.marketSources?.requests?.gecko.map(q => q.id)).toContain("sun-token");
  expect(collectionErrors([c])).toEqual([]);
});
it("uses the current symbol corroborated by both explicit parent IDs and coherent prices", () => {
  const i = parentInputs(); i.parents[0].symbol = "OLD";
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ identityStatus: "verified", geckoId: "sun-token", cmcId: 10529, symbol: "SUN", fdv: gecko.fully_diluted_valuation });
  expect(collectionErrors([c])).toEqual([]);
});
it("does not corroborate explicit parent IDs using wildly different prices", () => {
  const i = parentInputs(); i.parents[0].symbol = "OLD"; i.cmc[0].quote = [{ ...official.quote[0], price: 1e-13 }];
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ identityStatus: "review", geckoId: null, mcap: null, fdv: null });
});
it.each([5, 6] as const)("captures and replays parent identity with its original revision %s", async revision => {
  vi.useFakeTimers(); vi.setSystemTime(at);
  const i = parentInputs();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    return Response.json(url.includes("coinmarketcap") ? { data: i.cmc } : url.includes("coingecko") ? i.gecko
      : url.endsWith("/protocols") ? i.protocols : url.endsWith("/config") ? { parentProtocols: i.parents }
      : url.includes("stablecoins") ? { peggedAssets: [{ gecko_id: "usdd", symbol: "USDD" }] } : { protocols: i.revenue, totalDataChartBreakdown: [] });
  }));
  const pending = captureSourceBundle(at, null, () => fetchCoins([]), undefined, 2, revision);
  await vi.runAllTimersAsync(); const captured = await pending;
  expect(captured.error).toBeUndefined();
  expect(captured.value?.find(c => c.slug === "parent#sun")?.identityStatus).toBe(revision === 6 ? "verified" : "ambiguous");
  const offline = vi.fn(() => { throw new Error("Replay must be offline"); }); vi.stubGlobal("fetch", offline);
  expect(await replaySourceBundle(captured.bundle, () => fetchCoins([]))).toEqual(captured.value);
  expect(offline).not.toHaveBeenCalled();
});
it("keeps punctuation in market symbol lookup", () => {
  const i = inputs(); i.marketRevision = 3; i.protocols[0].symbol = "G$"; i.cmc[0].symbol = "G$"; i.gecko[0].symbol = "g$";
  expect(normalizeCoinInputs(i)[0].cmcId).toBe(33251);
});
it("joins WLFI by contract rather than a shared vendor slug and uses one identified quote", () => {
  const i = inputs(), before = JSON.stringify(i), [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ cmcId: 33251, cmcSlug: official.slug, symbol: "WLFI", identityStatus: "verified",
    price: gecko.current_price, mcap: gecko.market_cap, fdv: gecko.fully_diluted_valuation,
    totalSupply: 1e11, maxSupply: 1e11, totalVolume: gecko.total_volume });
  expect(referenceMultiple(c, "revenue", 30, "fdv")).toBeCloseTo(5_713_902_355 / (12_205_535 * 365 / 30));
  expect(referenceMultiple(c, "revenue", 30, "mcap")).toBeCloseTo(1_815_783_202 / (12_205_535 * 365 / 30));
  expect(collectionErrors([c])).toEqual([]);
  expect(JSON.stringify(i)).toBe(before);
});
it("keeps original market interpretation for archived revisions", () => {
  const i = inputs(); delete i.marketRevision;
  expect(normalizeCoinInputs(i)[0]).toMatchObject({ cmcId: 33023, fdv: 39430.39, totalSupply: 1e17 });
});
it("rejects a conflicting supplied CMC ID while retaining the explicitly identified Gecko asset", () => {
  const i = inputs(); i.protocols[0].cmcId = 33023;
  expect(normalizeCoinInputs(i)[0]).toMatchObject({ cmcId: 33251, fdv: gecko.fully_diluted_valuation });
});
it("keeps Solana address case and does not identify a namesake solely by its slug", () => {
  const i = inputs(); i.protocols[0].address = "solana:ABCdef";
  i.cmc = [{ ...namesake, platform: { token_address: "abcDEF" } }];
  const [c] = normalizeCoinInputs(i);
  expect(c.cmcId).toBeNull(); expect(c.fdv).toBe(gecko.fully_diluted_valuation);
});
it("does not establish a CMC identity from a conflicting symbol", () => {
  const i = inputs(); i.cmc = [{ ...official, symbol: "OTHER" }];
  expect(normalizeCoinInputs(i)[0].cmcId).toBeNull();
});
it("does not establish name uniqueness from incomplete CMC discovery", () => {
  const i = inputs(); for (const row of [...i.protocols, ...i.fees, ...i.revenue]) delete row.address; i.cmc = [official]; i.cmcDiscoveryComplete = false;
  expect(normalizeCoinInputs(i)[0].cmcId).toBeNull();
});
it.each([true, false])("excludes inactive CMC values, including FDV-only quotes (fallback=%s)", fallback => {
  const i = inputs(); i.cmc = [{ ...official, is_active: 0, quote: [{ ...official.quote[0], price: null, market_cap: null, fully_diluted_market_cap: 39430.39 }] }];
  if (!fallback) { i.gecko = []; i.geckoLookups[0][1].status = "not_returned"; i.geckoLookups[0][1].available = []; }
  const [c] = normalizeCoinInputs(i);
  expect(c.fdv).toBe(fallback ? gecko.fully_diluted_valuation : null);
  expect(c.totalSupply).toBe(fallback ? 1e11 : null);
  expect(collectionErrors([c])).toEqual([]);
  if (!fallback) expect(marketDataReason(c, "fdv")).toContain("비활성");
});
it("uses verified CMC when the explicit Gecko quote is absent", () => {
  const i = inputs(); i.gecko = []; i.geckoLookups[0][1].status = "not_returned"; i.geckoLookups[0][1].available = [];
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ cmcId: 33251, price: official.quote[0].price, mcap: official.quote[0].market_cap, fdv: official.quote[0].fully_diluted_market_cap });
  expect(collectionErrors([c])).toEqual([]);
});
it("withholds FDV below circulating market cap instead of showing a false cheap multiple", () => {
  const i = inputs(); i.cmc = []; i.cmcLookups = []; i.gecko[0].fully_diluted_valuation = 100;
  const [c] = normalizeCoinInputs(i);
  expect(c.fdv).toBeNull(); expect(c.mcap).toBe(gecko.market_cap);
  expect(referenceMultiple(c, "revenue", 30, "fdv")).toBeNull();
  expect(marketDataReason(c, "fdv")).toContain("시총");
  expect(collectionErrors([c])).toEqual([]);
});
it("does not use a product token as the capital of its tokenless parent", () => {
  const i = inputs(); i.protocols[0].parentProtocol = "parent#group"; i.revenue[0].parentProtocol = "parent#group";
  i.parents = [{ id: "parent#group", name: "Issuer", symbol: "-", gecko_id: null, cmcId: null }];
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ slug: "parent#group", identityStatus: "review", geckoId: null, cmcId: null, mcap: null, fdv: null, price: null, revenue30d: 12_205_535 });
  expect(referenceMultiple(c, "revenue", 30, "fdv")).toBeNull();
  expect(collectionErrors([c])).toEqual([]);
});
it("does not round a positive reference multiple into zero", () => {
  expect(fmtMult(.00026)).toBe("<0.01x"); expect(fmtMult(0)).toBe("0.00x");
});
it("keeps a whole Sui asset identifier when two contracts share the same type name", () => {
  const a = { ...official, platform: { token_address: "0x111::coin::COIN" } };
  const b = { ...namesake, platform: { token_address: "0x222::coin::COIN" } };
  expect(resolveCmcAsset([a, b], [], ["sui:0x111::coin::COIN"], official.name, "WLFI", true)).toBe(a);
});
it("uses the same CMC price and supply when only CMC has a positive circulating cap", () => {
  const i = inputs(); i.gecko[0].market_cap = 0; i.gecko[0].current_price = .1; i.gecko[0].total_supply = 1e12;
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ price: official.quote[0].price, mcap: official.quote[0].market_cap, totalSupply: 1e11, fdv: official.quote[0].fully_diluted_market_cap });
  expect(marketValueErrors([c])).toEqual([]);
});
it("uses a fresh identified fallback instead of treating an old quote as current", () => {
  const i = inputs(); i.gecko[0].last_updated = "2026-09-01T00:00:00Z";
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ price: official.quote[0].price, fdv: official.quote[0].fully_diluted_market_cap, marketDataUpdatedAt: at });
  expect(c.marketSources?.gecko?.exclusions?.some(e => e.reason.includes("12시간"))).toBe(true);
});
it("does not accept positive capital paired with a zero price", () => {
  const i = inputs(); i.gecko[0].current_price = 0; i.gecko[0].market_cap = 1e-11; i.gecko[0].fully_diluted_valuation = 1e-10;
  const [c] = normalizeCoinInputs(i);
  expect(c).toMatchObject({ price: official.quote[0].price, mcap: official.quote[0].market_cap, fdv: official.quote[0].fully_diluted_market_cap });
  expect(marketValueErrors([c])).toEqual([]);
});
it("rejects internally inconsistent circulating market cap and retains usable price", () => {
  const row = checkedMarketRow({ ...gecko, market_cap: 100 }, "gecko", at);
  expect(row.market_cap).toBeNull(); expect(row.current_price).toBe(gecko.current_price);
});
it("finds the native asset by a unique complete name even when the source omitted its symbol", () => {
  const row = { id: 1027, name: "Ethereum", symbol: "ETH", platform: null };
  expect(resolveCmcAsset([row], [], [], "Ethereum", null, true)).toBe(row);
  expect(resolveCmcAsset([row], [], [], "Ethereum", null, false)).toBeUndefined();
});
it("captures and replays revision 5 using the correct WLFI identity without network on replay", async () => {
  const i = inputs();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    return Response.json(url.includes("coinmarketcap") ? { data: i.cmc } : url.includes("coingecko") ? i.gecko
      : url.endsWith("/protocols") ? i.protocols : url.endsWith("/config") ? { parentProtocols: [{ id: "parent#unused", name: "Unused" }] }
      : url.includes("stablecoins") ? { peggedAssets: [{ gecko_id: "usdd", symbol: "USDD" }] } : { protocols: i.revenue, totalDataChartBreakdown: [] });
  }));
  const captured = await captureSourceBundle(at, null, () => fetchCoins([]), undefined, 2, 5);
  expect(captured.error).toBeUndefined(); expect(captured.value?.find(c => c.slug === gecko.id)?.cmcId).toBe(33251);
  const offline = vi.fn(() => { throw new Error("Replay must be offline"); }); vi.stubGlobal("fetch", offline);
  const replayed = await replaySourceBundle(captured.bundle, () => fetchCoins([]));
  expect(replayed).toEqual(captured.value); expect(offline).not.toHaveBeenCalled();
});
