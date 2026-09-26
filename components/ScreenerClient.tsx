"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Download, Info, RefreshCw, RotateCcw, Search, SlidersHorizontal, Star, X } from "lucide-react";
import type { CoinScored } from "@/lib/types";
import type { ScreenerPage } from "@/lib/screenerQuery";
import { fmtKstMinute, fmtMult, fmtUsd } from "@/lib/format";
import { parseFavoriteSlugs, serializeFavoriteSlugs } from "@/lib/screenerFilters";
import { DEFAULT_VISIBLE_COLUMNS, SCREENER_COLUMNS as COLS, REVENUE_COLUMN_DAYS, columnBand, type SortKey } from "@/lib/screenerColumns";
import { defaultPreferences, parseWorkspace, resetWorkspaceFilters, withVisibleColumns, workspaceMigrationNotice, WORKSPACE_KEY, type WorkspacePreferences } from "@/lib/workspacePreferences";
import { protocolMultiple, protocolReason, holderMultiple, holderReason } from "@/lib/valuationMetrics";
import { renderCell } from "./ScreenerCells";
import { UsdRangeFilter } from "./RangeFilters";
import { Pagination } from "./Pagination";
import { PAGE_SIZE_KEY, parsePageSize } from "@/lib/pagination";
import { useWindowTableHeader } from "./useWindowTableHeader";
import { SettingsDialog } from "./SettingsDialog";
import { AVAILABILITY_LABELS, METRIC_WINDOWS, METRIC_COLUMN_DAYS, windowLabel, type AvailableMetric } from "@/lib/metricCoverage";
import { DataGuide } from "./DataGuide";
import { DisplaySettings } from "./DisplaySettings";
import { InlineCoinDetail, signedUsd, tone } from "./InlineCoinDetail";
import { pageUrl, useScreenerPage } from "./useScreenerPage";
import { growthLabel, revenueTrend } from "@/lib/revenueTrend";

const FAVORITES_KEY = "crypto-valuation-favorites-v1";

