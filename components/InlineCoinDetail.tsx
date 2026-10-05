"use client";
import { ChevronUp, ExternalLink, Info } from "lucide-react";
import type { CoinScored } from "@/lib/types";
import { fmtKstMinute, fmtMult, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { growthLabel, revenueTrend } from "@/lib/revenueTrend";
import { holderAmount, holderMultiple, holderReason, protocolMultiple, protocolReason, type CapitalBasis } from "@/lib/valuationMetrics";
import { holderConditionSummary, holderTypeSummary } from "./ScreenerCells";
import { defiLlamaUrl, marketLink } from "@/lib/coinLinks";
import { koreanDetailDescription } from "@/lib/protocolDescriptions";
import { metricStatus } from "@/lib/metricStatus";
import { protocolResearch } from "@/lib/protocolResearch";
import { holderEconomicTypeLabel } from "@/lib/holderValue";
import { REVENUE_WINDOWS, revenueAmount } from "@/lib/revenueHistory";
import { windowLabel } from "@/lib/metricCoverage";
import { ValuationEvidence } from "./ValuationEvidence";
import { revenueReading } from "@/lib/revenueReading";
import { marketDataReason } from "@/lib/collectionQuality";
import { dataQualityReason } from "@/lib/dataQuality";

export const signedUsd = (v: number | null) => v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtUsd(Math.abs(v))}`;
export const tone = (v: number | null) => v === null || v === 0 ? "muted" : v > 0 ? "positive" : "negative";
const supply = (v: number | null) => v === null ? "미확인" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);

export function InlineCoinDetail({ coin: c, capital, onClose }: { coin: CoinScored; capital: CapitalBasis; onClose: () => void }) {
  const month = revenueTrend(c, 30);
  const research = protocolResearch(c);
  const capName = capital === "mcap" ? "유통 시총" : "FDV";
  const pr30 = protocolMultiple(c, 30, capital), phr30 = holderMultiple(c, 30, capital);
  const reading30 = revenueReading(c, 30), returned30 = holderAmount(c, 30);
  const end = c.revenueHistory?.periods[1]?.end;
  const market = marketLink(c), llama = defiLlamaUrl(c);
  const introduction = koreanDetailDescription(c.description) ?? c.descriptionKo;
  const providerPeriods = REVENUE_WINDOWS.filter(days => ["provider_total", "provider_partial"].includes(revenueReading(c, days).basis));
  const unavailable = (reason: string) => <span className="detail-unavailable" title={reason}>{metricStatus(reason)}<small>{reason}</small></span>;
  return <section className="inline-detail" aria-label={c.name + " 상세"} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="inline-detail-heading">
      <div className="detail-identity">{c.logo && <img src={c.logo} alt="" width={52} height={52}/>}<h3>{c.name}</h3><span>{c.symbol ?? "토큰 미연결"}{c.chains.length > 0 && ` · ${c.chains.slice(0, 3).join(", ")}`}</span></div>
      <div className="detail-links"><a className="button" href={llama} target="_blank" rel="noreferrer">DefiLlama<ExternalLink size={14}/></a>{market ? <a className="button" href={market.url} target="_blank" rel="noreferrer">{market.label}<ExternalLink size={14}/></a> : <span className="market-link-missing">시세 페이지 미연결</span>}<button onClick={onClose} className="text-button" aria-label={c.name + " 상세 접기"}>접기<ChevronUp size={17}/></button></div>
    </header>
    <section className="detail-introduction" aria-label="프로젝트 소개">
      <h4>어떤 코인인가요?</h4>
      <p>{introduction ?? research?.description ?? (c.description ? "한글 번역을 준비 중입니다. 아래에서 원문을 확인할 수 있습니다." : "프로젝트 소개 자료를 아직 확보하지 못했습니다.")}</p>
      {introduction ? <small>DefiLlama 소개 번역</small> : research && <small>공식 자료 검토 · {research.reviewedAt}</small>}
      {c.description && <details className="description-original"><summary>영문 원문 보기</summary><p lang="en">{c.description}</p><a href={c.descriptionSource ?? llama} target="_blank" rel="noreferrer">DefiLlama 원문<ExternalLink size={12}/></a></details>}
    </section>
    {!!c.dataQuality?.issues.length && <div className="notice" role="status">
      <strong>자료 확인 필요</strong>
      <ul>{c.dataQuality.issues.map(issue => <li key={`${issue.scope}:${issue.code}:${issue.source}`}>{dataQualityReason(issue)} · <a href={issue.source} target="_blank" rel="noreferrer">원천 확인 ↗</a></li>)}</ul>
    </div>}
    <section className="detail-summary" aria-label="핵심 지표">
      <div className="detail-section-title"><h4>핵심 지표</h4><span>배수 기준 {capName} · 수익·환원 최근 30일</span></div>
      <dl className="summary-grid">
        <div><dt>현재 가격</dt><dd>{c.price === null ? "미확인" : fmtPrice(c.price)}</dd><div className="summary-changes"><span>24시간 <b className={tone(c.change1d)}>{fmtPct(c.change1d)}</b></span><span>7일 <b className={tone(c.priceChange7d)}>{fmtPct(c.priceChange7d)}</b></span></div></div>
        <div><dt>{capital === "fdv" ? "완전 희석 가치 · FDV" : "유통 시총"}</dt><dd>{c[capital] === null ? "미확인" : fmtUsd(c[capital])}</dd><p>{capital === "fdv" ? "유통 시총" : "FDV"} <b>{fmtUsd(c[capital === "fdv" ? "mcap" : "fdv"])}</b>{c.mcap && c.fdv ? ` · ${(c.fdv / c.mcap).toFixed(2)}배` : ""}</p><small>{marketDataReason(c, capital)}</small></div>
        <div><dt>{reading30.kindLabel} · 30일</dt><dd>{reading30.amount === null ? "자료 부족" : fmtUsd(reading30.amount)}</dd>{reading30.basis.startsWith("provider") && <span className="source-badge">{reading30.basis === "provider_partial" ? "부분 집계" : "제공처 집계"}</span>}<p title={protocolReason(c, 30, capital)}>P/R <b>{pr30 === null ? metricStatus(protocolReason(c, 30, capital)) : fmtMult(pr30)}</b></p><p>직전 30일 대비 <b className={tone(month.delta)}>{month.delta === null ? "비교 불가" : growthLabel(month)}</b></p></div>
        <div><dt>홀더 환원액 · 30일</dt><dd>{returned30 === null ? "자료 부족" : fmtUsd(returned30)}</dd><p title={holderReason(c, 30, capital)}>P/HR <b>{phr30 === null ? metricStatus(holderReason(c, 30, capital)) : fmtMult(phr30)}</b></p><small>{research?.holder?.summary ?? research?.holder?.route ?? holderTypeSummary(c, true)}</small></div>
      </dl>
      <dl className="market-secondary"><div><dt>유통량</dt><dd>{supply(c.circulatingSupply)} {c.symbol}</dd></div><div><dt>총발행량</dt><dd>{supply(c.totalSupply)} {c.symbol}</dd></div><div><dt>24시간 거래대금</dt><dd>{fmtUsd(c.totalVolume)}</dd></div><div><dt>시세 출처</dt><dd>{marketDataReason(c, "price")}</dd></div></dl>
    </section>
    <section className="detail-comparison" aria-label="기간별 비교">
      <div className="detail-section-title"><h4>기간별 비교</h4><span>{end ? `${end} UTC까지 · ` : ""}변화는 직전 같은 기간과 비교</span><span className="comparison-basis">배수 기준 {capName}</span></div>
      <div className="comparison-scroll" role="region" aria-label="기간별 수익과 환원 비교 · 가로 스크롤 가능" tabIndex={0}>
        <table className="period-comparison"><caption className="sr-only">기간별 수익, 수익 변화, P/R, 홀더 환원액, P/HR</caption><thead><tr><th scope="col">기간</th><th scope="col">{reading30.kindLabel}</th><th scope="col">수익 변화</th><th scope="col">P/R</th><th scope="col">홀더 환원액</th><th scope="col">P/HR</th></tr></thead>
          <tbody>{REVENUE_WINDOWS.map(days => {
            const reading = revenueReading(c, days), trend = revenueTrend(c, days);
            const pr = protocolMultiple(c, days, capital), phr = holderMultiple(c, days, capital), returned = holderAmount(c, days);
            const period = c.revenueHistory?.periods[days], provider = reading.basis.startsWith("provider");
            return <tr key={days} className={days === 30 ? "comparison-highlight" : ""}>
              <th scope="row">{windowLabel(days)}</th>
              <td>{reading.amount === null ? <span className="detail-unavailable">자료 부족<small>{period ? `${period.reportedDays} / ${days}일 확보` : "기간 자료 미확보"}</small></span> : <><strong>{fmtUsd(reading.amount)}</strong>{provider && <span className="source-badge" title={reading.basisLabel}>{reading.basis === "provider_partial" ? "부분 집계" : "제공처 집계"}</span>}</>}</td>
              <td title={`직전 ${windowLabel(days)} ${fmtUsd(trend.previous)} · 증가액 ${signedUsd(trend.delta)}`}><span className={tone(trend.delta)}>{trend.delta === null ? "비교 불가" : growthLabel(trend)}</span></td>
              <td>{pr === null ? unavailable(protocolReason(c, days, capital)) : fmtMult(pr)}</td>
              <td>{returned === null ? unavailable(holderReason(c, days, capital)) : <strong>{fmtUsd(returned)}</strong>}</td>
              <td>{phr === null ? unavailable(holderReason(c, days, capital)) : fmtMult(phr)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {providerPeriods.length > 0 && <p className="comparison-notice"><Info size={15}/><span>{providerPeriods.map(days => `${windowLabel(days)} ${fmtUsd(revenueReading(c, days).amount)}`).join(" · ")}는 제공처 집계입니다. 기간별 이력이 부족하거나 일부 구성요소만 확보한 금액은 배수와 증가율 계산에 사용하지 않습니다.</span></p>}
      <p className="detail-footnote">24시간은 완료된 UTC 하루 · 1·7·30·90일 배수는 연환산 · 1년은 365일 합계</p>
    </section>
    <section className="detail-holder" aria-label="홀더 환원 방식">
      <div className="detail-section-title"><h4>홀더에게 어떻게 돌아가나요?</h4><span>최근 30일</span></div>
      <div className="holder-grid">
        <div className="holder-total"><span>홀더 환원액 합계</span><strong>{returned30 === null ? "자료 부족" : fmtUsd(returned30)}</strong><small>{returned30 === null ? holderReason(c, 30, capital) : research?.holder?.routes ? "두 방식의 합계 · 방식별 금액 미구분" : "적격 환원 방식의 합계"}</small></div>
        {research?.holder?.routes ? research.holder.routes.map(route => <div className="holder-route" key={route.label}><strong>{route.label}</strong><p>{route.description}</p><small>{route.condition}</small></div>) : <>
          <div className="holder-route"><strong>환원 방식</strong><p>{research?.holder?.route ?? (c.holderValue.components.length ? holderTypeSummary(c, true) : "환원 자료 미연결")}</p><small>{research?.holder?.asset ?? "지급·소각 자산은 원천 설명에서 확인합니다."}</small></div>
          <div className="holder-route"><strong>수령 조건</strong><p>{research?.holder?.condition ?? holderConditionSummary(c)}</p>{research?.holder?.recipient && <small>{research.holder.recipient}</small>}</div>
        </>}
      </div>
      <p className="holder-scope-note">{research?.holder?.scopeNote && <strong>{research.holder.scopeNote}</strong>}<span>{research?.holder ? `${research.holder.status} · 검토 ${research.reviewedAt}` : "DefiLlama 원천 설명 분류 · 개별 지급 거래 미대조"}</span></p>
    </section>
    <footer className="detail-sources"><span>시세 {c.marketSources?.price ?? "출처 미확인"} · {c.marketDataUpdatedAt ? fmtKstMinute(c.marketDataUpdatedAt) : "시각 미확인"}</span><span>수익·환원 <a href={llama} target="_blank" rel="noreferrer">DefiLlama<ExternalLink size={12}/></a> · {end ? `${end} UTC까지` : "완료일 미확인"} · 수집 {c.revenueHistory ? fmtKstMinute(c.revenueHistory.observedAt) : "시각 미확인"}</span></footer>
    <details className="inline-evidence"><summary>계산 근거 · 집계 범위 · 자료 상태</summary>
      <p>가격 변화 · 24시간 {fmtPct(c.change1d)} · 7일 {fmtPct(c.priceChange7d)} · 30일 {fmtPct(c.priceChange30d)}. 최근 7일 수익 중 가장 큰 하루의 비중 {c.revenueHistory?.peakDayShare7d == null ? "미확인" : `${c.revenueHistory.peakDayShare7d.toFixed(1)}%`}.</p>
      {research && <p>{research.description} <a href={research.source} target="_blank" rel="noreferrer">검토 자료</a> · {research.scope}</p>}
      <p>{pr30 !== null ? <>30일 P/R = {fmtUsd(c[capital])} ÷ ({fmtUsd(revenueAmount(c, 30))} × 365/30) = <b>{fmtMult(pr30)}</b> · {capName}</> : <>30일 P/R · {protocolReason(c, 30, capital)}</>}</p>
      <p>{c.identityReason}{c.capitalExclusionReason && ` · ${c.capitalExclusionReason}`}</p>
      <p>제공처 기간 집계 참고 · 24h {fmtUsd(c.revenue24h)} · 7일 {fmtUsd(c.revenue7d)} · 30일 {fmtUsd(c.revenue30d)}. 완료일 이력과 범위가 다를 수 있어 이력이 부족한 배수의 대체값으로 쓰지 않습니다.</p>
      <div className="inline-periods">{REVENUE_WINDOWS.map(days => <div key={days}><b>{windowLabel(days)}</b><span>{c.revenueHistory?.periods[days]?.start ?? "–"} ~ {c.revenueHistory?.periods[days]?.end ?? "–"} UTC</span><span>P/R · {protocolReason(c, days, capital)}</span><span>P/HR · {holderReason(c, days, capital)}</span></div>)}</div>
      <p>수익과 환원은 DefiLlama 자료입니다. 완료된 UTC 하루는 한국 시간 오전 9시부터 다음 날 오전 9시까지입니다. 1년은 365일 합계이며, 증가율은 직전 동일 길이 기간과 비교합니다. 단기 연환산은 해당 기간의 속도를 비교하는 값이며 향후 수익 예측이 아닙니다.</p>
      <p>수익 수집 {c.revenueHistory ? fmtKstMinute(c.revenueHistory.observedAt) : "이력 미확보"} · 환원 수집 {c.holderHistory ? fmtKstMinute(c.holderHistory.observedAt) : "이력 미확보"}</p>
      <p className="evidence-source-links">{[...new Set(REVENUE_WINDOWS.map(days => revenueReading(c, days).source))].map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer">수익 집계 원본 {i + 1}<ExternalLink size={12}/></a>)}{c.holderHistory && <a href={c.holderHistory.source} target="_blank" rel="noreferrer">환원 집계 원본<ExternalLink size={12}/></a>}</p>
      {c.fundamentals.revenue.components.map(p => <p key={p.slug}><b>{p.slug} · {p.status === "matched" ? "정의 확인" : "정의 재검토 필요"}</b><br/>{p.definition ?? "정의 미확보"}{p.reviewNote && <><br/>{p.reviewNote}</>}</p>)}
      {c.holderValue.components.map(p => <p key={p.slug}><b>{p.name} · {holderEconomicTypeLabel(p.economicType)} · {p.eligible ? "P/HR 포함" : "P/HR 제외"}</b><br/>{p.reason} · {p.condition}</p>)}
      {c.sales && <ValuationEvidence coin={c} capital={capital}/>}
    </details>
  </section>;
}
