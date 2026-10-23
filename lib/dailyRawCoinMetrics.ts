import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { CoinRaw } from "./types";
import type { DailyRawAsset, DailyRawPoint, DailyRawSource } from "./dailyRawData";

export const COIN_METRICS_BASE = "https://community-api.coinmetrics.io/v4";
export const COIN_METRICS_FIELDS = "PriceUSD,SplyCur,CapMrktCurUSD,CapMrktEstUSD";
const DAY = 86_400_000;
type Row = Record<string, unknown>;
export type CoinMetricsCoin = Pick<CoinRaw, "slug" | "geckoId" | "cmcId" | "identityStatus" | "cmcIdentity">;
export interface CoinMetricsReceipt { file: string; url: string; requestedAt?: string; observedAt: string; sha256: string; status: number; headers?: Record<string, string> }
export interface CoinMetricsBinding {
  asset: DailyRawAsset; cmAsset: string; cmcId: number; chain: "ethereum" | "bitcoin"; contract: string | null;
  market: string | null; fdvVerified: boolean; expectedSupply: number | null; verification: string[];
}
export interface CoinMetricsManifest {
  schema: 1; provider: "CoinMetrics"; startedAt: string; completedAt?: string; status: "running" | "complete" | "deferred";
  snapshotSha256: string; bundleSha256: string; bindings: CoinMetricsBinding[];
  proofs: { role: "catalog" | "markets" | "cmc"; receipt: CoinMetricsReceipt }[];
  histories: { cmAsset: string; pages: CoinMetricsReceipt[]; complete: boolean; nextUrl?: string }[];
  retryAt?: string; issues: { scope: string; reason: string }[];
}

// These constants verify full issuance; they never substitute for a missing dated SplyCur.
const FDV_POLICIES = [
  ["aave", "aave", "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", 16_000_000, "https://github.com/aave/aave-token/blob/master/contracts/token/AaveToken.sol"],
  ["compound-governance-token", "comp", "0xc00e94cb662c3520282e6f5717214004a7f26888", 10_000_000, "https://github.com/compound-finance/compound-protocol/blob/master/contracts/Governance/Comp.sol"],
  ["lido-dao", "ldo", "0x5a98fcbea516cf06857215779fd812ca3bef1b32", 1_000_000_000, "https://github.com/lidofinance/lido-dao/blob/master/deployed-mainnet.json"],
  ["chainlink", "link", "0x514910771af9ca656af840dff83e8264ecf986ca", 1_000_000_000, "https://github.com/smartcontractkit/LinkToken/blob/master/contracts/v0.4/LinkToken.sol"],
  ["1inch", "1inch", "0x111111111117dc0aa78b770fa6a738034120c302", 1_500_000_000, "https://github.com/1inch/1inch-token/blob/master/contracts/OneInch.sol"],
  ["perpetual-protocol", "perp", "0xbc396689893d065f41bc2c6ecbee5e0085233447", 150_000_000, "https://github.com/perpetual-protocol/perpetual-protocol/blob/master/metadata/production.json"],
] as const;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const address = (value: unknown): string | null => typeof value === "string" && /^(0x)?[a-f0-9]{40}$/i.test(value) ? `0x${value.replace(/^0x/i, "").toLowerCase()}` : null;
const amount = (value: unknown): number | null => typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sameAmount = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-10;

/** The non-all catalog excludes premium coverage. Never infer entitlement from a ticker. */
export function coinMetricsFreeSupplyAssets(catalog: unknown): Set<string> {
  const entries = array(row(catalog).data).map(row);
  const assets = (metric: string) => new Set(entries.filter(e => e.metric === metric).flatMap(e => array(e.frequencies).map(row)
    .filter(f => f.frequency === "1d").flatMap(f => array(f.assets)).filter((a): a is string => typeof a === "string")));
  const prices = assets("PriceUSD");
  return new Set([...assets("SplyCur")].filter(a => prices.has(a)));
}

