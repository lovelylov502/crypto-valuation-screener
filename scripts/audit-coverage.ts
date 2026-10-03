import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectionCoverage, collectionErrors } from "../lib/collectionQuality";
import { revenueReading } from "../lib/revenueReading";
import { fundamentalErrors } from "../lib/fundamentalContract";
import { DEPLOY_CONTRACT } from "./deploy-contract.mjs";
import type { CoinScored } from "../lib/types";
import type { ScreenerPage } from "../lib/screenerQuery";
import { gunzipSync } from "node:zlib";
import { checkArchiveUrl, readSnapshot, sha256 } from "../lib/snapshotArchive";
import { witnessErrors } from "../lib/sourceWitness";
import { COLLECTION_DEADLINE_MS } from "../lib/publication";
import { collectionSchedule } from "../lib/collectionSchedule";
import { geckoRequests, GECKO_INTERVAL_MS } from "../lib/geckoRequests";
import { inspectFwa } from "./verify-production.mjs";

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
      nextGeckoAt = Date.now() + GECKO_INTERVAL_MS;
    }
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(300_000) });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise(r => setTimeout(r, response.status === 429 ? 60_000 : 1500 * 2 ** attempt));
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
  const checkedAt = Date.now();
  const stale = Date.parse(first.updatedAt) < collectionSchedule(checkedAt).requiredAt;
  if (coins.length !== first.pagination.total || new Set(coins.map(c => c.slug)).size !== coins.length) errors.push("pagination omitted or duplicated projects");
  errors.push(...collectionErrors(coins));
  for (const c of coins) errors.push(...fundamentalErrors(c).map(e => `${c.slug}: ${e}`));
  if (first.collection?.gecko.failed) errors.push(`${first.collection.gecko.failed} asset quote queries failed`);

  // A protected stale publication must prove the retained bytes and the blocked
  // candidate's baseline, rather than comparing yesterday's snapshot to today's feed.
  const p = first.publication;
  if (!p?.published || p.storeError) throw new Error("Verified publication metadata unavailable");
  const archived = await readSnapshot(p.published);
  const archivedCoins = new Map(archived.coins.map(c => [c.slug, c]));
  if (archived.updatedAt !== first.updatedAt || archived.coins.length !== coins.length) errors.push("published archive identity differs from API");
  for (const coin of coins) if (JSON.stringify(coin) !== JSON.stringify(archivedCoins.get(coin.slug))) errors.push(`published bytes changed:${coin.slug}`);
  checkArchiveUrl(p.published.witnessUrl);
  const witnessResponse = await fetch(p.published.witnessUrl, { signal: AbortSignal.timeout(30_000) });
  if (!witnessResponse.ok) throw new Error(`Archived witness HTTP ${witnessResponse.status}`);
  const witnessBytes = new Uint8Array(await witnessResponse.arrayBuffer());
  if (sha256(witnessBytes) !== p.published.witnessSha256) throw new Error("Archived witness hash mismatch");
  const witness = JSON.parse(gunzipSync(witnessBytes).toString("utf8"));
  errors.push(...witnessErrors(archived, witness));
  report.publication = { id:p.published.id, journal:p.id, outcome:p.attempt.outcome, dataAt:p.published.dataAt, sha256:p.published.sha256, stale, verifiedArchiveRows:archived.coins.length };
  if (p.attempt.outcome !== "published") {
    if (p.attempt.outcome === "running") {
      if (Date.now() - Date.parse(p.attempt.startedAt) > COLLECTION_DEADLINE_MS) errors.push("collector did not complete within budget");
    } else {
      checkArchiveUrl(p.attempt.reportUrl);
      const failure = await read(p.attempt.reportUrl);
      if (!failure.errors?.length || failure.baseline?.id !== p.published.id || failure.baseline?.sha256 !== p.published.sha256) errors.push("blocked candidate does not prove retention of this verified baseline");
      if (!p.incident || !p.attempt.errors.length) errors.push("blocked candidate missing incident evidence");
    }
    report.mode = "protected-last-verified";
    report.currentCollectionPassed = false;
    if (output) { await mkdir(output,{recursive:true}); await writeFile(join(output,"all-coins.json"),JSON.stringify({...first,coins})); }
    // This is a protection/integrity pass, explicitly not fresh upstream coverage.
    return;
  }
  if (stale) errors.push("published snapshot missed the scheduled collection deadline");
  // Between scheduled collections, audit against the archived source witness.
  // Today's changing feed cannot prove that a deliberately retained snapshot lost data.
  if (checkedAt - Date.parse(first.updatedAt) > 45 * 60_000) {
    report.mode = "verified-scheduled-snapshot";
    report.currentCollectionPassed = !stale;
    report.liveSourcesChecked = false;
    if (output) { await mkdir(output,{recursive:true}); await writeFile(join(output,"all-coins.json"),JSON.stringify({...first,coins})); }
    return;
  }
  report.mode = "current-publication-and-live-sources";
  report.currentCollectionPassed = true;
  report.liveSourcesChecked = true;

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
      if (!id || lookup?.status === "identity_mismatch" || ![c.mcap,c.price,c.fdv].some(v => v === null || v <= 0)) continue;
      candidates.set(id, [...(candidates.get(id) ?? []), c]);
    }
    const ids = [...candidates.keys()].sort();
    const requests = vendor === "gecko" ? geckoRequests(ids) : Array.from({ length: Math.ceil(ids.length / 250) }, (_, i) => {
      const batch = ids.slice(i * 250, (i + 1) * 250);
      return { ids: batch, url: `https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?convert=USD&skip_invalid=true&id=${batch.join(",")}` };
    });
    for (const { ids: batch, url } of requests) {
      const data = await read(url);
      const rows = Array.isArray(data) ? data : data.data;
      if (!Array.isArray(rows)) throw new Error(`${vendor}: unexpected quote response`);
      quoteChecks += batch.length;
      for (const row of rows as Row[]) {
        const quote = vendor === "gecko" ? row : row.quote?.find((q: Row) => q.symbol === "USD");
        for (const c of candidates.get(String(row.id)) ?? []) {
          const fields = { mcap: "market_cap", price: vendor === "gecko" ? "current_price" : "price", fdv: vendor === "gecko" ? "fully_diluted_valuation" : "fully_diluted_market_cap" } as const;
          for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
            const value = quote?.[fields[field]];
            if (typeof value === "number" && Number.isFinite(value) && (c[field] === null || (c[field]! <= 0 && value > 0))) errors.push(`${c.slug}: ${vendor} has missing ${field}`);
          }
        }
      }
    }
  }
  report.independentQuoteChecks = quoteChecks;
  const fwa = coins.find(c => c.slug === "parent#fake-world-assets");
  report.fwa = fwa && { mcap: fwa.mcap, revenue30d: revenueReading(fwa,30), revenueDays: fwa.revenueHistory?.periods[30], holderDays: fwa.holderHistory?.periods[30], pr: fwa.multiples.pr, phr: fwa.multiples.phr };
  errors.push(...inspectFwa(fwa));
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
