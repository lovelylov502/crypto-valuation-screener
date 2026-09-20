"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns3, Download, RefreshCw, Search, SlidersHorizontal, Star, X, ChevronDown, ChevronUp, Info, GripVertical } from "lucide-react";
import type { ScreenerResponse } from "@/lib/types";
import { fmtKstMinute } from "@/lib/format";
import { revenueGrowing } from "@/lib/research";
import { matchesRange, parseFavoriteSlugs, serializeFavoriteSlugs } from "@/lib/screenerFilters";
import { DEFAULT_VISIBLE_COLUMNS, SCREENER_COLUMNS as COLS, COLUMN_GROUP_LABELS, type ColumnGroup, type SortKey } from "@/lib/screenerColumns";
import { defaultPreferences, parseWorkspace, resetWorkspaceFilters, WORKSPACE_KEY, type WorkspacePreferences, type UniverseView } from "@/lib/workspacePreferences";
import { compareSnapshot, makeSnapshot } from "@/lib/snapshotHistory";
import { SNAPSHOT_STALE_MS } from "@/lib/screenerRefresh";
import { salesMultiple, protocolMultiple, holderMultiple } from "@/lib/valuationMetrics";
import { addColumn, reorderColumn, showMetricPeriods } from "@/lib/columnOrder";
import { revenueBasis } from "@/lib/revenueHistory";
import { CoinDetail } from "./CoinDetail";
import { renderCell, sortValue } from "./ScreenerCells";
import { UsdRangeFilter } from "./RangeFilters";
import { useScreenerData } from "./useScreenerData";
import { Pagination } from "./Pagination";
import { PAGE_SIZE_KEY, parsePageSize } from "@/lib/pagination";
import { useWindowTableHeader } from "./useWindowTableHeader";
import { SettingsDialog } from "./SettingsDialog";
import { metricCoverage, matchesAvailability, AVAILABILITY_LABELS, windowLabel, type AvailableMetric } from "@/lib/metricCoverage";
import { DataGuide } from "./DataGuide";
import { useColumnReorder } from "./useColumnReorder";

const FAVORITES_KEY = "crypto-valuation-favorites-v1";
const VIEWS: { key: UniverseView; label: string }[] = [{ key: "all", label: "전체 종목" }, { key: "favorites", label: "관심종목" }, { key: "growth", label: "사업 수익 성장" }, { key: "holder", label: "홀더 환원 관측" }, { key: "changes", label: "확인 후 변화" }, { key: "issues", label: "자료 확인 필요" }];
const METRIC_KEYS = new Set(["psSales", "pr", "pr7d", "pr90d", "pr1y", "phr", "phr7d", "phr90d", "phr1y"]);

