import { Buffer } from "node:buffer";
import { DEPLOY_CONTRACT } from "./deploy-contract.mjs";

const ADVANCED_UI_MARKERS = ["실적 개선", "홀더 배분", "흐름 전환", "지난 확인 이후", "최신 자료 확인"];
const LEGACY_UI_MARKERS = ["저평가 80+", "고평가 20 이하"];
const MAX_API_BYTES = 4_500_000;
const MAX_ATTEMPTS = 8;
const RETRY_DELAY_MS = 5_000;

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function decodeUnicodeEscapes(value) {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

async function readPath(pathname, attempt) {
  const url = new URL(pathname, DEPLOY_CONTRACT.liveBaseUrl);
  url.searchParams.set("deploy_verify", `${Date.now()}-${attempt}`);
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  return {
    pathname,
    status: response.status,
    bytes: Buffer.byteLength(body),
    cache: response.headers.get("x-vercel-cache"),
    requestId: response.headers.get("x-vercel-id"),
    body,
  };
}

function inspectHome(readback) {
  const body = decodeUnicodeEscapes(readback.body);
  const missingMarkers = ADVANCED_UI_MARKERS.filter((marker) => !body.includes(marker));
  const legacyMarkers = LEGACY_UI_MARKERS.filter((marker) => body.includes(marker));
  const errors = [];
  if (readback.status !== 200) errors.push(`home HTTP ${readback.status}`);
  if (missingMarkers.length > 0) errors.push(`missing UI markers: ${missingMarkers.join(", ")}`);
  if (legacyMarkers.length > 0) errors.push(`legacy UI markers remain: ${legacyMarkers.join(", ")}`);
  return { errors, missingMarkers, legacyMarkers };
}

function inspectApi(readback) {
  const errors = [];
  let data;
  if (readback.status !== 200) errors.push(`API HTTP ${readback.status}`);
  try {
    data = JSON.parse(readback.body);
  } catch (error) {
    errors.push(`API JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
    return { errors, data: null };
  }
  if (readback.bytes >= MAX_API_BYTES) {
    errors.push(`API payload ${readback.bytes} bytes exceeds fail-closed limit ${MAX_API_BYTES}`);
  }
  if (data.scoreVersion !== DEPLOY_CONTRACT.scoreVersion) {
    errors.push(`unexpected scoreVersion: ${data.scoreVersion ?? "missing"}`);
  }
  if (!Array.isArray(data.coins) || data.coins.length === 0) {
    errors.push("API coins array is missing or empty");
  } else {
    const sample = data.coins.find((coin) => coin && typeof coin === "object");
    for (const field of ["status", "scoreAxes", "holderValue", "opportunities", "peerCounts"]) {
      if (!(field in sample)) errors.push(`API advanced field missing: ${field}`);
    }
  }
  return { errors, data };
}

export async function verifyProduction() {
  let lastErrors = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const [home, api] = await Promise.all([
        readPath("/", attempt),
        readPath("/api/screener", attempt),
      ]);
      const homeInspection = inspectHome(home);
      const apiInspection = inspectApi(api);
      lastErrors = [...homeInspection.errors, ...apiInspection.errors];
      if (lastErrors.length === 0) {
        console.log(JSON.stringify({
          path: "/",
          status: home.status,
          bytes: home.bytes,
          cache: home.cache,
          requestId: home.requestId,
          advancedMarkers: ADVANCED_UI_MARKERS,
          legacyMarkers: homeInspection.legacyMarkers,
        }));
        console.log(JSON.stringify({
          path: "/api/screener",
          status: api.status,
          bytes: api.bytes,
          cache: api.cache,
          requestId: api.requestId,
          scoreVersion: apiInspection.data.scoreVersion,
          rows: apiInspection.data.coins.length,
          updatedAt: apiInspection.data.updatedAt,
        }));
        console.log("[production-readback] PASS");
        return;
      }
    } catch (error) {
      lastErrors = [error instanceof Error ? error.message : String(error)];
    }

    console.error(`[production-readback] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastErrors.join("; ")}`);
    if (attempt < MAX_ATTEMPTS) await wait(RETRY_DELAY_MS);
  }
  throw new Error(`Production readback failed: ${lastErrors.join("; ")}`);
}

verifyProduction().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
