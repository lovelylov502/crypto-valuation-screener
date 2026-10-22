"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, Info, RefreshCw, RotateCcw, Search, SlidersHorizontal, Star, X } from "lucide-react";
import type { CoinScored } from "@/lib/types";
import type { ScreenerPage } from "@/lib/screenerQuery";
import { tableCell, type TablePage, type TableRow, type TableDetail } from "@/lib/tableDto";
import { validateTableDetail } from "@/lib/tableDetail";
import { readJsonText } from "@/lib/jsonTransport.mjs";
import { fmtKstMinute, fmtMult, fmtUsd } from "@/lib/format";
import { parseFavoriteSlugs, serializeFavoriteSlugs } from "@/lib/screenerFilters";
import { DEFAULT_VISIBLE_COLUMNS, SCREENER_COLUMNS as COLS, type SortKey } from "@/lib/screenerColumns";
import { defaultPreferences, parseWorkspace, resetWorkspaceFilters, workspaceMigrationNotice, WORKSPACE_KEY, type WorkspacePreferences } from "@/lib/workspacePreferences";
import { referenceMultiples } from "@/lib/referenceMetrics";
import { UsdRangeFilter } from "./RangeFilters";
import { Pagination } from "./Pagination";
import { PAGE_SIZE_KEY, parsePageSize } from "@/lib/pagination";
import { useWindowTableHeader } from "./useWindowTableHeader";
import { SettingsDialog } from "./SettingsDialog";
import { AVAILABILITY_LABELS, METRIC_WINDOWS, METRIC_COLUMN_DAYS, windowLabel, type AvailableMetric } from "@/lib/metricCoverage";
import { DataGuide } from "./DataGuide";
import { CoinDetailDialog } from "./CoinDetailDialog";
import { pageUrl, useScreenerPage } from "./useScreenerPage";
import { BRAND } from "@/lib/brand";
import { CollectionStatus } from "./CollectionStatus";
import { publicationComparisonSummary } from "@/lib/collectionHealth";
import { ThemeSwitch } from "./ThemeSwitch";
import { metricStatus } from "@/lib/metricStatus";
import { version as APP_VERSION } from "@/package.json";

import { ValuationComparisonCell } from "./ValuationComparisonCell";
import { comparisonEnvelopeValid, comparisonReading } from "@/lib/valuationComparison";
import { CandidateMap, type DiscoveryDetail } from "./CandidateMap";
import { Watchlist } from "./Watchlist";
import { useWatchNotes } from "./useWatchNotes";
import type { DiscoveryPage, DiscoveryRow } from "@/lib/discoveryTypes";

const FAVORITES_KEY = "crypto-valuation-favorites-v1";

