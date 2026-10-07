import type { ScreenerResponse } from "./types";
import { RULE_VERSION } from "./fundamentals";
import type { CollectionAttempt, PublicationJournal } from "./publicationTypes";
import { COLLECTION_DEADLINE_MS } from "./publication";
import { collectionSchedule } from "./collectionSchedule";
import { sourceCanBeLocal } from "./dataQuality";
import { publicFreshness } from "./datedFreshness";
import {collectionReleaseState} from "./pipelineRelease";
import {publicRecovery,recoveryVerdicts} from "./freshnessRecovery";

type HealthData = Pick<ScreenerResponse, "updatedAt" | "scoreVersion" | "sources" | "collection" | "publication" | "pipeline" | "freshness">;
export type CollectionHealthState = "healthy" | "partial" | "error" | "warning" | "stale" | "checking" | "unknown";

export function comparisonCompleted(attempt: CollectionAttempt): boolean {
  return attempt.comparisonCompleted ?? (attempt.outcome === "published" || attempt.errors.some(e => e.startsWith("unreviewed_losses:")));
}

export function comparisonSummary(attempt: CollectionAttempt): string {
  if (attempt.outcome === "running") return "이번 수집의 영향 범위를 검사하고 있습니다.";
  if (!comparisonCompleted(attempt)) return "수집·검사가 완료되지 않아 변화한 종목과 항목 수를 확인하지 못했습니다.";
  return `직전 검증본 대비 변화: ${attempt.affectedProjects.toLocaleString()}개 종목 · ${attempt.changeCount.toLocaleString()}개 항목`;
}

