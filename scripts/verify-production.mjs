import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";
import { DEPLOY_CONTRACT } from "./deploy-contract.mjs";

const ADVANCED_UI_MARKERS = ["DefiLlama 전체 종목", "열 표시", "필터", "연결 토큰", "배수 분자", "P/R · 24시간", "P/HR · 24시간", "P/R · 30일", "P/HR · 30일", "지표 안내", "최신 자료 확인", "page-size-top", "scan-table", "수익 정렬 기준"];
const LEGACY_UI_MARKERS = ["저평가 80+", "고평가 20 이하", "P/S 참고선", "P/S · 30일", "P/S · 사업 매출", 'aria-label="결과 정렬"'];
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
    signal: AbortSignal.timeout(300_000),
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

export function inspectHome(readback, expectedSnapshot) {
  const body = decodeUnicodeEscapes(readback.body);
  const missingMarkers = ADVANCED_UI_MARKERS.filter((marker) => !body.includes(marker));
  const legacyMarkers = LEGACY_UI_MARKERS.filter((marker) => body.includes(marker));
  const errors = [];
  if (readback.status !== 200) errors.push(`home HTTP ${readback.status}`);
  if (missingMarkers.length > 0) errors.push(`missing UI markers: ${missingMarkers.join(", ")}`);
  if (legacyMarkers.length > 0) errors.push(`legacy UI markers remain: ${legacyMarkers.join(", ")}`);
  if (expectedSnapshot && !body.includes(expectedSnapshot)) errors.push("HTML and API snapshots differ");
  return { errors, missingMarkers, legacyMarkers };
}

export function publicationProofKey(data) {
  const p = data?.publication?.published, proof = data?.pipeline;
  return JSON.stringify([p?.id, p?.sha256, p?.dataAt, p?.witnessSha256, p?.rawBundleUrl, p?.rawBundleSha256,
    p?.normalizedSha256, p?.replayVerified, proof?.schema, proof?.asOf, proof?.rawBundleSha256,
    proof?.normalizedSha256, proof?.outputSha256, proof?.replayVerified, proof?.quality]);
}

export function inspectPipelineProof(data) {
  const proof = data?.pipeline, p = data?.publication?.published;
  if (!proof) return p?.rawBundleUrl || p?.rawBundleSha256 ? ["API omitted published pipeline proof"] : [];
  const errors = [];
  const hashes = [proof.rawBundleSha256, proof.normalizedSha256, proof.outputSha256];
  const prefix = DEPLOY_CONTRACT.githubRemote.replace(/\.git$/, "") + "/releases/download/";
  if (proof.schema !== 1 || proof.replayVerified !== true || proof.asOf !== data.updatedAt ||
    !hashes.every(h => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)) ||
    !Number.isInteger(proof.quality?.affectedProjects) || proof.quality.affectedProjects < 0 ||
    !Number.isInteger(proof.quality?.issueCount) || proof.quality.issueCount < proof.quality.affectedProjects) errors.push("invalid pipeline source proof");
  if (!p || p.dataAt !== data.updatedAt || p.rawBundleSha256 !== proof.rawBundleSha256 ||
    p.normalizedSha256 !== proof.normalizedSha256 || p.replayVerified !== true ||
    p.rawBundleUrl !== `${prefix}${p.id}/source-bundle.json.gz`) errors.push("pipeline proof differs from published artifact");
  return errors;
}

