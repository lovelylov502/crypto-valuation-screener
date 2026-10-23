"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Maximize, RotateCcw, Save, Star, Trash2 } from "lucide-react";
import { defaultPreferences, type WorkspacePreferences } from "@/lib/workspacePreferences";
import { MAP_PERIODS, mapDate, periodName, type DiscoveryPage, type DiscoveryRow } from "@/lib/discoveryTypes";
import { defaultMapFilters, defaultMapWorkspace, mapFilterCount, mapFiltersFromTable, mapNamePosition, mapRevenueAt, matchesMapFilters, nearestMapPoint, parseMapWorkspace, MAP_WORKSPACE_KEY, type MapFilters } from "@/lib/mapWorkspace";
import { fmtKstMinute, fmtMult, fmtUsd } from "@/lib/format";
import { MapMarketCapRange } from "./MapMarketCapRange";
import { SettingsDialog } from "./SettingsDialog";
import { useDiscoveryData } from "./useDiscoveryData";

export type DiscoveryDetail = (row: DiscoveryRow, page: DiscoveryPage, trigger: HTMLButtonElement | null) => void;
type Area = { x1: number; y1: number; x2: number; y2: number };
const bounds = (values: number[]) => { const logs = values.filter(v => Number.isFinite(v) && v > 0).map(Math.log10); const low = Math.floor(Math.min(...logs, 0)), high = Math.ceil(Math.max(...logs, 1)); return [low, Math.max(low + 1, high)] as const; };
const ticks = (domain: readonly [number, number]) => Array.from({ length: domain[1] - domain[0] + 1 }, (_, i) => domain[0] + i).filter((_, i) => i % Math.max(1, Math.ceil((domain[1] - domain[0]) / 6)) === 0);
const axisNumber = (n: number) => n >= 1e9 ? n / 1e9 + "B" : n >= 1e6 ? n / 1e6 + "M" : n >= 1000 ? n / 1000 + "K" : n < .001 ? n.toExponential(0) : n.toLocaleString("en-US", { maximumFractionDigits: 6 });
const inside = (x: number, y: number, a: Area) => x >= Math.min(a.x1, a.x2) && x <= Math.max(a.x1, a.x2) && y >= Math.min(a.y1, a.y2) && y <= Math.max(a.y1, a.y2);

