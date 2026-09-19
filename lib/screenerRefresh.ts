import type { ScreenerResponse } from "./types";
import { RULE_VERSION } from "./fundamentals";
import { fundamentalErrors } from "./fundamentalContract";

export const SNAPSHOT_STALE_MS = 12 * 3_600_000;
export const REVALIDATE_MS = 30 * 60_000;

export function isScreenerResponse(value: unknown): value is ScreenerResponse {
  try {
  if (!value || typeof value !== "object") return false;
  const s = value as ScreenerResponse;
  return (
    typeof s.updatedAt === "string" &&
    Number.isFinite(Date.parse(s.updatedAt)) &&
    s.scoreVersion === RULE_VERSION &&
    Array.isArray(s.coins) &&
    s.coins.length > 0 &&
    s.coins.every(
      (c) =>
        c &&
        typeof c.slug === "string" &&
        c.opportunities &&
        Array.isArray(c.opportunities.dataIssues) &&
        c.peerCounts &&
        c.holderValue &&
        Array.isArray(c.holderValue.components) &&
        c.multiples &&
        c.gates && fundamentalErrors(c).length === 0,
    ) &&
    Array.isArray(s.categories) &&
    Array.isArray(s.sources) &&
    !!s.marketDataFreshness
  );
  } catch { return false; }
}

/** ISR may return the previous snapshot while rebuilding; give it bounded follow-up reads. */
export async function fetchLatestSnapshot({
  signal,
  onWaiting,
  fetcher = fetch,
  wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}: {
  signal: AbortSignal;
  onWaiting: () => void;
  fetcher?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<ScreenerResponse> {
  let last: ScreenerResponse | null = null;
  for (let attempt = 0; attempt < 7; attempt++) {
    signal.throwIfAborted();
    const response = await fetcher("/api/screener", {
      cache: "no-store",
      signal,
    });
    if (!response.ok)
      throw new Error("데이터 제공처 응답을 확인하지 못했습니다.");
    const data: unknown = await response.json();
    if (!isScreenerResponse(data))
      throw new Error("응답 형식이 맞지 않습니다. 페이지를 다시 열어 주세요.");
    if (Date.parse(data.updatedAt) > now() + 300_000)
      throw new Error("응답 시각을 확인하지 못했습니다.");
    if (!last || Date.parse(data.updatedAt) >= Date.parse(last.updatedAt))
      last = data;
    if (now() - Date.parse(last.updatedAt) < REVALIDATE_MS) return last;
    if (attempt < 6) {
      onWaiting();
      await wait(8_000);
    }
  }
  return last!;
}
