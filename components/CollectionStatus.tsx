"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Clock3, LoaderCircle } from "lucide-react";
import type { ScreenerResponse } from "@/lib/types";
import { collectionHealth, comparisonSummary, publicationFailure, sourceProvider } from "@/lib/collectionHealth";
import { fmtKstMinute } from "@/lib/format";
import { SettingsDialog } from "./SettingsDialog";
import type { PublicationJournal } from "@/lib/publicationTypes";
import { nextEligibleCheck } from "@/lib/freshnessRecovery";
import type {ScreenerPage} from "@/lib/screenerQuery";

const count = (value: number | undefined) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value.toLocaleString() : "미확인";
const time = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? fmtKstMinute(value) : "미확인";

export function CollectionStatus({ data, publication, error, refreshing, checkedAt, onRefresh }: {
  data: ScreenerResponse | null; error: string; refreshing: boolean; checkedAt: string | null; onRefresh: () => void;
  publication?: PublicationJournal;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(timer); window.removeEventListener("focus", tick); };
  }, []);
  const health = collectionHealth(data, now, error, refreshing, publication);
  const p = publication ?? data?.publication;
  const recovery=health.recovery;
  const economic=p?.publicEconomicReview??data?.economicReview;
  const coverage=(data as ScreenerPage|null)?.coverage;
  const Icon = health.state === "healthy" ? CheckCircle2 : health.state === "checking" ? LoaderCircle
    : health.state === "stale" ? Clock3 : health.state === "unknown" ? CircleHelp : AlertTriangle;
  const groups = [...new Set(health.failures.map(s => sourceProvider(s.url)))].map(provider => {
    const failures = health.failures.filter(s => sourceProvider(s.url) === provider);
    const codes = [...new Set(failures.flatMap(s => s.httpStatus ? [s.httpStatus] : []))];
    return { provider, count: failures.length, codes };
  });
  return <>
    <span className="collection-status" role="status" aria-live="polite">
      <button className={`collection-badge health-${health.state}`} onClick={() => setOpen(true)} aria-label={`수집 상태 상세 보기 · ${health.label}`} aria-haspopup="dialog" title={health.summary}>
        <Icon size={15} aria-hidden="true" className={health.state === "checking" ? "spinning" : ""}/>{health.label}
      </button>
    </span>
    {open && <SettingsDialog title="수집 상태" onClose={() => setOpen(false)} footerNote="상태는 원천 수집 기록과 현재 서버 응답을 기준으로 표시합니다.">
      <div className="collection-detail">
        <div className={`collection-summary health-${health.state}`}><Icon size={20} aria-hidden="true"/><strong>{health.label}</strong></div>
        <p>{health.summary}</p>
        {error && health.failures.length > 0 && <p className="negative">서버 확인도 실패했습니다: {error}</p>}
        {health.stale && health.state !== "stale" && <p className="caution-text">표시 자료의 갱신도 지연되고 있습니다.</p>}
        {health.scheduledRunMissing && health.label !== "예약 실행 미확인" && <p className="caution-text">예정 시각에서 90분이 지났지만 새 수집 시작 기록이 없습니다.</p>}
        <p>{health.release.schedule==="paused"?"자동 수집 일시 중지":health.release.schedule==="four-daily"?"하루 4회 · 05:00 / 11:00 / 17:00 / 23:00 KST부터 수집 예정 · 필요 시 2시간·4시간 뒤 보완 수집":"하루 2회 · 11:00 / 23:00 KST부터 수집 예정 · 예약 호출은 해당 시간대 안에서 시작"}</p>
        <dl className="collection-times">
          <div><dt>표시 자료 수집</dt><dd>{data ? time(data.updatedAt) : "자료 없음"}</dd></div>
          <div><dt>다음 수집 예정</dt><dd>{health.schedule.paused?"자동 수집 일시 중지":time(new Date(health.schedule.nextAt).toISOString())}</dd></div>
          <div><dt>수익 일별 집계 기준</dt><dd>{data ? `${new Date(Date.parse(data.updatedAt) - 86400_000).toISOString().slice(0,10)} UTC까지` : "자료 없음"}</dd></div>
          {health.freshness && <><div><dt>현재 목표 완료일</dt><dd>{health.freshness.targetDate} UTC{health.freshness.unassessed?" · 새 날짜 미확인":""}</dd></div><div><dt>전체 일별 항목</dt><dd>최신일 확인 {health.freshness.current} · 도착 대기 {health.freshness.pending} · 이력 부족 {health.freshness.insufficient} · 미확인 {health.freshness.unknown} · 충돌 {health.freshness.conflict} · 대상 없음 {health.freshness.unsupported}</dd></div></>}
          {recovery && <div><dt>다음 보완 확인 가능 시각</dt><dd>{health.schedule.paused?"자동 수집 일시 중지":nextEligibleCheck(recovery,now)?`${time(nextEligibleCheck(recovery,now))} · 실제 예약 실행이 필요합니다`:"이번 회차의 추가 보완 대상 또는 남은 시도 없음"}</dd></div>}
          <div><dt>이 브라우저의 서버 확인</dt><dd>{checkedAt ? time(checkedAt) : "아직 확인되지 않음"}</dd></div>
          {health.firstFailureAt && <div><dt>이번 자료의 첫 실패 관측</dt><dd>{fmtKstMinute(health.firstFailureAt)}</dd></div>}
        </dl>
        <p className="collection-note">가격·시총·배수는 저장된 수집본의 값입니다. 수익은 위 UTC 날짜까지의 완전한 일별 자료로 계산하며, 원천 금액의 별도 집계 범위와 누락일은 종목 상세에 표시합니다. 예약 실행은 지연될 수 있습니다.</p>
        <div className="collection-counts"><h3>경제적 귀속 검토</h3>
        {economic?<><p>전체 {count(economic.summary.sourceMetrics)}개 원천·지표 · 검토 대기 {count(economic.summary.pending)} · 증거 조회 미확인 {count(economic.summary.evidenceUnavailable)} · 검토 후 비적용 {count(economic.summary.reviewedUnavailable)}</p><p>검토 원장에 대기로 기록된 종목 {count(economic.summary.affectedProjects)}개 · 가장 오래된 관측 {time(economic.summary.oldestPendingAt)}</p><p>검토 기록 시작 {time(economic.trackingStartedAt)} · 이전 자료에서 확인한 첫 관측은 원천별로 보존합니다.</p>{p?.economicReviewRef&&<p><a href={p.economicReviewRef.url} target="_blank" rel="noreferrer">전체 원천별 검토 기록</a></p>}</>:<p>이 자료에는 지표별 경제 검토 원장이 없습니다. 종목 상세의 기존 정의 검토 사유를 확인해 주세요.</p>}
          <p className="collection-note">검토 대기는 원천 조회 오류와 별도로 집계합니다. 홀더 환원 실행 검토는 해당 P/HR 계산에 반영됩니다.</p>
        </div>
        {coverage&&<div className="collection-counts"><h3>현재 기준의 배수 산출 범위</h3><p>{coverage.capital==="fdv"?"FDV":"유통 시총"} · {coverage.window==="any"?"확보된 기간 중 하나":`${coverage.window}일`}</p><p>전체 {count(coverage.total)}개 종목 · P/R {count(coverage.revenue)} · P/HR {count(coverage.holder)} · 하나 이상 산출 {count(coverage.unique)}</p><p>원천 자료 있음·배수 보류 {count(coverage.review)} · 해당 기간 원천 자료 없음 {count(coverage.missing)}</p><p className="collection-note">현재 선택한 시총 기준과 기간으로 계산한 전체 종목 수입니다. 검색 결과와 별도로 집계하며, 다른 기간의 확보 범위는 달라질 수 있습니다.</p></div>}
        {p && <div className="collection-counts">
          <h3>공개·장애 기록</h3>
          <p>이력 기록 시작: {time(p.trackingStartedAt)}</p>
          {recovery?.migration && <><p>하루 4회 수집 기록 시작: {time(recovery.migration.startedAt)} · 전환 전에 끝난 단계의 실행과 기한 내 공개 여부는 미확인으로 남깁니다.</p><p><a href={`https://github.com/lovelylov502/crypto-valuation-screener/releases/tag/${recovery.migration.legacyJournalId}`} target="_blank" rel="noreferrer">전환 직전 이력</a>{recovery.migration.legacyPublished && ` · 이전 검증본 수집 ${time(recovery.migration.legacyPublished.dataAt)}`}{recovery.migration.correction && <> · <a href={recovery.migration.correction.journalUrl} target="_blank" rel="noreferrer">전환 기록 정정 전 원본</a></>}</p></>}
          <p>사용 중인 검증본 수집: {p.published ? time(data?.updatedAt ?? p.published.dataAt) : "검증본 없음"}</p>
          {p.correction&&<p>검증본 복원 기록: {time(p.correction.observedAt)} · <a href={p.correction.originalJournalUrl} target="_blank" rel="noreferrer">문제가 확인된 공개본의 원래 기록</a> · <a href={`https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${p.correction.journalId}/correction.json`} target="_blank" rel="noreferrer">복원 근거</a></p>}
          {p.publicationFailure&&<p>검증 결과 보관 실패: {time(p.publicationFailure.failedAt)} · 원본 영구 보관: {time(p.publicationFailure.archivedAt)} · <a href={p.publicationFailure.manifestUrl} target="_blank" rel="noreferrer">당시 실패와 미완료 날짜의 근거</a></p>}
          <p>최근 수집 시작: {time(p.attempt.startedAt)} · 완료: {p.attempt.completedAt ? time(p.attempt.completedAt) : "수집 중"}</p>
          {p.incident && <><p className="negative">기록 시작 이후 첫 실패 관측: {time(p.incident.firstFailureObservedAt)}</p><p>마지막 정상 자료: {time(p.incident.lastGoodDataAt)}</p><p>최근 실패 관측: {time(p.incident.lastFailureObservedAt)}</p></>}
          {p.recoveredAt && <p>최근 회복 확인: {time(p.recoveredAt)}</p>}
          {p.attempt.outcome === "blocked" && <p className="negative">공개 보류 사유: {publicationFailure(p.attempt)}</p>}
          <p>{p.publicationFailure?.attemptId===p.attempt.id&&p.attempt.outcome==="blocked"?"당시 수집·검사 결과는 원본 보고서에 보존되어 있습니다. 공개본 교체는 완료되지 않았습니다.":comparisonSummary(p.attempt)}</p>
          {recovery && <><p>자동 시도 {recovery.slots.at(-1)?[recovery.slots.at(-1)!.primary,recovery.slots.at(-1)!.catchup1,recovery.slots.at(-1)!.catchup2].reduce((n,s)=>n+s.claims,0):0}/5 · 별도 수동 복구 {recovery.slots.at(-1)?.manualClaims??0}/2</p><p>기한 내 공개 실패 {recovery.projectionDiagnostics?.deadlineMisses??((recovery.history?.deadlineMisses??0)+recovery.slots.filter(s=>s.deadlineMissed).length)}회 · 보완 실행 누락 {recovery.projectionDiagnostics?.missedCatchups??((recovery.history?.missedCatchups??0)+recovery.slots.reduce((n,s)=>n+Number(s.catchup1.missed)+Number(s.catchup2.missed),0))}회 · 24시간 이상 대기 {recovery.obligations.filter(o=>o.disposition==="overdue").length}건</p></>}
          <p>{p.attempt.outcome !== "running" && <><a href={p.publicationFailure?.attemptId===p.attempt.id?`https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${p.publicationFailure.journalId}/failed-report.json`:p.attempt.reportUrl} target="_blank" rel="noreferrer">종목별 변경값·검사 결과</a> · </>}<a href={p.attempt.runUrl} target="_blank" rel="noreferrer">수집 작업 기록</a></p>
          <p><a href={`https://github.com/lovelylov502/crypto-valuation-screener/releases/tag/${p.id}`} target="_blank" rel="noreferrer">공개·장애 이력 보관함</a></p>
          {p.attempt.affected.length > 0 && <p>변화가 확인된 종목: {p.attempt.affected.map(c => c.name).join(", ")}{p.attempt.affectedProjects > p.attempt.affected.length ? " 외" : ""}</p>}
        </div>}
        {groups.length > 0 && <ul className="collection-failures">{groups.map(g => <li key={g.provider}><strong>{g.provider}</strong><span>조회 {g.count.toLocaleString()}건 실패{g.codes.length ? ` · HTTP ${g.codes.join(", ")}` : " · 연결 또는 응답 오류"}</span></li>)}</ul>}
        {data?.collection && <div className="collection-counts">
          <h3>{p ? "화면에 표시하는 검증본" : "전체 자료 검사"}</h3>
          <p>{count(data.collection.projects)}개 프로젝트 · 원천 구성원 {count(data.collection.sourceSlugs)}개</p>
          {([['CoinGecko', data.collection.gecko], ['CoinMarketCap', data.collection.cmc]] as const).map(([name, q]) => <p key={name}><strong>{name}</strong> 자산 {count(q?.requested)}개 조회 · 수신 {count(q?.received)} · 미반환 {count(q?.notReturned)} · <span className={q?.failed ? "negative" : ""}>실패 {count(q?.failed)}</span></p>)}
          <p>30일 원천 수익 {count(data.collection.sourceRevenue30d)}개 · 금액 표시 {count(data.collection.displayedRevenue30d)}개</p>
          <p>금액·연결 검사 오류 {count(data.collection.errors)}건 · 이력 보완 보류 {health.withheld.length.toLocaleString()}건</p>
          {health.issueCount > 0 && <p className="caution-text">자료 확인 필요 {count(health.affectedProjects)}개 종목 · {count(health.issueCount)}개 항목. 종목 상세에 원천과 사유를 표시합니다.</p>}
        </div>}
        {p?.attempt.collection && <p>최근 시도: CoinGecko 조회 실패 {count(p.attempt.collection.gecko?.failed)}개 · CoinMarketCap 조회 실패 {count(p.attempt.collection.cmc?.failed)}개</p>}
        {health.firstFailureAt && <p className="collection-note">첫 실패 관측은 이번 수집 안에서의 기록입니다. 실제 장애가 언제 시작됐는지는 이 기록만으로 확정할 수 없습니다.</p>}
        <p className="collection-note">‘수집 정상’은 위 수집·검사 범위의 상태입니다. 원천 미제공, 토큰 연결·정의 검토, 기간 이력 부족으로 계산할 수 없는 지표는 종목 상세에서 확인할 수 있습니다.</p>
        <button className="button" disabled={refreshing} onClick={onRefresh}>{refreshing ? "서버 확인 중…" : "다시 확인"}</button>
      </div>
    </SettingsDialog>}
  </>;
}
