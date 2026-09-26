import { unstable_cache } from "next/cache";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { buildScreener } from "./screener";
import { SCORE_VERSION } from "./valuation";
import type { ScreenerResponse } from "./types";

// Content-addressed chunks stay below Next's 2 MB entry limit. Publish the manifest
// only after every chunk is stored: a page must never mix two collection times.
const VERSION = "full-universe-utc-24h-v9-reviewed-aero";
const chunk = (hash: string, contents?: string) => unstable_cache(async () => {
  if (contents === undefined) throw new Error("Snapshot chunk unavailable");
  return contents;
}, ["screener-chunk", VERSION, hash], { revalidate: false })();

async function buildManifest() {
  const data = await buildScreener();
  const compressed = gzipSync(JSON.stringify(data)).toString("base64");
  const hashes: string[] = [];
  for (let i = 0; i < compressed.length; i += 1_000_000) {
    const contents = compressed.slice(i, i + 1_000_000);
    const hash = createHash("sha256").update(contents).digest("hex");
    await chunk(hash, contents);
    hashes.push(hash);
  }
  memory = data;
  return { hashes, updatedAt: data.updatedAt };
}
const cachedManifest = unstable_cache(buildManifest, ["screener-manifest", SCORE_VERSION, VERSION], { revalidate: 1800 });
let memory: ScreenerResponse | undefined;
let pending: Promise<ScreenerResponse> | undefined;

export async function getScreener(): Promise<ScreenerResponse> {
  if (memory?.scoreVersion === SCORE_VERSION && Date.now() - Date.parse(memory.updatedAt) < 1800_000) return memory;
  pending ??= (async () => {
    let manifest = await cachedManifest();
    if (memory?.updatedAt === manifest.updatedAt) return memory;
    const read = async () => {
      const parts = await Promise.all(manifest.hashes.map(async hash => {
        const value = await chunk(hash);
        if (createHash("sha256").update(value).digest("hex") !== hash) throw new Error("Snapshot integrity mismatch");
        return value;
      }));
      const data = JSON.parse(gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8")) as ScreenerResponse;
      if (data.updatedAt !== manifest.updatedAt) throw new Error("Snapshot time mismatch");
      return data;
    };
    try { memory = await read(); }
    // In dev no-cache requests (and evicted chunks), use the freshly built value.
    // Next persists cache writes after the request, so immediately rereading can miss.
    catch { await buildManifest(); }
    return memory!;
  })().finally(() => { pending = undefined; });
  return pending;
}
