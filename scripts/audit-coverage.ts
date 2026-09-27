import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectionCoverage, collectionErrors } from "../lib/collectionQuality";
import { revenueReading } from "../lib/revenueReading";
import { fundamentalErrors } from "../lib/fundamentalContract";
import { DEPLOY_CONTRACT } from "./deploy-contract.mjs";
import type { CoinScored } from "../lib/types";
import type { ScreenerPage } from "../lib/screenerQuery";

const base = process.env.SCREENER_BASE_URL ?? DEPLOY_CONTRACT.liveBaseUrl;
const output = process.env.SCREENER_AUDIT_DIR;
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), base };
const errors: string[] = [];
type Row = Record<string, any>;
let nextGeckoAt = 0;

async function read(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const gecko = url.startsWith("https://api.coingecko.com/");
    if (gecko) {
      const delay = Math.max(0, nextGeckoAt - Date.now());
      if (delay) await new Promise(r => setTimeout(r, delay));
      nextGeckoAt = Date.now() + 12_500;
    }
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(300_000) });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise(r => setTimeout(r, response.status === 429 && gecko ? 60_000 : 1500 * 2 ** attempt));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    const body = await response.text();
    if (url.startsWith(base + "/api/") && Buffer.byteLength(body) >= 4_500_000) throw new Error("API payload exceeds 4.5 MB");
    return JSON.parse(body);
  }
}

async function allPages() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await read(`${base}/api/screener?size=200&page=1`) as ScreenerPage;
    const coins = [...first.coins];
    let changed = false;
    for (let page = 2; coins.length < first.pagination.total; page++) {
      const next = await read(`${base}/api/screener?size=200&page=${page}`) as ScreenerPage;
      if (next.updatedAt !== first.updatedAt || next.pagination.total !== first.pagination.total) { changed = true; break; }
      if (next.pagination.page !== page || !next.coins.length) throw new Error(`Pagination stalled at ${page}`);
      coins.push(...next.coins);
    }
    if (!changed) return { first, coins };
  }
  throw new Error("Snapshot changed during all three pagination attempts");
}

