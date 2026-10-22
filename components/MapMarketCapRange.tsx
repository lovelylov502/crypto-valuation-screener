"use client";
import { useState } from "react";
import { sliderToUsd, usdToSlider } from "@/lib/screenerFilters";
import { DualRangeSlider } from "./RangeFilters";

function readableUsd(value: number) {
  const [unit, suffix] = value >= 1e12 ? [1e12, "조"] : value >= 1e8 ? [1e8, "억"] : value >= 1e4 ? [1e4, "만"] : [1, ""];
  return (value / Number(unit)).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + suffix;
}
function UsdInput({ value, label, placeholder, onChange }: { value: number; label: string; placeholder: string; onChange: (value: number) => number }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState("");
  return <input type="text" inputMode="decimal" aria-label={label + " (달러)"} title="입력할 때는 달러 금액을 숫자로 적어 주세요." placeholder={placeholder}
    value={editing ? draft : value > 0 ? readableUsd(value) : ""}
    onFocus={() => { setEditing(true); setDraft(value > 0 ? String(value) : ""); }}
    onChange={e => setDraft(e.target.value)}
    onBlur={() => {
      setEditing(false);
      const next = Number(draft.replaceAll(",", ""));
      if (/^[\d,.]*$/.test(draft) && Number.isFinite(next) && next >= 0) onChange(next);
    }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}/>;
}
export function MapMarketCapRange({ min, max, onChange }: { min: number; max: number; onChange: (range: { minMcap: number; maxMcap: number }) => void }) {
  const setMin = (n: number) => { const applied = max > 0 ? Math.min(n, max) : n; onChange({ minMcap: applied, maxMcap: max }); return applied; };
  const setMax = (n: number) => { const applied = n > 0 ? Math.max(n, min) : 0; onChange({ minMcap: min, maxMcap: applied }); return applied; };
  return <fieldset className="map-cap-range"><legend>현재 시총 <span>(USD)</span></legend><div className="map-cap-control">
    <div className="map-cap-inputs"><label><span>최소</span><UsdInput value={min} label="지도 현재 시총 최소" placeholder="0" onChange={setMin}/><span>달러</span></label><span className="map-range-dash">—</span><label><span>최대</span><UsdInput value={max} label="지도 현재 시총 최대" placeholder="제한 없음" onChange={setMax}/><span>달러</span></label></div>
    <div className="map-cap-slider"><span>0</span><DualRangeSlider minPosition={usdToSlider(min)} maxPosition={max > 0 ? usdToSlider(max) : 100}
      onMinChange={p => setMin(sliderToUsd(p))} onMaxChange={p => setMax(p >= 100 ? 0 : sliderToUsd(p))} minLabel="지도 현재 시총 최소 조절" maxLabel="지도 현재 시총 최대 조절" step="any"/><span>제한 없음</span></div>
  </div></fieldset>;
}