export function ScreenerClient({ initialData }: { initialData: ScreenerResponse | null }) {
  const { data, refreshing, refresh, message, error, checkedAt, baseline, historyCount, acknowledge, storageError, now, history } = useScreenerData(initialData);
  const [prefs, setPrefs] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [popup, setPopup] = useState<"filters" | "columns" | "coverage" | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [columnSearch, setColumnSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const tableRef = useWindowTableHeader();
  useEffect(() => {
    try {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_KEY));
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
  const toggleColumn = (key: SortKey) => update("columns", prefs.columns.includes(key) ? prefs.columns.length > 1 ? prefs.columns.filter(k => k !== key) : prefs.columns : addColumn(prefs.columns, key));
  const reorder = (from: SortKey, to: SortKey) => {
    const columns = reorderColumn(prefs.columns, from, to);
    update("columns", columns);
    setOrderMessage((COLS.find(c => c.key === from)?.label ?? from) + " · 표시 열 " + (columns.indexOf(from) + 1) + "번째로 이동");
  };
  const moveColumn = (index: number, by: number) => { const target = prefs.columns[index + by]; if (target) reorder(prefs.columns[index], target); };
  const columnDrag = useColumnReorder(prefs.columns, reorder);
  const dragClass = (key: SortKey, zone: string) => columnDrag.drag?.zone !== zone ? "" : columnDrag.drag.key === key ? "column-dragging" : columnDrag.drag.over === key ? "column-drop-target" : "";
  const addPeriods = (prefix: "phr" | "pr") => update("columns", showMetricPeriods(prefs.columns, prefix));
  const coins = useMemo(() => data?.coins ?? [], [data]);
  const comparisonBaseline = baseline && data && Date.parse(baseline.at) <= Date.parse(data.updatedAt) ? baseline : null;
  const changes = useMemo(() => new Map(coins.map(c => [c.slug, compareSnapshot(c, comparisonBaseline, data?.scoreVersion ?? "")])), [coins, comparisonBaseline, data?.scoreVersion]);
  const coverage = useMemo(() => metricCoverage(coins,prefs.capital,prefs.coverageWindow), [coins,prefs.capital,prefs.coverageWindow]);
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
    const ps = salesMultiple(c, prefs.capital), phr = holderMultiple(c, 30, prefs.capital);
    if (!matchesAvailability(c,prefs.available,prefs.capital,prefs.coverageWindow)) return false;
    return matchesRange(c.mcap, prefs.minMcap, prefs.maxMcap) && matchesRange(ps, 0, prefs.maxPs) && matchesRange(phr, 0, prefs.maxPhr);
  }).sort((a,b) => {
    if (["pr", "pr7d", "pr90d", "pr1y"].includes(prefs.sortKey)) {
      const basis = revenueBasis(a).localeCompare(revenueBasis(b));
      if (basis && protocolMultiple(a) !== null && protocolMultiple(b) !== null) return basis;
    }
    const av = sortValue(a, prefs.sortKey, prefs.capital), bv = sortValue(b, prefs.sortKey, prefs.capital);
    if (av == null && bv == null) return (b.mcap ?? 0) - (a.mcap ?? 0) || a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    const d = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
    return d * (prefs.sortDir === "asc" ? 1 : -1) || a.name.localeCompare(b.name);
  }), [coins, prefs, favorites, changes]);
  const deferredRows = useDeferredValue(rows);
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
  const activeFilters = [prefs.view !== "all", !!prefs.search, !!prefs.category, prefs.available !== "all", prefs.minMcap > 0 || prefs.maxMcap > 0, prefs.maxPs > 0, prefs.maxPhr > 0, prefs.hideDilution, prefs.verifiedOnly].filter(Boolean).length;
  const capitalName = prefs.capital === "mcap" ? "유통 시총" : "FDV";
  return <main className="research-app valuation-workspace popup-workspace">
    <a className="skip-link" href="#screener-results">결과 표로 이동</a>
    <header className="valuation-header"><div className="brand-mark" aria-hidden="true">V</div><div><h1>크립토 밸류 스캐너</h1><p>가격과 사업, 홀더에게 돌아오는 가치를 함께</p></div><div className="header-actions"><span className={"freshness " + (stale || sourceFailures ? "caution" : "")}>{!data ? "자료 준비 중" : stale ? "자료 갱신 필요" : sourceFailures ? "일부 수집 실패" : "최근 수집 자료"}</span><button className="button" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? "spinning" : ""} />{refreshing ? "확인 중" : "최신 자료 확인"}</button></div></header>
    <div className="workspace-status" role="status"><span>{data ? fmtKstMinute(data.updatedAt) + " 수집" : "첫 자료를 준비합니다"} · {error ?? message ?? "페이지를 다시 열면 최신 자료를 확인합니다"}</span><button onClick={() => setSourceOpen(v => !v)} className="text-button" aria-expanded={sourceOpen}>데이터 안내 <Info size={13} /></button></div>
    {(storageError || preferencesError) && <p className="notice">브라우저 저장소를 사용할 수 없어 설정·관심종목·기록이 유지되지 않을 수 있습니다.</p>}
    <div className="valuation-layout">
      <section className="comparison-workspace" aria-label="스크리너">
        <div className="comparison-title"><h2>{VIEWS.find(v => v.key === prefs.view)?.label} <span>{deferredRows.length}<small> / {coins.length}</small></span></h2><button className="text-button" onClick={() => setSourceOpen(true)}>P/S · P/R · P/HR 계산법 <Info size={13}/></button></div>
        <div className="table-toolbar">
          <div className="choice-buttons universe-buttons" role="group" aria-label="종목 목록">{VIEWS.slice(0,2).map(v => <button key={v.key} aria-pressed={prefs.view === v.key} onClick={() => update("view",v.key)}>{v.key === "favorites" && <Star size={13}/>} {v.label}{v.key === "favorites" && <span>{coins.filter(c => favorites.has(c.slug)).length}</span>}</button>)}</div>
          <label className="search-box"><Search size={16}/><input aria-label="코인 또는 심볼 검색" placeholder="이름 또는 심볼 검색" value={prefs.search} onChange={e => update("search",e.target.value)}/>{prefs.search && <button aria-label="검색 지우기" onClick={() => update("search","")}><X size={14}/></button>}</label>
          <div className="toolbar-settings"><div className="choice-buttons" role="group" aria-label="배수 분자"><button aria-pressed={prefs.capital === "mcap"} onClick={() => update("capital","mcap")}>유통 시총</button><button aria-pressed={prefs.capital === "fdv"} onClick={() => update("capital","fdv")}>FDV</button></div><button className="button" onClick={() => setPopup("filters")}><SlidersHorizontal size={15}/>필터{activeFilters > 0 && <span className="control-count">{activeFilters}</span>}</button><button className="button" onClick={showColumns}><Columns3 size={15}/>표시 설정 <span className="control-count">{prefs.columns.length}</span></button><button className="icon-button" aria-label="자료 내보내기" title="자료 내보내기" onClick={exportSnapshot} disabled={!data}><Download size={15}/></button></div>
        </div>
        <span className="sr-only" role="status" aria-live="polite">{orderMessage}</span>
        {activeFilters > 0 && <div className="active-filters"><span>적용 조건</span>{prefs.search && <button onClick={() => update("search","")}>{prefs.search}<X size={12}/></button>}{prefs.view !== "all" && <button onClick={() => update("view","all")}>{VIEWS.find(v => v.key === prefs.view)?.label}<X size={12}/></button>}{prefs.category && <button onClick={() => update("category","")}>{prefs.category}<X size={12}/></button>}{prefs.available !== "all" && <button onClick={() => update("available","all")}>{AVAILABILITY_LABELS[prefs.available]} · {windowLabel(prefs.coverageWindow)}<X size={12}/></button>}{(prefs.minMcap > 0 || prefs.maxMcap > 0) && <button onClick={() => { update("minMcap",0); update("maxMcap",0); }}>시총 범위<X size={12}/></button>}{prefs.maxPs > 0 && <button onClick={() => update("maxPs",0)}>P/S ≤ {prefs.maxPs}<X size={12}/></button>}{prefs.maxPhr > 0 && <button onClick={() => update("maxPhr",0)}>P/HR 30일 ≤ {prefs.maxPhr}<X size={12}/></button>}{prefs.hideDilution && <button onClick={() => update("hideDilution",false)}>높은 희석 제외<X size={12}/></button>}{prefs.verifiedOnly && <button onClick={() => update("verifiedOnly",false)}>토큰 연결 확인<X size={12}/></button>}<button onClick={resetFilters}>모두 해제</button></div>}
        {prefs.view === "changes" && <div className="comparison-note"><p>{baseline?.scoreVersion === data?.scoreVersion ? "확인 기준 " + fmtKstMinute(baseline!.at) + " · 같은 집계 범위의 금액 변화를 비교합니다." : "계산 기준이 바뀌었습니다. 현재 자료를 확인 기준으로 저장하면 다음 수집부터 비교합니다."}</p><button className="text-button" onClick={acknowledge}>여기까지 확인 완료</button></div>}
        <div className="results-heading" id="screener-results" ref={resultsRef} tabIndex={-1}><button className="coverage-note text-button" onClick={() => setPopup("coverage")}>배수 산출 {coverage.unique}개 <span className="muted">· {capitalName} / {windowLabel(prefs.coverageWindow)} · 전체 {coins.length}개 기준</span> <Info size={13}/></button><div><label className="sort-select">정렬 <select aria-label="결과 정렬" value={prefs.sortKey} onChange={e => onSort(e.target.value as SortKey)}><option value="name">종목명</option>{COLS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label><button className="icon-button" aria-label={prefs.sortDir === "asc" ? "내림차순으로 변경" : "오름차순으로 변경"} onClick={() => update("sortDir", prefs.sortDir === "asc" ? "desc" : "asc")}>{prefs.sortDir === "asc" ? <ArrowUp size={15}/> : <ArrowDown size={15}/>}</button></div></div>
        <Pagination total={deferredRows.length} page={currentPage} size={pageSize} position="top" onPage={goPage} onSize={s => { setPageSize(s); setPage(1); }}/>
        <div ref={tableRef} data-reorder-zone="table" className="table-scroll thin-scroll" role="region" aria-label="프로토콜 비교 표 · 가로 스크롤 가능" tabIndex={0} aria-busy={rows !== deferredRows}>
          <table className="screener-table"><caption className="sr-only">토큰 가치와 매출·수익·환원 비교. 빈 값은 0이 아닙니다. 종목이나 숫자를 누르면 근거를 확인할 수 있습니다.</caption><thead><tr><th className="coin-column" scope="col" aria-sort={prefs.sortKey === "name" ? prefs.sortDir === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => onSort("name")}>종목</button></th>{selectedCols.map(col => <th key={col.key} data-column-key={col.key} className={dragClass(col.key,"table")} scope="col" title={col.title} aria-sort={prefs.sortKey === col.key ? prefs.sortDir === "asc" ? "ascending" : "descending" : "none"}><div className="column-heading"><button className="column-drag-handle" aria-label={col.label + " 표 열 순서 이동"} title="드래그 또는 방향키로 열 이동" {...columnDrag.handle(col.key,"table")}><GripVertical size={14}/></button><button onClick={() => onSort(col.key)}>{col.label}{prefs.sortKey === col.key && (prefs.sortDir === "asc" ? <ArrowUp size={12}/> : <ArrowDown size={12}/>)}</button></div>{METRIC_KEYS.has(col.key) && <small>{capitalName} 기준</small>}</th>)}</tr></thead><tbody>{deferredRows.slice((currentPage-1)*pageSize,currentPage*pageSize).map(c => <tr key={c.slug}><th scope="row" className="coin-column"><div className="coin-identity"><button className={"favorite-button " + (favorites.has(c.slug) ? "saved" : "")} aria-pressed={favorites.has(c.slug)} aria-label={c.name + " 관심종목 " + (favorites.has(c.slug) ? "해제" : "추가")} onClick={() => toggleFavorite(c.slug)}><Star size={15} fill={favorites.has(c.slug) ? "currentColor" : "none"}/></button><button className="coin-open" aria-label={c.name + " 상세 보기"} onClick={() => setSelectedSlug(c.slug)}>{c.logo && <img src={c.logo} alt="" width={27} height={27} loading="lazy"/>}<span><strong>{c.name}</strong><small>{c.symbol ?? "심볼 미확인"} · {c.category ?? "섹터 미확인"}</small></span></button></div>{c.identityStatus !== "verified" && <span className="row-data-issue">토큰 연결 확인 필요</span>}{prefs.view === "issues" && <p className="row-data-issue">{c.opportunities.dataIssues.slice(0,2).join(" · ")}</p>}{prefs.view === "changes" && <span className="row-data-issue">확인 기준 이후 금액·신호 변화</span>}</th>{selectedCols.map(col => <td key={col.key}>{METRIC_KEYS.has(col.key) ? <button className="metric-open" aria-label={c.name + " " + col.label + " 계산 근거"} onClick={() => setSelectedSlug(c.slug)}>{renderCell(c,col.key,prefs.capital)}</button> : renderCell(c,col.key,prefs.capital)}</td>)}</tr>)}</tbody></table>
        </div>
        {!deferredRows.length && <div className="empty-state"><Search size={26}/><h3>{!data ? "자료를 준비하고 있습니다" : prefs.view === "favorites" && !favorites.size ? "별표로 관심종목을 모아 보세요" : "조건에 맞는 종목이 없습니다"}</h3><p>{!data ? error ?? "공개 데이터 응답을 기다립니다." : "필터에서 조건을 조절하세요. 표시 열은 그대로 유지됩니다."}</p><button className="button" onClick={!data ? () => void refresh() : resetFilters}>{!data ? "다시 확인" : "필터 초기화"}</button></div>}
        <Pagination total={deferredRows.length} page={currentPage} size={pageSize} position="bottom" onPage={goPage} onSize={s => { setPageSize(s); setPage(1); }}/>
        <footer className="table-footnote"><p>‘–’는 자료 부족·비적용·검토 보류입니다. 0과 구분합니다. 단기 환원의 연환산은 일회성 매입에 민감합니다.</p><p>USD 표시 · M=백만, B=10억 · 시총 $1M 이상 · 토큰은 회사 지분과 권리가 다릅니다 · 낮은 배수만으로 저평가를 판단하지 않습니다.</p></footer>
      </section>
    </div>
    <footer className="app-footer"><p>DefiLlama · CoinMarketCap · CoinGecko · 개별 매출 출처</p><p>이 브라우저의 {historyCount}일 관측 기록 · 최근 60일 보관</p></footer>
    {(popup === "filters" || popup === "columns") && <SettingsDialog title={popup === "filters" ? "필터" : "표시 설정"} wide={popup === "columns"} onClose={() => setPopup(null)}>{popup === "filters" ? <div className="sidebar-body" aria-label="필터 설정"><p className="sidebar-hint">{capitalName} 기준 · 전체 {coins.length}개 종목의 자료를 확인합니다.</p>
          <fieldset className="filter-section"><legend>배수와 자료 상태</legend><div className="choice-buttons availability-buttons" role="group" aria-label="확인 가능한 지표">{(Object.keys(AVAILABILITY_LABELS) as AvailableMetric[]).map(key => <button key={key} aria-pressed={prefs.available === key} onClick={() => update("available",key)}>{AVAILABILITY_LABELS[key]} <span>{key === "all" ? coverage.total : key === "any" ? coverage.unique : coverage[key]}</span></button>)}</div></fieldset>
          <fieldset className="filter-section"><legend>자료 유무를 확인할 기간</legend><div className="choice-buttons" role="group" aria-label="자료 확인 기간">{(["any",7,30,90,365] as const).map(days => <button key={days} aria-pressed={prefs.coverageWindow === days} onClick={() => update("coverageWindow",days)}>{days === "any" ? "기간 중 하나" : windowLabel(days)}</button>)}</div><p className="sidebar-hint">P/R·P/HR 필터와 제공 종목 수에 적용됩니다. P/S는 개별 매출 자료의 기준 기간을 사용합니다.</p></fieldset>
          <label className="sidebar-label">섹터<select aria-label="섹터" value={prefs.category} onChange={e => update("category", e.target.value)}><option value="">모든 섹터</option>{data?.categories.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
          <UsdRangeFilter label="유통 시총" minUsd={prefs.minMcap} maxUsd={prefs.maxMcap} onMinChange={v => update("minMcap", v)} onMaxChange={v => update("maxMcap", v)}/>
          <div className="simple-range"><label>P/S 최대 배수<input aria-label="P/S 최대 배수" type="number" min="0" placeholder="제한 없음" value={prefs.maxPs || ""} onChange={e => update("maxPs", Math.max(0, Number(e.target.value)))}/></label><label>P/HR 30일 최대 배수<input aria-label="P/HR 30일 최대 배수" type="number" min="0" placeholder="제한 없음" value={prefs.maxPhr || ""} onChange={e => update("maxPhr", Math.max(0, Number(e.target.value)))}/></label></div>
          <label className="inline-check"><input type="checkbox" checked={prefs.verifiedOnly} onChange={e => update("verifiedOnly", e.target.checked)}/>토큰 연결 확인된 종목만</label>
          <label className="inline-check"><input type="checkbox" checked={prefs.hideDilution} onChange={e => update("hideDilution", e.target.checked)}/>FDV가 시총의 3.33배 초과인 종목 제외</label>
          <details className="extra-views" open={!["all", "favorites"].includes(prefs.view)}><summary>변화·자료 상태로 좁히기</summary><div className="choice-buttons" role="group" aria-label="추가 종목 조건">{VIEWS.slice(2).map(v => <button key={v.key} aria-pressed={prefs.view === v.key} onClick={() => update("view", prefs.view === v.key ? "all" : v.key)}>{v.label}</button>)}</div></details>
          <button className="text-button reset-control" onClick={resetFilters}>필터 초기화</button>
        </div> : <div className="column-settings" aria-label="표시 열 설정"><section>
          <p className="sidebar-hint" id="column-drag-help">점 손잡이를 드래그해 순서를 바꾸세요.<br/>표 머리글에서도 이동할 수 있습니다. 키보드는 손잡이에서 방향키, 취소는 Esc.</p>
          <ol className="selected-columns" aria-label="선택한 열 순서" data-reorder-zone="columns">{selectedCols.map((c,i) => <li key={c.key} data-column-key={c.key} className={dragClass(c.key,"columns")}>
            <button className="column-drag-handle" aria-label={c.label + " 순서 이동"} aria-describedby="column-drag-help" title="드래그 또는 방향키로 이동" {...columnDrag.handle(c.key,"columns")}><GripVertical size={16}/></button>
            <span>{c.label}</span><div><button className="order-button" disabled={i === 0} aria-label={c.label + " 왼쪽으로 이동"} onClick={() => moveColumn(i,-1)}><ChevronUp size={14}/></button><button className="order-button" disabled={i === selectedCols.length-1} aria-label={c.label + " 오른쪽으로 이동"} onClick={() => moveColumn(i,1)}><ChevronDown size={14}/></button><button className="order-button" disabled={selectedCols.length === 1} aria-label={c.label + " 열 숨기기"} onClick={() => toggleColumn(c.key)}><X size={13}/></button></div>
          </li>)}</ol>
          <div className="column-add-actions"><button className="button" onClick={() => addPeriods("phr")}>P/HR 4개 기간 함께 보기</button><button className="button" onClick={() => addPeriods("pr")}>P/R 4개 기간 함께 보기</button></div>
          </section><section><input className="column-search" aria-label="표시 열 검색" placeholder="추가할 지표 검색" value={columnSearch} onChange={e => setColumnSearch(e.target.value)}/>
          {(Object.keys(COLUMN_GROUP_LABELS) as ColumnGroup[]).map(group => <details className="column-group" key={group} open={!!columnSearch || group === "valuation"}><summary>{COLUMN_GROUP_LABELS[group]}</summary>{COLS.filter(c => c.group === group && (c.label + " " + c.title).toLowerCase().includes(columnSearch.toLowerCase())).map(c => <label className="column-option" key={c.key} title={c.title}><input type="checkbox" aria-label={c.label + " 표시"} checked={prefs.columns.includes(c.key)} disabled={prefs.columns.length === 1 && prefs.columns[0] === c.key} onChange={() => toggleColumn(c.key)}/><span>{c.label}</span></label>)}</details>)}
          <button className="text-button reset-control" onClick={() => update("columns", [...DEFAULT_VISIBLE_COLUMNS])}>기본 열로 되돌리기</button>
        </section></div>}</SettingsDialog>}
    {popup === "coverage" && <SettingsDialog title="자료 제공 현황" onClose={() => setPopup(null)}><p>전체 {coins.length}개 · {capitalName} 기준 · {windowLabel(prefs.coverageWindow)}</p><dl className="coverage-summary"><div><dt>배수 산출 가능 · 중복 제외</dt><dd>{coverage.unique}개</dd></div><div><dt>원천 자료 있음 · 배수 보류</dt><dd>{coverage.review}개</dd></div><div><dt>해당 기간 원천 자료 없음</dt><dd>{coverage.missing}개</dd></div></dl><p className="sidebar-hint">세 항목을 합하면 전체 종목 수입니다. 배수 보류에는 0·음수, 정의·토큰 연결·FDV·기간 이력 미확인이 포함됩니다. 자료가 없다는 표시만으로 실제 매출이 없다고 판단할 수 없습니다.</p><div className="coverage-metrics">P/S {coverage.sales} · P/R {coverage.revenue} · P/HR {coverage.holder}</div><p>위 지표별 종목 수는 서로 겹칩니다. 합산하면 안 됩니다.</p><button className="button" onClick={() => setPopup("filters")}>기간과 자료 조건 바꾸기</button></SettingsDialog>}
    {sourceOpen && <DataGuide onClose={() => setSourceOpen(false)} data={data} checkedAt={checkedAt}/>}
    {selectedCoin && <CoinDetail coin={selectedCoin} history={history} multipleReference={null} capital={prefs.capital} change={changes.get(selectedCoin.slug)!} onClose={() => setSelectedSlug(null)}/>}
  </main>;
}
