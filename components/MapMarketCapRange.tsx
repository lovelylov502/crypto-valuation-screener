"use client";
import { useState } from "react";
import { sliderToUsd, usdToSlider } from "@/lib/screenerFilters";
import { MAP_MIN_MCAP } from "@/lib/mapWorkspace";
import { DualRangeSlider } from "./RangeFilters";

const minimumPosition = usdToSlider(MAP_MIN_MCAP);
const toPosition = (usd: number) => Math.max(0, (usdToSlider(usd) - minimumPosition) / (100 - minimumPosition) * 100);
const fromPosition = (position: number) => position <= 0 ? MAP_MIN_MCAP : sliderToUsd(minimumPosition + position / 100 * (100 - minimumPosition));
const millionValue = (usd: number) => usd > 0 ? String(usd / 1e6) : "";

function MillionUsdInput({ value, label, placeholder, onChange }: { value: number; label: string; placeholder: string; onChange: (value: number) => number }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState("");
  return <input type="number" inputMode="decimal" min={0.1} step="any" aria-label={label + " (백만 달러)"} placeholder={placeholder}
    value={editing ? draft : millionValue(value)}
    onFocus={() => { setEditing(true); setDraft(millionValue(value)); }}
    onChange={e => setDraft(e.target.value)}
    onBlur={() => {
      setEditing(false);
      const next = Number(draft) * 1e6;
      if (Number.isFinite(next) && next >= 0) onChange(next);
    }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}/>;
}
export function MapMarketCapRange({ min, max, onChange }: { min: number; max: number; onChange: (range: { minMcap: number; maxMcap: number }) => void }) {
  const setMin = (n: number) => { const applied = Math.max(MAP_MIN_MCAP, max > 0 ? Math.min(n, max) : n); onChange({ minMcap: applied, maxMcap: max }); return applied; };
  const setMax = (n: number) => { const applied = n > 0 ? Math.max(n, min) : 0; onChange({ minMcap: min, maxMcap: applied }); return applied; };
  return <fieldset className="map-cap-range"><legend>현재 시총 <span>($M)</span></legend><div className="map-cap-control">
    <div className="map-cap-inputs"><label><span>최소 $M</span><MillionUsdInput value={min} label="지도 현재 시총 최소" placeholder="0.1" onChange={setMin}/></label><span className="map-range-dash">—</span><label><span>최대 $M</span><MillionUsdInput value={max} label="지도 현재 시총 최대" placeholder="∞" onChange={setMax}/></label></div>
    <div className="map-cap-slider"><span>0.1M</span><DualRangeSlider minPosition={toPosition(min)} maxPosition={max > 0 ? toPosition(max) : 100}
      onMinChange={p => setMin(fromPosition(p))} onMaxChange={p => setMax(p >= 100 ? 0 : fromPosition(p))} minLabel="지도 현재 시총 최소 조절" maxLabel="지도 현재 시총 최대 조절" step="any"/><span>제한 없음</span></div>
  </div></fieldset>;
}
