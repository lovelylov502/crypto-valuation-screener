"use client";

import { ArrowLeft, ArrowUpRight, CalendarDays, ChevronRight, ExternalLink, FileText, Info, LoaderCircle, RefreshCw, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { version as APP_VERSION } from "@/package.json";
import type { CoinScored } from "@/lib/types";
import type { CapitalBasis } from "@/lib/valuationMetrics";
import { defiLlamaUrl, marketLink, officialWebsite } from "@/lib/coinLinks";
import { koreanDetailDescription } from "@/lib/detailDescriptions";
import { protocolResearch } from "@/lib/protocolResearch";
import { referenceReview } from "@/lib/referenceMetrics";
import { fmtKstMinute, fmtMult, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { DETAIL_RANGES, DetailHistoryError, detailChartDomain, detailChartPoints, detailHistoryBounds, detailHistoryReason, detailObservationState, type DetailHistoryData, type DetailRange } from "@/lib/detailHistory";
import { loadCachedDetailHistory } from "@/lib/detailHistoryCache";
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

export function CoinDetailOverview({ coin: c, capital: initialCapital, onClose, publicationId, snapshotUpdatedAt, onRefreshPublication, favorite, onFavorite }: { coin: CoinScored; capital: CapitalBasis; onClose: () => void; publicationId?: string; snapshotUpdatedAt?: string; onRefreshPublication?: () => void; favorite?: boolean; onFavorite?: () => void }) {
  const [view, setView] = useState<"overview" | "research">("overview");
  const [originalOpen, setOriginalOpen] = useState(false);
  const [capital, setCapital] = useState(initialCapital);
  const [range, setRange] = useState<DetailRange>("MAX");
  const [now] = useState(() => new Date());
  const [retry, setRetry] = useState(0);
  const lastRetry = useRef(0);
  const [{ day: activeDay, chart: activeChart }, setActive] = useState<{ day: string | null; chart: "market" | "valuation" | null }>({ day: null, chart: null });
  const setChartDay = (chart: "market" | "valuation", day: string | null) => setActive(previous => day ? { day, chart } : previous.chart === chart ? { day: null, chart: null } : previous);
  const identity = c.geckoId ? `gecko:${c.geckoId}` : c.cmcId ? `cmc:${c.cmcId}` : "unlinked";
  const requestKey = JSON.stringify([c.slug, identity, publicationId, snapshotUpdatedAt, range, capital, retry]);
  const [history, setHistory] = useState<HistoryState>({ key: requestKey, status: "loading", count: 0 });
  const researchRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const force = retry !== lastRetry.current;
    lastRetry.current = retry;
    setHistory({ key: requestKey, status: "loading", count: 0 });
    setActive({ day: null, chart: null });
    void loadCachedDetailHistory({ slug: c.slug, identity, range, capital, signal: controller.signal, now, publicationId, snapshotUpdatedAt, force,
      onPage: count => { if (!controller.signal.aborted) setHistory({ key: requestKey, status: "loading", count }); },
    }).then(data => { if (!controller.signal.aborted) setHistory({ key: requestKey, status: "ready", data }); })
      .catch(error => { if (!controller.signal.aborted) setHistory({ key: requestKey, status: "error", error: error instanceof DetailHistoryError ? error : new DetailHistoryError(0, "이력을 불러오지 못했습니다.") }); });
    return () => controller.abort();
  }, [c.slug, identity, range, capital, now, requestKey, publicationId, snapshotUpdatedAt, retry]);
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
  const points = useMemo(() => detailChartPoints(data?.points ?? []), [data]);
  const domain = detailChartDomain(range, points, now);
  const displayDay = activeDay ?? data?.asOf;
  const selectedPoint = points.find(point => point.day === displayDay);
  const selectedHistory = data?.points.find(point => point.day === displayDay);
  const market = marketLink(c), llama = defiLlamaUrl(c), website = officialWebsite(c);
  const research = protocolResearch(c);
  const introduction = koreanDetailDescription(c.description) ?? c.descriptionKo ?? research?.description
    ?? (c.description ? "한글 번역을 준비 중입니다. 영문 원문을 확인해 주세요." : "프로젝트 소개 자료를 아직 확보하지 못했습니다.");
  const reviewRevenue = referenceReview(c, "revenue"), reviewHolders = referenceReview(c, "holders");
  const unknownEconomics = reviewRevenue !== "분류 검토 완료" || reviewHolders !== "분류 검토 완료";
  function openResearch(original = false) { setOriginalOpen(original); setView("research"); }
  function returnOverview() { setView("overview"); requestAnimationFrame(() => overviewRef.current?.focus({ preventScroll: true })); }
  function retryHistory() {
    if (state.status === "error" && state.error.status === 409 && onRefreshPublication) onRefreshPublication();
    setRetry(value => value + 1);
  }

  function legend(series: DetailChartSeries[]) {
    return <dl className="detail-chart-legend">{series.map(item => <div key={item.key}><dt><i style={{ borderColor: item.color, borderTopStyle: item.dashed ? "dashed" : "solid" }}/>{item.label}</dt><dd>{detailSeriesFormat(item.key, selectedPoint?.[item.key])}</dd></div>)}</dl>;
  }
  function chartState(valuation = false) {
    if (state.status === "loading") return <div className="detail-chart-state" role="status"><LoaderCircle size={22} className="detail-loading-icon"/><strong>이력을 불러오고 있습니다.</strong><span>{state.count ? `${state.count.toLocaleString("ko-KR")}개 날짜 확인 중` : "저장된 날짜별 자료를 조회합니다."}</span></div>;
    if (state.status === "error") return <div className="detail-chart-state" role="status"><Info size={23}/><strong>{state.error.status === 404 ? "저장된 이력이 없습니다." : state.error.status === 409 ? "이력 기준을 확인해 주세요." : "이력을 불러올 수 없습니다."}</strong><span>{state.error.status === 404 ? "현재 지표와 원천 자료는 핵심 지표와 자료 보기에서 확인할 수 있습니다." : state.error.status === 503 ? "이력 저장소 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요." : state.error.message}</span><button className="button" onClick={retryHistory}><RefreshCw size={13}/>다시 불러오기</button></div>;
    const available = valuation ? points.some(point => point.pr !== null || point.phr !== null) : points.some(point => point.price !== null || point.mcap !== null || point.fdv !== null);
    if (!available) return <div className="detail-chart-state"><Info size={22}/><strong>{valuation ? "이 기간의 참고 배수를 표시할 수 없습니다." : "선택한 기간에 저장된 시세가 없습니다."}</strong><span>{valuation ? "같은 날짜의 자본 값·하루 수익·토큰 연결을 확인한 날짜에 배수를 표시합니다." : "다른 기간을 선택하거나 자료 기준을 확인해 주세요."}</span>{valuation && selectedHistory && <small>P/R · {detailHistoryReason(selectedHistory.pr.reason)}<br/>P/HR · {detailHistoryReason(selectedHistory.phr.reason)}</small>}</div>;
    return null;
  }
  const requestedBounds = detailHistoryBounds(range, now);
  const rangeStart = range === "MAX" && points.length ? points[0].day : requestedBounds.from;
  const rangeEnd = range === "MAX" && points.length ? points.at(-1)!.day : requestedBounds.to;

  return <section className="detail-overview" aria-label={`${c.name} 상세 내용`}>
    <header className="detail-overview-header">
      <div className="detail-overview-identity">{c.logo && <img src={c.logo} alt="" width={48} height={48}/>}<div><h2>{c.name}</h2><span>{c.symbol ?? "토큰 미연결"}{c.chains.length > 0 && ` · ${c.chains.slice(0, 3).join(", ")}`}</span></div></div>
      <nav className="detail-overview-links" aria-label="프로젝트 외부 링크">
        {website ? <a className="button" href={website} target="_blank" rel="noreferrer">공식 홈페이지<ExternalLink size={13}/></a> : <button className="button" disabled title="공식 홈페이지 주소 미확인">공식 홈페이지 미확인</button>}
        <a className="button" href={llama} target="_blank" rel="noreferrer">DefiLlama<ExternalLink size={13}/></a>
        {market ? <a className="button" href={market.url} target="_blank" rel="noreferrer">{market.label}<ExternalLink size={13}/></a> : <button className="button" disabled title="확인된 CoinGecko ID 또는 CoinMarketCap 주소가 없습니다.">시세 페이지 미연결</button>}
      </nav>
      {onFavorite && <button className="icon-button detail-favorite" aria-pressed={favorite} aria-label={`${c.name} 관심종목 ${favorite ? "해제" : "추가"}`} title={favorite ? "관심종목에 저장됨" : "관심종목에 담기"} onClick={onFavorite}><Star size={18} fill={favorite ? "currentColor" : "none"}/></button>}
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
        <section className="detail-overview-revenue"><h3>일별 수익 · {displayDay ? `${displayDay} UTC` : "날짜 확인 중"}</h3><dl className="detail-revenue-list">
          <div><dt>Revenue</dt><dd>{fmtUsd(selectedHistory?.revenue.value)}</dd></div>{selectedHistory && selectedHistory.revenue.state !== "positive" && <small>{detailObservationState(selectedHistory.revenue)}</small>}
          <div><dt>Holders Revenue</dt><dd>{fmtUsd(selectedHistory?.holders.value)}</dd></div>{selectedHistory && selectedHistory.holders.state !== "positive" && <small>{detailObservationState(selectedHistory.holders)}</small>}
        </dl>{unknownEconomics && <button className="detail-economic-note" onClick={() => openResearch()}><Info size={12}/>분류 확인 필요 · 환원 조건 보기<ChevronRight size={12}/></button>}</section>
        <section className="detail-current-multiples" aria-label="같은 날짜의 일별 참고 배수"><dl className="detail-capital-pair"><div><dt>P/R</dt><dd className="detail-pr" title={selectedHistory?.pr.reason ? detailHistoryReason(selectedHistory.pr.reason) : undefined}>{fmtMult(selectedPoint?.pr)}</dd></div><div><dt>P/HR</dt><dd className="detail-phr" title={selectedHistory?.phr.reason ? detailHistoryReason(selectedHistory.phr.reason) : undefined}>{fmtMult(selectedPoint?.phr)}</dd></div></dl><p>{capital === "mcap" ? "시가총액" : "FDV"} ÷ (같은 날짜 하루 수익 × 365)</p></section>
        <div className="detail-rail-bottom">{!!c.dataQuality?.issues.length && <button className="detail-quality-note" onClick={() => openResearch()}><Info size={12}/>자료 확인 필요 · {c.dataQuality.issues.length}건</button>}
          <button className="detail-research-button" ref={overviewRef} onClick={() => openResearch()}><FileText size={14}/>자료 · 계산 근거<ArrowUpRight size={14}/></button></div>
      </aside>

      <div className="detail-chart-workspace">
        <div className="detail-chart-toolbar"><div className="detail-range-switch" role="group" aria-label="차트 표시 기간">{DETAIL_RANGES.map(item => <button key={item} aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}</div>
          <span className="detail-chart-date"><CalendarDays size={13}/>{range === "MAX" && !points.length ? "MAX · 저장된 전체 이력" : `${rangeStart.replaceAll("-", ".")} — ${rangeEnd.replaceAll("-", ".")}`}</span></div>
        <section className="detail-chart-card detail-market-chart" aria-label="가격·시가총액·FDV 이력">
          <header className="detail-chart-card-header"><h3>가격 · 시가총액 · FDV</h3>{legend(marketSeries)}</header>
          <div className="detail-chart-caption"><span>{displayDay ? `이력 ${displayDay} UTC` : "날짜별 관측값"}</span><span>FDV는 확인된 날짜만 표시</span></div>
          {chartState() ?? <DetailHistoryChart label="가격·시가총액·FDV 이력" points={points} historyPoints={data!.points} sources={data!.sources} capital={capital} series={marketSeries} domain={domain} activeDay={activeDay} onActiveDay={day => setChartDay("market", day)} showTooltip={activeChart === "market"}/>}
        </section>
        <section className="detail-chart-card detail-valuation-chart" aria-label="P/R·P/HR 이력">
          <header className="detail-chart-card-header"><h3>밸류에이션</h3>{legend(valuationSeries)}<div className="detail-valuation-controls"><div className="detail-capital-switch" role="group" aria-label="상세 배수 분자"><button aria-pressed={capital === "mcap"} onClick={() => setCapital("mcap")}>시가총액</button><button aria-pressed={capital === "fdv"} onClick={() => setCapital("fdv")}>FDV</button></div></div></header>
          <div className="detail-chart-caption"><span>{displayDay ? `이력 ${displayDay} UTC` : "날짜별 참고 배수"}</span><span>{capital === "mcap" ? "시가총액" : "FDV"} ÷ (같은 날짜 하루 수익 × 365)</span></div>
          {chartState(true) ?? <DetailHistoryChart label="P/R·P/HR 이력" points={points} historyPoints={data!.points} sources={data!.sources} capital={capital} series={valuationSeries} domain={domain} activeDay={activeDay} onActiveDay={day => setChartDay("valuation", day)} showTooltip={activeChart === "valuation"} valuation/>}
        </section>
        <footer className="detail-chart-footnote"><span>같은 UTC 날짜 기준 · 누락·집계 기준 변경 시 선 분리</span><button onClick={() => openResearch()}><Info size={12}/>자료 기준</button></footer>
      </div>
    </div> : <div className="detail-research-view" ref={researchRef} tabIndex={-1}>
      <div className="detail-research-toolbar"><button className="button" onClick={returnOverview}><ArrowLeft size={14}/>차트로 돌아가기</button><span>수익 분류 · 환원 조건 · 원천 자료 · 계산 근거</span></div>
      <section className="detail-history-provenance"><h3>차트의 날짜와 자료 기준</h3>
        <p>P/R은 UTC 날짜 D의 확인된 FDV 또는 시가총액을 같은 날짜 하루의 Revenue × 365로 나누어 계산합니다. P/HR은 같은 날짜의 Holders Revenue × 365를 분모로 사용합니다. 완료되지 않은 UTC 날짜와 확인하지 못한 값은 배수에서 제외합니다. 과거 수익에는 제공처의 수정이 반영될 수 있습니다.</p>
        <p>일 마감 시세는 다음 날 00:00 UTC에 관측될 수 있습니다. 실제 수집 시세는 해당 관측 시각을 표시하며, 가격·시총·FDV의 시각을 각각 보존합니다. 누락·부분 자료·원천 충돌로 배수를 계산하지 못한 구간과 수익 집계 기준이 바뀐 날짜에서는 선을 나누어 표시합니다.</p>
        <p>7D·1M·3M·YTD·1Y·MAX는 표시 기간만 바꿉니다. 분모는 항상 해당 날짜 하루 수익 × 365입니다. 현재 가격·시총·FDV는 최신 공개본의 관측값이며, 날짜별 차트와 관측 시각이 다를 수 있습니다. 아래 기간별 연구 자료는 최신 공개본 기준으로 따로 표시합니다.</p>
        {data ? <><dl className="detail-provenance-grid"><div><dt>표시 중인 이력</dt><dd>{data.points[0]?.day ?? "미확보"} ~ {data.points.at(-1)?.day ?? "미확보"} UTC · {data.points.length.toLocaleString("ko-KR")}개 날짜</dd></div><div><dt>조회 기준일</dt><dd>{data.asOf} UTC</dd></div><div><dt>계산 기준</dt><dd>{data.calculationVersion}</dd></div><div><dt>연결한 공개본</dt><dd>{String(data.asset.snapshotId ?? "미확인")}</dd></div></dl>
          {selectedHistory && <p>이력 {selectedHistory.day} UTC · 가격 관측 {selectedHistory.price.at ? fmtKstMinute(selectedHistory.price.at) : "미확인"} · 시총 관측 {selectedHistory.mcap.at ? fmtKstMinute(selectedHistory.mcap.at) : "미확인"} · FDV 관측 {selectedHistory.fdv.at ? fmtKstMinute(selectedHistory.fdv.at) : "미확인"}</p>}
          <details className="detail-history-source-list"><summary>차트 원천 응답 {data.sources.length}개</summary><ul>{data.sources.map(source => <li key={source.key}><a href={source.url} target="_blank" rel="noreferrer">{source.provider} · {source.metric}<ExternalLink size={12}/></a><span>{source.scope} · {source.definition} · {source.basis}</span><span>관측 {fmtKstMinute(source.observedAt)}{source.archiveUrl && <> · <a href={source.archiveUrl} target="_blank" rel="noreferrer">보존 원본</a></>}</span></li>)}</ul></details></> : <p>{state.status === "error" ? state.error.message : "이력을 불러오는 중입니다."} 현재 지표의 원천과 계산 근거는 아래에서 확인할 수 있습니다.</p>}
      </section>
      <InlineCoinDetail coin={c} capital={capital} onClose={onClose} hideHeader openOriginal={originalOpen}/>
    </div>}
    <footer className="detail-overview-footer"><span aria-label="앱 버전">v{APP_VERSION}</span><span>{view === "overview" ? "최신 지표와 날짜별 이력은 관측 시각이 다를 수 있습니다." : "원천 참고 배수 · 분류와 수령 조건은 별도 확인"}</span></footer>
  </section>;
}
