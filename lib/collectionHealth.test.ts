import { describe, expect, it,vi } from "vitest";
// Historical collection-health fixtures exercise legacy active scheduling; live mode transitions have separate regressions.
vi.mock("./pipeline-release.json",()=>({default:{readerRelease:"four-daily-freshness-v2",writerSchema:1,schedule:"legacy",phaseA:null}}));
import { collectionHealth } from "./collectionHealth";
import { RULE_VERSION } from "./fundamentals";
import type { ScreenerResponse } from "./types";

const at = "2026-09-29T10:32:53.309Z", now = Date.parse(at) + 60_000;
function healthy(): Pick<ScreenerResponse, "updatedAt" | "sources" | "scoreVersion" | "collection" | "pipeline"> {
  return { updatedAt: at, scoreVersion: RULE_VERSION, sources: [{ url: "https://api.coingecko.com/api/v3/coins/markets", observedAt: at, status: "ok" }],
    collection: { projects: 7145, sourceSlugs: 9454, errors: 0, gecko: { requested: 2768, received: 1530, notReturned: 1238, failed: 0 },
      cmc: { requested: 2152, received: 2138, notReturned: 14, failed: 0 }, marketCap: 1710, price: 1687, fdv: 2458,
      sourceRevenue30d: 1594, displayedRevenue30d: 1594, partialRevenue30d: 25 } };
}

function partial() {
  const data = healthy();
  data.pipeline = { schema: 1, asOf: at, rawBundleSha256: "a".repeat(64), normalizedSha256: "b".repeat(64), outputSha256: "c".repeat(64), replayVerified: true,
    quality: { affectedProjects: 12, issueCount: 17 } };
  data.sources.push({ url: "https://api.llama.fi/summary/fees/sample?dataType=dailyRevenue", observedAt: at, status: "error", httpStatus: 503 });
  return data;
}

describe("collection health, independent of HTTP 200 and current filtered rows", () => {
  it("discloses accepted local failures without marking current unaffected rows globally blocked", () => {
    expect(collectionHealth(partial(), now)).toMatchObject({ state: "partial", label: "일부 자료 확인 필요", affectedProjects: 12, issueCount: 17, stale: false });
  });
  it("keeps replay proof, global failures, failed checks, and scheduled freshness ahead of partial availability", () => {
    const data = partial();
    data.pipeline!.replayVerified = false;
    expect(collectionHealth(data, now).state).toBe("error");
    data.pipeline!.replayVerified = true;
    expect(collectionHealth(data, now, "서버 연결 실패", true).label).toBe("확인 오류");
    expect(collectionHealth(data, Date.parse("2026-09-29T15:30:00Z")).state).toBe("stale");
    data.sources.push({ url: "https://api.llama.fi/protocols", observedAt: at, status: "error", httpStatus: 503 });
    expect(collectionHealth(data, now).state).toBe("error");
  });
  it("allows explicit provider absence and partial original amounts without claiming missing data is zero", () => {
    expect(collectionHealth(healthy(), now).state).toBe("healthy");
  });
  it("detects the incident even though its collection error counter is zero", () => {
    const data = healthy();
    data.collection!.gecko = { requested: 2768, received: 0, notReturned: 0, failed: 2768 };
    data.sources = Array.from({ length: 12 }, (_, n) => ({ url: `https://api.coingecko.com/api/v3/coins/markets?batch=${n}`, observedAt: at, status: "error", httpStatus: 403 }));
    expect(collectionHealth(data, now)).toMatchObject({ state: "error", providers: ["CoinGecko"], quoteFailures: 2768, firstFailureAt: at });
    expect(collectionHealth(data, now, "", true).state).toBe("error");
    expect(collectionHealth(data, Date.parse("2026-09-29T15:30:00Z"))).toMatchObject({ state: "error", stale: true });
  });
  it("detects failed lookup accounting even if source error observations are missing", () => {
    const data = healthy(); data.collection!.gecko.failed = 1;
    expect(collectionHealth(data, now).state).toBe("error");
  });
  it("does not hide a failed browser/server check while retrying with older valid data", () => {
    expect(collectionHealth(healthy(), now, "서버 연결 실패", true)).toMatchObject({ state: "error", label: "확인 오류" });
    expect(collectionHealth(healthy(), now, "", true).state).toBe("checking");
    expect(collectionHealth(healthy(), now, "", false).state).toBe("healthy");
  });
  it("waits until the scheduled deadline and does not mark UTC rollover alone stale", () => {
    expect(collectionHealth(healthy(), Date.parse("2026-09-29T15:29:59Z")).state).toBe("healthy");
    expect(collectionHealth(healthy(), Date.parse("2026-09-29T15:30:00Z")).state).toBe("stale");
    const data = healthy(); data.updatedAt = "2026-09-29T23:59:00Z";
    expect(collectionHealth(data, Date.parse("2026-09-30T00:00:01Z")).state).toBe("healthy");
  });
  it("keeps scope conflicts and wholly empty quote responses out of green status", () => {
    const data = healthy(); data.sources.push({ url: "https://api.llama.fi/summary/fees/parent", observedAt: at, status: "withheld", reason: "scope_mismatch" });
    expect(collectionHealth(data, now).state).toBe("warning");
    data.sources.pop(); data.collection!.gecko = { requested: 2768, received: 0, notReturned: 2768, failed: 0 };
    expect(collectionHealth(data, now).state).toBe("warning");
  });
  it("cannot label missing or inconsistent evidence as healthy", () => {
    expect(collectionHealth(null, now).state).toBe("checking");
    const data = healthy(); data.collection = undefined;
    expect(collectionHealth(data, now).state).toBe("unknown");
    expect(collectionHealth({ ...healthy(), sources: [] }, now).state).toBe("unknown");
    const mismatch = healthy(); mismatch.collection!.gecko.requested++;
    expect(collectionHealth(mismatch, now).state).toBe("unknown");
  });
  it.each(["timestamp", "future", "version", "hiddenRevenue", "contract"])("rejects invalid %s evidence", kind => {
    const data = healthy();
    if (kind === "timestamp") data.updatedAt = "invalid";
    if (kind === "future") data.updatedAt = new Date(now + 300_001).toISOString();
    if (kind === "version") data.scoreVersion = "old-version";
    if (kind === "hiddenRevenue") data.collection!.displayedRevenue30d--;
    if (kind === "contract") data.collection!.errors = 1;
    expect(collectionHealth(data, now).state).toBe("error");
  });
});
