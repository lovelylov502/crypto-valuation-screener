"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Maximize, Play, RotateCcw, Search, Star } from "lucide-react";
import { defaultPreferences, type WorkspacePreferences } from "@/lib/workspacePreferences";
import { MAP_PERIODS, mapDate, periodName, type DiscoveryPage, type DiscoveryRow, type MapPeriod } from "@/lib/discoveryTypes";
import { fmtKstMinute, fmtMult, fmtUsd } from "@/lib/format";
import { useDiscoveryData } from "./useDiscoveryData";

export type DiscoveryDetail = (row: DiscoveryRow, page: DiscoveryPage, trigger: HTMLButtonElement | null) => void;
type Area = { x1: number; y1: number; x2: number; y2: number };
const bounds = (values: number[]) => { const logs = values.filter(v => Number.isFinite(v) && v > 0).map(Math.log10); const low = Math.floor(Math.min(...logs, 0)), high = Math.ceil(Math.max(...logs, 1)); return [low, Math.max(low + 1, high)] as const; };
const ticks = (domain: readonly [number, number]) => Array.from({ length: domain[1] - domain[0] + 1 }, (_, i) => domain[0] + i).filter((_, i) => i % Math.max(1, Math.ceil((domain[1] - domain[0]) / 6)) === 0);
const axisNumber = (n: number) => n >= 1e9 ? `${n / 1e9}B` : n >= 1e6 ? `${n / 1e6}M` : n >= 1000 ? `${n / 1000}K` : n < .001 ? n.toExponential(0) : n.toLocaleString("en-US", { maximumFractionDigits: 6 });
const inside = (x: number, y: number, a: Area) => x >= Math.min(a.x1, a.x2) && x <= Math.max(a.x1, a.x2) && y >= Math.min(a.y1, a.y2) && y <= Math.max(a.y1, a.y2);

