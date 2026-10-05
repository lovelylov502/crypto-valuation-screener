import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../app/api/cron/collect/route";
import { collectionTriggerDecision } from "./scheduledCollection";
import { schedulerReceipt, signSchedulerReceipt, verifySchedulerReceipt } from "./schedulerDispatch";
import type { PublicationJournal } from "./publicationTypes";

function prior(startedAt: string): PublicationJournal {
  return { schema: 1, id: "data-prior", createdAt: startedAt, trackingStartedAt: startedAt, previousId: null, previousStateUrl: null,
    published: null, incident: null, recoveredAt: null, attempt: { id: "data-prior", startedAt, completedAt: startedAt, outcome: "published",
      errors: [], sourceFailures: [], affectedProjects: 0, changeCount: 0, affected: [], runUrl: "", reportUrl: "" } };
}

const secret = "test-only-scheduler-secret-32-characters";
const now = Date.parse("2026-10-04T02:59:00Z");
const receipt = JSON.stringify(schedulerReceipt("0 2 * * *", now, "d6a250a2-3e72-44b8-af51-96fbffdfcb6e"));
const signature = signSchedulerReceipt(receipt, secret);
const dispatch = { event: "workflow_dispatch", receipt, signature, secret, bootstrap: false };
const fetchMock = vi.fn();
const request = (authorization = `Bearer ${secret}`, schedule = "0 2 * * *") => new Request("https://example.test/api/cron/collect", {
  headers: { authorization, "x-vercel-cron-schedule": schedule, "user-agent": "vercel-cron/1.0", "x-vercel-id": "iad1::iad1::cron-request-12345" },
});

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv("CRON_SECRET", secret); vi.stubEnv("SCREENER_DISPATCH_TOKEN", "test-only-dispatch-token"); vi.stubEnv("VERCEL_ENV", "production");
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("authenticates a Hobby invocation at the end of the hour and preserves its planned slot", async () => {
  const result = await GET(request());
  expect(result.status).toBe(202);
  expect(result.headers.get("cache-control")).toBe("no-store");
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.github.com/repos/lovelylov502/crypto-valuation-screener/actions/workflows/daily-snapshot.yml/dispatches");
  const body = JSON.parse(options.body);
  expect(body.ref).toBe("main");
  expect(verifySchedulerReceipt(body.inputs.scheduler_receipt, body.inputs.scheduler_signature, secret, now)).toMatchObject({
    source: "vercel-cron", scheduledFor: "2026-10-04T02:00:00.000Z", requestedAt: new Date(now).toISOString(),
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(["", "Bearer wrong", "Bearer undefined"])("rejects unauthorized calls without any external request: %s", async auth => {
  expect((await GET(request(auth))).status).toBe(401); expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["CRON_SECRET", "SCREENER_DISPATCH_TOKEN"])("fails closed when %s is missing", async key => {
  vi.stubEnv(key, ""); expect((await GET(request())).status).toBe(key === "CRON_SECRET" ? 401 : 503); expect(fetchMock).not.toHaveBeenCalled();
});
it("does not dispatch from preview deployments", async () => {
  vi.stubEnv("VERCEL_ENV", "preview"); expect((await GET(request())).status).toBe(503); expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["user-agent", "x-vercel-id"])("rejects a request without the Vercel cron header %s", async header => {
  const req = request(); req.headers.delete(header);
  expect((await GET(req)).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["", "0 14 * * *", "* * * * *"])("rejects a missing or wrong cron expression: %s", async cron => {
  expect((await GET(request(undefined, cron))).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects a wake beyond the existing 90-minute deadline", async () => {
  vi.setSystemTime(Date.parse("2026-10-04T03:30:00Z"));
  expect((await GET(request())).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
});
it.each([401, 403, 429, 500])("reports failed dispatch HTTP %s without leaking the provider body", async status => {
  fetchMock.mockResolvedValue(new Response("sensitive provider diagnostic", { status }));
  const result = await GET(request()); expect(result.status).toBe(502); expect(await result.text()).not.toContain("sensitive");
});
it("does not retry an ambiguous dispatch or claim it started a collection", async () => {
  fetchMock.mockRejectedValue(new Error("test-only-dispatch-token"));
  const result = await GET(request()); expect(result.status).toBe(502);
  expect(await result.text()).not.toContain("test-only-dispatch-token"); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("rejects unsigned or modified automatic receipts", () => {
  for (const input of [{ ...dispatch, signature: "" }, { ...dispatch, receipt: receipt.replace("02:00", "14:00") }, { ...dispatch, secret: "" }]) {
    expect(() => collectionTriggerDecision(input, prior("2026-10-03T14:01:00Z"), now)).toThrow();
  }
});
it("rejects future receipts and does not relabel a stale dispatch as the next slot", () => {
  expect(() => verifySchedulerReceipt(receipt, signature, secret, now - 1)).toThrow();
  expect(() => verifySchedulerReceipt(receipt, signature, secret, Date.parse("2026-10-04T14:00:00Z"))).toThrow();
});
it("permits a delayed GitHub queue within the original slot without extending its scheduled time", () => {
  expect(verifySchedulerReceipt(receipt, signature, secret, Date.parse("2026-10-04T05:00:00Z")).scheduledFor).toBe("2026-10-04T02:00:00.000Z");
});
it("serializes both schedulers and replayed requests against the same start record", () => {
  let previous = prior("2026-10-03T14:01:00Z");
  const inputs = [dispatch, { ...dispatch, event: "schedule", receipt: "", signature: "" }, dispatch];
  const decisions = inputs.map(input => {
    const result = collectionTriggerDecision(input, previous, now);
    if (result.collect) previous = prior(new Date(now).toISOString());
    return result.collect;
  });
  expect(decisions).toEqual([true, false, false]);
});
it("never counts a manual repair as scheduled while allowing a same-slot repair", () => {
  const manual = { ...dispatch, receipt: "", signature: "" };
  expect(collectionTriggerDecision(manual, prior("2026-10-03T14:01:00Z"), now)).toMatchObject({ collect: true, trigger: { source: "manual", scheduledFor: "2026-10-04T02:00:00.000Z" } });
  expect(collectionTriggerDecision(manual, prior("2026-10-04T02:01:00Z"), now)).toMatchObject({ collect: true, manualRepair: true, trigger: { source: "manual" } });
  expect(collectionTriggerDecision(dispatch, prior("2026-10-04T02:01:00Z"), now)).toMatchObject({ collect: false, manualRepair: false });
});
it("allows an explicit first manual bootstrap but rejects automatic bootstrap and unknown triggers", () => {
  expect(collectionTriggerDecision({ ...dispatch, receipt: "", signature: "", bootstrap: true }, null, now).collect).toBe(true);
  expect(() => collectionTriggerDecision({ ...dispatch, bootstrap: true }, null, now)).toThrow();
  expect(() => collectionTriggerDecision({ ...dispatch, event: "push" }, null, now)).toThrow();
  expect(() => collectionTriggerDecision(dispatch, null, now)).toThrow();
});
