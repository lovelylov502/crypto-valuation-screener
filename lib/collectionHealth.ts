import type { ScreenerResponse } from "./types";
import { RULE_VERSION } from "./fundamentals";
import type { PublicationJournal } from "./publicationTypes";
import { COLLECTION_DEADLINE_MS } from "./publication";

export const COLLECTION_STALE_MS = 45 * 60_000;
type HealthData = Pick<ScreenerResponse, "updatedAt" | "scoreVersion" | "sources" | "collection" | "publication">;
export type CollectionHealthState = "healthy" | "error" | "warning" | "stale" | "checking" | "unknown";

export function sourceProvider(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host === "api.coingecko.com") return "CoinGecko";
    if (host.endsWith("coinmarketcap.com")) return "CoinMarketCap";
    if (host.endsWith("llama.fi")) return "DefiLlama";
    return host;
  } catch { return "출처 미확인"; }
}

/** Scope: recorded collection results, accounting and freshness; never website uptime alone. */
export function collectionHealth(data: HealthData | null, now: number, requestError = "", refreshing = false, publication = data?.publication) {
  const p: PublicationJournal | undefined = publication;
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const failures = (p ? p.attempt.sourceFailures : sources).filter(s => s.status === "error");
  const withheld = (data?.sources ?? sources).filter(s => s.status === "withheld");
  const providers = [...new Set(failures.map(s => sourceProvider(s.url)))];
  const c = data?.collection;
  const quotes = c ? [c.gecko, c.cmc] : [];
  const quoteFailures = quotes.reduce((n, q) => n + (q?.failed ?? 0), 0);
  const observed = failures.map(s => Date.parse(s.observedAt)).filter(Number.isFinite);
  const firstFailureAt = observed.length ? new Date(Math.min(...observed)).toISOString() : null;
  const age = data ? now - Date.parse(data.updatedAt) : NaN;
  const stale = !!data && (age > COLLECTION_STALE_MS || data.updatedAt.slice(0, 10) !== new Date(now).toISOString().slice(0, 10));
  const result = (state: CollectionHealthState, label: string, summary: string) => ({
    state, label, summary, failures, withheld, providers, quoteFailures, firstFailureAt, stale,
  });
  if (p?.storeError) return result("error", "보관소 오류", p.storeError);
  if (p?.attempt.outcome === "running" && now - Date.parse(p.attempt.startedAt) > COLLECTION_DEADLINE_MS) return result("error", "수집 중단", "수집 작업이 15분 안에 완료되지 않았습니다. 마지막 검증본을 유지합니다.");
  if (p?.attempt.outcome === "blocked" || p?.incident) return result("error", "공개 보류", p?.published
    ? `새 수집본이 검사를 통과하지 못해 공개를 차단했습니다. ${p.attempt.affectedProjects.toLocaleString()}개 종목의 값·이력 변화를 확인했으며 마지막 검증본을 유지합니다.`
    : "수집본이 검사를 통과하지 못했습니다. 공개할 검증본이 아직 없습니다.");
  if (p && !p.published) return result("checking", "자료 준비 중", "첫 검증본을 준비하고 있습니다. 검사를 통과하기 전에는 금액을 공개하지 않습니다.");
  if (failures.length || quoteFailures) return result("error", "수집 오류",
    `${providers.join(" · ") || "시세 제공처"} 조회에 실패했습니다. 일부 가격·시가총액·수익 또는 배수가 비어 있을 수 있습니다.`);
  if (requestError) return result("error", "확인 오류", requestError);
  if (!data) return result("checking", "확인 중", "수집 결과를 기다리고 있습니다.");
  if (data.scoreVersion !== RULE_VERSION || !Number.isFinite(age) || age < -300_000 || (c?.errors ?? 0) > 0
    || (c && c.displayedRevenue30d < c.sourceRevenue30d)) return result("error", "검증 오류", "자료의 버전·시각·원천 금액 검사에서 문제가 발견됐습니다.");
  if (stale) return result("stale", "갱신 지연", "표시 자료가 45분 이상 지났거나 UTC 기준일이 바뀌었습니다. 최신 자료 확인이 필요합니다.");
  if (p?.attempt.outcome === "running") return result("checking", "수집 중", "새 자료를 수집·검사하는 동안 직전 검증본을 표시합니다.");
  if (p && data.publication?.published?.id !== p.published?.id) return result("checking", "자료 적용 중", "새 검증본을 불러오고 있습니다.");
  const counts = c && [c.projects, c.sourceSlugs, c.errors, c.sourceRevenue30d, c.displayedRevenue30d,
    ...quotes.flatMap(q => q ? [q.requested, q.received, q.notReturned, q.failed] : [NaN])];
  if (!counts || counts.some(n => !Number.isInteger(n) || n < 0) || !c!.projects || !c!.sourceSlugs || !sources.length
    || sources.some(s => !["ok", "error", "withheld"].includes(s.status) || !Number.isFinite(Date.parse(s.observedAt)))
    || quotes.some(q => q.requested !== q.received + q.notReturned + q.failed)) return result("unknown", "상태 미확인", "정상 여부를 판단할 수집 검사 기록이 부족합니다.");
  if (withheld.length) return result("warning", "검토 필요", `원천의 집계 범위나 금액이 맞지 않아 ${withheld.length.toLocaleString()}건의 이력 보완을 보류했습니다.`);
  if (quotes.some(q => q.requested > 0 && q.received === 0)) return result("warning", "검토 필요", "시세 제공처의 응답에 요청한 자산이 하나도 없습니다. 원천 확인이 필요합니다.");
  if (refreshing) return result("checking", "확인 중", "기존 자료를 표시하며 서버 응답을 확인하고 있습니다.");
  return result("healthy", "수집 정상", "기록된 원천 요청과 시세 조회에 실패가 없고, 금액 표시 검사와 자료 갱신 기준을 통과했습니다.");
}
