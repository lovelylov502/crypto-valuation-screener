"use client";

import { ArrowLeft, ArrowUpRight, CalendarDays, ChevronRight, ExternalLink, FileText, Info, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { version as APP_VERSION } from "@/package.json";
import type { CoinScored } from "@/lib/types";
import type { CapitalBasis } from "@/lib/valuationMetrics";
import { REVENUE_WINDOWS, type RevenueWindowDays } from "@/lib/revenueHistory";
import { defiLlamaUrl, marketLink, officialWebsite } from "@/lib/coinLinks";
import { koreanDetailDescription } from "@/lib/detailDescriptions";
import { protocolResearch } from "@/lib/protocolResearch";
import { referenceMultiple, referenceReading, referenceReason, referenceReview } from "@/lib/referenceMetrics";
import { fmtKstMinute, fmtMult, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { DETAIL_RANGES, DetailHistoryError, detailChartDomain, detailChartPoints, detailHistoryBounds, detailHistoryReason, loadDetailHistory, type DetailHistoryData, type DetailRange } from "@/lib/detailHistory";
import { DetailHistoryChart, detailSeriesFormat, type DetailChartSeries } from "./DetailHistoryChart";
import { InlineCoinDetail, tone } from "./InlineCoinDetail";

const marketSeries: DetailChartSeries[] = [
  { key: "price", label: "가격", color: "var(--detail-price)", axis: "left" },
  { key: "mcap", label: "시가총액", color: "var(--detail-market)", axis: "right" },
  { key: "fdv", label: "FDV", color: "var(--detail-fdv)", axis: "right", dashed: true },
];
const valuationSeries: DetailChartSeries[] = [
  { key: "pr", label: "P/R", color: "var(--detail-market)", axis: "left" },
  { key: "phr", label: "P/HR", color: "var(--detail-holder)", axis: "left" },
];
type HistoryState = { key: string; status: "loading"; count: number } | { key: string; status: "ready"; data: DetailHistoryData }
  | { key: string; status: "error"; error: DetailHistoryError };
const INTRO_PREVIEW_LENGTH = 50;
const shortDescription = (text: string) => text.length > INTRO_PREVIEW_LENGTH ? `${text.slice(0, INTRO_PREVIEW_LENGTH - 3).trimEnd()}…` : text;
const revenueWindowLabel = (days: number) => days === 1 ? "24시간" : days === 365 ? "1년" : `${days}일`;

export function CoinDetailOverview({ coin: c, capital: initialCapital, onClose }: { coin: CoinScored; capital: CapitalBasis; onClose: () => void }) {
  const [view, setView] = useState<"overview" | "research">("overview");
  const [originalOpen, setOriginalOpen] = useState(false);
  const [capital, setCapital] = useState(initialCapital);
  const [range, setRange] = useState<DetailRange>("MAX");
  const [days, setDays] = useState<RevenueWindowDays>(30);
  const [now] = useState(() => new Date());
  const [retry, setRetry] = useState(0);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const identity = c.geckoId ? `gecko:${c.geckoId}` : c.cmcId ? `cmc:${c.cmcId}` : "unlinked";
  const requestKey = `${c.slug}:${identity}:${range}:${days}:${retry}`;
  const [history, setHistory] = useState<HistoryState>({ key: requestKey, status: "loading", count: 0 });
  const researchRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setHistory({ key: requestKey, status: "loading", count: 0 });
    setActiveDay(null);
    void loadDetailHistory({ slug: c.slug, identity, range, days, signal: controller.signal, now,
      onPage: count => { if (!controller.signal.aborted) setHistory({ key: requestKey, status: "loading", count }); },
    }).then(data => { if (!controller.signal.aborted) setHistory({ key: requestKey, status: "ready", data }); })
      .catch(error => { if (!controller.signal.aborted) setHistory({ key: requestKey, status: "error", error: error instanceof DetailHistoryError ? error : new DetailHistoryError(0, "이력을 불러오지 못했습니다.") }); });
    return () => controller.abort();
  }, [c.slug, identity, range, days, now, requestKey]);
  useEffect(() => {
    if (view !== "research") return;
    researchRef.current?.focus({ preventScroll: true });
    if (originalOpen) {
      const original = document.getElementById("detail-description-original");
      original?.scrollIntoView({ block: "start" });
      original?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    }
  }, [view, originalOpen]);

  const state = history.key === requestKey ? history : { key: requestKey, status: "loading" as const, count: 0 };
  const data = state.status === "ready" ? state.data : null;
  const points = useMemo(() => detailChartPoints(data?.points ?? [], capital, data?.asset.reconciliationState === "updating"), [data, capital]);
  const domain = detailChartDomain(range, points, now);
  const selectedPoint = activeDay ? points.find(point => point.day === activeDay) : points.at(-1);
  const selectedHistory = activeDay ? data?.points.find(point => point.day === activeDay) : data?.points.at(-1);
  const displayDay = activeDay ?? points.at(-1)?.day;
  const market = marketLink(c), llama = defiLlamaUrl(c), website = officialWebsite(c);
  const research = protocolResearch(c);
  const introduction = koreanDetailDescription(c.description) ?? c.descriptionKo ?? research?.description
    ?? (c.description ? "한글 번역을 준비 중입니다. 영문 원문을 확인해 주세요." : "프로젝트 소개 자료를 아직 확보하지 못했습니다.");
  const revenue = referenceReading(c, "revenue", days), holders = referenceReading(c, "holders", days);
  const pr = referenceMultiple(c, "revenue", days, capital), phr = referenceMultiple(c, "holders", days, capital);
  const reviewRevenue = referenceReview(c, "revenue"), reviewHolders = referenceReview(c, "holders");
  const unknownEconomics = reviewRevenue !== "분류 검토 완료" || reviewHolders !== "분류 검토 완료";
  function openResearch(original = false) { setOriginalOpen(original); setView("research"); }
  function returnOverview() { setView("overview"); requestAnimationFrame(() => overviewRef.current?.focus({ preventScroll: true })); }

  function legend(series: DetailChartSeries[]) {
    return <dl className="detail-chart-legend">{series.map(item => <div key={item.key}><dt><i style={{ borderColor: item.color, borderTopStyle: item.dashed ? "dashed" : "solid" }}/>{item.label}</dt><dd>{detailSeriesFormat(item.key, selectedPoint?.[item.key])}</dd></div>)}</dl>;
  }
  function chartState(valuation = false) {
    if (state.status === "loading") return <div className="detail-chart-state" role="status"><LoaderCircle size={22} className="detail-loading-icon"/><strong>이력을 불러오고 있습니다.</strong><span>{state.count ? `${state.count.toLocaleString("ko-KR")}개 날짜 확인 중` : "저장된 날짜별 자료를 조회합니다."}</span></div>;
    if (state.status === "error") return <div className="detail-chart-state" role="status"><Info size={23}/><strong>{state.error.status === 404 ? "저장된 이력이 없습니다." : state.error.status === 409 ? "이력의 토큰 연결을 확인하고 있습니다." : "이력을 불러올 수 없습니다."}</strong><span>{state.error.status === 404 ? "현재 지표와 원천 자료는 핵심 지표와 자료 보기에서 확인할 수 있습니다." : state.error.status === 503 ? "이력 저장소 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요." : state.error.message}</span><button className="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={13}/>다시 불러오기</button></div>;
    const available = valuation ? points.some(point => point.pr !== null || point.phr !== null) : points.some(point => point.price !== null || point.mcap !== null || point.fdv !== null);
    if (!available && valuation && (data?.asset.reconciliationState === "updating" || data?.points.some(point => point.valuationState === "updating")))
      return <div className="detail-chart-state" role="status"><RefreshCw size={22}/><strong>배수를 갱신 중입니다.</strong><span>원천 자료와 저장된 계산값을 대조하고 있습니다.</span><button className="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={13}/>다시 불러오기</button></div>;
    if (!available) return <div className="detail-chart-state"><Info size={22}/><strong>{valuation ? "이 기간의 참고 배수를 표시할 수 없습니다." : "선택한 기간에 저장된 시세가 없습니다."}</strong><span>{valuation ? "수익 금액·완료 기간·토큰 연결의 확인 상태를 자료 보기에서 확인해 주세요." : "다른 기간을 선택하거나 자료 기준을 확인해 주세요."}</span>{valuation && selectedHistory && <small>P/R · {selectedHistory[capital] === null ? `${capital === "fdv" ? "FDV" : "시가총액"} 미확인` : detailHistoryReason(selectedHistory.valuation?.revenueReason)}<br/>P/HR · {selectedHistory[capital] === null ? `${capital === "fdv" ? "FDV" : "시가총액"} 미확인` : detailHistoryReason(selectedHistory.valuation?.holderReason)}</small>}</div>;
    return null;
  }
  const requestedBounds = detailHistoryBounds(range, now);
  const rangeStart = range === "MAX" && points.length ? points[0].day : requestedBounds.from;
  const rangeEnd = range === "MAX" && points.length ? points.at(-1)!.day : requestedBounds.to;
  const readingBadge = (basis: string) => basis === "provider_total" ? "제공처 집계" : basis === "provider_partial" ? "부분 집계" : null;

  return <section className="detail-overview" aria-label={`${c.name} 상세 내용`}>
    <header className="detail-overview-header">
      <div className="detail-overview-identity">{c.logo && <img src={c.logo} alt="" width={48} height={48}/>}<div><h2>{c.name}</h2><span>{c.symbol ?? "토큰 미연결"}{c.chains.length > 0 && ` · ${c.chains.slice(0, 3).join(", ")}`}</span></div></div>
      <nav className="detail-overview-links" aria-label="프로젝트 외부 링크">
        {website ? <a className="button" href={website} target="_blank" rel="noreferrer">공식 홈페이지<ExternalLink size={13}/></a> : <button className="button" disabled title="공식 홈페이지 주소 미확인">공식 홈페이지 미확인</button>}
        <a className="button" href={llama} target="_blank" rel="noreferrer">DefiLlama<ExternalLink size={13}/></a>
        {market ? <a className="button" href={market.url} target="_blank" rel="noreferrer">{market.label}<ExternalLink size={13}/></a> : <button className="button" disabled title="확인된 CoinGecko ID 또는 CoinMarketCap 주소가 없습니다.">시세 페이지 미연결</button>}
      </nav>
      <button data-detail-close onClick={onClose} className="icon-button detail-overview-close" aria-label={`${c.name} 상세 닫기`}><X size={22}/></button>
    </header>

    {view === "overview" ? <div className="detail-overview-body">
      <aside className="detail-overview-summary" aria-label="프로젝트 소개와 최신 지표">
        <section className="detail-overview-intro"><h3>어떤 프로젝트인가요?</h3><p>{shortDescription(introduction)}</p><div className="detail-intro-actions"><span>{koreanDetailDescription(c.description) ?? c.descriptionKo ? "DefiLlama 소개 번역" : research ? "공식 자료 검토" : "프로젝트 소개"}</span>{c.description && <button onClick={() => openResearch(true)}>영문 원문 보기</button>}{introduction.length > INTRO_PREVIEW_LENGTH && <button onClick={() => openResearch()}>소개 더 보기</button>}</div></section>
        <section className="detail-overview-core"><div className="detail-rail-title"><h3>핵심 지표</h3><span>최신 공개본</span></div>
          <div className="detail-current-price"><span>현재 가격</span><strong>{fmtPrice(c.price)}</strong><div><span>24시간 <b className={tone(c.change1d)}>{fmtPct(c.change1d)}</b></span><span>7일 <b className={tone(c.priceChange7d)}>{fmtPct(c.priceChange7d)}</b></span></div></div>
          <dl className="detail-capital-pair"><div><dt>시가총액</dt><dd>{fmtUsd(c.mcap)}</dd></div><div><dt>FDV</dt><dd>{fmtUsd(c.fdv)}</dd></div></dl>
          <p className="detail-quote-time">시세 {c.marketDataUpdatedAt ? fmtKstMinute(c.marketDataUpdatedAt) : "관측 시각 미확인"}</p>
        </section>
        <section className="detail-overview-revenue"><h3>수익 · 최근 {revenueWindowLabel(days)}</h3><dl className="detail-revenue-list">
          <div><dt>Revenue</dt><dd>{fmtUsd(revenue.amount)}</dd></div>{readingBadge(revenue.basis) && <small>{readingBadge(revenue.basis)}</small>}
          <div><dt>Holders Revenue</dt><dd>{fmtUsd(holders.amount)}</dd></div>{readingBadge(holders.basis) && <small>{readingBadge(holders.basis)}</small>}
        </dl>{unknownEconomics && <button className="detail-economic-note" onClick={() => openResearch()}><Info size={12}/>분류 확인 필요 · 환원 조건 보기<ChevronRight size={12}/></button>}</section>
        <section className="detail-current-multiples" aria-label="최신 공개본 참고 배수"><dl className="detail-capital-pair"><div><dt>P/R</dt><dd className="detail-pr" title={referenceReason(c, "revenue", days, capital)}>{fmtMult(pr)}</dd></div><div><dt>P/HR</dt><dd className="detail-phr" title={referenceReason(c, "holders", days, capital)}>{fmtMult(phr)}</dd></div></dl><p>{capital === "mcap" ? "시가총액" : "FDV"} 기준 · {days === 365 ? "원천 1년 금액" : `${days}일 연환산`}</p></section>
        <div className="detail-rail-bottom">{!!c.dataQuality?.issues.length && <button className="detail-quality-note" onClick={() => openResearch()}><Info size={12}/>자료 확인 필요 · {c.dataQuality.issues.length}건</button>}
          <button className="detail-research-button" ref={overviewRef} onClick={() => openResearch()}><FileText size={14}/>자료 · 계산 근거<ArrowUpRight size={14}/></button></div>
      </aside>

      <div className="detail-chart-workspace">
        <div className="detail-chart-toolbar"><div className="detail-range-switch" role="group" aria-label="차트 표시 기간">{DETAIL_RANGES.map(item => <button key={item} aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}</div>
          <span className="detail-chart-date"><CalendarDays size={13}/>{range === "MAX" && !points.length ? "MAX · 저장된 전체 이력" : `${rangeStart.replaceAll("-", ".")} — ${rangeEnd.replaceAll("-", ".")}`}</span></div>
        <section className="detail-chart-card detail-market-chart" aria-label="가격·시가총액·FDV 이력">
          <header className="detail-chart-card-header"><h3>가격 · 시가총액 · FDV</h3>{legend(marketSeries)}</header>
          <div className="detail-chart-caption"><span>{displayDay ? `이력 ${displayDay} UTC` : "날짜별 관측값"}</span><span>FDV는 확인된 날짜만 표시</span></div>
          {chartState() ?? <DetailHistoryChart label="가격·시가총액·FDV 이력" points={points} historyPoints={data!.points} days={days} series={marketSeries} domain={domain} activeDay={activeDay} onActiveDay={setActiveDay}/>}
        </section>
        <section className="detail-chart-card detail-valuation-chart" aria-label="P/R·P/HR 이력">
          <header className="detail-chart-card-header"><h3>밸류에이션</h3>{legend(valuationSeries)}<div className="detail-valuation-controls"><div className="detail-capital-switch" role="group" aria-label="상세 배수 분자"><button aria-pressed={capital === "mcap"} onClick={() => setCapital("mcap")}>시가총액</button><button aria-pressed={capital === "fdv"} onClick={() => setCapital("fdv")}>FDV</button></div><label>수익 기준<select aria-label="수익 집계 기간" value={days} onChange={event => setDays(Number(event.target.value) as RevenueWindowDays)}>{REVENUE_WINDOWS.map(value => <option key={value} value={value}>{value === 365 ? "365일 합계" : `${revenueWindowLabel(value)} 연환산`}</option>)}</select></label></div></header>
          <div className="detail-chart-caption"><span>{displayDay ? `이력 ${displayDay} UTC` : "날짜별 참고 배수"}</span><span>{capital === "mcap" ? "시가총액" : "FDV"} ÷ {days === 365 ? "직전 365일 수익" : `직전 ${days}일 수익 연환산`}</span></div>
          {chartState(true) ?? <DetailHistoryChart label="P/R·P/HR 이력" points={points} historyPoints={data!.points} days={days} series={valuationSeries} domain={domain} activeDay={activeDay} onActiveDay={setActiveDay} valuation/>}
        </section>
        <footer className="detail-chart-footnote"><span>시세 원천 · DefiLlama 수익 · 없는 날짜는 빈 구간으로 표시</span><button onClick={() => openResearch()}><Info size={12}/>자료 기준</button></footer>
      </div>
    </div> : <div className="detail-research-view" ref={researchRef} tabIndex={-1}>
      <div className="detail-research-toolbar"><button className="button" onClick={returnOverview}><ArrowLeft size={14}/>차트로 돌아가기</button><span>수익 분류 · 환원 조건 · 원천 자료 · 계산 근거</span></div>
      <section className="detail-history-provenance"><h3>차트의 날짜와 자료 기준</h3>
        <p>UTC 날짜 D의 시세와 D−1까지 완료된 직전 {days}일 수익을 사용합니다. 요약의 핵심 지표는 최신 공개본이며, 차트의 마지막 날짜·시세 시각과 다를 수 있습니다. 과거 수익은 제공처의 수정이 반영될 수 있습니다.</p>
        <p>가격·시총은 UTC 자정의 이력 또는 실제 수집 시각의 시세입니다. FDV는 별도 관측 시각을 보존하며, 확인한 날짜에만 표시합니다. 날짜가 빠졌거나 배수를 계산하지 못한 구간은 선을 연결하지 않습니다.</p>
        <p>7D·1M·3M·YTD·1Y·MAX는 차트 표시 기간입니다. 수익 집계 기간은 별도 선택하며, 기본값은 30일 연환산입니다. 차트의 365일 배수는 완료된 365일 합계를 사용합니다. 최신 공개본의 제공처 1년 금액과 확보 범위가 다를 수 있습니다.</p>
        {data ? <><dl className="detail-provenance-grid"><div><dt>표시 중인 이력</dt><dd>{data.points[0]?.day ?? "미확보"} ~ {data.points.at(-1)?.day ?? "미확보"} UTC · {data.points.length.toLocaleString("ko-KR")}개 날짜</dd></div><div><dt>전체 저장 시세 범위</dt><dd>{String(data.asset.marketFrom ?? "미확보")} ~ {String(data.asset.marketTo ?? "미확보")}</dd></div><div><dt>계산 기준</dt><dd>{data.calculationVersion}</dd></div><div><dt>연결한 공개본</dt><dd>{String(data.asset.snapshotId ?? "미확인")}</dd></div></dl>
          {selectedHistory && <p>이력 {selectedHistory.day} UTC · 가격·시총 관측 {fmtKstMinute(selectedHistory.marketAt)} ({selectedHistory.basis === "utc_midnight" ? "UTC 자정 이력" : "수집 시세"}) · FDV 관측 {selectedHistory.fdvAt ? fmtKstMinute(selectedHistory.fdvAt) : "미확인"}{selectedHistory.valuationState === "updating" && " · 배수 갱신 중"}</p>}
          <details className="detail-history-source-list"><summary>차트 원천 응답 {data.sources.length}개</summary><ul>{data.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.url}<ExternalLink size={12}/></a><span>관측 {fmtKstMinute(source.observedAt)} · <a href={source.archiveUrl} target="_blank" rel="noreferrer">보존 원본</a></span></li>)}</ul></details></> : <p>{state.status === "error" ? state.error.message : "이력을 불러오는 중입니다."} 현재 지표의 원천과 계산 근거는 아래에서 확인할 수 있습니다.</p>}
      </section>
      <InlineCoinDetail coin={c} capital={capital} onClose={onClose} hideHeader openOriginal={originalOpen}/>
    </div>}
    <footer className="detail-overview-footer"><span aria-label="앱 버전">v{APP_VERSION}</span><span>{view === "overview" ? "최신 지표와 날짜별 이력은 관측 시각이 다를 수 있습니다." : "원천 참고 배수 · 분류와 수령 조건은 별도 확인"}</span></footer>
  </section>;
}
