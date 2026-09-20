"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, RefreshCw, RotateCcw, Search, SlidersHorizontal, Star, X, Info, GripVertical } from "lucide-react";
import type { ScreenerResponse } from "@/lib/types";
import { fmtKstMinute } from "@/lib/format";
import { revenueGrowing } from "@/lib/research";
import { compareTableValues, matchesRange, parseFavoriteSlugs, serializeFavoriteSlugs } from "@/lib/screenerFilters";
import { DEFAULT_VISIBLE_COLUMNS, SCREENER_COLUMNS as COLS, type SortKey } from "@/lib/screenerColumns";
import { defaultPreferences, parseWorkspace, resetWorkspaceFilters, withVisibleColumns, workspaceMigrationNotice, WORKSPACE_KEY, type WorkspacePreferences, type UniverseView } from "@/lib/workspacePreferences";
import { compareSnapshot, makeSnapshot } from "@/lib/snapshotHistory";
import { SNAPSHOT_STALE_MS } from "@/lib/screenerRefresh";
import { protocolMultiple, holderMultiple } from "@/lib/valuationMetrics";
import { reorderColumn } from "@/lib/columnOrder";
import { CoinDetail } from "./CoinDetail";
import { renderCell, sortValue } from "./ScreenerCells";
import { UsdRangeFilter } from "./RangeFilters";
import { useScreenerData } from "./useScreenerData";
import { Pagination } from "./Pagination";
import { PAGE_SIZE_KEY, parsePageSize } from "@/lib/pagination";
import { useWindowTableHeader } from "./useWindowTableHeader";
import { SettingsDialog } from "./SettingsDialog";
import { metricCoverage, visibleMetricCoverage, matchesAvailability, AVAILABILITY_LABELS, METRIC_WINDOWS, METRIC_COLUMN_DAYS, windowLabel, type AvailableMetric, type CoverageWindow } from "@/lib/metricCoverage";
import { DataGuide } from "./DataGuide";
import { useColumnReorder } from "./useColumnReorder";
import { DisplaySettings } from "./DisplaySettings";

const FAVORITES_KEY = "crypto-valuation-favorites-v1";
const VIEWS: { key: UniverseView; label: string }[] = [{ key: "all", label: "전체 종목" }, { key: "favorites", label: "관심종목" }, { key: "growth", label: "사업 수익 성장" }, { key: "holder", label: "홀더 환원 관측" }, { key: "changes", label: "확인 후 변화" }, { key: "issues", label: "자료 확인 필요" }];
const METRIC_KEYS = new Set(Object.keys(METRIC_COLUMN_DAYS));