function MaximumMultipleInput({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
  const display = (n: number) => n > 0 ? String(n) : "";
  const [text, setText] = useState(() => display(value));
  useEffect(() => { setText(display(value)); }, [value]);
  return <input aria-label={label} type="number" inputMode="decimal" step="any" min="0" placeholder="제한 없음" value={text}
    onChange={e => {
      setText(e.target.value);
      if (e.target.validity.badInput) return;
      const next = e.target.valueAsNumber;
      onChange(Number.isFinite(next) && next > 0 ? next : 0);
    }}
    onBlur={() => setText(display(value))}
  />;
}

export function ScreenerClient({ initialData }: { initialData: TablePage | null }) {
  const [prefs, setPrefs] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [popup, setPopup] = useState<"filters" | "coverage" | null>(null);
  const [mcapRangeOpen, setMcapRangeOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState<"table" | "map" | "watchlist">("table");
  const [visited, setVisited] = useState({ map: false, watchlist: false });
  const [mapImport, setMapImport] = useState<WorkspacePreferences | null>(null);
  const [externalDetail, setExternalDetail] = useState<{ row: DiscoveryRow; page: DiscoveryPage } | null>(null);
  const notebook = useWatchNotes();
  const changeTab = (next: typeof tab) => { setTab(next); if (next !== "table") setVisited(prev => ({ ...prev, [next]: true })); setPopup(null); history.replaceState(null, "", `#${next}`); };
  useEffect(() => { const sync = () => { const next = location.hash.slice(1); if (next === "map" || next === "watchlist" || next === "table") { setTab(next); if (next !== "table") setVisited(prev => ({ ...prev, [next]: true })); } }; sync(); window.addEventListener("hashchange", sync); return () => window.removeEventListener("hashchange", sync); }, []);
  const resultsRef = useRef<HTMLDivElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const tableRef = useWindowTableHeader();
  const { data, publication, refreshing, refresh, error, checkedAt } = useScreenerPage(initialData, prefs, favorites, page, pageSize, ready);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_KEY);
      setPrefs(parseWorkspace(raw)); setMigrationNotice(workspaceMigrationNotice(raw));
      setFavorites(parseFavoriteSlugs(localStorage.getItem(FAVORITES_KEY)));
      setPageSize(parsePageSize(localStorage.getItem(PAGE_SIZE_KEY)));
    } catch { setStorageError(true); }
    setReady(true);
    const sync = (event: StorageEvent) => { if (event.key === FAVORITES_KEY) setFavorites(parseFavoriteSlugs(event.newValue)); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(prefs));
      localStorage.setItem(FAVORITES_KEY, serializeFavoriteSlugs(favorites));
      localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
    } catch { setStorageError(true); }
  }, [ready, prefs, favorites, pageSize]);
  const update = <K extends keyof WorkspacePreferences,>(key: K, value: WorkspacePreferences[K]) => { setPrefs(p => ({ ...p, [key]: value })); setPage(1); };
  const toggleFavorite = (slug: string) => setFavorites(prev => { const next = new Set(prev); if (next.has(slug)) next.delete(slug); else next.add(slug); return next; });
  const resetFilters = () => { setPrefs(resetWorkspaceFilters); setPage(1); };
  const onSort = (key: SortKey) => { setPrefs(p => ({ ...p, sortKey: key, sortDir: p.sortKey === key ? p.sortDir === "asc" ? "desc" : "asc" : METRIC_COLUMN_DAYS[key] || key === "name" ? "asc" : "desc" })); setPage(1); };
  const goPage = (n: number) => { setPage(n); setSelectedSlug(null); resultsRef.current?.scrollIntoView({ block: "start" }); };
  const openDetail = (slug: string, trigger?: HTMLButtonElement) => {
    setExternalDetail(null);
    detailTrigger.current = trigger ?? rowButtons.current.get(slug) ?? null;
    setSelectedSlug(slug);
  };
  const openDiscoveryDetail: DiscoveryDetail = (row, page, trigger) => { detailTrigger.current = trigger; setExternalDetail({ row, page }); setSelectedSlug(row.slug); };
  const selectedCols = DEFAULT_VISIBLE_COLUMNS.map(k => COLS.find(c => c.key === k)!);
  const comparison = comparisonEnvelopeValid(data?.valuationComparison, prefs.capital) ? data!.valuationComparison! : null;
  const activeFilters = [!!prefs.search, prefs.view !== "all", prefs.growingOnly, prefs.holderOnly, !!prefs.category, prefs.available !== "all", prefs.minMcap > 0 || prefs.maxMcap > 0, prefs.maxPr > 0, prefs.maxPhr > 0, prefs.minSourceAmount !== null, prefs.hideDilution, prefs.verifiedOnly].filter(Boolean).length;
  const capitalName = prefs.capital === "mcap" ? "유통 시총" : "FDV";
  const rows = data?.rows ?? [];
  const selectedRow = externalDetail?.row.slug === selectedSlug ? externalDetail.row : rows.find(c => c.slug === selectedSlug) ?? (detail?.coin.slug === selectedSlug ? { slug: detail.coin.slug, identity: detail.identity } : undefined);
  const detailPage = externalDetail?.page ?? data;
  const selectedCoin = detail?.coin.slug === selectedSlug && detail.publicationId === detailPage?.publicationId && detail.snapshotSha256 === detailPage?.snapshotSha256 && detail.identity === selectedRow?.identity ? detail.coin : null;
  useEffect(() => {
    if (!selectedRow || !detailPage) { setDetail(null); return; }
    setDetail(previous => previous?.coin.slug === selectedRow.slug ? previous : null);
    const controller = new AbortController(), expected = { slug: selectedRow.slug, identity: selectedRow.identity, publicationId: detailPage.publicationId, snapshotSha256: detailPage.snapshotSha256, updatedAt: detailPage.updatedAt };
    setStatus("상세 근거를 불러오고 있습니다.");
    void (async () => {
      try {
        const response = await fetch("/api/coin?" + new URLSearchParams({ slug: expected.slug, identity: expected.identity, publicationId: expected.publicationId }), { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
        if (response.status === 409) { refresh(); setSelectedSlug(null); setStatus("자료가 갱신되었습니다. 새 검증본을 확인한 뒤 종목을 다시 열어 주세요."); return; }
        if (!response.ok) throw Error("상세 근거를 불러오지 못했습니다. 다시 시도해 주세요.");
        const next = validateTableDetail(JSON.parse(await readJsonText(response)), expected);
        if (!controller.signal.aborted) { setDetail(next); setStatus(""); }
      } catch (error) { if (!controller.signal.aborted) { setSelectedSlug(null); setStatus(error instanceof Error ? error.message : "상세 조회 실패"); } }
    })();
    return () => controller.abort();
  }, [selectedSlug, selectedRow?.identity, detailPage?.publicationId, detailPage?.snapshotSha256, detailPage?.updatedAt, detailRetry]);
  const total = data?.pagination.filtered ?? 0;
  const currentPage = data?.pagination.page ?? 1;
  const coverage = data?.coverage;
  const sortIcon = (key: SortKey) => prefs.sortKey === key ? prefs.sortDir === "asc" ? <ArrowUp size={12}/> : <ArrowDown size={12}/> : null;

  const cell = (c: TableRow, key: SortKey) => {
    const days = METRIC_COLUMN_DAYS[key];
    if (days) {
      const { value, reason, basis } = tableCell(c, key)!;
      return <span className={value === null ? "unavailable-metric" : "ratio-reading"} title={reason}>{fmtMult(value)}{value === null ? <><small>{metricStatus(reason)}</small><span className="sr-only"> · {reason}</span></> : basis === "provider_total" && <small className="source-badge">{days === 365 ? "원천 1년" : "제공처 집계"}</small>}</span>;
    }
    return null;
  };

  const exportResults = async () => {
    setExporting(true); setStatus("전체 검색 결과를 모으고 있습니다.");
    try {
      const coins: CoinScored[] = []; let at: string | undefined, publicationId: string | undefined;
      for (let p = 1; ; p++) {
        const response = await fetch(pageUrl(prefs, favorites, p, 100), { cache: "no-store", signal: AbortSignal.timeout(90000) });
        if (!response.ok) throw new Error("내보낼 자료를 가져오지 못했습니다.");
        const next = await response.json() as ScreenerPage;
        if (at && (at !== next.updatedAt || publicationId !== next.publication?.published?.id)) throw new Error("수집 자료가 갱신되었습니다. 다시 내보내 주세요.");
        at = next.updatedAt; publicationId = next.publication?.published?.id; coins.push(...next.coins);
        if (coins.length >= next.pagination.filtered) break;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify({ updatedAt: at, preferences: prefs, coins, referenceMultiples: Object.fromEntries(coins.map(c => [c.slug, referenceMultiples(c, prefs.capital)])) })], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "tovenit-results.json"; a.click(); URL.revokeObjectURL(url);
      setStatus(`${coins.length}개 검색 결과를 내보냈습니다.`);
    } catch (e) { setStatus(e instanceof Error ? e.message : "내보내기 실패"); }
    finally { setExporting(false); }
  };

  return <main className="research-app valuation-workspace scan-workspace fixed-valuation-workspace">
    <a className="skip-link" href={tab === "table" ? "#screener-results" : `#panel-${tab}`}>내용으로 이동</a>
    <header className="valuation-header">
      <a className="brand-home" href="/" aria-label={`${BRAND.name} ${BRAND.koreanName} 홈`}>
        <img className="brand-mark" src="/brand/tovenit-mark.png" alt="" width={44} height={44}/>
        <div className="brand-title"><h1>{BRAND.name}<span className="sr-only"> {BRAND.koreanName}</span></h1><p>{BRAND.tagline}</p></div>
      </a>
      <div className="header-actions"><span className="header-status">{data ? fmtKstMinute(data.updatedAt) : "자료 준비 중"}</span><CollectionStatus data={data} publication={publication} error={error} refreshing={refreshing} checkedAt={checkedAt} onRefresh={refresh}/><button className="icon-button" aria-label="최신 자료 확인" title="최신 자료 확인" disabled={refreshing} onClick={refresh}><RefreshCw size={16} className={refreshing ? "spinning" : ""}/></button><button className="icon-button" aria-label="지표 안내" title="지표 안내" onClick={() => setSourceOpen(true)}><Info size={17}/></button><ThemeSwitch/></div>
    </header>
    {data && <p className="mobile-data-status">표시 자료 수집 · {fmtKstMinute(data.updatedAt)}</p>}
    {publication && (publication.incident || publication.attempt.outcome === "blocked") && <div className="publication-notice publication-blocked" role="status">
      <strong>새 수집본 공개 보류</strong>
      <span>{data ? `마지막으로 공개된 검증본(${fmtKstMinute(data.updatedAt)} 수집)을 표시합니다.` : "검사를 통과한 자료를 불러오고 있습니다."}</span>
      {publication.attempt.outcome === "blocked" && <span>{publicationComparisonSummary(publication)} 오른쪽 상단에서 원인과 이력을 볼 수 있습니다.</span>}
    </div>}
    {error && <div className="workspace-status" role="alert">{error} {data && "기존 결과를 표시하고 있습니다."}<button className="text-button" onClick={refresh}>다시 시도</button></div>}
    {storageError && <p className="notice">브라우저 저장소를 사용할 수 없어 설정·관심종목이 유지되지 않을 수 있습니다.</p>}
    {migrationNotice && <div className="migration-notice" role="status"><Info size={15}/><span>{migrationNotice}</span><button className="icon-button" aria-label="설정 변경 안내 닫기" onClick={() => setMigrationNotice(null)}><X size={16}/></button></div>}
    <nav className="workspace-tabs" aria-label="작업 공간"><div role="tablist" aria-label="종목 탐색 탭">{([{ id: "table", label: "전체종목", step: "01" }, { id: "map", label: "후보 지도", step: "02" }, { id: "watchlist", label: "관심종목", step: "03" }] as const).map((item, i, items) => <button key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => changeTab(item.id)} onKeyDown={e => { const next = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : -1; if (next >= 0) { e.preventDefault(); changeTab(items[next].id); document.getElementById(`tab-${items[next].id}`)?.focus(); } }}><span>{item.step}</span>{item.label}{item.id === "watchlist" && favorites.size > 0 && <small>{favorites.size}</small>}</button>)}</div><span className="workspace-tabs-hint">찾고 · 살펴보고 · 기록하기</span></nav>
    <section id="panel-table" role="tabpanel" aria-labelledby="tab-table" hidden={tab !== "table"}>
    <div className="scan-heading"><h2 aria-label="DefiLlama 전체 종목">전체 종목</h2><p>DefiLlama 원천 금액으로 참고 배수를 계산합니다. 수익 분류와 검토 상태는 따로 확인하세요.</p></div>
    <div className="scan-toolbar">
      <label className="search-box"><Search size={18}/><input aria-label="코인 또는 심볼 검색" placeholder="코인 또는 심볼 검색…" value={prefs.search} onChange={e => update("search", e.target.value)}/>{prefs.search && <button aria-label="검색 지우기" onClick={() => update("search", "")}><X size={15}/></button>}</label>
      <button className="icon-button watchlist-toggle" aria-label="관심종목만 보기" aria-pressed={prefs.view === "favorites"} title="관심종목만 보기" onClick={() => update("view", prefs.view === "favorites" ? "all" : "favorites")}><Star size={17} fill={prefs.view === "favorites" ? "currentColor" : "none"}/>{favorites.size > 0 && <small>{favorites.size}</small>}</button>
      <div className="capital-switch"><span>배수 기준</span><div className="choice-buttons" role="group" aria-label="배수 분자"><button aria-pressed={prefs.capital === "mcap"} onClick={() => update("capital", "mcap")}>유통 시총</button><button aria-pressed={prefs.capital === "fdv"} onClick={() => update("capital", "fdv")}>FDV</button></div></div>
      <button className="button filter-trigger" aria-label="필터" title="필터" onClick={() => { setMcapRangeOpen(prefs.minMcap > 0 || prefs.maxMcap > 0); setPopup("filters"); }}><SlidersHorizontal size={18}/>필터{activeFilters > 0 && <small>{activeFilters}</small>}</button>
      <button className="icon-button export-trigger" aria-label="검색 결과 전체 내보내기" title="검색 결과 전체 내보내기" disabled={exporting || !data} onClick={() => void exportResults()}><Download size={16}/></button>
      <button className="button table-to-map" onClick={() => { setMapImport({ ...prefs }); changeTab("map"); }}>지도에서 보기<ChevronRight size={14}/></button>
    </div>
    <div className="scan-meta" ref={resultsRef} id="screener-results" tabIndex={-1}>
      <button className="text-button" onClick={() => setPopup("coverage")}><span>프로젝트 {data?.pagination.total.toLocaleString() ?? "–"}개</span><span>·</span><span>연결 토큰 {data?.universe.linkedTokens.toLocaleString() ?? "–"}개</span><Info size={12}/></button>
      <span role="status">{refreshing ? "조회 중…" : `${total.toLocaleString()}개 표시 대상`}{prefs.view === "favorites" ? " · 관심종목" : ""}</span>
      {comparison && <span className="comparison-asof">과거 비교 기준: {comparison.asOf} UTC</span>}
      {activeFilters > 0 && <button className="text-button" onClick={resetFilters}>조건 {activeFilters}개 해제<X size={12}/></button>}
    </div>
    <div ref={tableRef} className="table-scroll scan-table-scroll thin-scroll" role="region" aria-label="프로토콜 비교 표" tabIndex={0} aria-busy={refreshing}>
      <table className="screener-table scan-table fixed-valuation-table"><caption className="sr-only">기간별 수익 기준 현재 P/R·P/HR과 하루 수익 기준 과거 배수 비교. 종목을 누르면 상세 팝업을 엽니다. 빈 값은 0이 아닙니다.</caption>
        <colgroup><col className="fixed-coin-col"/>{selectedCols.map(col => <col key={col.key} className="fixed-metric-col"/>)}<col className="fixed-history-col"/><col className="fixed-history-col"/></colgroup>
        <thead>
          <tr className="calculation-headings">
            <th className="coin-column" rowSpan={3} scope="col" aria-sort={prefs.sortKey === "name" ? prefs.sortDir === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => onSort("name")}>종목 · {capitalName}{sortIcon("name")}</button></th>
            <th colSpan={10} scope="colgroup"><strong>현재 배수 · 기간별 수익 기준</strong><span>최신 {capitalName} ÷ 해당 기간 수익의 연환산액</span><small>아래 기간은 수익 집계 기간입니다.</small></th>
            <th colSpan={2} scope="colgroup" className="history-band-start"><strong>과거 비교 · 하루 수익 기준</strong><span>해당 날짜 {capitalName} ÷ (그날 24시간 수익 × 365)</span><span className="comparison-key"><i>비교 범위: 이전 365일 중 계산 가능한 날짜</i><i className="comparison-blue">파란선: 중앙값보다 낮음</i><i className="comparison-red">붉은선: 높음</i></span></th>
          </tr>
          <tr className="current-group-headings"><th colSpan={5} scope="colgroup" className="band-heading">P/R · Revenue</th><th colSpan={5} scope="colgroup" className="band-heading">P/HR · Holders Revenue</th><th id="history-pr-column" rowSpan={2} scope="col" className="band-heading history-band-start">P/R 과거 비교</th><th id="history-phr-column" rowSpan={2} scope="col" className="band-heading">P/HR 과거 비교</th></tr>
          <tr className="current-period-headings">{selectedCols.map((col, i) => <th key={col.key} id={`period-${col.key}`} className={(i === 5 ? "band-start " : "") + (prefs.sortKey === col.key ? "active-sort" : "")} scope="col" title={col.title} aria-sort={prefs.sortKey === col.key ? prefs.sortDir === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => onSort(col.key)} aria-label={col.label + " 정렬"}><span className="compact-metric-name" aria-hidden="true">{col.key.startsWith("phr") ? "P/HR" : "P/R"}</span>{windowLabel(METRIC_COLUMN_DAYS[col.key]!)}{sortIcon(col.key)}</button></th>)}</tr>
        </thead>
        <tbody>{rows.map(c => <tr key={c.slug} className={"coin-row" + (selectedSlug === c.slug ? " selected-coin" : "")} onClick={event => {
            if ((event.target as Element).closest("button, a")) return;
            openDetail(c.slug);
          }}>
            <th scope="row" className="coin-column"><div className="coin-identity"><button className={"favorite-button " + (favorites.has(c.slug) ? "saved" : "")} aria-pressed={favorites.has(c.slug)} aria-label={c.name + " 관심종목 " + (favorites.has(c.slug) ? "해제" : "추가")} onClick={() => toggleFavorite(c.slug)}><Star size={13} fill={favorites.has(c.slug) ? "currentColor" : "none"}/></button><button className="coin-open" ref={el => { if (el) rowButtons.current.set(c.slug, el); else rowButtons.current.delete(c.slug); }} aria-label={c.name + " 상세 보기"} aria-haspopup="dialog" aria-expanded={selectedSlug === c.slug} aria-controls={selectedSlug === c.slug ? `detail-${c.slug}` : undefined} onClick={event => openDetail(c.slug, event.currentTarget)}>{selectedSlug === c.slug ? <ChevronDown size={16}/> : <ChevronRight size={16}/>} {c.logo && <img src={c.logo} alt="" width={32} height={32} loading="lazy"/>}<span><strong>{c.name} <em>{c.symbol}</em></strong><small>{c[prefs.capital] === null ? `${capitalName} 미확인` : `${capitalName} ${fmtUsd(c[prefs.capital])}`}{c.identityStatus !== "verified" && " · 연결 확인"}{c.hasIssues && <span className="caution-text"> · 자료 확인</span>}</small></span></button></div></th>
            {selectedCols.map((col, i) => <td key={col.key} headers={`period-${col.key}`} className={i === 5 ? "band-start" : ""}><button className="metric-open" tabIndex={-1} aria-label={c.name + " " + col.label + " 계산 근거"} onClick={event => openDetail(c.slug, event.currentTarget)}><span className="compact-period-label" aria-hidden="true"><b>{col.key.startsWith("phr") ? "P/HR" : "P/R"}</b>{windowLabel(METRIC_COLUMN_DAYS[col.key]!)}</span>{cell(c, col.key)}</button></td>)}
            {(["pr", "phr"] as const).map(metric => <td key={metric} headers={`history-${metric}-column`} className={"history-cell " + (metric === "pr" ? "history-band-start" : "band-start")}><button className="metric-open history-open" aria-label={c.name + (metric === "pr" ? " P/R" : " P/HR") + " 과거 비교와 상세 보기"} onClick={event => openDetail(c.slug, event.currentTarget)}><span className="comparison-mobile-name" aria-hidden="true">{metric === "pr" ? "P/R" : "P/HR"} 과거 비교</span><ValuationComparisonCell reading={data?.coverage.capital !== prefs.capital ? {status: "loading"} : comparisonReading(data?.valuationComparison, prefs.capital, c.slug, metric)} label={metric === "pr" ? "P/R" : "P/HR"} capitalLabel={capitalName}/></button></td>)}
          </tr>
        )}</tbody>
      </table>
    </div>
    {!rows.length && <div className="empty-state"><Search size={26}/><h3>{!data ? "자료를 준비하고 있습니다" : prefs.view === "favorites" && !favorites.size ? "별표로 관심종목을 모아 보세요" : "조건에 맞는 종목이 없습니다"}</h3><p>{!data ? "공개 자료 응답을 기다립니다." : "검색어 또는 필터 조건을 조절하세요."}</p><button className="button" onClick={!data ? refresh : resetFilters}>{!data ? "다시 확인" : "조건 초기화"}</button></div>}
    <div className="comparison-method"><p><strong>현재 배수</strong> 24시간·7일·30일·90일 수익은 연환산, 1년은 원천 수익 합계 기준입니다.</p><p><strong>과거 비교</strong> 이전 365일 중 배수를 계산할 수 있는 날짜만 비교하고, 사용한 일수를 표시합니다. 매일 그날의 가치와 24시간 수익으로 계산하며, 최신 시세와 관측 시점이 다를 수 있습니다.</p></div>
    <div className="table-legend"><span><b className="source-badge">제공처 집계</b> 제공처 기간 집계 · 완료일 이력과 구분</span><span><b>자료 부족</b> 기간 이력 미확보</span><span><b>미연결</b> 원천 자료 미연결</span></div>
    <div className="scan-footer"><p>원천 참고 배수 · 짧은 기간은 연환산 · 제공처 집계와 원천 1년 금액은 별도 표시<span className="app-version-persistent" aria-label="앱 버전">{`v${APP_VERSION}`}</span></p><Pagination total={total} page={currentPage} size={pageSize} position="top" onPage={goPage} onSize={s => { setPageSize(s); setPage(1); }}/></div>
    </section>
    <section id="panel-map" role="tabpanel" aria-labelledby="tab-map" tabIndex={-1} hidden={tab !== "map"}>{ready && visited.map && <CandidateMap favorites={favorites} onFavorite={toggleFavorite} onDetail={openDiscoveryDetail} imported={mapImport} onClearImport={() => setMapImport(null)} publicationId={data?.publicationId} onWatchlist={() => changeTab("watchlist")}/>}</section>
    <section id="panel-watchlist" role="tabpanel" aria-labelledby="tab-watchlist" tabIndex={-1} hidden={tab !== "watchlist"}>{ready && visited.watchlist && <Watchlist favorites={favorites} onFavorite={toggleFavorite} onRestoreFavorites={setFavorites} notes={notebook} onDetail={openDiscoveryDetail} publicationId={data?.publicationId} onMap={() => changeTab("map")} onTable={() => changeTab("table")}/>}</section>
    {status && <div className="discovery-status" role="status" aria-live="polite">{status}<button className="icon-button" aria-label="상세 조회 안내 닫기" onClick={() => { setStatus(""); if (!selectedCoin) setSelectedSlug(null); }}><X size={14}/></button></div>}
    {selectedCoin && detail && <CoinDetailDialog key={selectedCoin.slug} coin={selectedCoin} capital={externalDetail?.page.capital ?? prefs.capital} publicationId={detail.publicationId} snapshotUpdatedAt={detail.updatedAt} onRefreshPublication={() => { refresh(); setDetailRetry(value => value + 1); }} onClose={() => setSelectedSlug(null)} returnFocus={detailTrigger.current} favorite={favorites.has(selectedCoin.slug)} onFavorite={() => toggleFavorite(selectedCoin.slug)}/>}

    {popup === "filters" && <SettingsDialog title="필터" onClose={() => setPopup(null)} headerAction={<button className="text-button" onClick={resetFilters}><RotateCcw size={15}/>초기화</button>}><div className="sidebar-body filter-settings" aria-label="필터 설정">
      <p className="sidebar-hint">조건은 전체 프로젝트에 적용합니다. 가격 하락만으로 종목을 제외하지 않습니다.</p>
      <fieldset className="filter-section"><legend>조건 적용 기간</legend><div className="choice-buttons period-buttons filter-periods" role="group" aria-label="조건 적용 기간">{METRIC_WINDOWS.map(days => <button key={days} aria-pressed={prefs.rangeWindow === days} onClick={() => update("rangeWindow", days)}>{windowLabel(days)}</button>)}</div></fieldset>
      <fieldset className="filter-section source-amount-section"><legend>수익 금액</legend>
        <div className="choice-buttons source-metric-switch" role="group" aria-label="수익 원천 종류"><button aria-pressed={prefs.sourceMetric === "revenue"} onClick={() => update("sourceMetric", "revenue")}>Revenue 원천</button><button aria-pressed={prefs.sourceMetric === "holders"} onClick={() => update("sourceMetric", "holders")}>Holders Revenue 원천</button></div>
        <label className="source-amount-label">이 금액 이하 제외<span className="source-amount-input"><span aria-hidden="true">$</span><input aria-label="이 금액 이하 제외" aria-describedby="source-amount-hint source-amount-note" type="number" min="0" step="any" placeholder="제한 없음" value={prefs.minSourceAmount ?? ""} onChange={e => update("minSourceAmount", Number.isFinite(e.target.valueAsNumber) ? Math.max(0, e.target.valueAsNumber) : null)}/><span>USD</span></span></label>
        <p id="source-amount-hint" className="source-amount-hint">{prefs.minSourceAmount === null ? "금액을 입력하면 선택한 기간의 원천 수익으로 좁힙니다." : `최근 ${windowLabel(prefs.rangeWindow)} ${prefs.sourceMetric === "holders" ? "Holders Revenue" : "Revenue"}가 $${prefs.minSourceAmount.toLocaleString("en-US", { maximumFractionDigits: 20 })}를 초과하는 종목만 표시합니다.`}</p>
        <p id="source-amount-note" className="source-amount-note">선택 기간의 원천 합계 기준 · 금액 조건 적용 시 미확인 종목 제외</p>
      </fieldset>
      <div className="multiple-range"><label>P/R 최대 배수<span><MaximumMultipleInput label="P/R 최대 배수" value={prefs.maxPr} onChange={n => update("maxPr", n)}/><span>배</span></span></label><label>P/HR 최대 배수<span><MaximumMultipleInput label="P/HR 최대 배수" value={prefs.maxPhr} onChange={n => update("maxPhr", n)}/><span>배</span></span></label></div>
      <fieldset className="filter-section"><legend>함께 적용할 조건</legend><label className="inline-check"><input type="checkbox" checked={prefs.growingOnly} onChange={e => update("growingOnly", e.target.checked)}/>직전 동일 기간보다 수익 증가</label><label className="inline-check"><input type="checkbox" checked={prefs.holderOnly} onChange={e => update("holderOnly", e.target.checked)}/>해당 기간의 원천 홀더 금액 있음</label><label className="inline-check"><input type="checkbox" checked={prefs.view === "favorites"} onChange={e => update("view", e.target.checked ? "favorites" : "all")}/>관심종목만</label></fieldset>
      {prefs.view === "issues" && <p>기존 ‘자료 확인 필요’ 조건 적용 중 <button className="text-button" onClick={() => update("view", "all")}>해제</button></p>}
      <label className="sidebar-label">섹터<select aria-label="섹터" value={prefs.category} onChange={e => update("category", e.target.value)}><option value="">모든 섹터</option>{data?.categories.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
      <details className="filter-details" open={mcapRangeOpen} onToggle={e => setMcapRangeOpen(e.currentTarget.open)}><summary>유통 시총</summary><UsdRangeFilter label="유통 시총" minUsd={prefs.minMcap} maxUsd={prefs.maxMcap} onMinChange={v => update("minMcap", v)} onMaxChange={v => update("maxMcap", v)}/></details>
      <details className="filter-details" open={prefs.available !== "all"}><summary>자료 유무로 좁히기</summary><div className="choice-buttons period-buttons" role="group" aria-label="자료 확인 기간">{(["any", ...METRIC_WINDOWS] as const).map(days => <button key={days} aria-pressed={prefs.coverageWindow === days} onClick={() => update("coverageWindow", days)}>{days === "any" ? "기간 중 하나" : windowLabel(days)}</button>)}</div><div className="choice-buttons availability-buttons" role="group" aria-label="확인 가능한 지표">{(Object.keys(AVAILABILITY_LABELS) as AvailableMetric[]).filter(k => k !== "sales").map(key => <button key={key} aria-pressed={prefs.available === key} onClick={() => update("available", key)}>{AVAILABILITY_LABELS[key]}</button>)}</div></details>
      <details className="filter-details" open={prefs.verifiedOnly || prefs.hideDilution}><summary>토큰 연결 · 희석</summary><label className="inline-check"><input type="checkbox" checked={prefs.verifiedOnly} onChange={e => update("verifiedOnly", e.target.checked)}/>토큰 연결 확인된 종목만</label><label className="inline-check"><input type="checkbox" checked={prefs.hideDilution} onChange={e => update("hideDilution", e.target.checked)}/>FDV가 시총의 3.33배 초과인 종목 제외</label></details>
    </div></SettingsDialog>}
    {popup === "coverage" && <SettingsDialog title="수집 범위와 계산 가능 범위" onClose={() => setPopup(null)} footerNote="프로젝트 수와 고유 토큰 수는 다릅니다."><p>DefiLlama 프로토콜 목록·상위 프로젝트·수수료·수익·환원·DEX 목록을 합칩니다. 같은 상위 프로젝트의 제품은 한 행으로 묶습니다. 시총이나 수익 자료가 없어도 목록에 남습니다.</p><dl className="coverage-summary"><div><dt>전체 프로젝트</dt><dd>{data?.pagination.total}개</dd></div><div><dt>연결 확인한 고유 투자 토큰</dt><dd>{data?.universe.linkedTokens}개</dd></div><div><dt>현재 표시 지표 중 배수 계산 가능 · 검색 결과</dt><dd>{data?.visibleCoverage.unique} / {total}개</dd></div></dl><p>전체 프로젝트 · {capitalName} · {windowLabel(prefs.coverageWindow)}</p><dl className="coverage-summary"><div><dt>배수 산출 가능</dt><dd>{coverage?.unique}개</dd></div><div><dt>원천 자료 있음 · 배수 미산출</dt><dd>{coverage?.review}개</dd></div><div><dt>해당 기간 자료 미확보</dt><dd>{coverage?.missing}개</dd></div></dl><p>자료 미확보는 수익 0을 뜻하지 않습니다. P/R과 P/HR 집계는 서로 겹치며, 각 배수의 보류 사유는 행 아래 상세에서 확인할 수 있습니다.</p></SettingsDialog>}
    {sourceOpen && <DataGuide onClose={() => setSourceOpen(false)} data={data} checkedAt={checkedAt}/>}
  </main>;
}
