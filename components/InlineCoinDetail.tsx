"use client";
import { ArrowRight, ChevronUp, ExternalLink } from "lucide-react";
import type { CoinScored } from "@/lib/types";
import { fmtKstMinute, fmtMult, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { growthLabel, revenueTrend } from "@/lib/revenueTrend";
import { holderAmount, holderReason, protocolMultiple, protocolReason, type CapitalBasis } from "@/lib/valuationMetrics";
import { coinUrl, holderConditionSummary, holderTypeSummary } from "./ScreenerCells";
import { protocolResearch } from "@/lib/protocolResearch";
import { holderEconomicTypeLabel } from "@/lib/holderValue";
import { REVENUE_WINDOWS, revenueAmount } from "@/lib/revenueHistory";
import { windowLabel } from "@/lib/metricCoverage";
import { ValuationEvidence } from "./ValuationEvidence";

export const signedUsd = (v: number | null) => v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtUsd(Math.abs(v))}`;
export const tone = (v: number | null) => v === null || v === 0 ? "muted" : v > 0 ? "positive" : "negative";
const supply = (v: number | null) => v === null ? "미확인" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);

export function InlineCoinDetail({ coin: c, capital, onClose }: { coin: CoinScored; capital: CapitalBasis; onClose: () => void }) {
  const trend = revenueTrend(c, 7), month = revenueTrend(c, 30);
  const research = protocolResearch(c);
  const capName = capital === "mcap" ? "유통 시총" : "FDV";
  const pr24 = protocolMultiple(c, 1, capital);
  const peak = c.revenueHistory?.peakDayShare7d;
  const end = c.revenueHistory?.periods[1]?.end;
  return <section className="inline-detail" aria-label={c.name + " 상세"}>
    <header className="inline-detail-heading">
      <div>{c.logo && <img src={c.logo} alt="" width={34} height={34}/>}<h3>{c.name}</h3><span>{c.symbol ?? "토큰 미연결"}{c.chains.length > 0 && ` · ${c.chains.slice(0, 3).join(", ")}`}</span></div>
      <div><a href={coinUrl(c)} target="_blank" rel="noreferrer">{c.cmcSlug ? "CoinMarketCap에서 보기" : "DefiLlama에서 보기"}<ExternalLink size={14}/></a><button onClick={onClose} className="text-button" aria-label={c.name + " 상세 접기"}>접기<ChevronUp size={17}/></button></div>
    </header>
    <dl className="inline-market">
      <div><dt>현재 가격</dt><dd className="inline-price">{fmtPrice(c.price)}</dd></div>
      <div><dt>유통 시총</dt><dd>{fmtUsd(c.mcap)}</dd></div>
      <div><dt>FDV</dt><dd>{fmtUsd(c.fdv)}</dd><small>{c.mcap && c.fdv ? `시총의 ${(c.fdv / c.mcap).toFixed(2)}배` : "희석 규모 미확인"}</small></div>
      <div><dt>유통량</dt><dd>{supply(c.circulatingSupply)} <span>{c.symbol}</span></dd><small>총발행량 {supply(c.totalSupply)} {c.symbol}</small></div>
      <div><dt>24시간 거래대금</dt><dd>{fmtUsd(c.totalVolume)}</dd></div>
    </dl>
    <div className="inline-price-changes"><span>가격 변화</span>{[["24시간", c.change1d], ["7일", c.priceChange7d], ["30일", c.priceChange30d]].map(([label, value]) => <span key={String(label)}>{label} <b className={tone(value as number | null)}>{fmtPct(value as number | null)}</b></span>)}</div>
    <section className="inline-growth" aria-labelledby={`growth-${c.slug}`}>
      <h4 id={`growth-${c.slug}`}>최근 7일 수익 변화</h4>
      <div className="growth-equation"><span>직전 7일 <strong>{fmtUsd(trend.previous)}</strong></span><ArrowRight size={24}/><span>최근 7일 <strong>{fmtUsd(trend.current)}</strong></span><strong className={tone(trend.delta)}>{signedUsd(trend.delta)} <span>{trend.fromZero ? "(0에서 발생)" : trend.percent !== null ? `(${fmtPct(trend.percent)})` : ""}</span></strong></div>
      <p>{trend.previous === null ? "직전 동일 기간의 자료가 부족하면 증가율을 계산하지 않습니다." : <>7일 수익 중 가장 큰 하루 비중 <b>{peak == null ? "미확인" : `${peak.toFixed(1)}%`}</b><span> · </span>30일 수익 변화 <b className={tone(month.delta)}>{growthLabel(month)}</b></>}</p>
    </section>
    <section className="inline-holder">
      <div className="holder-total"><span>30일 홀더 귀속 수익</span><strong>{fmtUsd(holderAmount(c, 30))}</strong>{holderAmount(c, 30) === null && <small>{holderReason(c, 30, capital)}</small>}</div>
      <div className="holder-mechanism"><span>환원 방식</span><strong>{research?.holder?.route ?? holderTypeSummary(c, true)}</strong><p>{research?.holder?.condition ?? holderConditionSummary(c)}</p><small>{research?.holder ? `공식 문서 검토 ${research.reviewedAt} · ${research.holder.status}` : "DefiLlama 원천 설명 분류 · 개별 지급 거래 미대조"}</small></div>
    </section>
    <div className="inline-calculation"><p>{pr24 !== null ? <>24h P/R = {fmtUsd(c[capital])} ÷ ({fmtUsd(revenueAmount(c, 1))} × 365) = <b>{fmtMult(pr24)}</b> <span>· {capName}</span></> : <>24h P/R · {protocolReason(c, 1, capital)}</>}</p><p>시세 {c.marketDataUpdatedAt ? fmtKstMinute(c.marketDataUpdatedAt) : "시각 미확인"}<br/>수익 {end ? `${end} UTC 완료일` : "완료일 미확인"}</p></div>
    <details className="inline-evidence"><summary>계산 근거 · 집계 범위 · 자료 상태</summary>
      <p>{research?.description ?? c.descriptionKo ?? c.description ?? "프로젝트 설명 미확보"}</p>
      <p>{c.identityReason}{c.capitalExclusionReason && ` · ${c.capitalExclusionReason}`}</p>
      <p>제공처 기간 집계 참고 · 24h {fmtUsd(c.revenue24h)} · 7일 {fmtUsd(c.revenue7d)} · 30일 {fmtUsd(c.revenue30d)}. 완료일 이력과 범위가 다를 수 있어 이력이 부족한 배수의 대체값으로 쓰지 않습니다.</p>
      <div className="inline-periods">{REVENUE_WINDOWS.map(days => <div key={days}><b>{windowLabel(days)}</b><span>{c.revenueHistory?.periods[days]?.start ?? "–"} ~ {c.revenueHistory?.periods[days]?.end ?? "–"} UTC</span><span>P/R · {protocolReason(c, days, capital)}</span><span>P/HR · {holderReason(c, days, capital)}</span></div>)}</div>
      <p>수익과 환원은 DefiLlama 자료입니다. 완료된 UTC 하루는 한국 시간 오전 9시부터 다음 날 오전 9시까지입니다. 1년은 365일 합계이며, 증가율은 직전 동일 길이 기간과 비교합니다. 단기 연환산은 해당 기간의 속도를 비교하는 값이며 향후 수익 예측이 아닙니다.</p>
      <p>수익 수집 {c.revenueHistory ? fmtKstMinute(c.revenueHistory.observedAt) : "이력 미확보"} · 환원 수집 {c.holderHistory ? fmtKstMinute(c.holderHistory.observedAt) : "이력 미확보"}</p>
      {c.fundamentals.revenue.components.map(p => <p key={p.slug}><b>{p.slug} · {p.status === "matched" ? "정의 확인" : "정의 재검토 필요"}</b><br/>{p.definition ?? "정의 미확보"}{p.reviewNote && <><br/>{p.reviewNote}</>}</p>)}
      {c.holderValue.components.map(p => <p key={p.slug}><b>{p.name} · {holderEconomicTypeLabel(p.economicType)} · {p.eligible ? "P/HR 포함" : "P/HR 제외"}</b><br/>{p.reason} · {p.condition}</p>)}
      {c.sales && <ValuationEvidence coin={c} capital={capital}/>}
    </details>
  </section>;
}
