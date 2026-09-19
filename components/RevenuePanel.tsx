"use client";

import { useState } from "react";
import type { CoinScored } from "@/lib/types";
import { fmtMult, fmtUsd } from "@/lib/format";
import { researchMultiple } from "@/lib/research";
import { revenueAmount, historyMatches, type RevenueWindowDays } from "@/lib/revenueHistory";
import { compareSnapshot, type Snapshot } from "@/lib/snapshotHistory";
import { revenueLabel, multipleLabel, knownRevenue, feeLabel, RULE_VERSION } from "@/lib/fundamentals";

export function RevenuePanel({ coin, history, reference }: { coin: CoinScored; history: Snapshot[]; reference: number | null }) {
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const weeks = coin.revenueHistory?.weeks ?? [];
  const values = weeks.map(w => w.total).filter((v): v is number => v !== null);
  const max = Math.max(0, ...values), min = Math.min(0, ...values);
  const range = max - min || 1;
  const y = (v: number) => (max - v) / range * 100;
  const selected = weeks[selectedWeek ?? weeks.length - 1];
  const records = history.flatMap(snapshot => {
    const row = snapshot.coins[coin.slug];
    return compareSnapshot(coin, snapshot, RULE_VERSION).state === "comparable" && row?.revenueMultiple != null ? [{ at: snapshot.at, row }] : [];
  });
  return <section className="detail-section revenue-panel">
    <div className="section-title"><h3>{multipleLabel(coin)} · 기간별 추이</h3><span>현재 토큰 시총 · {fmtUsd(coin.mcap)}</span></div>
    <p><strong>분모: {revenueLabel(coin)}</strong> · 최근 기간의 집계액을 연환산합니다.</p>
    {coin.fundamentals.revenue.components.some(c => c.slug === "venice") && <p className="notice">VVV 매입·소각만 집계합니다. 오프체인 구독·API·크레딧/DIEM 판매액이 빠져 있어 Venice 전체 매출이나 ARR로 사용할 수 없습니다.</p>}
    {!knownRevenue(coin) && <p className="notice">구성요소의 정의가 미확인·변경됐거나 성격이 섞여 있습니다. 원천 금액은 보존하고 배수와 사업 수익 성장 비교는 보류합니다.</p>}
    {!historyMatches(coin) && <p className="notice">일별 이력과 현재 자료의 집계 정의가 일치하지 않습니다. 배수와 변화 비교를 보류합니다.</p>}
    <details className="definition-evidence"><summary>집계 정의와 출처 확인</summary>{[
      { label: `Revenue · ${revenueLabel(coin)}`, parts: coin.fundamentals.revenue.components },
      { label: `Fees · ${feeLabel(coin)}`, parts: coin.fundamentals.fees.components },
      { label: "HoldersRevenue · 홀더 귀속 원천 집계", parts: coin.fundamentals.holders },
    ].map(group => <div key={group.label}><strong>{group.label}</strong>{group.parts.length ? group.parts.map((part, i) => <p key={`${part.slug}-${i}`}><a href={part.source} target="_blank" rel="noreferrer">{part.slug}</a> · {part.status === "matched" ? `정의 대조 ${part.reviewedAt}` : "정의 재검토 필요"}<br /><span lang="en">{part.definition ?? "원천 정의 없음"}</span></p>) : <p>원천 구성요소 없음</p>}</div>)}<p className="muted">제공처의 정의를 대조한 분류입니다. 재무감사나 거래별 검증을 뜻하지 않습니다.</p></details>
    <div className="revenueMultiple-periods">
      {([365, 90, 30, 7] as RevenueWindowDays[]).map(days => {
        const revenueMultiple = researchMultiple(coin, days), period = coin.revenueHistory?.periods[days];
        return <div className={`revenueMultiple-period ${days === 30 ? "primary-period" : ""}`} key={days}>
          <span>{days === 365 ? "시총/집계액 · 365일 합계" : `시총/집계액 · ${days}일 연환산`}</span>
          <strong className={reference !== null && days === 30 && revenueMultiple !== null && revenueMultiple <= reference ? "revenueMultiple-highlight" : ""}>{fmtMult(revenueMultiple)}</strong>
          <small>원천 집계액 {fmtUsd(revenueAmount(coin, days))}</small>
          {period && <small>{period.start} ~ {period.end}</small>}
          {period && period.reportedDays !== days && <small className="caution-text">{period.reportedDays}/{days}일 확보 · 일부 이력 누락</small>}
          {period?.total !== null && period?.total !== undefined && period.total <= 0 && <small>집계액 0 이하 · 시총/집계액 산출 보류</small>}
        </div>;
      })}
    </div>
    <p className="detail-note muted">90/30/7일 시총/집계액 = 현재 시총 ÷ (기간 집계액 × 365 ÷ 일수). 연환산은 미래 집계액 예측이 아닙니다. 각 기간은 서로 겹칩니다.</p>
    <div className="revenue-comparison">
      <div><span>직전 30일</span><strong>{fmtUsd(coin.revenueHistory ? coin.revenueHistory.previous30.total : coin.revenuePrev30d)}</strong><small>{coin.revenueHistory ? `${coin.revenueHistory.previous30.start} ~ ${coin.revenueHistory.previous30.end}` : "원천 집계"}</small></div>
      <div><span>최근 30일</span><strong>{fmtUsd(revenueAmount(coin, 30))}</strong><small>{coin.revenueHistory ? `${coin.revenueHistory.periods[30].start} ~ ${coin.revenueHistory.periods[30].end}` : "원천 집계"}</small></div>
      <div><span>집계액 변화</span><strong>{coin.opportunities.revenue.state === "from_zero" ? "보고된 0 → 양수" : coin.opportunities.revenue.changePct === null ? "비교 불가" : `${coin.opportunities.revenue.changePct > 0 ? "+" : ""}${coin.opportunities.revenue.changePct.toFixed(1)}%`}</strong></div>
    </div>
    <p className="detail-note muted">집계 범위는 위 원천 정의를 따릅니다. 토큰 시총·FDV는 회사 지분 가치가 아니며, 이 금액으로 회사 전체 매출이나 홀더의 이익 청구권을 추정하지 않습니다.</p>
    {weeks.length > 0 ? <figure className="revenue-chart">
      <figcaption><strong>주별 원천 집계액</strong><span>각 7일 합계 · USD</span></figcaption>
      <div className="chart-layout"><div className="chart-scale"><span>{fmtUsd(max)}</span><span>{fmtUsd(min)}</span></div>
        <div className="weekly-bars" style={{ "--zero": `${y(0)}%` } as React.CSSProperties}>
          {weeks.map((w, i) => <button key={w.end} className={`week-column ${selectedWeek === i ? "selected" : ""}`} onClick={() => setSelectedWeek(i)} onFocus={() => setSelectedWeek(i)} onMouseEnter={() => setSelectedWeek(i)} aria-label={`${w.start}부터 ${w.end} 집계액 ${w.total === null ? `이력 부족, ${w.reportedDays}/7일` : fmtUsd(w.total)}`}>
            {w.total === null ? <span className="missing-bar" /> : <span className={`revenue-bar ${w.total < 0 ? "negative-bar" : ""}`} style={{ top: `${Math.min(y(w.total), y(0))}%`, height: `${Math.max(w.total === 0 ? 0.5 : 0, Math.abs(w.total) / range * 100)}%` }} />}
          </button>)}
        </div>
      </div>
      <div className="chart-dates"><span>{weeks[0]?.start}</span><span>{weeks.at(-1)?.end}</span></div>
      {selected && <p className="chart-value" aria-live="polite">{selected.start} ~ {selected.end} <strong>{selected.total === null ? `자료 부족 (${selected.reportedDays}/7일)` : fmtUsd(selected.total)}</strong></p>}
      <details><summary>주별 금액 표로 보기</summary><table className="detail-table"><thead><tr><th>기간</th><th>원천 집계액</th><th>확보 일수</th></tr></thead><tbody>{weeks.map(w => <tr key={w.end}><th>{w.start} ~ {w.end}</th><td>{fmtUsd(w.total)}</td><td>{w.reportedDays}/7일</td></tr>)}</tbody></table></details>
      <p className="detail-note muted">빈 막대는 자료 누락입니다. 아직 끝나지 않은 UTC 날짜는 제외합니다. 자료가 나중에 보완되면 과거 집계도 달라질 수 있습니다.</p>
    </figure> : <p className="notice">일별 집계액 이력을 확보하지 못했습니다. 기간별 집계가 있는 값만 표시하며 90일 집계액은 추정하지 않습니다.</p>}
    <details className="historical-revenueMultiple"><summary>기록 당시의 시총과 시총/집계액 비교 <span className="muted">· 이 브라우저의 관측 기록</span></summary>
      <p className="detail-note">각 날짜에 기록한 시총 ÷ 당시 최근 30일 집계액 연환산입니다. 토큰 연결·계산 규칙·집계 정의·기간 기준이 같은 기록만 표시합니다. 방문하지 않은 날의 기록은 없습니다.</p>
      {records.length > 1 ? <table className="detail-table"><thead><tr><th>관측 날짜</th><th>당시 시총</th><th>당시 최근 30일 집계액</th><th>당시 시총/집계액</th></tr></thead><tbody>{records.slice(-14).map(r => <tr key={r.at}><th>{r.at.slice(0, 10)}</th><td>{fmtUsd(r.row.mcap)}</td><td>{fmtUsd(r.row.revenue30d)}</td><td>{fmtMult(r.row.revenueMultiple)}</td></tr>)}</tbody></table> : <p className="muted">서로 다른 날짜의 비교 가능한 기록이 두 개 이상 쌓이면 표시합니다. 현재 시총으로 과거 배수를 만들어 채우지 않습니다.</p>}
    </details>
  </section>;
}
