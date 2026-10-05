import { afterEach, expect, it, vi } from "vitest";
import { assessPipelineCandidate, captureDataPipeline } from "./dataPipeline";
import { classifyAttemptFailure, scheduledCollectionDecision } from "./scheduledCollection";
import type { CollectionAttempt, PublicationJournal } from "./publicationTypes";
import type { SourceObservation } from "./types";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const at = "2026-10-05T02:00:00.000Z";
const protocol = { slug: "one", name: "One", id: "1", defillamaId: "1" };

function setup(path: "directory" | "dailyRevenue" | "dailyHoldersRevenue", status: 200 | 503) {
  vi.useFakeTimers(); vi.setSystemTime(new Date(at));
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const u = new URL(String(input));
    const target = path === "directory" ? u.pathname === "/protocols"
      : u.pathname === "/overview/fees" && u.searchParams.get("dataType") === path && u.searchParams.get("excludeTotalDataChartBreakdown") === "false";
    if (target) return new Response(status === 503 ? "temporarily unavailable" : "malformed JSON", { status });
    return Response.json(u.hostname === "stablecoins.llama.fi" ? { peggedAssets: [{ gecko_id: "tether", symbol: "USDT" }] }
      : u.hostname.includes("coinmarketcap.com") ? { data: [{ id: 999, name: "Other", symbol: "O", slug: "other" }] }
      : u.pathname === "/protocols" ? [protocol]
      : u.pathname === "/config" ? { parentProtocols: [{ id: "parent#unrelated", name: "Unrelated" }] }
      : { protocols: [protocol], totalDataChartBreakdown: [] });
  }));
}

function blocked(errors: string[], sources: SourceObservation[]): PublicationJournal {
  const attempt: CollectionAttempt = { id: "data-test", startedAt: at, completedAt: new Date().toISOString(), outcome: "blocked",
    runUrl: "", reportUrl: "", errors, sourceFailures: sources.filter(s => s.status === "error"), affectedProjects: 0, changeCount: 0, affected: [] };
  return { schema: 1, id: "data-test-complete", createdAt: attempt.completedAt!, trackingStartedAt: at, previousId: null, previousStateUrl: null,
    published: null, attempt, incident: null, recoveredAt: null };
}

it.each(["dailyRevenue", "dailyHoldersRevenue"] as const)("retries captured %s HTTP503 but holds malformed HTTP200 for validation", async metric => {
  for (const status of [503, 200] as const) {
    setup(metric, status);
    const pending = captureDataPipeline(null, at, async () => {});
    await vi.runAllTimersAsync();
    const result = await pending;
    const errors = assessPipelineCandidate(result.data, result.bundle, null, at, new Date().toISOString(), result.data).errors;
    expect(errors.length).toBeGreaterThan(0);
    const journal = blocked(errors, result.data.sources);
    expect(journal.attempt.sourceFailures).toContainEqual(expect.objectContaining({ status: "error", httpStatus: status }));
    expect(classifyAttemptFailure(journal.attempt)).toBe(status === 503 ? "transient" : "validation");
    expect(scheduledCollectionDecision(journal, Date.parse(at) + 30 * 60_000).collect).toBe(status === 503);
  }
});

it.each([503, 200] as const)("retains fatal directory HTTP%s evidence through pipeline failure and the retry decision", async status => {
  setup("directory", status);
  const sources: SourceObservation[] = [];
  let failure: unknown;
  const pending = captureDataPipeline(null, at, async () => {}, sources).catch(error => { failure = error; });
  await vi.runAllTimersAsync(); await pending;
  expect(failure).toBeInstanceOf(Error);
  const journal = blocked([(failure as Error).message, "candidate_artifacts_missing", "comparison_not_completed"], sources);
  expect(journal.attempt.sourceFailures).toContainEqual(expect.objectContaining({ url: "https://api.llama.fi/protocols", httpStatus: status }));
  expect(classifyAttemptFailure(journal.attempt)).toBe(status === 503 ? "transient" : "validation");
  expect(scheduledCollectionDecision(journal, Date.parse(at) + 30 * 60_000).collect).toBe(status === 503);
});
