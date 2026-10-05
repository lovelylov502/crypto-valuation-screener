import type { SourceObservation } from "./types";
import { sourceDelay, sourceFetch, sourceObservedAt, sourceReplayActive } from "./sourceBundle";

/** Child and parent recovery use the same bounded retry policy. */
export async function readHistorySummary(url: string, now: number, deadline: number, observations: SourceObservation[], sourceSlugs?: string[]): Promise<Record<string, unknown> | undefined> {
  let httpStatus: number | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let delay = 500;
    try {
      const remaining = sourceReplayActive() ? 15_000 : deadline - Date.now();
      httpStatus = undefined;
      const signal = remaining <= 0 ? AbortSignal.abort(new Error("history time budget exhausted")) : AbortSignal.timeout(Math.min(15_000, remaining));
      const response = await sourceFetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal });
      httpStatus = response.status;
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const retryMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter ?? "") - Date.parse(sourceObservedAt(url));
      // The provider rounds its reset countdown to seconds. Retrying exactly at
      // that boundary produced another 429 with Retry-After: 0 in live receipts.
      delay = response.status === 429 ? Math.max(5000, Number.isFinite(retryMs) ? retryMs + 1000 : 0)
        : Math.max(delay, Number.isFinite(retryMs) ? retryMs : 0);
      if (!response.ok) throw new Error("history unavailable");
      const summary = await response.json();
      if (!summary || typeof summary !== "object" || Array.isArray(summary)) throw new Error("invalid history response");
      return summary;
    } catch {
      if (attempt === 1 || (httpStatus !== undefined && httpStatus !== 429 && httpStatus < 500)) break;
      // Never bypass Retry-After because the local budget is short. At expiry,
      // the next attempt records an aborted request so replay follows the same path.
      await sourceDelay(sourceReplayActive() ? delay : Math.min(delay, Math.max(0, deadline - Date.now())));
    }
  }
  observations.push({ url, observedAt: sourceObservedAt(url), status: "error", httpStatus, ...(sourceSlugs ? { sourceSlugs } : {}) });
}