export function inspectApi(readback, requireUsableHistory = true) {
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
  if (!data.pagination || data.pagination.total < data.pagination.filtered || data.pagination.filtered < data.coins?.length || ![50,100,200].includes(data.pagination.size) || data.coins?.length > data.pagination.size) errors.push("invalid paginated universe");
  if (data.universe?.projects !== data.pagination?.total || !(data.universe?.linkedTokens > 0)) errors.push("universe coverage missing");
  const coverage = data.collection;
  errors.push(...inspectPipelineProof(data));
  if (!coverage || coverage.projects !== data.pagination?.total || coverage.errors !== 0 || (!data.pipeline && (coverage.gecko?.failed !== 0 || coverage.cmc?.failed !== 0)) ||
    [coverage.gecko, coverage.cmc].some(q => !q || ![q.requested,q.received,q.notReturned,q.failed].every(n=>Number.isInteger(n)&&n>=0) || q.requested !== q.received + q.notReturned + q.failed) ||
    coverage.displayedRevenue30d < coverage.sourceRevenue30d) errors.push("collection coverage incomplete");
  if (!Array.isArray(data.coins) || (data.coins.length === 0 && (requireUsableHistory || !data.pipeline || data.pagination?.filtered !== 0))) {
    errors.push("API coins array is missing or empty");
  } else if (data.coins.length) {
    const sample = data.coins.find((coin) => coin && typeof coin === "object");
    for (const field of ["status", "scoreAxes", "holderValue", "opportunities", "peerCounts", "descriptionKo"]) {
      if (!(field in sample)) errors.push(`API advanced field missing: ${field}`);
    }
    if (requireUsableHistory && !data.pipeline && !data.coins.some((coin) => coin.revenueHistory?.periods?.[30]?.total > 0 && coin.revenueHistory?.weeks?.length === 13)) {
      errors.push("API has no usable completed-day revenue history");
    }
    if (!data.coins.some((coin) => typeof coin.descriptionKo === "string" && /[가-힣]/u.test(coin.descriptionKo))) {
      errors.push("API has no Korean protocol descriptions");
    }
    for (const coin of data.coins) {
      if (data.pipeline) {
        const quality = coin.dataQuality;
        if (!quality || !["complete","partial","unavailable"].includes(quality.state) || !Array.isArray(quality.issues) ||
          (quality.state === "complete") !== (quality.issues.length === 0) || quality.issues.some(i =>
            !["market","revenue","holders","fees","volume"].includes(i.scope) || typeof i.code !== "string" || typeof i.source !== "string" || typeof i.retryable !== "boolean")) errors.push(`invalid local data quality: ${coin.slug}`);
        if (quality?.issues?.some(i => i.code === "value_conflict" && i.scope === "holders") && coin.multiples.phr !== null) errors.push(`conflicting holder history used: ${coin.slug}`);
        if (quality?.issues?.some(i => i.code === "value_conflict" && i.scope === "revenue") && coin.multiples.pr !== null) errors.push(`conflicting revenue history used: ${coin.slug}`);
      }
      if (!Array.isArray(coin.sourceSlugs) || !coin.sourceSlugs.includes(coin.slug) || !coin.marketSources) errors.push(`source accounting missing: ${coin.slug}`);
      if (coin.geckoId && coin.marketSources?.gecko?.id !== coin.geckoId) errors.push(`unqueried asset: ${coin.slug}`);
      for (const lookup of [coin.marketSources?.gecko, coin.marketSources?.cmc]) if (lookup?.status === "received") {
        for (const field of lookup.available ?? []) if (coin[field] === null) errors.push(`source-backed ${field} missing: ${coin.slug}`);
        for (const field of lookup.positive ?? []) if (!(coin[field] > 0)) errors.push(`source-backed positive ${field} missing: ${coin.slug}`);
      }
      const f = coin.fundamentals;
      if (!f || f.version !== "fundamental-definitions-v1" || !Array.isArray(f.revenue?.components) || !Array.isArray(f.fees?.components) || !Array.isArray(f.holders)) {
        errors.push(`definition metadata missing: ${coin.slug}`); break;
      }
      if (Object.hasOwn(coin.multiples, "ps")) errors.push(`legacy P/S: ${coin.slug}`);
      if (["unknown", "mixed"].includes(f.revenue.kind) && coin.multiples.revenueMultiple !== null) errors.push(`unreviewed multiple: ${coin.slug}`);
      if (!f.holderShareReviewed && coin.valueCapture.eligibleHolderValueShare !== null) errors.push(`unreviewed holder share: ${coin.slug}`);
      if (!["protocol_revenue", "service_sales"].includes(f.revenue.kind) && f.fees.kind !== "user_fees" && coin.opportunities.business) errors.push(`non-business growth: ${coin.slug}`);
    }
    for (const coin of data.coins) {
      const check = (key, amount, days) => {
        const value = coin.multiples[key];
        if (value !== null && (!(amount > 0) || Math.abs(value - coin.mcap / (amount * 365 / days)) > Math.max(1,value)*1e-9)) errors.push(`invalid ${key}: ${coin.slug}`);
      };
      check("psSales", coin.sales?.amountUsd, 365);
      check("phr", coin.holderHistory?.periods?.[30]?.total, 30);
      if (coin.multiples.psSales !== null && (coin.sales?.status !== "current" || coin.sales?.geckoId !== coin.geckoId || coin.sales?.symbol !== coin.symbol)) errors.push(`sales evidence invalid: ${coin.slug}`);
      if (coin.multiples.pr !== null && !["protocol_revenue","service_sales"].includes(coin.fundamentals.revenue.kind)) errors.push(`non-protocol P/R: ${coin.slug}`);
      if (coin.multiples.phr !== null && coin.holderHistory?.periods?.[30]?.reportedDays !== 30) errors.push(`partial holder period: ${coin.slug}`);
      if (coin.capitalExclusionReason && Object.values(coin.multiples).some(v=>v!==null)) errors.push(`ineligible capital: ${coin.slug}`);
    }
    const venice = data.coins.find(c => c.slug === "venice");
    if (!data.pipeline && venice && (venice.fundamentals?.revenue.kind !== "holder_return" || venice.fundamentals?.fees.kind !== "holder_return" || venice.opportunities.business || venice.valueCapture.eligibleHolderValueShare !== null || venice.multiples.pf !== null)) errors.push("VVV scope regression");
  }
  return { errors, data };
}

