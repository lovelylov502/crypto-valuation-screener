"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns3, Download, RefreshCw, Search, SlidersHorizontal, Star, X, PanelLeftClose, PanelLeftOpen, ChevronDown, ChevronUp, Info } from "lucide-react";
import type { ScreenerResponse } from "@/lib/types";
import { fmtKstMinute } from "@/lib/format";
import { revenueGrowing } from "@/lib/research";
import { matchesRange, parseFavoriteSlugs, serializeFavoriteSlugs } from "@/lib/screenerFilters";
import { DEFAULT_VISIBLE_COLUMNS, SCREENER_COLUMNS as COLS, COLUMN_GROUP_LABELS, type ColumnGroup, type SortKey } from "@/lib/screenerColumns";
import { defaultPreferences, parseWorkspace, resetWorkspaceFilters, WORKSPACE_KEY, type WorkspacePreferences, type UniverseView } from "@/lib/workspacePreferences";
import { compareSnapshot, makeSnapshot } from "@/lib/snapshotHistory";
import { SNAPSHOT_STALE_MS } from "@/lib/screenerRefresh";
import { salesMultiple, protocolMultiple, holderMultiple, type CapitalBasis } from "@/lib/valuationMetrics";
import { revenueBasis } from "@/lib/revenueHistory";
import { CoinDetail } from "./CoinDetail";
import { renderCell, sortValue } from "./ScreenerCells";
import { UsdRangeFilter } from "./RangeFilters";
import { useScreenerData } from "./useScreenerData";
import { Pagination } from "./Pagination";
import { PAGE_SIZE_KEY, parsePageSize } from "@/lib/pagination";
import { useWindowTableHeader } from "./useWindowTableHeader";
import { DataGuide } from "./DataGuide";

const FAVORITES_KEY = "crypto-valuation-favorites-v1";
const VIEWS: { key: UniverseView; label: string }[] = [{ key: "all", label: "전체 종목" }, { key: "favorites", label: "관심종목" }, { key: "growth", label: "사업 수익 성장" }, { key: "holder", label: "홀더 환원 관측" }, { key: "changes", label: "확인 후 변화" }, { key: "issues", label: "자료 확인 필요" }];
const METRIC_KEYS = new Set(["psSales", "pr", "pr7d", "pr90d", "pr1y", "phr", "phr7d", "phr90d", "phr1y"]);