export function ScreenerClient({ initialData }: { initialData: ScreenerPage | null }) {
  const [prefs, setPrefs] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [popup, setPopup] = useState<"filters" | "columns" | "coverage" | null>(null);
  const [status, setStatus] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const tableRef = useWindowTableHeader();
  const { data, refreshing, refresh, error, checkedAt } = useScreenerPage(initialData, prefs, favorites, page, pageSize, ready);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_KEY);
      setPrefs(parseWorkspace(raw)); setMigrationNotice(workspaceMigrationNotice(raw));
      setFavorites(parseFavoriteSlugs(localStorage.getItem(FAVORITES_KEY)));
      setPageSize(parsePageSize(localStorage.getItem(PAGE_SIZE_KEY)));
    } catch { setStorageError(true); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(prefs));
      localStorage.setItem(FAVORITES_KEY, serializeFavoriteSlugs(favorites));
      localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
    } catch { setStorageError(true); }
  }, [ready, prefs, favorites, pageSize]);
  useEffect(() => {
    const element = tableRef.current;
    if (!element) return;
    const measure = () => element.style.setProperty("--table-viewport", `${element.clientWidth}px`);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [tableRef]);

  const update = <K extends keyof WorkspacePreferences,>(key: K, value: WorkspacePreferences[K]) => { setPrefs(p => ({ ...p, [key]: value })); setPage(1); };
  const toggleFavorite = (slug: string) => setFavorites(prev => { const next = new Set(prev); if (next.has(slug)) next.delete(slug); else next.add(slug); return next; });
  const resetFilters = () => { setPrefs(resetWorkspaceFilters); setPage(1); };
  const onSort = (key: SortKey) => { setPrefs(p => ({ ...p, sortKey: key, sortDir: p.sortKey === key ? p.sortDir === "asc" ? "desc" : "asc" : METRIC_COLUMN_DAYS[key] || key === "name" ? "asc" : "desc" })); setPage(1); };
  const closeDetail = (slug: string) => { setSelectedSlug(null); rowButtons.current.get(slug)?.focus({ preventScroll: true }); };
  const goPage = (n: number) => { setPage(n); setSelectedSlug(null); resultsRef.current?.scrollIntoView({ block: "start" }); };
  const selectedCols = prefs.columns.map(k => COLS.find(c => c.key === k)!).filter(Boolean);
  const bands: { label: string; count: number; start: number }[] = [];
  selectedCols.forEach((col, i) => { const label = columnBand(col.key); if (bands.at(-1)?.label === label) bands[bands.length - 1].count++; else bands.push({ label, count: 1, start: i }); });
  const activeFilters = [!!prefs.search, prefs.view !== "all", prefs.growingOnly, prefs.holderOnly, !!prefs.category, prefs.available !== "all", prefs.minMcap > 0 || prefs.maxMcap > 0, prefs.maxPr > 0, prefs.maxPhr > 0, prefs.hideDilution, prefs.verifiedOnly].filter(Boolean).length;
  const capitalName = prefs.capital === "mcap" ? "유통 시총" : "FDV";
  const rows = data?.coins ?? [];
  const total = data?.pagination.filtered ?? 0;
  const currentPage = data?.pagination.page ?? 1;
  const coverage = data?.coverage;
  const stale = data && Date.now() - Date.parse(data.updatedAt) > 12 * 3600000;
  const sourceFailures = data?.sources.filter(s => s.status === "error").length ?? 0;
  const sortIcon = (key: SortKey) => prefs.sortKey === key ? prefs.sortDir === "asc" ? <ArrowUp size={12}/> : <ArrowDown size={12}/> : null;

  const cell = (c: CoinScored, key: SortKey) => {
    const revenueDays = REVENUE_COLUMN_DAYS[key as keyof typeof REVENUE_COLUMN_DAYS];
    if (revenueDays) {
      const trend = revenueTrend(c, revenueDays);
      return <span className="revenue-reading" title={`직전 ${windowLabel(revenueDays)} ${fmtUsd(trend.previous)} · 증가액 ${signedUsd(trend.delta)}${c.revenueHistory ? " · 완료 UTC 날짜" : " · 제공처 기간 집계"}`}><strong>{fmtUsd(trend.current)}</strong><small className={tone(trend.delta)}>{prefs.revenueSort === "delta" ? signedUsd(trend.delta) : growthLabel(trend)}</small></span>;
    }
    const days = METRIC_COLUMN_DAYS[key];
    if (days) {
      const holder = key.startsWith("phr");
      const value = holder ? holderMultiple(c, days, prefs.capital) : protocolMultiple(c, days, prefs.capital);
      const reason = holder ? holderReason(c, days, prefs.capital) : protocolReason(c, days, prefs.capital);
      return <span className={value === null ? "unavailable-metric" : "ratio-reading"} title={reason}>{fmtMult(value)}{value === null && <span className="sr-only"> · {reason}</span>}</span>;
    }
    return renderCell(c, key, prefs.capital);
  };

  const exportResults = async () => {
    setExporting(true); setStatus("전체 검색 결과를 모으고 있습니다.");
    try {
      const coins: CoinScored[] = []; let at: string | undefined;
      for (let p = 1; ; p++) {
        const response = await fetch(pageUrl(prefs, favorites, p, 100), { cache: "no-store", signal: AbortSignal.timeout(90000) });
        if (!response.ok) throw new Error("내보낼 자료를 가져오지 못했습니다.");
        const next = await response.json() as ScreenerPage;
        if (at && at !== next.updatedAt) throw new Error("수집 자료가 갱신되었습니다. 다시 내보내 주세요.");
        at = next.updatedAt; coins.push(...next.coins);
        if (coins.length >= next.pagination.filtered) break;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify({ updatedAt: at, preferences: prefs, coins })], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "screener-results.json"; a.click(); URL.revokeObjectURL(url);
      setStatus(`${coins.length}개 검색 결과를 내보냈습니다.`);
    } catch (e) { setStatus(e instanceof Error ? e.message : "내보내기 실패"); }
    finally { setExporting(false); }
  };

  return <main className="research-app valuation-workspace scan-workspace">
    <a className="skip-link" href="#screener-results">결과 표로 이동</a>
    <header className="valuation-header">
      <div className="brand-mark" aria-hidden="true">V</div><div className="brand-title"><h1>크립토 밸류 스캐너</h1><p>수익 배수 · 성장 · 홀더 환원</p></div>
      <div className="header-actions"><span className="header-status">{data ? fmtKstMinute(data.updatedAt) : "자료 준비 중"}{stale ? " · 갱신 필요" : sourceFailures ? " · 일부 자료 미수집" : ""}</span><button className="icon-button" aria-label="최신 자료 확인" title="최신 자료 확인" disabled={refreshing} onClick={refresh}><RefreshCw size={16} className={refreshing ? "spinning" : ""}/></button><button className="icon-button" aria-label="지표 안내" title="지표 안내" onClick={() => setSourceOpen(true)}><Info size={17}/></button></div>
    </header>
    {data && <p className="mobile-data-status" role="status">{fmtKstMinute(data.updatedAt)}{stale ? " · 갱신 필요" : sourceFailures ? " · 일부 자료 미수집" : " · 수집 완료"}</p>}
    {error && <div className="workspace-status" role="alert">{error} {data && "기존 결과를 표시하고 있습니다."}<button className="text-button" onClick={refresh}>다시 시도</button></div>}
    {storageError && <p className="notice">브라우저 저장소를 사용할 수 없어 설정·관심종목이 유지되지 않을 수 있습니다.</p>}
    {migrationNotice && <div className="migration-notice" role="status"><Info size={15}/><span>{migrationNotice}</span><button className="icon-button" aria-label="설정 변경 안내 닫기" onClick={() => setMigrationNotice(null)}><X size={16}/></button></div>}
    <div className="scan-toolbar">
      <h2>DefiLlama 전체 종목</h2>
      <label className="search-box"><Search size={18}/><input aria-label="코인 또는 심볼 검색" placeholder="코인 검색" value={prefs.search} onChange={e => update("search", e.target.value)}/>{prefs.search && <button aria-label="검색 지우기" onClick={() => update("search", "")}><X size={15}/></button>}</label>
      <button className="icon-button watchlist-toggle" aria-label="관심종목만 보기" aria-pressed={prefs.view === "favorites"} title="관심종목만 보기" onClick={() => update("view", prefs.view === "favorites" ? "all" : "favorites")}><Star size={17} fill={prefs.view === "favorites" ? "currentColor" : "none"}/>{favorites.size > 0 && <small>{favorites.size}</small>}</button>
      <div className="capital-switch"><span>배수 기준</span><div className="choice-buttons" role="group" aria-label="배수 분자"><button aria-pressed={prefs.capital === "mcap"} onClick={() => update("capital", "mcap")}>유통 시총</button><button aria-pressed={prefs.capital === "fdv"} onClick={() => update("capital", "fdv")}>FDV</button></div></div>
      <button className="icon-button" aria-label="필터" title="필터" onClick={() => setPopup("filters")}><SlidersHorizontal size={18}/>{activeFilters > 0 && <small>{activeFilters}</small>}</button>
      <button className="button" onClick={() => setPopup("columns")}><Columns3 size={16}/>열 표시<ChevronDown size={13}/></button>
    </div>
    <div className="scan-meta" ref={resultsRef} id="screener-results" tabIndex={-1}>
      <button className="text-button" onClick={() => setPopup("coverage")}><span>프로젝트 {data?.pagination.total.toLocaleString() ?? "–"}개</span><span>·</span><span>연결 토큰 {data?.universe.linkedTokens.toLocaleString() ?? "–"}개</span><Info size={12}/></button>
      <span role="status">{refreshing ? "조회 중…" : `${total.toLocaleString()}개 표시 대상`}{prefs.view === "favorites" ? " · 관심종목" : ""}</span>
      {activeFilters > 0 && <button className="text-button" onClick={resetFilters}>조건 {activeFilters}개 해제<X size={12}/></button>}
    </div>
    <div ref={tableRef} className="table-scroll scan-table-scroll thin-scroll" role="region" aria-label="프로토콜 비교 표 · 가로 스크롤 가능" tabIndex={0} aria-busy={refreshing}>
      <table className="screener-table scan-table"><caption className="sr-only">프로토콜 수익 배수, 수익 성장, 홀더 환원 비교. 종목을 누르면 행 아래 상세를 엽니다. 빈 값은 0이 아닙니다.</caption>
        <thead><tr><th className="coin-column" rowSpan={2} scope="col" aria-sort={prefs.sortKey === "name" ? prefs.sortDir === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => onSort("name")}>종목 · {capitalName}{sortIcon("name")}</button></th>{bands.map((band, i) => <th key={i} colSpan={band.count} scope="colgroup" className="band-heading">{band.label}{band.label === "프로토콜 수익" && <select aria-label="수익 정렬 기준" value={prefs.revenueSort} onChange={e => { setPrefs(p => ({ ...p, revenueSort: e.target.value as WorkspacePreferences["revenueSort"], sortKey: p.sortKey in REVENUE_COLUMN_DAYS ? p.sortKey : selectedCols.find(c => c.key in REVENUE_COLUMN_DAYS)!.key, sortDir: "desc" })); setPage(1); }}><option value="amount">금액</option><option value="percent">증가율</option><option value="delta">증가액</option></select>}</th>)}</tr>
          <tr>{selectedCols.map((col, i) => { const days = METRIC_COLUMN_DAYS[col.key] ?? REVENUE_COLUMN_DAYS[col.key as keyof typeof REVENUE_COLUMN_DAYS]; return <th key={col.key} className={`${bands.some(b => b.start === i) ? "band-start " : ""}${prefs.sortKey === col.key ? "active-sort" : ""}`} scope="col" title={col.title} aria-sort={prefs.sortKey === col.key ? prefs.sortDir === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => onSort(col.key)} aria-label={col.label + " 정렬"}>{days ? windowLabel(days) : col.label}{sortIcon(col.key)}</button></th>; })}</tr>
        </thead>
        <tbody>{rows.map(c => <Fragment key={c.slug}>
          <tr className={selectedSlug === c.slug ? "selected-coin" : ""}>
            <th scope="row" className="coin-column"><div className="coin-identity"><button className={"favorite-button " + (favorites.has(c.slug) ? "saved" : "")} aria-pressed={favorites.has(c.slug)} aria-label={c.name + " 관심종목 " + (favorites.has(c.slug) ? "해제" : "추가")} onClick={() => toggleFavorite(c.slug)}><Star size={13} fill={favorites.has(c.slug) ? "currentColor" : "none"}/></button><button className="coin-open" ref={el => { if (el) rowButtons.current.set(c.slug, el); else rowButtons.current.delete(c.slug); }} aria-label={c.name + " 상세 보기"} aria-expanded={selectedSlug === c.slug} aria-controls={selectedSlug === c.slug ? `detail-${c.slug}` : undefined} onClick={() => setSelectedSlug(selectedSlug === c.slug ? null : c.slug)}>{selectedSlug === c.slug ? <ChevronDown size={16}/> : <ChevronRight size={16}/>} {c.logo && <img src={c.logo} alt="" width={32} height={32} loading="lazy"/>}<span><strong>{c.name} <em>{c.symbol}</em></strong><small>{c[prefs.capital] === null ? `${capitalName} 미확인` : `${capitalName} ${fmtUsd(c[prefs.capital])}`}{c.identityStatus !== "verified" && " · 연결 확인"}</small></span></button></div></th>
            {selectedCols.map((col, i) => <td key={col.key} className={bands.some(b => b.start === i) ? "band-start" : ""}><button className="metric-open" tabIndex={-1} aria-label={c.name + " " + col.label + " 계산 근거"} onClick={() => setSelectedSlug(selectedSlug === c.slug ? null : c.slug)}>{cell(c, col.key)}</button></td>)}
          </tr>
          {selectedSlug === c.slug && <tr className="inline-detail-row" id={`detail-${c.slug}`}><td colSpan={selectedCols.length + 1}><InlineCoinDetail coin={c} capital={prefs.capital} onClose={() => closeDetail(c.slug)}/></td></tr>}
        </Fragment>)}</tbody>
      </table>
    </div>
    {!rows.length && <div className="empty-state"><Search size={26}/><h3>{!data ? "자료를 준비하고 있습니다" : prefs.view === "favorites" && !favorites.size ? "별표로 관심종목을 모아 보세요" : "조건에 맞는 종목이 없습니다"}</h3><p>{!data ? "공개 자료 응답을 기다립니다." : "검색어 또는 필터 조건을 조절하세요."}</p><button className="button" onClick={!data ? refresh : resetFilters}>{!data ? "다시 확인" : "조건 초기화"}</button></div>}
    <div className="scan-footer"><p>24h는 UTC 완료 하루 · 7·30·90일과 함께 연환산 · 1년은 실제 합계 · 성장률은 직전 동일 기간 대비 · ‘–’는 자료 부족·보류·비적용</p><Pagination total={total} page={currentPage} size={pageSize} position="top" onPage={goPage} onSize={s => { setPageSize(s); setPage(1); }}/></div>
    <span className="sr-only" role="status" aria-live="polite">{status}</span>

    {popup === "columns" && <SettingsDialog title="열 표시" wide onClose={() => setPopup(null)} headerAction={<button className="text-button" onClick={() => { setPrefs(p => withVisibleColumns(p, [...DEFAULT_VISIBLE_COLUMNS])); setStatus("기본 열을 복원했습니다."); }}><RotateCcw size={15}/>기본 열 복원</button>}><DisplaySettings columns={prefs.columns} onChange={columns => setPrefs(p => withVisibleColumns(p, columns))} onStatus={setStatus}/><button className="button export-results" disabled={exporting || !data} onClick={() => void exportResults()}><Download size={15}/>{exporting ? "전체 결과 준비 중…" : "검색 결과 전체 내보내기"}</button><p role="status">{exporting || status.includes("내보") ? status : ""}</p></SettingsDialog>}
    {popup === "filters" && <SettingsDialog title="필터" onClose={() => setPopup(null)} headerAction={<button className="text-button" onClick={resetFilters}><RotateCcw size={15}/>초기화</button>}><div className="sidebar-body" aria-label="필터 설정">
      <p className="sidebar-hint">조건은 전체 프로젝트에 적용합니다. 가격 하락만으로 종목을 제외하지 않습니다.</p>
      <fieldset className="filter-section"><legend>배수·성장·환원 조회 기간</legend><div className="choice-buttons period-buttons" role="group" aria-label="배수 범위 기간">{METRIC_WINDOWS.map(days => <button key={days} aria-pressed={prefs.rangeWindow === days} onClick={() => update("rangeWindow", days)}>{windowLabel(days)}</button>)}</div><div className="multiple-range"><label>P/R 최대 배수<span><input aria-label="P/R 최대 배수" type="number" min="0" placeholder="제한 없음" value={prefs.maxPr || ""} onChange={e => update("maxPr", Math.max(0, Number(e.target.value)))}/><span>배</span></span></label><label>P/HR 최대 배수<span><input aria-label="P/HR 최대 배수" type="number" min="0" placeholder="제한 없음" value={prefs.maxPhr || ""} onChange={e => update("maxPhr", Math.max(0, Number(e.target.value)))}/><span>배</span></span></label></div></fieldset>
      <fieldset className="filter-section"><legend>함께 적용할 조건</legend><label className="inline-check"><input type="checkbox" checked={prefs.growingOnly} onChange={e => update("growingOnly", e.target.checked)}/>직전 동일 기간보다 수익 증가</label><label className="inline-check"><input type="checkbox" checked={prefs.holderOnly} onChange={e => update("holderOnly", e.target.checked)}/>해당 기간의 적격 환원액 있음</label><label className="inline-check"><input type="checkbox" checked={prefs.view === "favorites"} onChange={e => update("view", e.target.checked ? "favorites" : "all")}/>관심종목만</label></fieldset>
      {prefs.view === "issues" && <p>기존 ‘자료 확인 필요’ 조건 적용 중 <button className="text-button" onClick={() => update("view", "all")}>해제</button></p>}
      <label className="sidebar-label">섹터<select aria-label="섹터" value={prefs.category} onChange={e => update("category", e.target.value)}><option value="">모든 섹터</option>{data?.categories.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
      <UsdRangeFilter label="유통 시총" minUsd={prefs.minMcap} maxUsd={prefs.maxMcap} onMinChange={v => update("minMcap", v)} onMaxChange={v => update("maxMcap", v)}/>
      <details className="filter-details" open={prefs.available !== "all"}><summary>자료 유무로 좁히기</summary><div className="choice-buttons period-buttons" role="group" aria-label="자료 확인 기간">{(["any", ...METRIC_WINDOWS] as const).map(days => <button key={days} aria-pressed={prefs.coverageWindow === days} onClick={() => update("coverageWindow", days)}>{days === "any" ? "기간 중 하나" : windowLabel(days)}</button>)}</div><div className="choice-buttons availability-buttons" role="group" aria-label="확인 가능한 지표">{(Object.keys(AVAILABILITY_LABELS) as AvailableMetric[]).filter(k => k !== "sales").map(key => <button key={key} aria-pressed={prefs.available === key} onClick={() => update("available", key)}>{AVAILABILITY_LABELS[key]}</button>)}</div></details>
      <details className="filter-details" open={prefs.verifiedOnly || prefs.hideDilution}><summary>토큰 연결 · 희석</summary><label className="inline-check"><input type="checkbox" checked={prefs.verifiedOnly} onChange={e => update("verifiedOnly", e.target.checked)}/>토큰 연결 확인된 종목만</label><label className="inline-check"><input type="checkbox" checked={prefs.hideDilution} onChange={e => update("hideDilution", e.target.checked)}/>FDV가 시총의 3.33배 초과인 종목 제외</label></details>
    </div></SettingsDialog>}
    {popup === "coverage" && <SettingsDialog title="수집 범위와 계산 가능 범위" onClose={() => setPopup(null)} footerNote="프로젝트 수와 고유 토큰 수는 다릅니다."><p>DefiLlama 프로토콜 목록·상위 프로젝트·수수료·수익·환원·DEX 목록을 합칩니다. 같은 상위 프로젝트의 제품은 한 행으로 묶습니다. 시총이나 수익 자료가 없어도 목록에 남습니다.</p><dl className="coverage-summary"><div><dt>전체 프로젝트</dt><dd>{data?.pagination.total}개</dd></div><div><dt>연결 확인한 고유 투자 토큰</dt><dd>{data?.universe.linkedTokens}개</dd></div><div><dt>현재 표시 지표 중 배수 계산 가능 · 검색 결과</dt><dd>{data?.visibleCoverage.unique} / {total}개</dd></div></dl><p>전체 프로젝트 · {capitalName} · {windowLabel(prefs.coverageWindow)}</p><dl className="coverage-summary"><div><dt>배수 산출 가능</dt><dd>{coverage?.unique}개</dd></div><div><dt>원천 자료 있음 · 배수 보류</dt><dd>{coverage?.review}개</dd></div><div><dt>해당 기간 자료 미확보</dt><dd>{coverage?.missing}개</dd></div></dl><p>자료 미확보는 수익 0을 뜻하지 않습니다. P/R과 P/HR 집계는 서로 겹치며, 각 배수의 보류 사유는 행 아래 상세에서 확인할 수 있습니다.</p></SettingsDialog>}
    {sourceOpen && <DataGuide onClose={() => setSourceOpen(false)} data={data} checkedAt={checkedAt}/>}
  </main>;
}
