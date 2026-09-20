"use client";

import { useState } from "react";
import { GripVertical, Plus, Search, X } from "lucide-react";
import { COLUMN_GROUP_LABELS, SCREENER_COLUMNS, type ColumnGroup, type SortKey } from "@/lib/screenerColumns";
import { addColumn, reorderColumn, showMetricPeriods } from "@/lib/columnOrder";
import { useColumnReorder } from "./useColumnReorder";

const GROUPS: ColumnGroup[] = ["valuation", "market", "performance", "fundamentals", "research"];

export function DisplaySettings({ columns, onChange, onStatus }: {
  columns: SortKey[];
  onChange: (columns: SortKey[]) => void;
  onStatus: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const selected = columns.map(key => SCREENER_COLUMNS.find(c => c.key === key)!).filter(Boolean);
  const move = (from: SortKey, to: SortKey) => {
    const next = reorderColumn(columns, from, to);
    onChange(next);
    onStatus(`${SCREENER_COLUMNS.find(c=>c.key===from)?.label} · ${next.indexOf(from)+1}번째로 이동`);
  };
  const drag = useColumnReorder(columns, move);
  const query = search.trim().toLowerCase();
  const available = SCREENER_COLUMNS.filter(c => !columns.includes(c.key) && (c.label + " " + c.title).toLowerCase().includes(query));
  return <div className="column-settings" aria-label="표시 열 설정">
    <section aria-labelledby="selected-columns-heading">
      <div className="setting-section-title"><h3 id="selected-columns-heading">표시 중인 열 <span>{columns.length}</span></h3><span>종목은 첫 열에 고정</span></div>
      <p className="sidebar-hint" id="column-drag-help">손잡이를 드래그하거나 방향키로 순서를 바꾸세요.</p>
      <ol className="selected-columns" aria-label="선택한 열 순서" data-reorder-zone="columns">
        {selected.map((c,i) => <li key={c.key} data-column-key={c.key} className={drag.drag?.key === c.key ? "column-dragging" : drag.drag?.over === c.key ? "column-drop-target" : ""}>
          <button className="column-drag-handle" aria-label={c.label + " 순서 이동"} aria-describedby="column-drag-help" {...drag.handle(c.key,"columns")}><GripVertical size={16}/></button>
          <span className="column-position" aria-hidden="true">{i+1}</span><span className="column-name">{c.label}</span>
          <button className="order-button" aria-label={c.label + " 열 숨기기"} disabled={columns.length === 1} onClick={() => { onChange(columns.filter(key=>key!==c.key)); onStatus(c.label + " 열을 숨겼습니다."); }}><X size={16}/></button>
        </li>)}
      </ol>
    </section>
    <section className="available-columns" aria-labelledby="add-columns-heading">
      <div className="setting-section-title"><h3 id="add-columns-heading">열 추가</h3></div>
      <label className="column-search-field"><Search size={16}/><input aria-label="표시 열 검색" placeholder="지표 검색" value={search} onChange={e=>setSearch(e.target.value)}/>{search && <button aria-label="지표 검색 지우기" onClick={()=>setSearch("")}><X size={15}/></button>}</label>
      {GROUPS.map(group => {
        const choices = available.filter(c=>c.group===group);
        if (!choices.length) return null;
        return <details className="column-group" key={group} open={!!query || group !== "research"}>
          <summary>{COLUMN_GROUP_LABELS[group]}</summary>
          {group === "valuation" && !query && <div className="period-shortcuts"><button onClick={()=>{onChange(showMetricPeriods(columns,"pr"));onStatus("P/R 4개 기간을 추가했습니다.");}}>P/R 전 기간 추가</button><button onClick={()=>{onChange(showMetricPeriods(columns,"phr"));onStatus("P/HR 4개 기간을 추가했습니다.");}}>P/HR 전 기간 추가</button></div>}
          <div className="column-options">{choices.map(c=><button key={c.key} className="column-add" title={c.title} aria-label={c.label + " 추가"} onClick={()=>{onChange(addColumn(columns,c.key));onStatus(c.label + " 열을 추가했습니다.");}}><Plus size={14}/>{c.label}</button>)}</div>
        </details>;
      })}
      {!available.length && <p className="sidebar-hint">{query ? "검색어에 맞는 추가 지표가 없습니다." : "모든 지표를 표시하고 있습니다."}</p>}
    </section>
  </div>;
}
