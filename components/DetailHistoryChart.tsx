"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { detailSeriesSegments, type DetailChartPoint, type DetailHistoryPoint, type DetailSeriesKey } from "@/lib/detailHistory";
import { fmtMult, fmtPrice, fmtUsd } from "@/lib/format";

export interface DetailChartSeries { key: DetailSeriesKey; label: string; color: string; axis: "left" | "right"; dashed?: boolean }
export const detailSeriesFormat = (key: DetailSeriesKey, value: number | null | undefined) => key === "price" ? fmtPrice(value) : key === "pr" || key === "phr" ? fmtMult(value) : fmtUsd(value);
const exactValue = (key: DetailSeriesKey, value: number | null | undefined) => value == null ? "미확인" : key === "pr" || key === "phr"
  ? `${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}x`
  : "$" + value.toLocaleString("en-US", key === "price" ? { maximumSignificantDigits: 10 } : { maximumFractionDigits: 2 });
const quoteTime = (iso: string | null | undefined) => iso && Number.isFinite(Date.parse(iso)) ? `${new Date(iso).toISOString().replace("T", " ").slice(0, 19)} UTC` : "미확인";

function extent(values: number[], zero: boolean): [number, number] {
  if (!values.length) return [0, 1];
  let low = zero ? 0 : Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * .08, high * .03);
  low = Math.max(0, low - padding); high += padding;
  const rough = (high - low) / 4, base = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(n => n * base).find(n => n >= rough) ?? base * 10;
  return [Math.floor(low / step) * step, Math.ceil(high / step) * step];
}