export function CandidateMap({ favorites, onFavorite, onDetail, imported, onClearImport, publicationId, onWatchlist }: {
  favorites: Set<string>; onFavorite: (slug: string) => void; onDetail: DiscoveryDetail;
  imported: WorkspacePreferences | null; onClearImport: () => void; publicationId?: string; onWatchlist: () => void;
}) {
  const [capital, setCapital] = useState<"mcap" | "fdv">("mcap"), [period, setPeriod] = useState<MapPeriod>(30);
  const [search, setSearch] = useState(""), [page, setPage] = useState(1), [area, setArea] = useState<Area | null>(null), [selecting, setSelecting] = useState(false);
  const [hover, setHover] = useState<string | null>(null), [width, setWidth] = useState(1000), [playing, setPlaying] = useState(false), [progress, setProgress] = useState(1);
  const wrapper = useRef<HTMLDivElement>(null), finder = useRef<HTMLButtonElement>(null), drag = useRef<Area | null>(null);
  useEffect(() => { if (imported) { setCapital(imported.capital); setArea(null); setSearch(""); setPage(1); } }, [imported]);
  const prefs = useMemo(() => ({ ...(imported ?? defaultPreferences()), capital }), [imported, capital]);
  const { data, loading, error, refresh } = useDiscoveryData(prefs, favorites, "map", publicationId);
  useEffect(() => { const el = wrapper.current; if (!el) return; const observer = new ResizeObserver(entries => { const w = entries[0].contentRect.width; if (w > 0) setWidth(w); }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => { setArea(null); setPage(1); setPlaying(false); setProgress(1); }, [data, period, width]);
  useEffect(() => {
    if (!playing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setProgress(1); setPlaying(false); return; }
    let frame = 0, start = 0;
    const tick = (time: number) => { if (!start) start = time; const p = Math.min(1, (time - start) / 2600); setProgress(p); if (p < 1) frame = requestAnimationFrame(tick); else setPlaying(false); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing]);
  const rows = data?.rows ?? [];
  const domains = useMemo(() => {
    const x: number[] = [], y: number[] = [];
    for (const row of data?.rows ?? []) { x.push(row.cells.pr.value!); y.push(row.revenue30d!); for (const past of Object.values(row.past)) if (past?.point) { x.push(past.point.pr); y.push(past.point.revenue); } }
    return { x: bounds(x), y: bounds(y) };
  }, [data]);
  const height = width < 600 ? 400 : 470, left = 64, right = Math.max(left + 20, width - 24), top = 40, bottom = height - 48;
  const sx = (n: number) => left + (Math.log10(n) - domains.x[0]) / (domains.x[1] - domains.x[0]) * (right - left);
  const sy = (n: number) => bottom - (Math.log10(n) - domains.y[0]) / (domains.y[1] - domains.y[0]) * (bottom - top);
  const plotted = rows.map(row => { const past = row.past[period]?.point; const x = sx(row.cells.pr.value!), y = sy(row.revenue30d!); return { row, x, y, px: past ? sx(past.pr) : x, py: past ? sy(past.revenue) : y, past, color: past ? row.cells.pr.value! < past.pr ? "down" : row.cells.pr.value! > past.pr ? "up" : "same" : "same" }; });
  const arrows = plotted.filter(p => p.past).length;
  const results = plotted.filter(p => (!area || inside(p.x, p.y, area)) && `${p.row.name} ${p.row.symbol}`.toLowerCase().includes(search.toLowerCase()));
  const hovered = plotted.find(p => p.row.slug === hover), maxPage = Math.max(1, Math.ceil(results.length / 12)), shown = results.slice((Math.min(page, maxPage) - 1) * 12, Math.min(page, maxPage) * 12);
  const position = (e: React.PointerEvent<SVGSVGElement>) => { const rect = e.currentTarget.getBoundingClientRect(); return { x: Math.max(left, Math.min(right, e.clientX - rect.left)), y: Math.max(top, Math.min(bottom, e.clientY - rect.top)) }; };
  const nearest = (x: number, y: number) => {
    let found: typeof plotted[number] | undefined, distance = 14;
    for (const p of plotted) { const dx = p.x - p.px, dy = p.y - p.py, length = dx * dx + dy * dy; const t = length ? Math.max(0, Math.min(1, ((x - p.px) * dx + (y - p.py) * dy) / length)) : 1; const d = Math.hypot(x - (p.px + t * dx), y - (p.py + t * dy)); if (d < distance) { distance = d; found = p; } }
    return found;
  };
  const open = (row: DiscoveryRow, trigger: HTMLButtonElement | null) => { if (data) onDetail(row, data, trigger); };
  return <div className="discovery-space">
    <div className="discovery-heading"><div><span className="eyebrow">DISCOVER</span><h2>후보 지도</h2><p>모든 종목의 P/R과 수익 변화를 한눈에. 궁금한 점이나 화살표를 눌러 보세요.</p></div><button className="button" onClick={onWatchlist}><Star size={15}/>관심종목 {favorites.size}<ArrowRight size={15}/></button></div>
    {imported && <div className="discovery-banner"><span>전체종목의 검색·필터를 가져왔습니다.{imported.search && ` 검색: ${imported.search}`}</span><button className="text-button" onClick={onClearImport}>전체 지도로 돌아가기</button></div>}
    <div className="discovery-controls"><div><span className="control-label">과거와 현재 비교</span><div className="choice-buttons map-periods" role="group" aria-label="지도 비교 시점">{MAP_PERIODS.map(day => <button key={day} aria-pressed={period === day} onClick={() => setPeriod(day)}>{periodName(day)}</button>)}</div></div><div><span className="control-label">P/R 분자</span><div className="choice-buttons" role="group" aria-label="지도 배수 기준"><button aria-pressed={capital === "mcap"} onClick={() => setCapital("mcap")}>유통 시총</button><button aria-pressed={capital === "fdv"} onClick={() => setCapital("fdv")}>FDV</button></div></div></div>
    <div className="map-panel" ref={wrapper} aria-busy={loading}>
      <div className="map-topline"><span><strong>{rows.length.toLocaleString()}개</strong> 현재 위치 <span className="muted">· {arrows.toLocaleString()}개 화살표</span></span><div><button className="text-button" disabled={!arrows || loading} onClick={() => { if (playing) { setPlaying(false); setProgress(1); } else { setProgress(0); setPlaying(true); } }}><Play size={14}/>{playing ? "현재로" : "이동 재생"}</button><button className="text-button" disabled={loading} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setArea(null); }}><Maximize size={15}/>{selecting ? "영역 선택 중" : "영역 선택"}</button>{area && <button className="text-button" onClick={() => { setArea(null); setPage(1); }}><RotateCcw size={13}/>해제</button>}</div></div>
      {loading ? <div className="discovery-loading" role="status"><span className="loading-orbit"/><strong>현재 위치와 과거 기록을 모으고 있습니다</strong><p>전체 종목을 같은 수집본으로 맞춥니다.</p></div> : error ? <div className="discovery-loading" role="alert"><p>{error}</p><button className="button" onClick={refresh}>다시 불러오기</button></div> : !rows.length ? <div className="discovery-loading"><strong>이 조건에서 지도로 표시할 수 있는 종목이 없습니다</strong><p>양수인 P/R과 30일 Revenue가 모두 필요합니다.</p>{imported && <button className="button" onClick={onClearImport}>전체 지도 보기</button>}</div> : <>
        <svg className={"candidate-chart" + (selecting ? " selecting" : "")} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${rows.length}개 종목의 지도. 가로는 30일 P/R, 세로는 30일 Revenue. ${periodName(period)}에서 현재로 ${arrows}개 화살표. 아래 종목 목록으로도 상세를 열 수 있습니다.`}
          onPointerDown={e => { if (!selecting) return; setHover(null); const p = position(e); drag.current = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }; setArea(drag.current); e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e => { const p = position(e); if (drag.current) { drag.current = { ...drag.current, x2: p.x, y2: p.y }; setArea(drag.current); } else if (!selecting) setHover(nearest(p.x, p.y)?.row.slug ?? null); }}
          onPointerLeave={() => setHover(null)} onPointerCancel={() => { drag.current = null; setArea(null); setSelecting(false); }}
          onPointerUp={e => { if (drag.current) { const a = drag.current; drag.current = null; setSelecting(false); setPage(1); if (Math.abs(a.x1 - a.x2) < 8 || Math.abs(a.y1 - a.y2) < 8) setArea(null); } else { const p = position(e); const hit = nearest(p.x, p.y); if (hit) open(hit.row, finder.current); } }}>
          <defs>{["down", "up", "same"].map(c => <marker key={c} id={`arrow-${c}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 8 4 L 0 8 Z" className={`map-fill-${c}`}/></marker>)}</defs>
          {ticks(domains.x).map(v => <g key={`x${v}`}><line x1={sx(10 ** v)} x2={sx(10 ** v)} y1={top} y2={bottom} className="map-grid"/><text x={sx(10 ** v)} y={bottom + 20} textAnchor="middle">{axisNumber(10 ** v)}x</text></g>)}
          {ticks(domains.y).map(v => <g key={`y${v}`}><line x1={left} x2={right} y1={sy(10 ** v)} y2={sy(10 ** v)} className="map-grid"/><text x={left - 10} y={sy(10 ** v) + 4} textAnchor="end">${axisNumber(10 ** v)}</text></g>)}
          <text x={left} y={17} className="map-axis-label">30일 Revenue ↑</text><text x={right} y={height - 7} textAnchor="end" className="map-axis-label">30일 P/R →</text>
          <g pointerEvents="none">{plotted.map(p => <g key={p.row.slug} data-coin={p.row.slug}>{p.past && <><line x1={p.px} y1={p.py} x2={p.x} y2={p.y} className={`map-line map-stroke-${p.color}`} markerEnd={`url(#arrow-${p.color})`}/><circle cx={p.px} cy={p.py} r={2.1} className={`map-past map-stroke-${p.color}`}/></>}<circle cx={p.px + (p.x - p.px) * progress} cy={p.py + (p.y - p.py) * progress} r={hover === p.row.slug ? 5.5 : favorites.has(p.row.slug) ? 4 : 3} className={`map-current map-fill-${p.color}`}/>{area && inside(p.x, p.y, area) && <circle cx={p.x} cy={p.y} r="7" className="map-selected-ring"/>}</g>)}</g>
          {area && <rect x={Math.min(area.x1, area.x2)} y={Math.min(area.y1, area.y2)} width={Math.abs(area.x2 - area.x1)} height={Math.abs(area.y2 - area.y1)} className="map-area" pointerEvents="none"/>}
        </svg>
        {hovered && <div className="map-tooltip" style={{ left: Math.min(Math.max(8, hovered.x - 100), width - 240), top: Math.max(56, hovered.y - 40) }}><strong>{hovered.row.name} <small>{hovered.row.symbol}</small></strong><span>P/R {hovered.past ? `${fmtMult(hovered.past.pr)} → ` : ""}{fmtMult(hovered.row.cells.pr.value)}</span><span>30일 Revenue {fmtUsd(hovered.row.revenue30d)}</span><small>{hovered.past ? "누르면 종목 상세를 엽니다" : hovered.row.past[period]?.reason}</small></div>}
      </>}
      <div className="map-legend"><span><i className="legend-path">○ → ●</i>{periodName(period)} → 현재</span><span><i className="legend-dot down"/>P/R 낮아짐</span><span><i className="legend-dot up"/>P/R 높아짐</span><span><i className="legend-dot same"/>변화 없음·과거 자료 없음</span></div>
    </div>
    {data && <div className="map-explanation"><p><strong>과거 {mapDate(data.asOf, -period)} UTC → 현재 {fmtKstMinute(data.updatedAt)} 수집본</strong> · 30일 수익의 마지막 날짜: {data.asOf} UTC. 가로·세로 모두 로그 눈금으로, 같은 간격은 같은 배율을 뜻합니다.</p><p>오른쪽으로 가면 P/R이 높아지고, 위로 가면 30일 수익이 늘어납니다. 과거 위치는 그날의 {capital === "mcap" ? "유통 시총과" : "FDV와"} 직전 30일 수익으로 계산합니다.</p><details><summary>현재 점만 {rows.length - arrows}개 · 지도에 표시할 수 없는 종목 {data.excluded.toLocaleString()}개</summary><p>과거 30일의 수익 기록과 당시 가치가 모두 확인된 경우에만 화살표를 그립니다. 현재 P/R이나 30일 Revenue를 계산할 수 없는 종목은 전체종목에서 확인할 수 있습니다. 점이 겹치면 아래 검색과 목록을 이용하세요. 축은 모든 비교 기간에 걸쳐 고정됩니다.</p>{data.historyStatus === "unavailable" && <p role="status">불러오지 못한 과거 기록이 있습니다. 해당 종목은 현재 위치만 표시합니다. <button className="text-button" onClick={refresh}>다시 연결</button></p>}</details></div>}
    <div className="map-results-head"><div><h3>{area ? "선택한 영역의 종목" : "지도 속 종목"} <small>{results.length}개</small></h3><p>{selecting ? "지도에서 원하는 영역을 드래그하세요." : "종목을 눌러 근거를 확인하고, 별표로 관심종목에 담으세요."}</p></div><label className="search-box"><Search size={16}/><input aria-label="지도 속 종목 검색" placeholder="이름·심볼로 찾기" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}/></label></div>
    <div className="map-result-grid">{shown.map((p, i) => <div className="map-result" key={p.row.slug}><button className="discovery-coin" ref={i === 0 ? finder : undefined} onMouseEnter={() => setHover(p.row.slug)} onMouseLeave={() => setHover(null)} onClick={e => open(p.row, e.currentTarget)} aria-label={`${p.row.name} 상세 보기`}><span className="coin-monogram">{(p.row.symbol ?? p.row.name).slice(0, 2)}</span><span><strong>{p.row.name}</strong><small>{p.row.symbol} · {fmtMult(p.row.cells.pr.value)}{p.past ? ` · ${periodName(period)} ${fmtMult(p.past.pr)}` : " · 과거 자료 없음"}</small></span></button><button className="favorite-button" aria-pressed={favorites.has(p.row.slug)} aria-label={`${p.row.name} 관심종목 ${favorites.has(p.row.slug) ? "해제" : "추가"}`} onClick={() => onFavorite(p.row.slug)}><Star size={17} fill={favorites.has(p.row.slug) ? "currentColor" : "none"}/></button></div>)}</div>
    {!loading && !error && !results.length && rows.length > 0 && <p className="discovery-empty">조건에 맞는 종목이 없습니다. 검색어나 선택 영역을 바꿔 보세요.</p>}
    {maxPage > 1 && <div className="discovery-pagination"><button className="button" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>이전</button><span>{Math.min(page, maxPage)} / {maxPage}</span><button className="button" disabled={page >= maxPage} onClick={() => setPage(n => n + 1)}>다음</button></div>}
  </div>;
}