/** Exact official Ethereum DEX addresses + the verified CMC ID/platform bridge; no symbol joins. */
export function matchCoinMetricsBindings(coins: CoinMetricsCoin[], cmcRows: unknown[], marketBodies: unknown[], catalog: unknown): CoinMetricsBinding[] {
  const free = coinMetricsFreeSupplyAssets(catalog), byContract = new Map<string, Map<string, string>>();
  for (const market of marketBodies.flatMap(b => array(row(b).data)).map(row)) {
    if (!["uniswap_v2_eth", "uniswap_v3_eth", "sushiswap_v1_eth"].includes(String(market.exchange))) continue;
    for (const side of ["base", "quote"] as const) {
      const token = address(market[`${side}_address`]), asset = market[side];
      if (!token || typeof asset !== "string" || !free.has(asset) || typeof market.market !== "string") continue;
      const matches = byContract.get(token) ?? new Map<string, string>();
      if (!matches.has(asset)) matches.set(asset, market.market);
      byContract.set(token, matches);
    }
  }
  const cmc = new Map<number, Row[]>();
  for (const value of cmcRows) {
    const entry = row(value);
    if (typeof entry.id === "number") cmc.set(entry.id, [...cmc.get(entry.id) ?? [], entry]);
  }
  const result: CoinMetricsBinding[] = [];
  for (const coin of coins) {
    if (coin.identityStatus !== "verified" || !coin.geckoId || !coin.cmcId) continue;
    const records = cmc.get(coin.cmcId) ?? [];
    if (!records.length) continue;
    const platforms = records.map(c => row(c.platform));
    const native = coin.geckoId === "ethereum" && coin.cmcId === 1027 ? "eth" : coin.geckoId === "bitcoin" && coin.cmcId === 1 ? "btc" : null;
    if (native && free.has(native) && records.every(c => c.platform === null)) {
      result.push({ asset: { slug: coin.slug, identity: `gecko:${coin.geckoId}` }, cmAsset: native, cmcId: coin.cmcId,
        chain: native === "eth" ? "ethereum" : "bitcoin", contract: null, market: null, fdvVerified: false, expectedSupply: null,
        verification: ["Exact verified native-chain CoinGecko identity and CMC ID; issued supply is not approved as FDV"] });
      continue;
    }
    const token = address(platforms[0].token_address), canonical = address(coin.cmcIdentity?.address);
    if (!token || token !== canonical || platforms.some(p => p.slug !== "ethereum" || address(p.token_address) !== token)) continue;
    if (!["contract", "source-id", "retained"].includes(coin.cmcIdentity?.basis ?? "")) continue;
    const matches = byContract.get(token);
    if (matches?.size !== 1) continue;
    const [cmAsset, market] = [...matches][0];
    const policy = FDV_POLICIES.find(p => p[0] === coin.geckoId && p[1] === cmAsset && p[2] === token);
    const compatible = !!policy && records.every(c => typeof c.total_supply === "number" && sameAmount(c.total_supply, policy[3])
      && (c.max_supply === null || typeof c.max_supply === "number" && sameAmount(c.max_supply, policy[3])));
    result.push({ asset: { slug: coin.slug, identity: `gecko:${coin.geckoId}` }, cmAsset, cmcId: coin.cmcId,
      chain: "ethereum", contract: token, market, fdvVerified: compatible, expectedSupply: compatible ? policy![3] : null,
      verification: ["Coin Metrics Ethereum DEX base/quote contract equals verified CMC ID/platform contract", ...(compatible ? [policy![4], "Current provider total/max basis agrees with full issuance; every historical day still requires its own dated supply"] : ["Issued-supply valuation withheld: FDV supply/burn convention not verified"])] });
  }
  return result.sort((a, b) => a.asset.slug.localeCompare(b.asset.slug));
}