export function publicationFailure(attempt: CollectionAttempt): string {
  if (!comparisonCompleted(attempt)) return "수집·검사 미완료";
  if (attempt.sourceFailures.length) return "원천 조회 실패";
  if (attempt.errors.some(e => e.startsWith("unreviewed_losses:"))) return "원천 변경 검증 미통과";
  return "공개 검사 미통과";
}

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
  const pipeline = data?.pipeline;
  const quality = pipeline?.quality;
  const proven = !!pipeline && [1,2].includes(pipeline.schema) && pipeline.replayVerified === true && pipeline.asOf === data?.updatedAt &&
    [pipeline.rawBundleSha256, pipeline.normalizedSha256, pipeline.outputSha256].every(hash => /^[a-f0-9]{64}$/.test(hash)) &&
    !!quality && [quality.affectedProjects, quality.issueCount].every(n => Number.isInteger(n) && n >= 0) &&
    quality.affectedProjects <= (c?.projects ?? 0) && quality.issueCount >= quality.affectedProjects &&
    (quality.affectedProjects === 0) === (quality.issueCount === 0);
  const partial = proven && quality!.issueCount > 0 && failures.every(sourceCanBeLocal);
  const freshness = publicFreshness(data?.freshness ?? p?.recovery?.summary,now);
  const quotes = c ? [c.gecko, c.cmc] : [];
  const quoteFailures = quotes.reduce((n, q) => n + (q?.failed ?? 0), 0);
  const observed = failures.map(s => Date.parse(s.observedAt)).filter(Number.isFinite);
  const firstFailureAt = observed.length ? new Date(Math.min(...observed)).toISOString() : null;
  const age = data ? now - Date.parse(data.updatedAt) : NaN;
  const release=p?.collectionRelease??collectionReleaseState();
  const recovery=p?publicRecovery(p,now,release.schedule==="paused"):undefined;
  const schedule = collectionSchedule(now,release.schedule);
  const stale = !schedule.paused && !!data && Date.parse(data.updatedAt) < schedule.requiredAt;
  const scheduledRunMissing = !schedule.paused && !!p && Date.parse(p.attempt.startedAt) < schedule.requiredAt;
  const result = (state: CollectionHealthState, label: string, summary: string) => ({
    state, label, summary, failures, withheld, providers, quoteFailures, firstFailureAt, stale, schedule, release, scheduledRunMissing,
    affectedProjects: proven ? quality!.affectedProjects : 0, issueCount: proven ? quality!.issueCount : 0, freshness, recovery,
  });
  if (p?.storeError) return result("error", "보관소 오류", p.storeError);
  if (p?.attempt.outcome === "running" && now - Date.parse(p.attempt.startedAt) > COLLECTION_DEADLINE_MS) return result("error", "수집 중단", "수집 작업이 15분 안에 완료되지 않았습니다. 마지막 검증본을 유지합니다.");
  if (p?.attempt.outcome === "running" && p.incident) return result("error", "공개 보류", "이전 수집 실패로 마지막 검증본을 유지하며 새 수집 결과를 확인하고 있습니다. 이번 영향 범위는 검사가 끝난 뒤 표시합니다.");
  if(p?.correction&&p.published?.id===p.correction.to.id)return result("error","이전 검증본 복원","시세 제공처의 광범위한 조회 실패를 확인해 이전 검증본을 복원했습니다. 복원된 자료의 수집 시각을 표시합니다.");
  if (p?.attempt.outcome === "blocked" || p?.incident) return result("error", "공개 보류", p?.published
    ? `${publicationFailure(p.attempt)}로 마지막 검증본을 유지합니다. ${comparisonSummary(p.attempt)}`
    : "수집본이 검사를 통과하지 못했습니다. 공개할 검증본이 아직 없습니다.");
  if (p && !p.published) return result("checking", "자료 준비 중", "첫 검증본을 준비하고 있습니다. 검사를 통과하기 전에는 금액을 공개하지 않습니다.");
  if ((failures.length || quoteFailures) && !partial) return result("error", "수집 오류",
    `${providers.join(" · ") || "시세 제공처"} 조회에 실패했습니다. 일부 가격·시가총액·수익 또는 배수가 비어 있을 수 있습니다.`);
  if (requestError) return result("error", "확인 오류", requestError);
  if (!data) return result("checking", "확인 중", "수집 결과를 기다리고 있습니다.");
  if (data.scoreVersion !== RULE_VERSION || !Number.isFinite(age) || age < -300_000 || (c?.errors ?? 0) > 0 || (pipeline && !proven)
    || (c && c.displayedRevenue30d < c.sourceRevenue30d)) return result("error", "검증 오류", "자료의 버전·시각·원천 금액 검사에서 문제가 발견됐습니다.");
  if (scheduledRunMissing) return result("stale", "예약 실행 미확인", "예정 시각에서 90분이 지났지만 새 수집 시작 기록이 없습니다. 마지막 검증본을 표시합니다.");
  if (stale) return result("stale", "갱신 지연", "예정 시각에서 90분이 지났지만 새 검증본을 확인하지 못했습니다. 마지막 검증본을 표시합니다.");
  const deadlines=p?.recovery?recoveryVerdicts(p,now):undefined;
  if(!schedule.paused&&p?.recovery&&!deadlines!.collectionDeadlinePassed&&!deadlines!.collectionDeadlineUnverified&&now>=Date.parse(p.recovery.slots[0]?.slotAt??"")+90*60_000)return result("stale","기한 내 공개 미확인","최근 정기 수집의 기한 내 공개 기록을 확인하지 못했습니다. 이후 회복 기록과 원천의 일별 도착 상태를 함께 확인해 주세요.");
  if (p?.attempt.outcome === "running") return result("checking", "수집 중", "새 자료를 수집·검사하는 동안 직전 검증본을 표시합니다.");
  if (p && data.publication?.published?.id !== p.published?.id) return result("checking", "자료 적용 중", "새 검증본을 불러오고 있습니다.");
  const counts = c && [c.projects, c.sourceSlugs, c.errors, c.sourceRevenue30d, c.displayedRevenue30d,
    ...quotes.flatMap(q => q ? [q.requested, q.received, q.notReturned, q.failed] : [NaN])];
  if (!counts || counts.some(n => !Number.isInteger(n) || n < 0) || !c!.projects || !c!.sourceSlugs || !sources.length
    || sources.some(s => !["ok", "error", "withheld"].includes(s.status) || !Number.isFinite(Date.parse(s.observedAt)))
    || quotes.some(q => q.requested !== q.received + q.notReturned + q.failed)) return result("unknown", "상태 미확인", "정상 여부를 판단할 수집 검사 기록이 부족합니다.");
  if (partial) return result("partial", "일부 자료 확인 필요", `현재 수집본의 ${quality!.affectedProjects.toLocaleString()}개 종목에 확인이 필요한 자료가 있습니다. 항목별 상태와 계산 보류 사유는 종목 상세에서 확인할 수 있습니다.`);
  if (withheld.length) return result("warning", "검토 필요", `원천의 집계 범위나 금액이 맞지 않아 ${withheld.length.toLocaleString()}건의 이력 보완을 보류했습니다.`);
  if (quotes.some(q => q.requested > 0 && q.received === 0)) return result("warning", "검토 필요", "시세 제공처의 응답에 요청한 자산이 하나도 없습니다. 원천 확인이 필요합니다.");
  if (refreshing) return result("checking", "확인 중", "기존 자료를 표시하며 서버 응답을 확인하고 있습니다.");
  if(schedule.paused)return result("warning","자동 수집 일시 중지","호환 가능한 읽기 기능과 마지막 검증본을 유지합니다. 자동 수집 재개에는 활성화 확인이 필요합니다.");
  if(deadlines?.collectionDeadlineUnverified)return result("warning","전환 전 기한 미확인","하루 4회 수집 기록을 시작하기 전에 지난 회차가 기한 안에 공개됐는지는 확인되지 않았습니다. 이전 검증본 기록과 보완 수집 결과를 함께 표시합니다.");
  if (freshness?.unassessed) return result("warning","새 완료일 확인 대기",`현재 목표일은 ${freshness.targetDate} UTC입니다. 이 수집본은 새 완료일을 아직 확인하지 않았습니다.`);
  if (freshness?.pending) return result("warning","원천 도착 대기",`전체 자료 중 ${freshness.pending.toLocaleString()}개 일별 항목에 최신 완료일이 없습니다. 재확인 가능 시각과 남은 시도, 24시간 이상 대기는 수집 상태 상세에 표시합니다.`);
  if(freshness?.insufficient)return result("warning","최신 일별 이력 부족",`전체 자료 중 ${freshness.insufficient.toLocaleString()}개 일별 항목에 목표 완료일과 직전일의 완전한 관측이 없습니다. 오래된 기간 이력의 빈 날짜만으로 보완 수집을 반복하지 않습니다.`);
  if (freshness && (freshness.unknown || freshness.conflict)) return result("warning","일별 관측 확인 필요",`일별 관측 미확인 ${freshness.unknown.toLocaleString()}개 · 범위·정의·금액 확인 필요 ${freshness.conflict.toLocaleString()}개 항목입니다.`);
  return result("healthy", "수집 정상", "기록된 원천 요청과 시세 조회에 실패가 없고, 금액 표시 검사와 자료 갱신 기준을 통과했습니다.");
}