export function DetailHistoryChart({ points, historyPoints, days, series, domain, activeDay, onActiveDay, valuation = false, label }: {
  historyPoints: DetailHistoryPoint[]; days: number;
  points: DetailChartPoint[]; series: DetailChartSeries[]; domain: [number, number]; activeDay: string | null;
  onActiveDay: (day: string | null) => void; valuation?: boolean; label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 850, height: 230 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(250, entry.contentRect.width), height: Math.max(100, entry.contentRect.height) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { width, height } = size;
  const left = width < 500 ? 48 : 60, right = valuation ? 18 : width < 500 ? 49 : 60, top = 18, bottom = 29;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = (axis: "left" | "right") => series.filter(s => s.axis === axis).flatMap(s => points.flatMap(p => p[s.key] === null ? [] : [p[s.key]!]));
  const leftValues = values("left"), rightValues = values("right");
  const leftExtent = extent(leftValues, valuation), rightExtent = extent(rightValues, false);
  const x = (time: number) => left + (time - domain[0]) / (domain[1] - domain[0]) * plotWidth;
  const y = (value: number, axis: "left" | "right") => {
    const range = axis === "left" ? leftExtent : rightExtent;
    return top + (1 - (value - range[0]) / (range[1] - range[0])) * plotHeight;
  };
  const activeTime = activeDay ? Date.parse(activeDay) : null;
  const activePoint = points.find(point => point.day === activeDay);
  const observation = historyPoints.find(point => point.day === activeDay);
  const flowEvidence = observation?.valuationState === "ready" ? observation.valuation : null;
  const windowEnd = activeTime === null ? "" : new Date(activeTime - 86_400_000).toISOString().slice(0, 10);
  const windowStart = activeTime === null ? "" : new Date(activeTime - days * 86_400_000).toISOString().slice(0, 10);
  const dateLabel = (time: number) => {
    const day = new Date(time).toISOString().slice(0, 10);
    return domain[1] - domain[0] > 150 * 86_400_000 ? day.slice(0, 7).replace("-", ".") : day.slice(5).replace("-", ".");
  };
  function pointAt(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * width;
    const time = domain[0] + Math.max(0, Math.min(1, (px - left) / plotWidth)) * (domain[1] - domain[0]);
    onActiveDay(new Date(Math.round(time / 86_400_000) * 86_400_000).toISOString().slice(0, 10));
  }
  function keyDay(event: KeyboardEvent<SVGSVGElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const time = event.key === "Home" ? domain[0] : event.key === "End" ? domain[1]
      : (activeTime ?? points.at(-1)?.time ?? domain[1]) + (event.key === "ArrowLeft" ? -1 : 1) * 86_400_000;
    onActiveDay(new Date(Math.max(Math.ceil(domain[0] / 86_400_000) * 86_400_000, Math.min(Math.floor(domain[1] / 86_400_000) * 86_400_000, time))).toISOString().slice(0, 10));
  }
  const tickCount = width < 600 ? 3 : 4;
  const activeX = activeTime === null ? null : x(activeTime);
  const tooltipRight = activeX !== null && activeX > width * .62;
  return <div className="detail-chart-plot" ref={ref}>
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}. 좌우 방향키로 날짜를 확인할 수 있습니다.`} tabIndex={0}
      onPointerMove={pointAt} onPointerDown={pointAt} onPointerLeave={() => onActiveDay(null)} onFocus={() => onActiveDay(points.at(-1)?.day ?? null)} onBlur={() => onActiveDay(null)} onKeyDown={keyDay}>
      <text x={left} y={10} className="detail-chart-axis-title">{valuation ? "배수 · x" : "가격 · USD"}</text>
      {!valuation && <text x={width - right} y={10} textAnchor="end" className="detail-chart-axis-title">시총 · FDV · USD</text>}
      {Array.from({ length: 5 }, (_, i) => {
        const value = leftExtent[1] - (leftExtent[1] - leftExtent[0]) * i / 4;
        const secondary = rightExtent[1] - (rightExtent[1] - rightExtent[0]) * i / 4;
        const yy = top + plotHeight * i / 4;
        return <g key={i}><line x1={left} y1={yy} x2={width - right} y2={yy} className="detail-chart-grid"/>
          <text x={left - 9} y={yy + 4} textAnchor="end" className="detail-chart-tick">{!leftValues.length ? "–" : valuation ? fmtMult(value) : fmtPrice(value)}</text>
          {!valuation && <text x={width - right + 9} y={yy + 4} className="detail-chart-tick">{rightValues.length ? fmtUsd(secondary) : "–"}</text>}</g>;
      })}
      {Array.from({ length: tickCount + 1 }, (_, i) => {
        const time = domain[0] + (domain[1] - domain[0]) * i / tickCount, xx = x(time);
        return <g key={i}><line x1={xx} y1={top} x2={xx} y2={height - bottom} className="detail-chart-grid detail-chart-grid-vertical"/>
          <text x={xx} y={height - 7} textAnchor="middle" className="detail-chart-tick">{dateLabel(time)}</text></g>;
      })}
      {series.flatMap(item => detailSeriesSegments(points, item.key).map((segment, index) => segment.length === 1
        ? <circle key={`${item.key}-${index}`} cx={x(segment[0].time)} cy={y(segment[0][item.key]!, item.axis)} r={2.7} fill={item.color}/>
        : <path key={`${item.key}-${index}`} d={segment.map((point, i) => `${i ? "L" : "M"}${x(point.time).toFixed(2)},${y(point[item.key]!, item.axis).toFixed(2)}`).join(" ")} fill="none" stroke={item.color} strokeWidth={2} strokeDasharray={item.dashed ? "5 5" : undefined} strokeLinejoin="round" strokeLinecap="round"/>))}
      {activeX !== null && activeX >= left && activeX <= width - right && <g><line x1={activeX} y1={top} x2={activeX} y2={height - bottom} className="detail-chart-crosshair"/>
        {activePoint && series.filter(item => activePoint[item.key] !== null).map(item => <circle key={item.key} cx={activeX} cy={y(activePoint[item.key]!, item.axis)} r={3.7} fill={item.color} className="detail-chart-dot"/>)}</g>}
    </svg>
    {activeDay && <div className={`detail-chart-tooltip${tooltipRight ? " tooltip-left" : ""}`} style={{ left: activeX === null ? undefined : `${Math.max(3, Math.min(97, activeX / width * 100))}%` }} role="status" aria-live="polite">
      <strong>{activeDay} <span>UTC</span></strong>
      {activePoint ? <>{series.map(item => <div key={item.key}><span><i style={{ background: item.color }}/>{item.label}</span><b>{exactValue(item.key, activePoint[item.key])}</b></div>)}
        {valuation ? <div className="detail-tooltip-evidence"><span>수익 기간 {windowStart} ~ {windowEnd} UTC</span><div><span>Revenue</span><b>{exactValue("mcap", flowEvidence?.revenue)}</b></div><div><span>Holders Revenue</span><b>{exactValue("mcap", flowEvidence?.holders)}</b></div><span>완료일 · 수익 {flowEvidence?.revenueDays ?? "–"}/{days} · 환원 {flowEvidence?.holderDays ?? "–"}/{days}</span></div>
          : <div className="detail-tooltip-evidence"><span>가격·시총 {quoteTime(observation?.marketAt)}</span><span>FDV {quoteTime(observation?.fdvAt)}</span><span>{observation?.basis === "utc_midnight" ? "UTC 자정 이력" : "실제 수집 시세"}</span></div>}</> : <p>이 날짜의 시세 자료가 없습니다.</p>}
    </div>}
  </div>;
}