export interface CoinMetricsParsed { sources: DailyRawSource[]; points: DailyRawPoint[]; supplyDays: number; issues: string[] }
/** D is an end-of-day interval; its measurement instant is 00:00 UTC on D+1. */
export function parseCoinMetricsHistory(body: unknown, binding: CoinMetricsBinding, receipt: CoinMetricsReceipt, options: { includeMarket?: boolean } = {}): CoinMetricsParsed {
  if (receipt.status !== 200 || !Array.isArray(row(body).data)) throw Error("Invalid Coin Metrics historical response");
  const url = new URL(receipt.url), fields = new Set(url.searchParams.get("metrics")?.split(","));
  if (url.origin !== new URL(COIN_METRICS_BASE).origin || url.pathname !== "/v4/timeseries/asset-metrics" || url.searchParams.get("assets") !== binding.cmAsset
    || url.searchParams.get("frequency") !== "1d" || !fields.has("PriceUSD") || !fields.has("SplyCur")) throw Error("Coin Metrics history URL identity or daily basis mismatch");
  const sources: DailyRawSource[] = [], points = new Map<string, DailyRawPoint>(), issues: string[] = [];
  const scope = `coinmetrics:${binding.cmAsset}:${binding.chain}:${binding.contract ?? "native"}:${binding.asset.identity}`;
  const source = (metric: "price" | "mcap" | "fdv") => {
    const definition = metric === "fdv" ? "Coin Metrics same-day PriceUSD x dated SplyCur; verified fully issued total-supply basis, not unissued maximum supply"
      : metric === "price" ? "Coin Metrics PriceUSD UTC daily close" : "Coin Metrics CapMrktEstUSD reported circulating-supply market capitalization";
    const origin: DailyRawSource = { key: `coinmetrics:${hash([receipt.sha256, scope, metric].join("|"))}`, metric, provider: "CoinMetrics",
      url: receipt.url, observedAt: receipt.observedAt, sha256: receipt.sha256, scope, definition,
      basis: metric === "fdv" ? "utc_daily_close_verified_total_supply" : "utc_daily_close" };
    sources.push(origin); return origin.key;
  };
  const keys = { price: options.includeMarket ? source("price") : "", mcap: options.includeMarket ? source("mcap") : "", fdv: binding.fdvVerified ? source("fdv") : "" };
  let supplyDays = 0;
  for (const value of array(row(body).data)) {
    const entry = row(value);
    if (entry.asset !== binding.cmAsset || typeof entry.time !== "string" || !/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?Z$/.test(entry.time)) throw Error("Coin Metrics date or token identity mismatch");
    const time = Date.parse(entry.time), day = entry.time.slice(0, 10), close = time + DAY;
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day || close > Date.parse(receipt.observedAt)) throw Error("Incomplete or invalid Coin Metrics daily close");
    const at = new Date(close).toISOString(), price = amount(entry.PriceUSD), supply = amount(entry.SplyCur), cap = amount(entry.CapMrktCurUSD), mcap = amount(entry.CapMrktEstUSD);
    if (supply !== null) supplyDays++;
    const point: DailyRawPoint = { day };
    if (options.includeMarket) {
      if (price !== null) point.price = { value: price, state: "complete", source: keys.price, at };
      if (mcap !== null) point.mcap = { value: mcap, state: "complete", source: keys.mcap, at };
    }
    // Use the actual dated supply, allowing only the same 1e-10 consistency
    // tolerance as the provider capitalization check (e.g. 0.003 of 1.5B 1INCH).
    if (keys.fdv && price !== null && price > 0 && supply !== null && supply > 0 && binding.expectedSupply !== null && sameAmount(supply, binding.expectedSupply)) {
      const fdv = price * supply;
      if (!Number.isFinite(fdv)) throw Error("Invalid Coin Metrics issued-supply valuation");
      point.fdv = cap !== null && !sameAmount(cap, fdv) ? { value: null, state: "conflict", source: keys.fdv, at }
        : { value: fdv, state: "complete", source: keys.fdv, at };
      if (point.fdv.state === "conflict") issues.push(`${day}: provider capitalization disagrees with dated price and supply`);
    }
    if (!point.price && !point.mcap && !point.fdv) continue;
    const previous = points.get(day);
    if (previous && JSON.stringify(previous) !== JSON.stringify(point)) throw Error("Conflicting duplicate Coin Metrics day");
    points.set(day, point);
  }
  const used = new Set([...points.values()].flatMap(p => [p.price?.source, p.mcap?.source, p.fdv?.source].filter(Boolean)));
  return { sources: sources.filter(s => used.has(s.key)), points: [...points.values()].sort((a, b) => a.day.localeCompare(b.day)), supplyDays, issues };
}

