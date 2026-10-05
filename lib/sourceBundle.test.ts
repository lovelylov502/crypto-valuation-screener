import { afterEach, expect, it, vi } from "vitest";
import { captureSourceBundle, replaySourceBundle, sourceDelay, sourceFetch, sourceNow, sourceObservedAt, validateSourceBundle } from "./sourceBundle";

afterEach(() => vi.unstubAllGlobals());
const url = "https://api.llama.fi/summary/fees/wbtc?dataType=dailyRevenue";
it("retains exact zero in original bytes, deduplicates successful reads and replays without network", async () => {
  const network = vi.fn(async () => new Response('{"totalDataChart":[[1790985600,0]]}'));
  vi.stubGlobal("fetch", network);
  const run = async () => {
    const first = await (await sourceFetch(url)).json();
    const second = await (await sourceFetch(url)).json();
    return { first, second, now: sourceNow(), at: sourceObservedAt(url) };
  };
  const captured = await captureSourceBundle("2026-10-04T14:00:00Z", null, run);
  expect(captured.error).toBeUndefined();
  expect(network).toHaveBeenCalledTimes(1);
  vi.stubGlobal("fetch", () => { throw new Error("Network forbidden"); });
  expect(await replaySourceBundle(captured.bundle, run)).toEqual(captured.value);
  expect(captured.bundle.receipts[0].body).toContain(",0]");
});
it("records failed and recovered responses, rejects changed bytes and uncaptured requests", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("busy", { status: 429 })).mockResolvedValueOnce(new Response("{}")));
  const run = async () => [(await sourceFetch(url)).status, (await sourceFetch(url)).status];
  const captured = await captureSourceBundle("2026-10-04T14:00:00Z", null, run);
  expect(await replaySourceBundle(captured.bundle, run)).toEqual([429, 200]);
  await expect(replaySourceBundle(captured.bundle, () => sourceFetch("https://api.llama.fi/protocols"))).rejects.toThrow("no source receipt");
  captured.bundle.receipts[1].body = '{"forged":true}';
  expect(() => validateSourceBundle(captured.bundle)).toThrow("integrity");
});
it("rejects archives containing credential-bearing URLs before any fetch", async () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  const result = await captureSourceBundle("2026-10-04T14:00:00Z", null, () => sourceFetch(url + "&api_key=secret"));
  expect(String(result.error)).toContain("Unapproved source URL");
  expect(network).not.toHaveBeenCalled();
});
it("preserves an in-flight sibling receipt when its caller fails early", async () => {
  let respond!: (response: Response) => void;
  vi.stubGlobal("fetch", () => new Promise<Response>(resolve => { respond = resolve; }));
  let sibling: Promise<Response>;
  const capture = captureSourceBundle("2026-10-04T14:00:00Z", null, async () => {
    sibling = sourceFetch(url);
    throw new Error("normalization stopped");
  });
  respond(new Response('{"total24h":0}'));
  const result = await capture;
  await sibling!;
  expect(String(result.error)).toContain("normalization stopped");
  expect(result.bundle.receipts).toHaveLength(1);
  expect(result.bundle.receipts[0].body).toBe('{"total24h":0}');
});
it("aborts transport and retry waits early enough to archive a failed capture", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    await new Promise<void>((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("abort")), { once: true }));
  });
  const capture = captureSourceBundle("2026-10-04T14:00:00Z", null, async () => {
    await Promise.all([sourceFetch(url), sourceDelay(60_000)]);
  }, controller.signal);
  controller.abort();
  const result = await capture;
  expect(String(result.error)).toContain("Recorded source transport failure");
  expect(result.bundle.receipts[0]).toMatchObject({ status: null, error: "Recorded source transport failure" });
});
