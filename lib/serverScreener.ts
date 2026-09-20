import { unstable_cache } from "next/cache";
import { gzipSync, gunzipSync } from "node:zlib";
import { buildScreener } from "./screener";
import { SCORE_VERSION } from "./valuation";
import type { ScreenerResponse } from "./types";

// Source payloads exceed Next's per-entry limit. Cache one compressed, joined snapshot
// so the page and refresh API share the same observation and 30-minute refresh cycle.
const cachedSnapshot = unstable_cache(async () => {
  const data = await buildScreener();
  return gzipSync(JSON.stringify(data)).toString("base64");
}, ["screener", SCORE_VERSION, "capital-and-identity-v7-2"], { revalidate: 1800 });

export async function getScreener(): Promise<ScreenerResponse> {
  return JSON.parse(gunzipSync(Buffer.from(await cachedSnapshot(), "base64")).toString("utf8"));
}