export function ScreenerClient({ initialData }: { initialData: ScreenerResponse | null }) {
  const { data, refreshing, refresh, message, error, checkedAt, baseline, historyCount, acknowledge, storageError, now, history } = useScreenerData(initialData);
  const [prefs, setPrefs] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<"filters" | "columns">("filters");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [columnSearch, setColumnSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const tableRef = useWindowTableHeader();
  useEffect(() => {
    try {
      setPrefs(parseWorkspace(localStorage.getItem(WORKSPACE_KEY)));
      setFavorites(parseFavoriteSlugs(localStorage.getItem(FAVORITES_KEY)));
      setPageSize(parsePageSize(localStorage.getItem(PAGE_SIZE_KEY)));
    } catch { setPreferencesError(true); }
    setSidebarOpen(!window.matchMedia("(max-width: 900px)").matches);
    setReady(true);
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => setMobile(query.matches);
    sync(); query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!mobile || !sidebarOpen) return;
    const panel = sidebarRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLButtonElement>("button")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setSidebarOpen(false); }
      if (e.key !== "Tab" || !panel) return;
      const controls = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,summary')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown",trap); document.body.style.overflow = overflow; previous?.focus({preventScroll:true}); };
  }, [mobile,sidebarOpen]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(prefs));
      localStorage.setItem(FAVORITES_KEY, serializeFavoriteSlugs(favorites));
      localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
    } catch { setPreferencesError(true); }
  }, [ready, prefs, favorites, pageSize]);
  const update = <K extends keyof WorkspacePreferences,>(key: K, value: WorkspacePreferences[K]) => { setPrefs(p => ({ ...p, [key]: value })); if (key !== "columns") setPage(1); };
  const toggleFavorite = (slug: string) => setFavorites(prev => { const next = new Set(prev); if (next.has(slug)) next.delete(slug); else next.add(slug); return next; });
  const resetFilters = () => { setPrefs(resetWorkspaceFilters); setPage(1); };
  const toggleColumn = (key: SortKey) => update("columns", prefs.columns.includes(key) ? prefs.columns.length > 1 ? prefs.columns.filter(k => k !== key) : prefs.columns : [...prefs.columns, key]);
  const moveColumn = (index: number, by: number) => { const cols = [...prefs.columns]; [cols[index], cols[index + by]] = [cols[index + by], cols[index]]; update("columns", cols); };
  const addPeriods = (prefix: "phr" | "pr") => update("columns", [...new Set<SortKey>([...prefs.columns, (prefix + "1y") as SortKey, (prefix + "90d") as SortKey, prefix, (prefix + "7d") as SortKey])]);
  const coins = useMemo(() => data?.coins ?? [], [data]);
  const comparisonBaseline = baseline && data && Date.parse(baseline.at) <= Date.parse(data.updatedAt) ? baseline : null;
  const changes = useMemo(() => new Map(coins.map(c => [c.slug, compareSnapshot(c, comparisonBaseline, data?.scoreVersion ?? "")])), [coins, comparisonBaseline, data?.scoreVersion]);
  const coverage = useMemo(() => ({ sales: coins.filter(c => salesMultiple(c, prefs.capital) !== null).length, revenue: coins.filter(c => protocolMultiple(c, 30, prefs.capital) !== null).length, holder: coins.filter(c => holderMultiple(c, 30, prefs.capital) !== null).length }), [coins, prefs.capital]);
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
    const ps = salesMultiple(c, prefs.capital), pr = protocolMultiple(c, 30, prefs.capital), phr = holderMultiple(c, 30, prefs.capital);
    if ((prefs.available === "sales" && ps === null) || (prefs.available === "revenue" && pr === null) || (prefs.available === "holder" && phr === null)) return false;
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
  return <main className={"research-app valuation-workspace " + (sidebarOpen ? "sidebar-open" : "sidebar-closed")}>
    <a className="skip-link" href="#screener-results">결과 표로 이동</a>
    <header className="valuation-header"><div className="brand-mark" aria-hidden="true">V</div><div><h1>크립토 밸류 스캐너</h1><p>가격과 사업, 홀더에게 돌아오는 가치를 함께</p></div><div className="header-actions"><span className={"freshness " + (stale || sourceFailures ? "caution" : "")}>{!data ? "자료 준비 중" : stale ? "자료 갱신 필요" : sourceFailures ? "일부 수집 실패" : "최근 수집 자료"}</span><button className="button" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? "spinning" : ""} />{refreshing ? "확인 중" : "최신 자료 확인"}</button></div></header>
    <div className="workspace-status" role="status"><span>{data ? fmtKstMinute(data.updatedAt) + " 수집" : "첫 자료를 준비합니다"} · {error ?? message ?? "페이지를 다시 열면 최신 자료를 확인합니다"}</span><button onClick={() => setSourceOpen(v => !v)} className="text-button" aria-expanded={sourceOpen}>데이터 안내 <Info size={13} /></button></div>
    {(storageError || preferencesError) && <p className="notice">브라우저 저장소를 사용할 수 없어 설정·관심종목·기록이 유지되지 않을 수 있습니다.</p>}
    <div className="valuation-layout">
      <button className="sidebar-scrim" aria-label="조작창 닫기" onClick={() => setSidebarOpen(false)} hidden={!sidebarOpen} />
      <aside ref={sidebarRef} role={mobile ? "dialog" : undefined} aria-modal={mobile && sidebarOpen ? true : undefined} className="control-sidebar" aria-label="검색과 비교 설정" hidden={!sidebarOpen}>
        <div className="sidebar-heading"><strong>비교 설정</strong><button className="icon-button" aria-label="조작창 접기" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button></div>
        <label className="search-box"><Search size={16}/><input aria-label="코인 또는 심볼 검색" placeholder="이름 또는 심볼 검색" value={prefs.search} onChange={e => update("search", e.target.value)}/>{prefs.search && <button aria-label="검색 지우기" onClick={() => update("search", "")}><X size={14}/></button>}</label>
        <label className="sidebar-label">종목 목록<select aria-label="종목 목록" value={prefs.view} onChange={e => update("view", e.target.value as UniverseView)}>{VIEWS.map(v => <option key={v.key} value={v.key}>{v.label}{v.key === "favorites" ? " (" + coins.filter(c => favorites.has(c.slug)).length + ")" : ""}</option>)}</select></label>
        <div className="sidebar-tabs" aria-label="조작창 내용"><button aria-pressed={panel === "filters"} onClick={() => setPanel("filters")}><SlidersHorizontal size={14}/>필터{activeFilters > 0 && <span>{activeFilters}</span>}</button><button aria-pressed={panel === "columns"} onClick={() => setPanel("columns")}><Columns3 size={14}/>표시 열 <span>{prefs.columns.length}</span></button></div>
        {panel === "filters" ? <div className="sidebar-body" aria-label="필터 설정">
          <label className="sidebar-label">배수 계산에 쓸 토큰 가치<select aria-label="배수 분자" value={prefs.capital} onChange={e => update("capital", e.target.value as CapitalBasis)}><option value="mcap">유통 시총 · 현재 유통량</option><option value="fdv">FDV · 완전희석가치</option></select><small>선택한 기준은 P/S · P/R · P/HR에 함께 적용됩니다.</small></label>
          <label className="sidebar-label">확인 가능한 지표<select aria-label="확인 가능한 지표" value={prefs.available} onChange={e => update("available", e.target.value as WorkspacePreferences["available"])}><option value="all">전체 · 자료 부족 포함</option><option value="sales">P/S 사업 매출 자료 있음 ({coverage.sales})</option><option value="revenue">P/R 프로토콜 수익 있음 ({coverage.revenue})</option><option value="holder">P/HR 환원 이력 있음 ({coverage.holder})</option></select></label>
          <label className="sidebar-label">섹터<select aria-label="섹터" value={prefs.category} onChange={e => update("category", e.target.value)}><option value="">모든 섹터</option>{data?.categories.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
          <UsdRangeFilter label="유통 시총" minUsd={prefs.minMcap} maxUsd={prefs.maxMcap} onMinChange={v => update("minMcap", v)} onMaxChange={v => update("maxMcap", v)}/>
          <div className="simple-range"><label>P/S 최대 배수<input aria-label="P/S 최대 배수" type="number" min="0" placeholder="제한 없음" value={prefs.maxPs || ""} onChange={e => update("maxPs", Math.max(0, Number(e.target.value)))}/></label><label>P/HR 30일 최대 배수<input aria-label="P/HR 30일 최대 배수" type="number" min="0" placeholder="제한 없음" value={prefs.maxPhr || ""} onChange={e => update("maxPhr", Math.max(0, Number(e.target.value)))}/></label></div>
          <label className="inline-check"><input type="checkbox" checked={prefs.verifiedOnly} onChange={e => update("verifiedOnly", e.target.checked)}/>토큰 연결 확인된 종목만</label>
          <label className="inline-check"><input type="checkbox" checked={prefs.hideDilution} onChange={e => update("hideDilution", e.target.checked)}/>FDV가 시총의 3.33배 초과인 종목 제외</label>
          <button className="text-button reset-control" onClick={resetFilters}>필터 초기화</button>
          <p className="sidebar-hint">조건을 바꿔도 표시 열은 유지됩니다.<br/>선택한 조건과 열 순서는 자동 저장됩니다.</p>
        </div> : <div className="sidebar-body" aria-label="표시 열 설정">
          <p className="sidebar-hint">코인 이름은 고정됩니다. 화살표로 열 순서를 바꿀 수 있습니다.</p>
          <div className="column-add-actions"><button className="button" onClick={() => addPeriods("phr")}>P/HR 4개 기간 추가</button><button className="button" onClick={() => addPeriods("pr")}>P/R 4개 기간 추가</button></div>
          <ol className="selected-columns" aria-label="선택한 열 순서">{selectedCols.map((c,i) => <li key={c.key}><span>{c.label}</span><div><button className="order-button" disabled={i === 0} aria-label={c.label + " 왼쪽으로 이동"} onClick={() => moveColumn(i,-1)}><ChevronUp size={14}/></button><button className="order-button" disabled={i === selectedCols.length-1} aria-label={c.label + " 오른쪽으로 이동"} onClick={() => moveColumn(i,1)}><ChevronDown size={14}/></button><button className="order-button" disabled={selectedCols.length === 1} aria-label={c.label + " 열 숨기기"} onClick={() => toggleColumn(c.key)}><X size={13}/></button></div></li>)}</ol>
          <input className="column-search" aria-label="표시 열 검색" placeholder="추가할 지표 검색" value={columnSearch} onChange={e => setColumnSearch(e.target.value)}/>
          {(Object.keys(COLUMN_GROUP_LABELS) as ColumnGroup[]).map(group => <details className="column-group" key={group} open={!!columnSearch || group === "valuation"}><summary>{COLUMN_GROUP_LABELS[group]}</summary>{COLS.filter(c => c.group === group && (c.label + " " + c.title).toLowerCase().includes(columnSearch.toLowerCase())).map(c => <label className="column-option" key={c.key} title={c.title}><input type="checkbox" aria-label={c.label + " 표시"} checked={prefs.columns.includes(c.key)} disabled={prefs.columns.length === 1 && prefs.columns[0] === c.key} onChange={() => toggleColumn(c.key)}/><span>{c.label}</span></label>)}</details>)}
          <button className="text-button reset-control" onClick={() => update("columns", [...DEFAULT_VISIBLE_COLUMNS])}>기본 열로 되돌리기</button>
        </div>}
      </aside>
      <section className="comparison-workspace" aria-label="스크리너">
        <div className="comparison-title"><div className="title-left"><button className="icon-button" aria-label={sidebarOpen ? "왼쪽 조작창 접기" : "왼쪽 조작창 열기"} onClick={() => setSidebarOpen(v => !v)}>{sidebarOpen ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={17}/>}</button><div><p className="workspace-eyebrow">TOKEN FUNDAMENTALS</p><h2>{VIEWS.find(v => v.key === prefs.view)?.label} <span>{deferredRows.length}<small> / {coins.length}</small></span></h2></div></div><button className="button" onClick={exportSnapshot} disabled={!data}><Download size={14}/>자료 내보내기</button></div>
        <div className="metric-guide"><span><b>P/S</b> 사업 매출</span><span><b>P/R</b> 프로토콜 귀속 수익</span><span><b>P/HR</b> 홀더 환원</span><button className="text-button" onClick={() => setSourceOpen(true)}>차이와 계산법</button></div>
        <div className="comparison-context"><span className="basis-pill">분자: 현재 {capitalName}</span><span>30·90·7일은 연환산 · 1년은 365일 합계</span><span>숫자를 누르면 계산 근거</span></div>
        {activeFilters > 0 && <div className="active-filters"><span>조건 {activeFilters}개 적용</span>{prefs.search && <button onClick={() => update("search", "")}>{prefs.search}<X size={12}/></button>}{prefs.available !== "all" && <span>{prefs.available === "sales" ? "P/S" : prefs.available === "revenue" ? "P/R" : "P/HR"} 자료 있음</span>}<button onClick={resetFilters}>필터 해제<X size={12}/></button></div>}
        {prefs.view === "changes" && <div className="comparison-note"><p>{baseline?.scoreVersion === data?.scoreVersion ? "확인 기준 " + fmtKstMinute(baseline!.at) + " · 같은 집계 범위의 금액 변화를 비교합니다." : "계산 기준이 바뀌었습니다. 현재 자료를 확인 기준으로 저장하면 다음 수집부터 비교합니다."}</p><button className="text-button" onClick={acknowledge}>여기까지 확인 완료</button></div>}
        <div className="results-heading" id="screener-results" ref={resultsRef} tabIndex={-1}><span className="coverage-note">배수 산출 가능 · P/S {coverage.sales} · P/R {coverage.revenue} · P/HR {coverage.holder}<span className="muted"> / 전체 {coins.length}</span></span><div><label className="sort-select">정렬 <select aria-label="결과 정렬" value={prefs.sortKey} onChange={e => onSort(e.target.value as SortKey)}><option value="name">종목명</option>{COLS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label><button className="icon-button" aria-label={prefs.sortDir === "asc" ? "내림차순으로 변경" : "오름차순으로 변경"} onClick={() => update("sortDir", prefs.sortDir === "asc" ? "desc" : "asc")}>{prefs.sortDir === "asc" ? <ArrowUp size={15}/> : <ArrowDown size={15}/>}</button></div></div>
        <Pagination total={deferredRows.length} page={currentPage} size={pageSize} position="top" onPage={goPage} onSize={s => { setPageSize(s); setPage(1); }}/>
        <div ref={tableRef} className="table-scroll thin-scroll" role="region" aria-label="프로토콜 비교 표 · 가로 스크롤 가능" tabIndex={0} aria-busy={rows !== deferredRows}>
          <table className="screener-table"><caption className="sr-only">토큰 가치와 매출·수익·환원 비교. 빈 값은 0이 아닙니다. 종목이나 숫자를 누르면 근거를 확인할 수 있습니다.</caption><thead><tr><th className="coin-column" scope="col" aria-sort={prefs.sortKey === "name" ? prefs.sortDir === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => onSort("name")}>종목</button></th>{selectedCols.map(col => <th key={col.key} scope="col" title={col.title} aria-sort={prefs.sortKey === col.key ? prefs.sortDir === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => onSort(col.key)}>{col.label}{prefs.sortKey === col.key && (prefs.sortDir === "asc" ? <ArrowUp size={12}/> : <ArrowDown size={12}/>)}</button>{METRIC_KEYS.has(col.key) && <small>{capitalName} 기준</small>}</th>)}</tr></thead><tbody>{deferredRows.slice((currentPage-1)*pageSize,currentPage*pageSize).map(c => <tr key={c.slug}><th scope="row" className="coin-column"><div className="coin-identity"><button className={"favorite-button " + (favorites.has(c.slug) ? "saved" : "")} aria-pressed={favorites.has(c.slug)} aria-label={c.name + " 관심종목 " + (favorites.has(c.slug) ? "해제" : "추가")} onClick={() => toggleFavorite(c.slug)}><Star size={15} fill={favorites.has(c.slug) ? "currentColor" : "none"}/></button><button className="coin-open" aria-label={c.name + " 상세 보기"} onClick={() => setSelectedSlug(c.slug)}>{c.logo && <img src={c.logo} alt="" width={27} height={27} loading="lazy"/>}<span><strong>{c.name}</strong><small>{c.symbol ?? "심볼 미확인"} · {c.category ?? "섹터 미확인"}</small></span></button></div>{c.identityStatus !== "verified" && <span className="row-data-issue">토큰 연결 확인 필요</span>}{prefs.view === "issues" && <p className="row-data-issue">{c.opportunities.dataIssues.slice(0,2).join(" · ")}</p>}{prefs.view === "changes" && <span className="row-data-issue">확인 기준 이후 금액·신호 변화</span>}</th>{selectedCols.map(col => <td key={col.key}>{METRIC_KEYS.has(col.key) ? <button className="metric-open" aria-label={c.name + " " + col.label + " 계산 근거"} onClick={() => setSelectedSlug(c.slug)}>{renderCell(c,col.key,prefs.capital)}</button> : renderCell(c,col.key,prefs.capital)}</td>)}</tr>)}</tbody></table>
        </div>
        {!deferredRows.length && <div className="empty-state"><Search size={26}/><h3>{!data ? "자료를 준비하고 있습니다" : prefs.view === "favorites" && !favorites.size ? "별표로 관심종목을 모아 보세요" : "조건에 맞는 종목이 없습니다"}</h3><p>{!data ? error ?? "공개 데이터 응답을 기다립니다." : "왼쪽에서 조건을 조절하세요. 표시 열은 그대로 유지됩니다."}</p><button className="button" onClick={!data ? () => void refresh() : resetFilters}>{!data ? "다시 확인" : "필터 초기화"}</button></div>}
        <Pagination total={deferredRows.length} page={currentPage} size={pageSize} position="bottom" onPage={goPage} onSize={s => { setPageSize(s); setPage(1); }}/>
        <footer className="table-footnote"><p>‘–’는 자료 부족·비적용·검토 보류입니다. 0과 구분합니다. 단기 환원의 연환산은 일회성 매입에 민감합니다.</p><p>USD 표시 · M=백만, B=10억 · 시총 $1M 이상 · 토큰은 회사 지분과 권리가 다릅니다 · 낮은 배수만으로 저평가를 판단하지 않습니다.</p></footer>
      </section>
    </div>
    <footer className="app-footer"><p>DefiLlama · CoinMarketCap · CoinGecko · 개별 매출 출처</p><p>이 브라우저의 {historyCount}일 관측 기록 · 최근 60일 보관</p></footer>
    {sourceOpen && <DataGuide onClose={() => setSourceOpen(false)} data={data} checkedAt={checkedAt}/>}
    {selectedCoin && <CoinDetail coin={selectedCoin} history={history} multipleReference={null} capital={prefs.capital} change={changes.get(selectedCoin.slug)!} onClose={() => setSelectedSlug(null)}/>}
  </main>;
}
