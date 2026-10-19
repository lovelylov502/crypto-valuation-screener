import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { COIN_METRICS_BASE, COIN_METRICS_FIELDS, matchCoinMetricsBindings, parseCoinMetricsHistory, type CoinMetricsManifest, type CoinMetricsReceipt } from "../lib/dailyRawCoinMetrics";
import type { CoinRaw } from "../lib/types";
import type { SourceBundle, SourceReceipt } from "../lib/sourceBundle";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(name); if (i < 0 || !argv[i + 1]) throw Error(`Required argument ${name}`); return argv[i + 1]; };
const cache = resolve(arg("--cache")), snapshotPath = resolve(arg("--snapshot")), bundlePath = resolve(arg("--bundle"));
const rel = relative(process.cwd(), cache);
if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\")) throw Error("Coin Metrics original cache must be outside the Git worktree");
const manifestPath = join(cache, "manifest.json");
const save = async (path: string, value: unknown) => { const temp = `${path}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, path); };
const unpack = (bytes: Buffer) => JSON.parse((bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8"));

async function main() {
  await mkdir(join(cache, "originals"), { recursive: true });
  await mkdir(join(cache, "requests"), { recursive: true });
  const [snapshotBytes, bundleBytes] = await Promise.all([readFile(snapshotPath), readFile(bundlePath)]);
  const snapshot = unpack(snapshotBytes) as { coins: CoinRaw[]; updatedAt: string }, bundle = unpack(bundleBytes) as SourceBundle;
  if (!Array.isArray(snapshot.coins) || !Array.isArray(bundle.receipts) || !Number.isFinite(Date.parse(snapshot.updatedAt))) throw Error("Invalid verified snapshot or source bundle");
  let manifest: CoinMetricsManifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; manifest = { schema: 1, provider: "CoinMetrics", startedAt: new Date().toISOString(), status: "running",
    snapshotSha256: hash(snapshotBytes), bundleSha256: hash(bundleBytes), bindings: [], proofs: [], histories: [], issues: [] }; }
  if (manifest.snapshotSha256 !== hash(snapshotBytes) || manifest.bundleSha256 !== hash(bundleBytes)) throw Error("Coin Metrics cache belongs to a different verified publication");
  if (manifest.retryAt && Date.parse(manifest.retryAt) > Date.now()) { console.log(JSON.stringify({ status: "deferred", retryAt: manifest.retryAt, manifest: manifestPath })); return; }
  delete manifest.retryAt; manifest.status = "running";
  await save(manifestPath, manifest);
  const persist = async (body: string, metadata: Omit<CoinMetricsReceipt, "file" | "sha256">): Promise<CoinMetricsReceipt> => {
    const sha256 = hash(body), file = `originals/${sha256}.json`, path = join(cache, file);
    try { const old = await readFile(path); if (hash(old) !== sha256) throw Error("Corrupt Coin Metrics original receipt"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(path, body, { flag: "wx" }); }
    return { ...metadata, file, sha256 };
  };
  let lastRequest = 0, networkRequests = 0, cachedRequests = 0;
  const get = async (url: string): Promise<{ body: unknown; receipt: CoinMetricsReceipt }> => {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(COIN_METRICS_BASE).origin || !parsed.pathname.startsWith("/v4/")) throw Error("Unexpected Coin Metrics continuation URL");
    const index = join(cache, "requests", `${hash(url)}.json`);
    try {
      const receipt = JSON.parse(await readFile(index, "utf8")) as CoinMetricsReceipt;
      const original = await readFile(join(cache, receipt.file));
      if (receipt.url !== url || hash(original) !== receipt.sha256 || receipt.status !== 200) throw Error("Invalid cached Coin Metrics response");
      cachedRequests++; return { body: JSON.parse(original.toString("utf8")), receipt };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const pause = 1000 - (Date.now() - lastRequest);
    if (pause > 0) await new Promise(r => setTimeout(r, pause));
    lastRequest = Date.now();
    networkRequests++;
    const requestedAt = new Date().toISOString(), response = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
    const body = await response.text(), observedAt = new Date().toISOString();
    const receipt = await persist(body, { url, requestedAt, observedAt, status: response.status,
      headers: Object.fromEntries([...response.headers].filter(([key]) => ["content-type", "retry-after", "x-ratelimit-plan", "etag", "last-modified"].includes(key))) });
    if (!response.ok) {
      manifest.issues.push({ scope: url, reason: `HTTP ${response.status}; original ${receipt.file}` });
      if ([401, 403, 429].includes(response.status)) {
        const retry = response.headers.get("retry-after"), seconds = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 60_000;
        manifest.retryAt = new Date(Date.now() + ([401, 403].includes(response.status) ? 86_400_000 : Math.max(6000, Number.isFinite(seconds) ? seconds : 60_000))).toISOString();
        manifest.status = "deferred"; await save(manifestPath, manifest);
      }
      throw Error(`Coin Metrics HTTP ${response.status}; stopped without retrying another endpoint`);
    }
    await save(index, receipt);
    return { body: JSON.parse(body), receipt };
  };
  const originalCmc: { body: unknown; receipt: CoinMetricsReceipt }[] = [];
  for (const receipt of bundle.receipts.filter((r: SourceReceipt) => r.status === 200 && new URL(r.url).hostname === "pro-api.coinmarketcap.com" && new URL(r.url).pathname === "/public-api/v3/cryptocurrency/listings/latest")) {
    if (hash(receipt.body) !== receipt.sha256) throw Error("Original CMC receipt hash mismatch");
    originalCmc.push({ body: JSON.parse(receipt.body), receipt: await persist(receipt.body, { url: receipt.url, requestedAt: receipt.requestedAt, observedAt: receipt.observedAt, status: 200, headers: receipt.headers }) });
  }
  const catalog = await get(`${COIN_METRICS_BASE}/catalog/asset-metrics`);
  const markets = [];
  for (const exchange of ["uniswap_v2_eth", "uniswap_v3_eth", "sushiswap_v1_eth"]) markets.push(await get(`${COIN_METRICS_BASE}/reference-data/markets?exchange=${exchange}&page_size=10000`));
  if (markets.some(m => (m.body as { next_page_url?: string }).next_page_url)) throw Error("Coin Metrics market proof requires further pagination");
  manifest.proofs = [{ role: "catalog", receipt: catalog.receipt }, ...markets.map(m => ({ role: "markets" as const, receipt: m.receipt })), ...originalCmc.map(c => ({ role: "cmc" as const, receipt: c.receipt }))];
  manifest.bindings = matchCoinMetricsBindings(snapshot.coins, originalCmc.flatMap(c => (c.body as { data: unknown[] }).data), markets.map(m => m.body), catalog.body);
  await save(manifestPath, manifest);
  const end = new Date(Date.parse(snapshot.updatedAt.slice(0, 10)) - 86_400_000).toISOString().slice(0, 10);
  const cmAssets = [...new Set(manifest.bindings.sort((a, b) => Number(b.fdvVerified) - Number(a.fdvVerified) || a.cmAsset.localeCompare(b.cmAsset)).map(b => b.cmAsset))];
  for (const cmAsset of cmAssets) {
    let history = manifest.histories.find(h => h.cmAsset === cmAsset);
    if (!history) { history = { cmAsset, pages: [], complete: false, nextUrl: `${COIN_METRICS_BASE}/timeseries/asset-metrics?assets=${encodeURIComponent(cmAsset)}&metrics=${COIN_METRICS_FIELDS}&frequency=1d&page_size=10000&paging_from=start&end_time=${end}` }; manifest.histories.push(history); }
    while (!history.complete && history.nextUrl) {
      const url = new URL(history.nextUrl);
      if (url.pathname !== "/v4/timeseries/asset-metrics" || url.searchParams.get("assets") !== cmAsset) throw Error("Coin Metrics pagination changed token identity");
      const response = await get(history.nextUrl);
      if (!Array.isArray((response.body as { data?: unknown }).data)) throw Error("Invalid Coin Metrics historical body");
      history.pages.push(response.receipt);
      history.nextUrl = (response.body as { next_page_url?: string }).next_page_url;
      history.complete = !history.nextUrl;
      await save(manifestPath, manifest);
    }
    console.log(JSON.stringify({ asset: cmAsset, bindings: manifest.bindings.filter(b => b.cmAsset === cmAsset).length, pages: history.pages.length, complete: history.complete }));
  }
  let verifiedFdvDays = 0;
  for (const binding of manifest.bindings.filter(b => b.fdvVerified)) for (const receipt of manifest.histories.find(h => h.cmAsset === binding.cmAsset)?.pages ?? []) {
    const body = JSON.parse(await readFile(join(cache, receipt.file), "utf8"));
    verifiedFdvDays += parseCoinMetricsHistory(body, binding, receipt).points.filter(p => p.fdv?.state === "complete").length;
  }
  manifest.completedAt = new Date().toISOString(); manifest.status = "complete";
  await save(manifestPath, manifest);
  console.log(JSON.stringify({ status: manifest.status, manifest: manifestPath, bindings: manifest.bindings.length, cmAssets: cmAssets.length,
    verifiedFdvAssets: manifest.bindings.filter(b => b.fdvVerified).length, verifiedFdvDays, networkRequests, cachedRequests }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