export function CandidateMap({ favorites, onFavorite, onDetail, imported, onClearImport, publicationId, onPublicationChanged }: {
  favorites: Set<string>; onFavorite: (slug: string) => void; onDetail: DiscoveryDetail;
  imported: WorkspacePreferences | null; onClearImport: () => void; publicationId?: string; onPublicationChanged?: () => void;
}) {
  const [workspace, setWorkspace] = useState(defaultMapWorkspace), [ready, setReady] = useState(false);
  const { filters, inherited, saved, selected } = workspace, { capital, period } = filters;
  const [page, setPage] = useState(1), [area, setArea] = useState<Area | null>(null), [selecting, setSelecting] = useState(false), [listOpen, setListOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null), [width, setWidth] = useState(1000);
  const [saveOpen, setSaveOpen] = useState(false), [saveName, setSaveName] = useState(""), [message, setMessage] = useState("");
  const wrapper = useRef<HTMLDivElement>(null), listToggle = useRef<HTMLButtonElement>(null), drag = useRef<Area | null>(null), pointerStart = useRef<{ x: number; y: number } | null>(null);
  const chartId = useId().replaceAll(":", "");
  useEffect(() => {
    try { setWorkspace(parseMapWorkspace(localStorage.getItem(MAP_WORKSPACE_KEY))); } catch { setMessage("브라우저 저장소를 사용할 수 없어 지도 조건이 유지되지 않을 수 있습니다."); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) try { localStorage.setItem(MAP_WORKSPACE_KEY, JSON.stringify(workspace)); } catch { setMessage("지도 조건을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요."); }
  }, [ready, workspace]);
  useEffect(() => {
    if (imported) setWorkspace(previous => ({ ...previous, filters: mapFiltersFromTable(imported), inherited: imported, selected: "" }));
  }, [imported]);
  const prefs = useMemo(() => ({
    ...(inherited ?? defaultPreferences()), capital, minMcap: 0, maxMcap: 0,
    maxPr: inherited && inherited.rangeWindow !== 30 ? inherited.maxPr : 0,
  }), [inherited, capital]);
  const { data, loading, error, refresh } = useDiscoveryData(prefs, favorites, "map", publicationId, onPublicationChanged);
  useEffect(() => {
    const el = wrapper.current; if (!el) return;
    const observer = new ResizeObserver(entries => { const w = entries[0].contentRect.width; if (w > 0) setWidth(w); });
    observer.observe(el); return () => observer.disconnect();
  }, []);
  useEffect(() => { setArea(null); setPage(1); setHover(null); }, [data, filters, width]);

  const update = (patch: Partial<MapFilters>) => { setMessage(""); setWorkspace(previous => ({ ...previous, filters: { ...previous.filters, ...patch } })); };
  const reset = () => {
    setWorkspace(previous => ({ ...previous, filters: { ...defaultMapFilters(), capital, period }, inherited: null, selected: "" }));
    onClearImport(); setArea(null); setPage(1); setMessage("");
  };
  const currentSaved = saved.find(item => item.name === selected);
  const modified = !!currentSaved && JSON.stringify([currentSaved.filters, currentSaved.inherited]) !== JSON.stringify([filters, inherited]);
  const filterCount = mapFilterCount(filters);
  const rows = useMemo(() => (data?.rows ?? []).filter(row => matchesMapFilters(row, filters)), [data, filters]);
  const comparisonRows = useMemo(() => (data?.rows ?? []).filter(row => matchesMapFilters(row, { ...filters, revenueGrowing: false, prFalling: false })), [data, filters]);
  const revenueComparable = comparisonRows.filter(row => mapRevenueAt(row, period) !== null).length;
  const prComparable = comparisonRows.filter(row => row.past[period]?.point).length;
  const prCandidates = useMemo(() => (data?.rows ?? []).filter(row => matchesMapFilters(row, { ...filters, prFalling: false })), [data, filters]);
  const prUnknown = prCandidates.filter(row => !row.past[period]?.point).length;
  const domains = useMemo(() => {
    const x: number[] = [], y: number[] = [];
    for (const row of data?.rows ?? []) {
      x.push(row.cells.pr.value!); y.push(row.revenue30d!);
      for (const past of Object.values(row.past)) if (past?.point) { x.push(past.point.pr); y.push(past.point.revenue); }
    }
    return { x: bounds(x), y: bounds(y) };
  }, [data]);
  const height = width < 600 ? 440 : Math.min(600, Math.max(480, width * .38)), left = width < 600 ? 58 : 72, right = Math.max(left + 20, width - 28), top = 38, bottom = height - 50;
  const sx = (n: number) => left + (Math.log10(n) - domains.x[0]) / (domains.x[1] - domains.x[0]) * (right - left);
  const sy = (n: number) => bottom - (Math.log10(n) - domains.y[0]) / (domains.y[1] - domains.y[0]) * (bottom - top);
  const plotted = rows.map(row => {
    const past = row.past[period]?.point, x = sx(row.cells.pr.value!), y = sy(row.revenue30d!);
    return { row, slug: row.slug, x, y, px: past ? sx(past.pr) : x, py: past ? sy(past.revenue) : y, past, hasPast: !!past,
      color: past ? row.cells.pr.value! < past.pr ? "down" : row.cells.pr.value! > past.pr ? "up" : "same" : "same" };
  });
  const arrows = plotted.filter(p => p.past).length, results = plotted.filter(p => !area || inside(p.x, p.y, area));
  const hovered = plotted.find(p => p.slug === hover), maxPage = Math.max(1, Math.ceil(results.length / 12)), shown = results.slice((Math.min(page, maxPage) - 1) * 12, Math.min(page, maxPage) * 12);
  const nameWidth = hovered ? Array.from(hovered.row.name).reduce((total, char) => total + (/[^\u0000-\u007f]/.test(char) ? 14 : 8), 12) : 0;
  const namePosition = hovered ? mapNamePosition(hovered, plotted, nameWidth, width, height) : null;
  const position = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * width / rect.width, y: (e.clientY - rect.top) * height / rect.height };
  };
  const open = (row: DiscoveryRow, trigger: HTMLButtonElement | null) => { if (data) onDetail(row, data, trigger); };
  const renderPoint = (p: typeof plotted[number]) => <g key={p.slug} data-coin={p.slug} className={hover === p.slug ? "map-coin is-hovered" : "map-coin"}>
    {p.past && <><line x1={p.px} y1={p.py} x2={p.x} y2={p.y} className={"map-line map-stroke-" + p.color} markerEnd={"url(#" + chartId + "-arrow-" + p.color + ")"}/><circle cx={p.px} cy={p.py} r={2.1} className={"map-past map-stroke-" + p.color}/></>}
    {hover === p.slug && <circle cx={p.x} cy={p.y} r={12} className={"map-hover-ring " + (favorites.has(p.slug) ? "is-favorite" : "map-stroke-" + p.color)}/>}
    <circle cx={p.x} cy={p.y} r={hover === p.slug ? 8 : favorites.has(p.slug) ? 4.5 : 3.5} className={"map-current " + (favorites.has(p.slug) ? "map-fill-favorite" : "map-fill-" + p.color)}/>
    {area && inside(p.x, p.y, area) && <circle cx={p.x} cy={p.y} r={8} className="map-selected-ring"/>}
  </g>;

  return <div className="discovery-space candidate-map-space">
    <div className="discovery-heading map-heading"><div><h2>후보 지도</h2><p>과거와 현재의 P/R·수익 변화를 살펴보세요.</p></div>
      <div className="map-save-controls"><select aria-label="저장한 지도 조건" value={modified ? "" : selected} onChange={e => {
        setMessage("");
        const condition = saved.find(item => item.name === e.target.value);
        if (condition) setWorkspace(previous => ({ ...previous, filters: { ...condition.filters }, inherited: condition.inherited, selected: condition.name }));
        else setWorkspace(previous => ({ ...previous, selected: "" }));
      }}><option value="">저장한 조건</option>{saved.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select>
        {modified && <span className="map-modified">수정됨</span>}
        {selected && <button className="icon-button" aria-label="선택한 지도 조건 삭제" onClick={() => { setWorkspace(previous => ({ ...previous, saved: previous.saved.filter(item => item.name !== selected), selected: "" })); setMessage("저장한 조건을 삭제했습니다. 현재 지도 조건은 유지합니다."); }}><Trash2 size={15}/></button>}
        <button className="button primary-button" disabled={!ready} onClick={() => { setSaveName(selected); setSaveOpen(true); }}><Save size={15}/>조건 저장</button>
      </div>
    </div>
    {inherited && <div className="discovery-banner"><span>전체종목의 검색·필터를 함께 적용 중입니다.{inherited.search && " 검색: " + inherited.search}</span><button className="text-button" onClick={() => { setWorkspace(previous => ({ ...previous, inherited: null })); onClearImport(); }}>가져온 조건 해제</button></div>}
    {message && <p className="map-message" role="status">{message}</p>}
    <div className="map-filter-panel">
      <div className="map-filter-primary"><MapMarketCapRange min={filters.minMcap} max={filters.maxMcap} onChange={update}/>
        <fieldset className="map-checks"><legend className="sr-only">지도 조건</legend>
          <label><input type="checkbox" checked={filters.revenueGrowing} onChange={e => update({ revenueGrowing: e.target.checked })}/>수익 증가</label>
          <label><input type="checkbox" checked={filters.prFalling} onChange={e => update({ prFalling: e.target.checked })}/>P/R 하락</label>
          <label><input type="checkbox" checked={filters.prLimit} onChange={e => update({ prLimit: e.target.checked })}/>P/R 상한</label>
          <input className="map-pr-limit" aria-label="지도 P/R 최대 배수" type="number" inputMode="decimal" min="0" step="any" placeholder="최대 배수" disabled={!filters.prLimit} value={filters.prLimit && filters.maxPr > 0 ? filters.maxPr : ""} onChange={e => update({ maxPr: Number.isFinite(e.target.valueAsNumber) ? Math.max(0, e.target.valueAsNumber) : 0 })}/>
        </fieldset>
      </div>
      <div className="discovery-controls map-filter-secondary"><div className="map-period-control"><span className="control-label">과거 시점</span><div className="choice-buttons map-periods" role="group" aria-label="지도 비교 시점">{MAP_PERIODS.map(day => <button key={day} aria-pressed={period === day} onClick={() => update({ period: day })}>{periodName(day)}</button>)}</div></div>
        <div className="map-capital-control"><span className="control-label">P/R 분자</span><div className="choice-buttons" role="group" aria-label="지도 배수 기준"><button aria-pressed={capital === "mcap"} onClick={() => update({ capital: "mcap" })}>유통 시총</button><button aria-pressed={capital === "fdv"} onClick={() => update({ capital: "fdv" })}>FDV</button></div></div>
      </div>
      {(filters.revenueGrowing || filters.prFalling) && <p className="map-filter-hint">{periodName(period)}과 현재를 비교합니다. 수익 증가는 두 시점의 직전 30일 Revenue 기준이며, 선택한 조건을 모두 충족한 종목만 표시합니다.
        {data && !loading && <span className="map-comparison-coverage">{filters.revenueGrowing && `수익 비교 가능 ${revenueComparable}/${comparisonRows.length}개 · 확인 불가 ${comparisonRows.length - revenueComparable}개`}{filters.revenueGrowing && filters.prFalling && " / "}{filters.prFalling && `P/R 비교 가능 ${prComparable}/${comparisonRows.length}개 · 확인 불가 ${comparisonRows.length - prComparable}개`}</span>}
      </p>}
      {data?.historyStatus === "unavailable" && !loading && !error && <div className="map-comparison-notice" role="alert"><div><strong>일부 종목의 과거 자료를 불러오지 못했습니다.</strong><p>현재 결과에는 조회에 성공한 자료만 반영됩니다. 잠시 후 다시 불러와 주세요.</p></div><button className="button" onClick={refresh}>과거 자료 다시 불러오기</button></div>}
      {filters.prFalling && data?.historyStatus === "ready" && !loading && !error && prUnknown > 0 && <div className="map-comparison-notice" role="status">
        <div><strong>과거 P/R 자료가 없는 종목은 하락 여부를 판단할 수 없습니다.</strong><p>다른 조건을 통과한 {prCandidates.length}개 중 P/R 비교 가능 {prCandidates.length - prUnknown}개 · 자료 부족 {prUnknown}개. 자료 부족 종목은 결과에서 제외합니다.</p>
          {capital === "fdv" && <p>유통 시총 기준으로 바꾸거나 더 가까운 과거 시점을 선택해 확인할 수 있습니다. 분자를 바꾸면 P/R 값과 결과도 달라집니다.</p>}</div>
        {capital === "fdv" && <button className="button" onClick={() => update({ capital: "mcap" })}>유통 시총 기준으로 보기</button>}
      </div>}
    </div>
    <div className="map-panel" aria-busy={loading}>
      <div className="map-topline"><div className="map-applied"><span>{filterCount ? "조건 " + filterCount + "개 적용" : "전체 범위"}{inherited && " · 전체종목 조건"}</span>{(filterCount > 0 || inherited) && <button className="text-button" onClick={reset}>초기화</button>}<span className="map-count">{rows.length.toLocaleString()}개 · {arrows.toLocaleString()}개 화살표</span></div>
        <div className="map-legend"><span><ArrowLeft size={18} className="map-legend-down"/>P/R 하락</span><span><ArrowRight size={18} className="map-legend-up"/>P/R 상승</span><span><i className="legend-dot favorite"/>관심종목</span><span><i className="legend-dot same"/>P/R 변화 없음·과거 P/R 없음</span>
          <button className="text-button" disabled={loading || !rows.length} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setArea(null); setHover(null); }}><Maximize size={15}/>{selecting ? "영역 선택 중" : "영역 선택"}</button>{area && <button className="text-button" onClick={() => { setArea(null); setPage(1); }}><RotateCcw size={13}/>영역 해제</button>}
        </div>
      </div>
      <div className="map-plot" ref={wrapper}>
        {loading ? <div className="discovery-loading" role="status"><span className="loading-orbit"/><strong>현재 위치와 과거 기록을 불러오고 있습니다</strong><p>전체 종목을 같은 수집본으로 맞춥니다.</p></div> : error ? <div className="discovery-loading" role="alert"><p>{error}</p><button className="button" onClick={refresh}>다시 불러오기</button></div> : !rows.length ? <div className="discovery-loading"><strong>조건에 맞는 지도 종목이 없습니다</strong><p>현재 P/R과 30일 Revenue가 모두 양수인 종목을 표시합니다. 수익 증가에는 과거 30일 Revenue, P/R 하락에는 당시 시총·FDV도 필요합니다.</p><button className="button" onClick={reset}>조건 초기화</button></div> : <>
          <svg className={"candidate-chart" + (selecting ? " selecting" : hovered ? " has-hover" : "")} width="100%" height={height} viewBox={"0 0 " + width + " " + height} role="img" tabIndex={0} aria-describedby={chartId + "-hint"} aria-label={rows.length + "개 종목의 지도. 가로는 30일 P/R, 세로는 30일 Revenue. " + periodName(period) + "에서 현재로 " + arrows + "개 화살표."}
            onFocus={() => setHover(current => current ?? plotted[0]?.slug ?? null)}
            onKeyDown={e => {
              if (e.key === "Escape") { setHover(null); setSelecting(false); return; }
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                e.preventDefault(); const at = plotted.findIndex(p => p.slug === hover);
                const next = e.key === "Home" ? 0 : e.key === "End" ? plotted.length - 1 : (Math.max(0, at) + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + plotted.length) % plotted.length;
                setHover(plotted[next]?.slug ?? null);
              } else if ((e.key === "Enter" || e.key === " ") && hovered) { e.preventDefault(); open(hovered.row, listToggle.current); }
            }}
            onBlur={() => setHover(null)}
            onPointerDown={e => {
              if (e.pointerType === "mouse") e.preventDefault();
              const p = position(e); pointerStart.current = p;
              if (!selecting) return;
              setHover(null); const x = Math.max(left, Math.min(right, p.x)), y = Math.max(top, Math.min(bottom, p.y));
              drag.current = { x1: x, y1: y, x2: x, y2: y }; setArea(drag.current); e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={e => {
              const p = position(e);
              if (drag.current) { drag.current = { ...drag.current, x2: Math.max(left, Math.min(right, p.x)), y2: Math.max(top, Math.min(bottom, p.y)) }; setArea(drag.current); }
              else if (!selecting) setHover(previous => nearestMapPoint(plotted, p.x, p.y, previous, e.pointerType === "touch" ? 26 : 20)?.slug ?? null);
            }}
            onPointerLeave={() => setHover(null)}
            onPointerCancel={() => { drag.current = null; pointerStart.current = null; setArea(null); setSelecting(false); }}
            onPointerUp={e => {
              const p = position(e), start = pointerStart.current; pointerStart.current = null;
              if (drag.current) {
                const a = drag.current; drag.current = null; setSelecting(false); setPage(1);
                if (Math.abs(a.x1 - a.x2) < 8 || Math.abs(a.y1 - a.y2) < 8) setArea(null); else setListOpen(true);
              } else if (start && Math.hypot(p.x - start.x, p.y - start.y) < 8) {
                const hit = nearestMapPoint(plotted, p.x, p.y, hover, e.pointerType === "touch" ? 26 : 20); if (hit) open(hit.row, listToggle.current);
              }
            }}>
            <defs>{["down", "up", "same"].map(c => <marker key={c} id={chartId + "-arrow-" + c} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 8 4 L 0 8 Z" className={"map-fill-" + c}/></marker>)}</defs>
            {ticks(domains.x).map(v => <g key={"x" + v}><line x1={sx(10 ** v)} x2={sx(10 ** v)} y1={top} y2={bottom} className="map-grid"/><text x={sx(10 ** v)} y={bottom + 22} textAnchor="middle">{axisNumber(10 ** v)}x</text></g>)}
            {ticks(domains.y).map(v => <g key={"y" + v}><line x1={left} x2={right} y1={sy(10 ** v)} y2={sy(10 ** v)} className="map-grid"/><text x={left - 10} y={sy(10 ** v) + 4} textAnchor="end">{"$" + axisNumber(10 ** v)}</text></g>)}
            <text x={left} y={18} className="map-axis-label">30일 Revenue</text><text x={(left + right) / 2} y={height - 8} textAnchor="middle" className="map-axis-label">30일 P/R</text>
            <g pointerEvents="none">{plotted.filter(p => p.slug !== hover).map(renderPoint)}{hovered && renderPoint(hovered)}</g>
            {area && <rect x={Math.min(area.x1, area.x2)} y={Math.min(area.y1, area.y2)} width={Math.abs(area.x2 - area.x1)} height={Math.abs(area.y2 - area.y1)} className="map-area" pointerEvents="none"/>}
          </svg>
          {hovered && namePosition && <span className="map-hover-name" style={{ left: namePosition.x, top: namePosition.y, maxWidth: width - 24 }}>{hovered.row.name}</span>}
        </>}
        <p className="sr-only" id={chartId + "-hint"}>방향키로 종목을 이동하고 Enter로 상세를 엽니다. 아래 종목 목록에서도 선택할 수 있습니다.</p>
      </div>
      <div className="map-results">
        <button ref={listToggle} className="map-results-toggle" aria-expanded={listOpen} aria-controls={chartId + "-results"} onClick={() => setListOpen(!listOpen)}>{listOpen ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}<span>{area ? "선택한 영역의 종목" : "종목 목록"} {listOpen ? "접기" : "펼치기"}</span><small>{results.length.toLocaleString()}개</small></button>
        {listOpen && !loading && !error && <div id={chartId + "-results"}>
          <div className="map-results-columns" aria-hidden="true"><span>종목</span><span>현재 시총</span><span>30일 Revenue</span><span>30일 P/R</span><span/></div>
          {shown.map(p => <div className="map-result" key={p.slug}>
            <button className="discovery-coin" onMouseEnter={() => setHover(p.slug)} onMouseLeave={() => setHover(null)} onClick={e => open(p.row, e.currentTarget)} aria-label={p.row.name + " 상세 보기"}><span className="coin-monogram">{(p.row.symbol ?? p.row.name).slice(0, 2)}</span><span><strong>{p.row.name}</strong><small>{p.row.symbol}</small></span></button>
            <span className="map-result-number"><small>현재 시총</small>{fmtUsd(p.row.mcap)}</span><span className="map-result-number"><small>30일 Revenue</small>{fmtUsd(p.row.revenue30d)}</span><span className="map-result-number"><small>30일 P/R</small>{fmtMult(p.row.cells.pr.value)}</span>
            <button className="favorite-button" aria-pressed={favorites.has(p.slug)} aria-label={p.row.name + " 관심종목 " + (favorites.has(p.slug) ? "해제" : "추가")} onClick={() => onFavorite(p.slug)}><Star size={17} fill={favorites.has(p.slug) ? "currentColor" : "none"}/></button>
          </div>)}
          {!results.length && <p className="discovery-empty">{area ? "선택한 영역에 종목이 없습니다. 영역을 다시 선택해 주세요." : "조건에 맞는 종목이 없습니다. 시총 범위나 변화 조건을 조정해 주세요."}</p>}
          {maxPage > 1 && <div className="discovery-pagination"><button className="button" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>이전</button><span>{Math.min(page, maxPage)} / {maxPage}</span><button className="button" disabled={page >= maxPage} onClick={() => setPage(n => n + 1)}>다음</button></div>}
        </div>}
      </div>
    </div>
    <div className="map-explanation"><p>현재 시총은 최신 수집본 기준입니다.{data && " · " + fmtKstMinute(data.updatedAt)}</p>
      {data && <details><summary>지도 읽는 법 · 자료 기준</summary><p>과거 {mapDate(data.asOf, -period)} UTC → 현재 수집본. 현재 30일 수익의 마지막 날짜는 {data.asOf} UTC입니다. 가로·세로는 로그 눈금이며, 같은 간격은 같은 배율을 뜻합니다.</p>
        <p>왼쪽으로 가면 P/R이 낮아지고, 위로 가면 30일 Revenue가 늘어납니다. 과거 위치는 그날의 {capital === "mcap" ? "유통 시총" : "FDV"}과 직전 30일 수익으로 계산합니다. 수익 증가는 두 시점의 Revenue로 판별하며, 과거 시총·FDV가 없어도 확인할 수 있습니다. 수익 증가는 투자 수익률이 아닌 Revenue의 증가입니다.</p>
        <p>현재 점만 {rows.length - arrows}개 · 현재 배수나 수익 부족으로 지도에서 제외된 종목 {data.excluded.toLocaleString()}개. 당시 가치와 연속 30일 수익을 모두 확인한 종목에만 화살표가 있습니다. 점이 겹치면 영역을 선택해 아래 목록에서 열 수 있습니다. 축은 필터와 과거 시점 변경 중에도 같은 기준을 유지합니다.</p>
        {data.historyStatus === "unavailable" && <p role="status">불러오지 못한 과거 기록이 있습니다. 해당 종목은 현재 위치만 표시합니다. <button className="text-button" onClick={refresh}>다시 연결</button></p>}
      </details>}
    </div>
    {saveOpen && <SettingsDialog title="지도 조건 저장" onClose={() => setSaveOpen(false)} footerNote="지도 조건은 이 브라우저에 저장됩니다."><form className="map-save-form" onSubmit={e => {
      e.preventDefault(); const name = saveName.trim(); if (!name) return;
      setWorkspace(previous => ({ ...previous, selected: name, saved: [...previous.saved.filter(item => item.name !== name), { name, filters: { ...filters }, inherited }] }));
      setSaveOpen(false); setMessage("‘" + name + "’ 조건을 저장했습니다.");
    }}><label>조건 이름<input aria-label="지도 조건 이름" maxLength={60} value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="예: 시총 100M 이하 · 수익 증가"/></label>
      <p>시총 범위·변화 조건·과거 시점·P/R 분자를 함께 저장합니다.{inherited && " 전체종목에서 가져온 조건도 포함합니다."}{saved.some(item => item.name === saveName.trim()) && " 같은 이름의 조건은 현재 값으로 바뀝니다."}</p><button type="submit" className="button primary-button" disabled={!saveName.trim()}>이 이름으로 저장</button></form></SettingsDialog>}
  </div>;
}
