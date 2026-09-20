import type { CoinScored } from "@/lib/types";
import { fmtUsd, fmtMult } from "@/lib/format";
import { salesMultiple, salesReason, holderMultiple, holderAmount, holderReason, protocolMultiple, type CapitalBasis } from "@/lib/valuationMetrics";
import { revenueAmount, type RevenueWindowDays } from "@/lib/revenueHistory";

export function ValuationEvidence({ coin: c, capital }: { coin: CoinScored; capital: CapitalBasis }) {
  const capName = capital === "mcap" ? "유통 시총" : "FDV";
  const s = c.sales;
  return <div className="valuation-evidence">
    {c.capitalExclusionReason && <p className="notice">{c.capitalExclusionReason}</p>}
    <section className="detail-section">
      <div className="section-title"><h3>P/S · 사업 매출</h3><span>{salesReason(c)}</span></div>
      {s ? <>
        <div className="sales-equation"><span>{capName}<strong>{fmtUsd(c[capital])}</strong></span><span aria-hidden="true">÷</span><span>{s.basis === "annualized_estimate" ? "연환산 매출 추정" : "보고된 1년 매출"}<strong>{fmtUsd(s.amountUsd)}</strong></span><span aria-hidden="true">=</span><span>P/S<strong>{fmtMult(salesMultiple(c, capital))}</strong></span></div>
        <div className="capital-comparison"><span>시총 기준 <b>{fmtMult(salesMultiple(c, "mcap"))}</b></span><span>FDV 기준 <b>{fmtMult(salesMultiple(c, "fdv"))}</b></span></div>
        <p className="evidence-scope">{s.scope}</p><p className="detail-note">{s.limitation}</p>
        <p className="detail-note"><a href={s.url} target="_blank" rel="noreferrer">{s.publisher} 원문 확인 ↗</a> · 자료 기준 {s.asOf} · 검토 {s.reviewedAt} · 재검토 기한 {s.validUntil}</p>
        <p className="detail-note muted">이 추정치로 7·30·90일 실적을 역산하지 않습니다. 비교 가능한 기간별 매출 자료가 있어야 해당 P/S를 계산할 수 있습니다.</p>
      </> : <div className="missing-evidence"><strong>사업 매출 자료를 확보하지 못했습니다.</strong><p>아래 프로토콜 수익·환원 집계는 별도로 비교할 수 있습니다. 수수료, 선불 결제, 소각액을 사업 매출로 대신 사용하지 않습니다.</p></div>}
    </section>
    <section className="detail-section"><div className="section-title"><h3>P/HR · 홀더 환원</h3><span>현재 {capName} {fmtUsd(c[capital])}</span></div>
      <div className="revenueMultiple-periods">{([365,90,30,7] as RevenueWindowDays[]).map(days => {
        const h = c.holderHistory?.periods[days], total = holderAmount(c, days);
        return <div className={"revenueMultiple-period " + (days === 30 ? "primary-period" : "")} key={days}><span>{days === 365 ? "1년 · 365일 합계" : days + "일 연환산"}</span><strong>{fmtMult(holderMultiple(c,days,capital))}</strong><small>환원액 {fmtUsd(total)}</small>{h && <small>{h.start} ~ {h.end} UTC</small>}<small>{holderReason(c,days)}</small>{total !== null && days !== 365 && <small>연환산 분모 {fmtUsd(total * 365 / days)}</small>}</div>;
      })}</div>
      <p className="detail-note">배수 = 현재 {capName} ÷ 환원 연환산액. 1년은 실제 365일 합계만 사용합니다. 일회성 매입·소각이 몰리면 7일 배수가 크게 달라질 수 있습니다.</p>
      {c.slug === "venice" && <p className="notice">VVV의 이 환원액은 매입·소각된 토큰의 USD 집계입니다. 위 사업 매출 추정과 분모가 다르므로, 100배가 넘는 환원 배수를 매출 P/S로 읽으면 안 됩니다. 소각 시점 평가액이 실제 매입 지출과 일치하는지도 별도 확인이 필요합니다.</p>}
      <p className="detail-note muted">{c.holderValue.components.filter(p=>p.eligible).map(p=>p.name).join(", ") || "적격 환원 구성요소 없음"} · 제외된 조건부 보상은 아래 환원 방식에서 확인합니다.</p>
      {c.holderHistory && <a className="detail-note" href={c.holderHistory.source} target="_blank" rel="noreferrer">환원 일별 원자료 ↗</a>}
    </section>
    <section className="detail-section"><h3>P/R · 프로토콜 귀속 수익</h3>
      {c.fundamentals.revenue.kind === "protocol_revenue" ? <div className="detail-table-wrap"><table className="detail-table"><thead><tr><th>기간</th><th>기간 수익</th><th>P/R · {capName}</th></tr></thead><tbody>{([365,90,30,7] as RevenueWindowDays[]).map(days=><tr key={days}><th>{days === 365 ? "365일 합계" : days + "일 연환산"}</th><td>{fmtUsd(revenueAmount(c,days))}</td><td>{fmtMult(protocolMultiple(c,days,capital))}</td></tr>)}</tbody></table></div> : <p className="muted">이 종목의 Revenue는 프로토콜 귀속 수익으로 확인된 자료가 아닙니다. 원천 정의는 아래에서 확인할 수 있습니다.</p>}
      <p className="detail-note muted">프로토콜이 얻은 수익이며 전체 사업 매출·순이익·홀더 수령액과 구분합니다.</p>
    </section>
  </div>;
}