export function inspectFwa(coin) {
  const errors = [];
  if (!coin || !(coin.mcap > 0) || !(coin.revenue30d > 0) || coin.fundamentals?.revenue.kind !== "protocol_revenue") return ["FWA source/quote regression"];
  for (const [key, history] of [["pr", coin.revenueHistory], ["phr", coin.holderHistory]]) {
    const period = history?.periods?.[30], value = coin.multiples[key];
    if (!period || !Number.isInteger(period.reportedDays) || period.reportedDays < 0 || period.reportedDays > 30) errors.push(`FWA ${key} coverage missing`);
    else if (period.reportedDays < 30 || !(period.total > 0)) {
      if (value !== null || (period.reportedDays < 30 && period.total !== null)) errors.push(`FWA ${key} uses incomplete history`);
    } else if (!(value > 0) || Math.abs(value - coin.mcap / (period.total * 365 / 30)) > Math.max(1,value)*1e-9) errors.push(`FWA ${key} arithmetic regression`);
  }
  return errors;
}

export async function verifyProduction() {
  let lastErrors = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const api = await readPath("/api/screener", attempt);
      const [home, named, fwa] = await Promise.all([
        readPath("/", attempt),
        readPath("/api/screener?prefs=" + encodeURIComponent(JSON.stringify({ search: "venice" })), attempt),
        readPath("/api/screener?prefs=" + encodeURIComponent(JSON.stringify({ search: "fwa" })), attempt),
      ]);
      const apiInspection = inspectApi(api);
      // The static shell has no data payload; all rows now come from one persisted API snapshot.
      const homeInspection = inspectHome(home, apiInspection.data?.publication ? undefined : apiInspection.data?.updatedAt);
      const namedInspection = inspectApi(named, false);
      const fwaInspection = inspectApi(fwa, false);
      lastErrors = [...homeInspection.errors, ...apiInspection.errors, ...namedInspection.errors, ...fwaInspection.errors];
      const publication = apiInspection.data?.publication;
      if (!publication?.published || publication.published.dataAt !== apiInspection.data?.updatedAt || publication.storeError) lastErrors.push("verified publication identity unavailable");
      for (const result of [namedInspection, fwaInspection]) if (publicationProofKey(result.data) !== publicationProofKey(apiInspection.data)) lastErrors.push("API queries use different publication proofs");
      if (!apiInspection.data?.pipeline && !namedInspection.data?.coins?.some(c => c.slug === "venice")) lastErrors.push("VVV lookup unavailable");
      const fwaCoin = fwaInspection.data?.coins?.find(c => c.slug === "parent#fake-world-assets");
      if (!apiInspection.data?.pipeline) lastErrors.push(...inspectFwa(fwaCoin));
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
          universeRows: apiInspection.data.pagination.total,
          updatedAt: apiInspection.data.updatedAt,
        }));
        console.log(JSON.stringify({ publication: publication.published.id, collectionOutcome: publication.attempt.outcome, protected: publication.attempt.outcome !== "published", lastVerifiedDataAt: publication.published.dataAt,
          ...(apiInspection.data.pipeline ? { quality: apiInspection.data.pipeline.quality, requiresSourceReplayAudit: true } : {}) }));
        console.log("[production-readback] PASS (publication integrity; see collection outcome)");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) verifyProduction().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