export interface CoinMetricsCollectedAsset { asset: DailyRawAsset; sources: DailyRawSource[]; points: DailyRawPoint[] }
/** Verify original bytes and rebuild bindings from official proof receipts before importing only approved FDV. */
export async function loadCoinMetricsManifest(path: string, cache: string, currentCoins: CoinMetricsCoin[]): Promise<{ assets: CoinMetricsCollectedAsset[]; issues: { scope: string; reason: string }[] }> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as CoinMetricsManifest;
  if (manifest.schema !== 1 || manifest.provider !== "CoinMetrics") throw Error("Unsupported Coin Metrics manifest");
  const root = resolve(cache);
  const read = async (receipt: CoinMetricsReceipt) => {
    const file = resolve(root, receipt.file), rel = relative(root, file);
    if (isAbsolute(receipt.file) || rel === ".." || rel.startsWith(`..\\`) || rel.startsWith("../") || isAbsolute(rel)) throw Error("Coin Metrics receipt escapes cache");
    const bytes = await readFile(file);
    if (hash(bytes) !== receipt.sha256) throw Error("Coin Metrics original receipt hash mismatch");
    if (receipt.status !== 200 || !Number.isFinite(Date.parse(receipt.observedAt))) throw Error("Invalid Coin Metrics receipt metadata");
    return JSON.parse(bytes.toString("utf8")) as unknown;
  };
  const proofBodies = await Promise.all(manifest.proofs.map(async p => {
    const url = new URL(p.receipt.url);
    const valid = p.role === "cmc" ? url.origin === "https://pro-api.coinmarketcap.com" && url.pathname === "/public-api/v3/cryptocurrency/listings/latest"
      : url.origin === new URL(COIN_METRICS_BASE).origin && url.pathname === (p.role === "catalog" ? "/v4/catalog/asset-metrics" : "/v4/reference-data/markets");
    if (!valid) throw Error("Coin Metrics identity proof endpoint mismatch");
    return { role: p.role, body: await read(p.receipt) };
  }));
  const catalog = proofBodies.find(p => p.role === "catalog")?.body;
  const cmcRows = proofBodies.filter(p => p.role === "cmc").flatMap(p => array(row(p.body).data));
  const bindings = matchCoinMetricsBindings(currentCoins, cmcRows, proofBodies.filter(p => p.role === "markets").map(p => p.body), catalog);
  const assets: CoinMetricsCollectedAsset[] = [], issues = [...manifest.issues];
  for (const binding of bindings.filter(b => b.fdvVerified)) {
    const history = manifest.histories.find(h => h.cmAsset === binding.cmAsset);
    if (!history?.complete) { issues.push({ scope: binding.asset.slug, reason: "Coin Metrics history incomplete" }); continue; }
    const sources: DailyRawSource[] = [], points: DailyRawPoint[] = [], seen = new Map<string, string>();
    for (const receipt of history.pages) {
      const url = new URL(receipt.url);
      if (url.origin !== new URL(COIN_METRICS_BASE).origin || url.pathname !== "/v4/timeseries/asset-metrics" || url.searchParams.get("assets") !== binding.cmAsset) throw Error("Coin Metrics history URL identity mismatch");
      const parsed = parseCoinMetricsHistory(await read(receipt), binding, receipt);
      for (const point of parsed.points) {
        const semantic = JSON.stringify([point.fdv?.value, point.fdv?.state, point.fdv?.at]);
        if (seen.has(point.day) && seen.get(point.day) !== semantic) throw Error("Conflicting Coin Metrics history pages");
        if (!seen.has(point.day)) { points.push(point); seen.set(point.day, semantic); }
      }
      sources.push(...parsed.sources); issues.push(...parsed.issues.map(reason => ({ scope: binding.asset.slug, reason })));
    }
    if (points.length) assets.push({ asset: binding.asset, sources, points: points.sort((a, b) => a.day.localeCompare(b.day)) });
  }
  return { assets, issues };
}
