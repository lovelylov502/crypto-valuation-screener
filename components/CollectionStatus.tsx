"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Clock3, LoaderCircle } from "lucide-react";
import type { ScreenerResponse } from "@/lib/types";
import { collectionHealth, comparisonSummary, publicationFailure, sourceProvider } from "@/lib/collectionHealth";
import { fmtKstMinute } from "@/lib/format";
import { SettingsDialog } from "./SettingsDialog";
import type { PublicationJournal } from "@/lib/publicationTypes";

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
        <p>하루 2회 · 11:00 / 23:00 KST부터 수집 예정 · 예약 호출은 해당 시간대 안에서 시작</p>
        <dl className="collection-times">
          <div><dt>표시 자료 수집</dt><dd>{data ? time(data.updatedAt) : "자료 없음"}</dd></div>
          <div><dt>다음 수집 예정</dt><dd>{time(new Date(health.schedule.nextAt).toISOString())}</dd></div>
          <div><dt>수익 일별 집계 기준</dt><dd>{data ? `${new Date(Date.parse(data.updatedAt) - 86400_000).toISOString().slice(0,10)} UTC까지` : "자료 없음"}</dd></div>
          <div><dt>이 브라우저의 서버 확인</dt><dd>{checkedAt ? time(checkedAt) : "아직 확인되지 않음"}</dd></div>
          {health.firstFailureAt && <div><dt>이번 자료의 첫 실패 관측</dt><dd>{fmtKstMinute(health.firstFailureAt)}</dd></div>}
        </dl>
        <p className="collection-note">가격·시총·배수는 저장된 수집본의 값입니다. 수익은 위 UTC 날짜까지의 완전한 일별 자료로 계산하며, 원천 금액의 별도 집계 범위와 누락일은 종목 상세에 표시합니다. 예약 실행은 지연될 수 있습니다.</p>
        {p && <div className="collection-counts">
          <h3>공개·장애 기록</h3>
          <p>이력 기록 시작: {time(p.trackingStartedAt)}</p>
          <p>사용 중인 검증본 수집: {p.published ? time(data?.updatedAt ?? p.published.dataAt) : "검증본 없음"}</p>
          <p>최근 수집 시작: {time(p.attempt.startedAt)} · 완료: {p.attempt.completedAt ? time(p.attempt.completedAt) : "수집 중"}</p>
          {p.incident && <><p className="negative">기록 시작 이후 첫 실패 관측: {time(p.incident.firstFailureObservedAt)}</p><p>마지막 정상 자료: {time(p.incident.lastGoodDataAt)}</p><p>최근 실패 관측: {time(p.incident.lastFailureObservedAt)}</p></>}
          {p.recoveredAt && <p>최근 회복 확인: {time(p.recoveredAt)}</p>}
          {p.attempt.outcome === "blocked" && <p className="negative">공개 보류 사유: {publicationFailure(p.attempt)}</p>}
          <p>{comparisonSummary(p.attempt)}</p>
          <p>{p.attempt.outcome !== "running" && <><a href={p.attempt.reportUrl} target="_blank" rel="noreferrer">종목별 변경값·검사 결과</a> · </>}<a href={p.attempt.runUrl} target="_blank" rel="noreferrer">수집 작업 기록</a></p>
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
        </div>}
        {p?.attempt.collection && <p>최근 시도: CoinGecko 조회 실패 {count(p.attempt.collection.gecko?.failed)}개 · CoinMarketCap 조회 실패 {count(p.attempt.collection.cmc?.failed)}개</p>}
        {health.firstFailureAt && <p className="collection-note">첫 실패 관측은 이번 수집 안에서의 기록입니다. 실제 장애가 언제 시작됐는지는 이 기록만으로 확정할 수 없습니다.</p>}
        <p className="collection-note">‘수집 정상’은 위 수집·검사 범위의 상태입니다. 원천 미제공, 토큰 연결·정의 검토, 기간 이력 부족으로 계산할 수 없는 지표는 종목 상세에서 확인할 수 있습니다.</p>
        <button className="button" disabled={refreshing} onClick={onRefresh}>{refreshing ? "서버 확인 중…" : "다시 확인"}</button>
      </div>
    </SettingsDialog>}
  </>;
}
