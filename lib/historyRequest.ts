import type { SourceObservation } from "./types";

/** Child and parent recovery use the same bounded retry policy. */
export async function readHistorySummary(url: string, now: number, deadline: number, observations: SourceObservation[]): Promise<Record<string, unknown> | undefined> {
  let httpStatus: number | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let delay = 500;
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("history time budget exhausted");
      httpStatus = undefined;
      const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(Math.min(15_000, remaining)) });
      httpStatus = response.status;
      delay = Math.max(delay, (Number(response.headers.get("retry-after")) || 0) * 1000);
      if (!response.ok) throw new Error("history unavailable");
      const summary = await response.json();
      if (!summary || typeof summary !== "object" || Array.isArray(summary)) throw new Error("invalid history response");
      return summary;
    } catch {
      if (attempt === 1 || (httpStatus !== undefined && httpStatus !== 429 && httpStatus < 500) || Date.now() + delay >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  observations.push({ url, observedAt: new Date(now).toISOString(), status: "error", httpStatus });
}