export function ScreenerClient({ initialData }: { initialData: ScreenerResponse | null }) {
  const { data, refreshing, refresh, message, error, checkedAt, baseline, historyCount, acknowledge, storageError, now, history } = useScreenerData(initialData);
  const [prefs, setPrefs] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [popup, setPopup] = useState<"filters" | "columns" | "coverage" | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [overviewWindow, setOverviewWindow] = useState<CoverageWindow>("any");
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const tableRef = useWindowTableHeader();
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_KEY);
      const saved = parseWorkspace(raw);
      setMigrationNotice(workspaceMigrationNotice(raw));
      setPrefs(saved);
      setFavorites(parseFavoriteSlugs(localStorage.getItem(FAVORITES_KEY)));
      setPageSize(parsePageSize(localStorage.getItem(PAGE_SIZE_KEY)));
    } catch { setPreferencesError(true); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(prefs));
      localStorage.setItem(FAVORITES_KEY, serializeFavoriteSlugs(favorites));
      localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
    } catch { setPreferencesError(true); }
  }, [ready, prefs, favorites, pageSize]);
  const update = <K extends keyof WorkspacePreferences,>(key: K, value: WorkspacePreferences[K]) => { setPrefs(p => ({ ...p, [key]: value })); if (!["columns", "panel", "sidebarOpen"].includes(key)) setPage(1); };
  const showColumns = () => setPopup("columns");
  const toggleFavorite = (slug: string) => setFavorites(prev => { const next = new Set(prev); if (next.has(slug)) next.delete(slug); else next.add(slug); return next; });
  const resetFilters = () => { setPrefs(resetWorkspaceFilters); setPage(1); };
  const setColumns = (columns: SortKey[]) => setPrefs(p => withVisibleColumns(p, columns));
  const reorder = (from: SortKey, to: SortKey) => {
    const columns = reorderColumn(prefs.columns, from, to);
    setColumns(columns);
    setOrderMessage((COLS.find(c => c.key === from)?.label ?? from) + " · 표시 열 " + (columns.indexOf(from) + 1) + "번째로 이동");
  };
  const columnDrag = useColumnReorder(prefs.columns, reorder);
  const dragClass = (key: SortKey, zone: string) => columnDrag.drag?.zone !== zone ? "" : columnDrag.drag.key === key ? "column-dragging" : columnDrag.drag.over === key ? "column-drop-target" : "";
  const coins = useMemo(() => data?.coins ?? [], [data]);
  const comparisonBaseline = baseline && data && Date.parse(baseline.at) <= Date.parse(data.updatedAt) ? baseline : null;
  const changes = useMemo(() => new Map(coins.map(c => [c.slug, compareSnapshot(c, comparisonBaseline, data?.scoreVersion ?? "")])), [coins, comparisonBaseline, data?.scoreVersion]);
  const coverage = useMemo(() => metricCoverage(coins,prefs.capital,prefs.coverageWindow,false), [coins,prefs.capital,prefs.coverageWindow]);
  const overviewCoverage = useMemo(() => metricCoverage(coins,prefs.capital,overviewWindow,false), [coins,prefs.capital,overviewWindow]);
  const rows = useMemo(() => coins.filter(c => {
    const q = prefs.search.trim().toLowerCase();
    if (q && !(c.name + " " + (c.symbol ?? "")).toLowerCase().includes(q)) return false;
    if (prefs.view === "favorites" && !favorites.has(c.slug)) return false;
    if (prefs.view === "growth" && !revenueGrowing(c)) return false;
    if (prefs.view === "holder" && !c.opportunities.holder) return false;
    if (prefs.view === "changes" && !changes.get(c.slug)?.meaningful) return false;
    if (prefs.view === "issues" && !c.opportunities.dataIssues.length) return false;
    if (prefs.category && c.category !== prefs.category) return false;
    if (prefs.hideDilution && c.highDilution) return false;
    if (prefs.verifiedOnly && c.identityStatus !== "verified") return false;
    const pr = protocolMultiple(c,prefs.rangeWindow,prefs.capital), phr = holderMultiple(c,prefs.rangeWindow,prefs.capital);
    if (!matchesAvailability(c,prefs.available,prefs.capital,prefs.coverageWindow,false)) return false;
    return matchesRange(c.mcap, prefs.minMcap, prefs.maxMcap) && matchesRange(pr, 0, prefs.maxPr) && matchesRange(phr, 0, prefs.maxPhr);
  }).sort((a,b) => {
    const av = sortValue(a, prefs.sortKey, prefs.capital), bv = sortValue(b, prefs.sortKey, prefs.capital);
    if (av == null && bv == null) return (b.mcap ?? 0) - (a.mcap ?? 0) || a.name.localeCompare(b.name);
    return compareTableValues(av,bv,prefs.sortDir) || a.name.localeCompare(b.name);
  }), [coins, prefs, favorites, changes]);
  const deferredRows = useDeferredValue(rows);
  const visibleCoverage = useMemo(() => visibleMetricCoverage(deferredRows,prefs.capital,prefs.columns), [deferredRows,prefs.capital,prefs.columns]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(deferredRows.length / pageSize)));
  const selectedCols = prefs.columns.map(k => COLS.find(c => c.key === k)!).filter(Boolean);
  const selectedCoin = coins.find(c => c.slug === selectedSlug);
  const snapshotAge = data && now ? now - Date.parse(data.updatedAt) : 0;
  const sourceFailures = data?.sources.filter(s => s.status === "error").length ?? 0;
  const stale = snapshotAge > SNAPSHOT_STALE_MS;
  const onSort = (key: SortKey) => { setPrefs(p => ({ ...p, sortKey: key, sortDir: p.sortKey === key ? p.sortDir === "asc" ? "desc" : "asc" : METRIC_KEYS.has(key) || key === "name" ? "asc" : "desc" })); setPage(1); };
  const goPage = (n: number) => { setPage(n); requestAnimationFrame(() => { resultsRef.current?.focus({ preventScroll: true }); resultsRef.current?.scrollIntoView({ block: "start" }); }); };
  const exportSnapshot = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ ...makeSnapshot(data), view: prefs, rows: deferredRows }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = "screener-" + data.updatedAt.replace(/[:.]/g, "-") + ".json"; anchor.click(); URL.revokeObjectURL(url);
  };
  const activeFilters = [prefs.view !== "all", !!prefs.search, !!prefs.category, prefs.available !== "all", prefs.minMcap > 0 || prefs.maxMcap > 0, prefs.maxPr > 0, prefs.maxPhr > 0, prefs.hideDilution, prefs.verifiedOnly].filter(Boolean).length;
  const capitalName = prefs.capital === "mcap" ? "유통 시총" : "FDV";
  const sortIcon = (key: SortKey) => prefs.sortKey === key
    ? prefs.sortDir === "asc" ? <ArrowUp size={14}/> : <ArrowDown size={14}/>
    : <ArrowUpDown size={13} className="sort-idle"/>;
  return <main className="research-app valuation-workspace popup-workspace">
    <a className="skip-link" href="#screener-results">결과 표로 이동</a>
    <header className="valuation-header">
      <div className="brand-mark" aria-hidden="true">V</div>
      <div className="brand-title"><h1>크립토 밸류 스캐너</h1><p>프로토콜 수익과 홀더 환원을 한눈에</p></div>
      <div className="header-actions">
        <div className="header-status"><span className={"freshness " + (stale || sourceFailures ? "caution" : "")}>{!data ? "자료 준비 중" : stale ? "자료 갱신 필요" : sourceFailures ? "일부 수집 실패" : "최근 수집 자료"}</span><span>{data ? fmtKstMinute(data.updatedAt) : "첫 자료를 준비합니다"}</span></div>
        <button className="icon-button" aria-label="최신 자료 확인" title="최신 자료 확인" disabled={refreshing} onClick={()=>void refresh()}><RefreshCw size={17} className={refreshing ? "spinning" : ""}/></button>
        <button className="text-button guide-trigger" onClick={()=>setSourceOpen(true)}><Info size={16}/>지표 안내</button>
      </div>
    </header>
    {(error || message) && <div className={error || refreshing ? "workspace-status" : "sr-only"} role="status">{error || message}</div>}
    {(storageError || preferencesError) && <p className="notice">브라우저 저장소를 사용할 수 없어 설정·관심종목·기록이 유지되지 않을 수 있습니다.</p>}
    {migrationNotice && <div className="migration-notice" role="status"><Info size={16}/><span>{migrationNotice}</span><button className="icon-button" aria-label="설정 변경 안내 닫기" onClick={()=>setMigrationNotice(null)}><X size={16}/></button></div>}
    <div className="valuation-layout">
      <section className="comparison-workspace" aria-label="스크리너">
        <div className="comparison-title"><h2>{VIEWS.find(v=>v.key===prefs.view)?.label} <span>{deferredRows.length}<small> / {coins.length}</small></span></h2><p><strong>P/R</strong> 프로토콜 수익 <span>·</span> <strong>P/HR</strong> 홀더 환원</p></div>
        <div className="table-toolbar">
          <div className="choice-buttons universe-buttons" role="group" aria-label="종목 목록">{VIEWS.slice(0,2).map(v=><button key={v.key} aria-pressed={prefs.view===v.key} onClick={()=>update("view",v.key)}>{v.key==="favorites" && <Star size={15}/>} {v.label}{v.key==="favorites" && <span>{coins.filter(c=>favorites.has(c.slug)).length}</span>}</button>)}</div>
          <label className="search-box"><Search size={17}/><input aria-label="코인 또는 심볼 검색" placeholder="이름 또는 심볼 검색" value={prefs.search} onChange={e=>update("search",e.target.value)}/>{prefs.search && <button aria-label="검색 지우기" onClick={()=>update("search","")}><X size={15}/></button>}</label>
          <div className="toolbar-settings">
            <div className="capital-switch"><span>배수 기준</span><div className="choice-buttons" role="group" aria-label="배수 분자"><button aria-pressed={prefs.capital==="mcap"} onClick={()=>update("capital","mcap")}>유통 시총</button><button aria-pressed={prefs.capital==="fdv"} onClick={()=>update("capital","fdv")}>FDV</button></div></div>
            <button className="button" onClick={()=>setPopup("filters")}><SlidersHorizontal size={16}/>필터{activeFilters>0 && <span className="control-count">{activeFilters}</span>}</button>
            <button className="button" onClick={showColumns}><Columns3 size={16}/>표시 설정 <span className="control-count">{prefs.columns.length}</span></button>
            <button className="icon-button" aria-label="자료 내보내기" title="자료 내보내기" onClick={exportSnapshot} disabled={!data}><Download size={16}/></button>
          </div>
        </div>
        <span className="sr-only" role="status" aria-live="polite">{orderMessage}</span>
        {activeFilters>0 && <div className="active-filters"><span>적용 조건</span>
          {prefs.search && <button onClick={()=>update("search","")}>{prefs.search}<X size={12}/></button>}
          {prefs.view!=="all" && <button onClick={()=>update("view","all")}>{VIEWS.find(v=>v.key===prefs.view)?.label}<X size={12}/></button>}
          {prefs.category && <button onClick={()=>update("category","")}>{prefs.category}<X size={12}/></button>}
          {prefs.available!=="all" && <button onClick={()=>update("available","all")}>{AVAILABILITY_LABELS[prefs.available]} · {windowLabel(prefs.coverageWindow)}<X size={12}/></button>}
          {(prefs.minMcap>0 || prefs.maxMcap>0) && <button onClick={()=>{update("minMcap",0);update("maxMcap",0);}}>시총 범위<X size={12}/></button>}
          {prefs.maxPr>0 && <button onClick={()=>update("maxPr",0)}>P/R {windowLabel(prefs.rangeWindow)} ≤ {prefs.maxPr}<X size={12}/></button>}
          {prefs.maxPhr>0 && <button onClick={()=>update("maxPhr",0)}>P/HR {windowLabel(prefs.rangeWindow)} ≤ {prefs.maxPhr}<X size={12}/></button>}
          {prefs.hideDilution && <button onClick={()=>update("hideDilution",false)}>높은 희석 제외<X size={12}/></button>}
          {prefs.verifiedOnly && <button onClick={()=>update("verifiedOnly",false)}>토큰 연결 확인<X size={12}/></button>}
          <button onClick={resetFilters}>모두 해제</button>
        </div>}
        {prefs.view==="changes" && <div className="comparison-note"><p>{baseline?.scoreVersion===data?.scoreVersion ? "확인 기준 " + fmtKstMinute(baseline!.at) + " · 같은 집계 범위의 금액 변화를 비교합니다." : "계산 기준이 바뀌었습니다. 현재 자료를 확인 기준으로 저장하면 다음 수집부터 비교합니다."}</p><button className="text-button" onClick={acknowledge}>여기까지 확인 완료</button></div>}
        <div className="results-heading" id="screener-results" ref={resultsRef} tabIndex={-1}>
          <button className="coverage-note text-button" onClick={()=>setPopup("coverage")}><Info size={14}/>{visibleCoverage.metrics.length ? <span>표시 지표로 배수 산출 <strong>{visibleCoverage.unique}</strong> / {deferredRows.length}개</span> : <span>자료 제공 현황</span>}</button>
          <Pagination total={deferredRows.length} page={currentPage} size={pageSize} position="top" onPage={goPage} onSize={s=>{setPageSize(s);setPage(1);}}/>
        </div>
        <div ref={tableRef} data-reorder-zone="table" className="table-scroll thin-scroll" role="region" aria-label="프로토콜 비교 표 · 가로 스크롤 가능" tabIndex={0} aria-busy={rows!==deferredRows}>
          <table className="screener-table"><caption className="sr-only">토큰 가치와 프로토콜 수익·홀더 환원 비교. 빈 값은 0이 아닙니다. 종목이나 숫자를 누르면 근거를 확인할 수 있습니다.</caption>
            <thead><tr>
              <th className="coin-column" scope="col" aria-sort={prefs.sortKey==="name" ? prefs.sortDir==="asc" ? "ascending" : "descending" : "none"}><div className="identity-heading"><button onClick={()=>onSort("name")}>종목{sortIcon("name")}</button><span className="header-basis">배수: {capitalName}</span></div></th>
              {selectedCols.map(col=><th key={col.key} data-column-key={col.key} className={dragClass(col.key,"table")} scope="col" title={col.title} aria-sort={prefs.sortKey===col.key ? prefs.sortDir==="asc" ? "ascending" : "descending" : "none"}>
                <div className="column-heading"><button className="column-drag-handle" aria-label={col.label + " 표 열 순서 이동"} title="드래그 또는 방향키로 열 이동" {...columnDrag.handle(col.key,"table")}><GripVertical size={14}/></button><button className="sort-heading" onClick={()=>onSort(col.key)}>{col.label}{sortIcon(col.key)}</button></div>
              </th>)}
            </tr></thead>
            <tbody>{deferredRows.slice((currentPage-1)*pageSize,currentPage*pageSize).map(c=><tr key={c.slug}>
              <th scope="row" className="coin-column"><div className="coin-identity"><button className={"favorite-button " + (favorites.has(c.slug) ? "saved" : "")} aria-pressed={favorites.has(c.slug)} aria-label={c.name + " 관심종목 " + (favorites.has(c.slug) ? "해제" : "추가")} onClick={()=>toggleFavorite(c.slug)}><Star size={16} fill={favorites.has(c.slug) ? "currentColor" : "none"}/></button><button className="coin-open" aria-label={c.name + " 상세 보기"} onClick={()=>setSelectedSlug(c.slug)}>{c.logo && <img src={c.logo} alt="" width={28} height={28} loading="lazy"/>}<span><strong>{c.name}</strong><small>{c.symbol ?? "심볼 미확인"} · {c.category ?? "섹터 미확인"}</small></span></button></div>{c.identityStatus!=="verified" && <span className="row-data-issue">토큰 연결 확인 필요</span>}{prefs.view==="issues" && <p className="row-data-issue">{c.opportunities.dataIssues.slice(0,2).join(" · ")}</p>}{prefs.view==="changes" && <span className="row-data-issue">확인 기준 이후 금액·신호 변화</span>}</th>
              {selectedCols.map(col=><td key={col.key}>{METRIC_KEYS.has(col.key) ? <button className="metric-open" aria-label={c.name + " " + col.label + " 계산 근거"} onClick={()=>setSelectedSlug(c.slug)}>{renderCell(c,col.key,prefs.capital)}</button> : renderCell(c,col.key,prefs.capital)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        {!deferredRows.length && <div className="empty-state"><Search size={26}/><h3>{!data ? "자료를 준비하고 있습니다" : prefs.view==="favorites" && !favorites.size ? "별표로 관심종목을 모아 보세요" : "조건에 맞는 종목이 없습니다"}</h3><p>{!data ? error ?? "공개 데이터 응답을 기다립니다." : "필터에서 조건을 조절하세요. 표시 열은 그대로 유지됩니다."}</p><button className="button" onClick={!data ? ()=>void refresh() : resetFilters}>{!data ? "다시 확인" : "필터 초기화"}</button></div>}
        <Pagination total={deferredRows.length} page={currentPage} size={pageSize} position="bottom" onPage={goPage} onSize={s=>{setPageSize(s);setPage(1);}}/>
        <footer className="table-footnote"><p>‘–’는 자료 부족·비적용·검토 보류입니다. 0과 구분합니다. 7·30·90일 배수는 연환산, 1년은 365일 합계입니다.</p><p>USD · M=백만, B=10억 · 시총 $1M 이상 · 토큰은 회사 지분과 권리가 다릅니다 · 낮은 배수만으로 저평가를 판단하지 않습니다.</p></footer>
      </section>
    </div>
    <footer className="app-footer"><p>DefiLlama · CoinMarketCap · CoinGecko · 개별 매출 출처</p><p>이 브라우저의 {historyCount}일 관측 기록 · 최근 60일 보관</p></footer>
    {popup==="columns" && <SettingsDialog title="표시 설정" wide onClose={()=>setPopup(null)} headerAction={<button className="text-button reset-columns" onClick={()=>{setColumns([...DEFAULT_VISIBLE_COLUMNS]);setOrderMessage("기본 열을 복원했습니다. 필터와 관심종목은 유지됩니다.");}} title="표시 열과 순서만 기본값으로 복원"><RotateCcw size={15}/>기본 열 복원</button>}>
      <DisplaySettings columns={prefs.columns} onChange={setColumns} onStatus={setOrderMessage}/>
    </SettingsDialog>}
    {popup==="filters" && <SettingsDialog title="필터" onClose={()=>setPopup(null)} headerAction={<button className="text-button" onClick={resetFilters}><RotateCcw size={15}/>초기화</button>}>
      <div className="sidebar-body" aria-label="필터 설정">
        <p className="sidebar-hint">배수는 {capitalName} 기준입니다. 표시 열과 순서는 유지됩니다.</p>
        <fieldset className="filter-section"><legend>배수 범위</legend><div className="choice-buttons period-buttons" role="group" aria-label="배수 범위 기간">{METRIC_WINDOWS.map(days=><button key={days} aria-pressed={prefs.rangeWindow===days} onClick={()=>update("rangeWindow",days)}>{windowLabel(days)}</button>)}</div>
          <div className="multiple-range"><label>P/R 최대 배수<span><input aria-label="P/R 최대 배수" type="number" min="0" placeholder="제한 없음" value={prefs.maxPr || ""} onChange={e=>update("maxPr",Math.max(0,Number(e.target.value)))}/><span>배</span></span></label><label>P/HR 최대 배수<span><input aria-label="P/HR 최대 배수" type="number" min="0" placeholder="제한 없음" value={prefs.maxPhr || ""} onChange={e=>update("maxPhr",Math.max(0,Number(e.target.value)))}/><span>배</span></span></label></div>
          <p className="sidebar-hint">{windowLabel(prefs.rangeWindow)} 배수에 적용 · 표의 기간은 표시 설정에서 고릅니다.</p>
        </fieldset>
        <label className="sidebar-label">섹터<select aria-label="섹터" value={prefs.category} onChange={e=>update("category",e.target.value)}><option value="">모든 섹터</option>{data?.categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
        <UsdRangeFilter label="유통 시총" minUsd={prefs.minMcap} maxUsd={prefs.maxMcap} onMinChange={v=>update("minMcap",v)} onMaxChange={v=>update("maxMcap",v)}/>
        <details className="filter-details" open={prefs.available!=="all"}><summary>자료 유무로 좁히기{prefs.available!=="all" && <span>적용 중</span>}</summary>
          <p className="sidebar-hint">자료가 있는 종목을 고르는 기간입니다. 위의 배수 범위 조건과 별도로 적용됩니다.</p>
          <div className="choice-buttons period-buttons" role="group" aria-label="자료 확인 기간">{(["any",...METRIC_WINDOWS] as const).map(days=><button key={days} aria-pressed={prefs.coverageWindow===days} onClick={()=>update("coverageWindow",days)}>{days==="any" ? "기간 중 하나" : windowLabel(days)}</button>)}</div>
          <div className="choice-buttons availability-buttons" role="group" aria-label="확인 가능한 지표">{(Object.keys(AVAILABILITY_LABELS) as AvailableMetric[]).filter(key=>key!=="sales").map(key=><button key={key} aria-pressed={prefs.available===key} onClick={()=>update("available",key)}>{AVAILABILITY_LABELS[key]} <span>{key==="all" ? coverage.total : key==="any" ? coverage.unique : coverage[key]}</span></button>)}</div>
        </details>
        <details className="filter-details" open={prefs.verifiedOnly || prefs.hideDilution || !["all","favorites"].includes(prefs.view)}><summary>추가 조건</summary>
          <label className="inline-check"><input type="checkbox" checked={prefs.verifiedOnly} onChange={e=>update("verifiedOnly",e.target.checked)}/>토큰 연결 확인된 종목만</label>
          <label className="inline-check"><input type="checkbox" checked={prefs.hideDilution} onChange={e=>update("hideDilution",e.target.checked)}/>FDV가 시총의 3.33배 초과인 종목 제외</label>
          <div className="choice-buttons" role="group" aria-label="추가 종목 조건">{VIEWS.slice(2).map(v=><button key={v.key} aria-pressed={prefs.view===v.key} onClick={()=>update("view",prefs.view===v.key ? "all" : v.key)}>{v.label}</button>)}</div>
        </details>
      </div>
    </SettingsDialog>}
    {popup==="coverage" && <SettingsDialog title="자료 제공 현황" onClose={()=>setPopup(null)} footerNote="현황 조회는 표의 설정을 바꾸지 않습니다.">
      <h3 className="coverage-title">현재 표 · {capitalName} 기준</h3>
      {visibleCoverage.metrics.length > 0 && <p>검색·필터 결과 {visibleCoverage.total}개 중, 표시된 배수를 하나 이상 계산할 수 있는 종목은 <strong>{visibleCoverage.unique}개</strong>입니다.</p>}
      {visibleCoverage.metrics.length ? <dl className="coverage-summary">{visibleCoverage.metrics.map(m=><div key={m.key}><dt>{m.label}</dt><dd>{m.count}개</dd></div>)}</dl> : <p className="sidebar-hint">표시 설정에서 P/R 또는 P/HR 열을 추가하세요.</p>}
      <p className="sidebar-hint">지표별 종목은 서로 겹칩니다. 합산하지 않으며, 시총 참고값은 FDV 집계에 포함하지 않습니다.</p>
      <details className="filter-details"><summary>전체 종목의 자료 현황</summary>
        <div className="choice-buttons period-buttons" role="group" aria-label="현황 조회 기간">{(["any",...METRIC_WINDOWS] as const).map(days=><button key={days} aria-pressed={overviewWindow===days} onClick={()=>setOverviewWindow(days)}>{days==="any" ? "기간 중 하나" : windowLabel(days)}</button>)}</div>
        <p>전체 {coins.length}개 · {capitalName} · {windowLabel(overviewWindow)}</p>
        <dl className="coverage-summary"><div><dt>P/R·P/HR 배수 산출 가능 · 중복 제외</dt><dd>{overviewCoverage.unique}개</dd></div><div><dt>원천 자료 있음 · 배수 보류</dt><dd>{overviewCoverage.review}개</dd></div><div><dt>해당 기간 원천 자료 없음</dt><dd>{overviewCoverage.missing}개</dd></div></dl>
        <p className="sidebar-hint">세 항목을 합하면 전체 종목 수입니다. 자료 미확보는 실제 매출이 없다는 뜻이 아닙니다. 보류 사유는 개별 종목에서 확인할 수 있습니다.</p>
        <div className="coverage-metrics">P/R {overviewCoverage.revenue}개 · P/HR {overviewCoverage.holder}개</div>
      </details>
      <button className="button" onClick={()=>setPopup("filters")}>자료 조건으로 필터</button>
    </SettingsDialog>}
    {sourceOpen && <DataGuide onClose={()=>setSourceOpen(false)} data={data} checkedAt={checkedAt}/>}
    {selectedCoin && <CoinDetail coin={selectedCoin} history={history} multipleReference={null} capital={prefs.capital} change={changes.get(selectedCoin.slug)!} onClose={()=>setSelectedSlug(null)}/>}
  </main>;
}