async function main() {
  const { first, coins } = await allPages();
  report.updatedAt = first.updatedAt;
  report.collection = collectionCoverage(coins);
  report.sourceFailures = first.sources.filter(s => s.status === "error");
  if (first.sources.some(s => s.status === "error")) errors.push("source requests failed; inspect sourceFailures");
  if (first.scoreVersion !== DEPLOY_CONTRACT.scoreVersion) errors.push("wrong deployed version");
  if (Date.now() - Date.parse(first.updatedAt) > 45 * 60_000) errors.push("snapshot older than 45 minutes");
  if (coins.length !== first.pagination.total || new Set(coins.map(c => c.slug)).size !== coins.length) errors.push("pagination omitted or duplicated projects");
  errors.push(...collectionErrors(coins));
  for (const c of coins) errors.push(...fundamentalErrors(c).map(e => `${c.slug}: ${e}`));
  if (first.collection?.gecko.failed) errors.push(`${first.collection.gecko.failed} asset quote queries failed`);

  const paths = ["/protocols", "/config", "/overview/fees", "/overview/fees?dataType=dailyRevenue", "/overview/fees?dataType=dailyHoldersRevenue", "/overview/dexs"];
  const sources = await Promise.all(paths.map(path => read("https://api.llama.fi" + path + (path.includes("overview") ? `${path.includes("?") ? "&" : "?"}excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true` : ""))));
  const [directory, config, fees, revenue, holders, dexs] = sources;
  if (!Array.isArray(directory) || !directory.length || !Array.isArray(config.parentProtocols) || [fees,revenue,holders,dexs].some(s => !Array.isArray(s.protocols) || !s.protocols.length)) throw new Error("Source universe unavailable");
  const expected = new Set<string>([...directory, ...fees.protocols, ...revenue.protocols, ...holders.protocols, ...dexs.protocols].map(p => p.slug).filter(Boolean));
  for (const p of config.parentProtocols) expected.add(p.id);
  const represented = new Map<string, CoinScored>();
  for (const c of coins) for (const slug of c.sourceSlugs ?? []) represented.set(slug, c);
  const missing = [...expected].filter(s => !represented.has(s));
  report.directory = { sourceItems: expected.size, represented: [...expected].filter(s => represented.has(s)).length, missing };
  errors.push(...missing.map(s => `${s}: source project omitted`));
  for (const row of revenue.protocols as Row[]) {
    if (row.doublecounted === true) continue;
    const c = represented.get(row.slug);
    if (!c) continue;
    for (const [days, field] of [[1,"total24h"],[7,"total7d"],[30,"total30d"],[365,"total1y"]] as const) {
      if (typeof row[field] === "number" && revenueReading(c, days).amount === null) errors.push(`${row.slug}: ${days}d source amount is hidden`);
    }
  }

  // Independently re-query every linked asset with a missing quote field, including
  // provider omissions. A successful collection status cannot hide an available value.
  let quoteChecks = 0;
  for (const vendor of ["gecko", "cmc"] as const) {
    const candidates = new Map<string, CoinScored[]>();
    for (const c of coins) {
      const lookup = c.marketSources?.[vendor];
      const id = vendor === "gecko" ? c.geckoId : lookup?.id;
      if (!id || lookup?.status === "identity_mismatch" || ![c.mcap,c.price,c.fdv].some(v => v === null)) continue;
      candidates.set(id, [...(candidates.get(id) ?? []), c]);
    }
    const ids = [...candidates.keys()].sort();
    for (let i = 0; i < ids.length; i += 250) {
      const batch = ids.slice(i, i + 250);
      const url = vendor === "gecko" ? `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&ids=${batch.map(encodeURIComponent).join(",")}` : `https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?convert=USD&skip_invalid=true&id=${batch.join(",")}`;
      const data = await read(url);
      const rows = Array.isArray(data) ? data : data.data;
      if (!Array.isArray(rows)) throw new Error(`${vendor}: unexpected quote response`);
      quoteChecks += batch.length;
      for (const row of rows as Row[]) {
        const quote = vendor === "gecko" ? row : row.quote?.find((q: Row) => q.symbol === "USD");
        for (const c of candidates.get(String(row.id)) ?? []) {
          const fields = { mcap: "market_cap", price: vendor === "gecko" ? "current_price" : "price", fdv: vendor === "gecko" ? "fully_diluted_valuation" : "fully_diluted_market_cap" } as const;
          for (const field of Object.keys(fields) as (keyof typeof fields)[]) if (c[field] === null && typeof quote?.[fields[field]] === "number") errors.push(`${c.slug}: ${vendor} has missing ${field}`);
        }
      }
    }
  }
  report.independentQuoteChecks = quoteChecks;
  const fwa = coins.find(c => c.slug === "parent#fake-world-assets");
  report.fwa = fwa && { mcap: fwa.mcap, revenue30d: revenueReading(fwa,30), revenueDays: fwa.revenueHistory?.periods[30], holderDays: fwa.holderHistory?.periods[30], pr: fwa.multiples.pr, phr: fwa.multiples.phr };
  if (!fwa || !(fwa.mcap! > 0) || !(fwa.multiples.pr! > 0) || !(fwa.multiples.phr! > 0)) errors.push("FWA recovery incomplete");
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "all-coins.json"), JSON.stringify({ ...first, coins }));
    await writeFile(join(output, "source-universe.json"), JSON.stringify(sources));
  }
}

main().catch(error => errors.push(error instanceof Error ? error.message : String(error))).finally(async () => {
  report.completedAt = new Date().toISOString(); report.errors = errors;
  if (output) { await mkdir(output, { recursive: true }); await writeFile(join(output, "coverage-audit.json"), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
});
