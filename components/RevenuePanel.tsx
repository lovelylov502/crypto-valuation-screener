"use client";

import { useState } from "react";
import type { CoinScored } from "@/lib/types";
import { fmtMult, fmtUsd } from "@/lib/format";
import { researchPs } from "@/lib/research";
import { revenueAmount, type RevenueWindowDays } from "@/lib/revenueHistory";
import type { Snapshot } from "@/lib/snapshotHistory";

export function RevenuePanel({ coin, history, reference }: { coin: CoinScored; history: Snapshot[]; reference: number }) {
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const weeks = coin.revenueHistory?.weeks ?? [];
  const values = weeks.map(w => w.total).filter((v): v is number => v !== null);
  const max = Math.max(0, ...values), min = Math.min(0, ...values);
  const range = max - min || 1;
  const y = (v: number) => (max - v) / range * 100;
  const selected = weeks[selectedWeek ?? weeks.length - 1];
  const records = history.flatMap(snapshot => {
    const row = snapshot.coins[coin.slug];
    const identity = `${coin.identityStatus}:${coin.cmcId ?? ""}:${coin.geckoId ?? ""}:${coin.symbol ?? ""}`;
    return row && row.identity === identity && row.ps != null ? [{ at: snapshot.at, row }] : [];
  });
  return <section className="detail-section revenue-panel">
    <div className="section-title"><h3>P/S와 매출 추이</h3><span>현재 시총 고정 · {fmtUsd(coin.mcap)}</span></div>
    <p className="muted">현재 시총은 고정하고 매출 집계 기간을 바꿔 P/S를 비교합니다. 최근 기간의 매출을 적용했을 때 배수가 낮아지는지 살펴보세요.</p>
    <div className="ps-periods">
      {([365, 90, 30, 7] as RevenueWindowDays[]).map(days => {
        const ps = researchPs(coin, days), period = coin.revenueHistory?.periods[days];
        return <div className={`ps-period ${days === 30 ? "primary-period" : ""}`} key={days}>
          <span>{days === 365 ? "P/S · 1년 실제 매출" : `P/S · ${days}일 매출 연환산`}</span>
          <strong className={days === 30 && ps !== null && ps <= reference ? "ps-highlight" : ""}>{fmtMult(ps)}</strong>
          <small>실제 매출 {fmtUsd(revenueAmount(coin, days))}</small>
          {period && <small>{period.start} ~ {period.end}</small>}
          {period && period.reportedDays !== days && <small className="caution-text">{period.reportedDays}/{days}일 확보 · 일부 이력 누락</small>}
          {period?.total !== null && period?.total !== undefined && period.total <= 0 && <small>매출 0 이하 · P/S 산출 보류</small>}
        </div>;
      })}
    </div>
    <p className="detail-note muted">90/30/7일 P/S = 현재 시총 ÷ (기간 매출 × 365 ÷ 일수). 연환산은 미래 매출 예측이 아닙니다. 각 기간은 서로 겹칩니다.</p>
    <div className="revenue-comparison">
      <div><span>직전 30일</span><strong>{fmtUsd(coin.revenueHistory ? coin.revenueHistory.previous30.total : coin.revenuePrev30d)}</strong><small>{coin.revenueHistory ? `${coin.revenueHistory.previous30.start} ~ ${coin.revenueHistory.previous30.end}` : "원천 집계"}</small></div>
      <div><span>최근 30일</span><strong>{fmtUsd(revenueAmount(coin, 30))}</strong><small>{coin.revenueHistory ? `${coin.revenueHistory.periods[30].start} ~ ${coin.revenueHistory.periods[30].end}` : "원천 집계"}</small></div>
      <div><span>매출 변화</span><strong>{coin.opportunities.revenue.state === "from_zero" ? "보고된 0 → 양수" : coin.opportunities.revenue.changePct === null ? "비교 불가" : `${coin.opportunities.revenue.changePct > 0 ? "+" : ""}${coin.opportunities.revenue.changePct.toFixed(1)}%`}</strong></div>
    </div>
    <p className="detail-note muted">매출은 수수료에서 공급자 몫을 뺀 프로토콜 귀속 수익입니다. 운영비까지 차감한 순이익과는 다릅니다.</p>
    {weeks.length > 0 ? <figure className="revenue-chart">
      <figcaption><strong>주별 실제 매출</strong><span>각 7일 합계 · USD</span></figcaption>
      <div className="chart-layout"><div className="chart-scale"><span>{fmtUsd(max)}</span><span>{fmtUsd(min)}</span></div>
        <div className="weekly-bars" style={{ "--zero": `${y(0)}%` } as React.CSSProperties}>
          {weeks.map((w, i) => <button key={w.end} className={`week-column ${selectedWeek === i ? "selected" : ""}`} onClick={() => setSelectedWeek(i)} onFocus={() => setSelectedWeek(i)} onMouseEnter={() => setSelectedWeek(i)} aria-label={`${w.start}부터 ${w.end} 매출 ${w.total === null ? `이력 부족, ${w.reportedDays}/7일` : fmtUsd(w.total)}`}>
            {w.total === null ? <span className="missing-bar" /> : <span className={`revenue-bar ${w.total < 0 ? "negative-bar" : ""}`} style={{ top: `${Math.min(y(w.total), y(0))}%`, height: `${Math.max(w.total === 0 ? 0.5 : 0, Math.abs(w.total) / range * 100)}%` }} />}
          </button>)}
        </div>
      </div>
      <div className="chart-dates"><span>{weeks[0]?.start}</span><span>{weeks.at(-1)?.end}</span></div>
      {selected && <p className="chart-value" aria-live="polite">{selected.start} ~ {selected.end} <strong>{selected.total === null ? `자료 부족 (${selected.reportedDays}/7일)` : fmtUsd(selected.total)}</strong></p>}
      <details><summary>주별 금액 표로 보기</summary><table className="detail-table"><thead><tr><th>기간</th><th>실제 매출</th><th>확보 일수</th></tr></thead><tbody>{weeks.map(w => <tr key={w.end}><th>{w.start} ~ {w.end}</th><td>{fmtUsd(w.total)}</td><td>{w.reportedDays}/7일</td></tr>)}</tbody></table></details>
      <p className="detail-note muted">빈 막대는 자료 누락입니다. 아직 끝나지 않은 UTC 날짜는 제외합니다. 자료가 나중에 보완되면 과거 집계도 달라질 수 있습니다.</p>
    </figure> : <p className="notice">일별 매출 이력을 확보하지 못했습니다. 기간별 집계가 있는 값만 표시하며 90일 매출은 추정하지 않습니다.</p>}
    <details className="historical-ps"><summary>기록 당시의 시총과 P/S 비교 <span className="muted">· 이 브라우저의 관측 기록</span></summary>
      <p className="detail-note">각 날짜에 기록한 시총 ÷ 당시 최근 30일 매출 연환산입니다. 위의 현재 시총 고정 비교와 구분합니다. 방문하지 않은 날의 기록은 없습니다.</p>
      {records.length > 1 ? <table className="detail-table"><thead><tr><th>관측 날짜</th><th>당시 시총</th><th>당시 최근 30일 매출</th><th>당시 P/S</th></tr></thead><tbody>{records.slice(-14).map(r => <tr key={r.at}><th>{r.at.slice(0, 10)}</th><td>{fmtUsd(r.row.mcap)}</td><td>{fmtUsd(r.row.revenue30d)}</td><td>{fmtMult(r.row.ps)}</td></tr>)}</tbody></table> : <p className="muted">서로 다른 날짜의 비교 가능한 기록이 두 개 이상 쌓이면 표시합니다. 현재 시총으로 과거 P/S를 만들어 채우지 않습니다.</p>}
    </details>
  </section>;
}
