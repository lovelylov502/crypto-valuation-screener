"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Download, FilePenLine, Search, Star, Upload, X } from "lucide-react";
import { defaultPreferences } from "@/lib/workspacePreferences";
import { fmtMult, fmtUsd } from "@/lib/format";
import { isReviewDue, localDay, mergeWatchBackup, newWatchNote, parseWatchBackup, WATCH_STAGES, type WatchNote, type WatchStage } from "@/lib/watchNotes";
import { serializeFavoriteSlugs } from "@/lib/screenerFilters";
import { useDiscoveryData } from "./useDiscoveryData";
import type { useWatchNotes } from "./useWatchNotes";
import type { DiscoveryDetail } from "./CandidateMap";

type Notebook = ReturnType<typeof useWatchNotes>;
const FAVORITES_KEY = "crypto-valuation-favorites-v1";

function NoteEditor({ initial, draft, onDraft, disabled, onSave, onCancel }: { initial: WatchNote; draft: WatchNote; onDraft: (note: WatchNote) => void; disabled: boolean; onSave: (note: WatchNote) => boolean; onCancel: () => void }) {
  const [saved, setSaved] = useState(false);
  const dirty = draft.note !== initial.note || draft.stage !== initial.stage || draft.reviewDate !== initial.reviewDate;
  const change = (patch: Partial<WatchNote>) => { onDraft({ ...draft, ...patch }); setSaved(false); };
  const reviewIn = (days: number) => { const next = new Date(); next.setDate(next.getDate() + days); change({ reviewDate: localDay(next) }); };
  return <form className="watch-editor" onSubmit={e => { e.preventDefault(); if (onSave({ ...draft, updatedAt: new Date().toISOString() })) setSaved(true); }}>
    <label className="watch-note-label">기억할 내용<textarea aria-label={`${initial.name} 메모`} value={draft.note} maxLength={3000} rows={3} placeholder="관심을 둔 이유, 아직 확인하지 못한 점, 다음에 볼 자료를 적어 두세요." onChange={e => change({ note: e.target.value })}/><small>{draft.note.length.toLocaleString()} / 3,000자</small></label>
    <div className="watch-editor-bottom"><label>검토 상태<select aria-label={`${initial.name} 검토 상태`} value={draft.stage} onChange={e => change({ stage: e.target.value as WatchStage })}>{Object.entries(WATCH_STAGES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>다시 볼 날짜<input aria-label={`${initial.name} 다시 볼 날짜`} type="date" value={draft.reviewDate} onChange={e => change({ reviewDate: e.target.value })}/></label><div className="watch-editor-actions"><span role="status">{saved ? "저장했습니다" : dirty ? "저장 전" : ""}</span><button className="text-button" type="button" onClick={onCancel}>{dirty ? "수정 취소" : "닫기"}</button><button className="button primary-button" disabled={disabled} type="submit">기록 저장</button></div></div>
    <div className="watch-date-shortcuts"><span>다시 볼 날짜</span><button type="button" className="text-button" onClick={() => reviewIn(0)}>오늘</button><button type="button" className="text-button" onClick={() => reviewIn(7)}>일주일 뒤</button>{draft.reviewDate && <button type="button" className="text-button" onClick={() => change({ reviewDate: "" })}>날짜 지우기</button>}</div>
    <p className="watch-editor-hint">날짜가 되면 이 탭의 ‘다시 볼 종목’에 표시됩니다. 별도 알림은 보내지 않습니다.</p>
  </form>;
}

export function Watchlist({ favorites, onFavorite, onRestoreFavorites, notes, onDetail, publicationId, onMap, onTable }: {
  favorites: Set<string>; onFavorite: (slug: string) => void; onRestoreFavorites: (favorites: Set<string>) => void; notes: Notebook;
  onDetail: DiscoveryDetail; publicationId?: string; onMap: () => void; onTable: () => void;
}) {
  const [capital, setCapital] = useState<"mcap" | "fdv">("mcap"), [search, setSearch] = useState(""), [filter, setFilter] = useState<"all" | "due" | WatchStage>("all");
  const [editing, setEditing] = useState<string | null>(null), [removed, setRemoved] = useState<{ slug: string; name: string } | null>(null), [message, setMessage] = useState(""), [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, WatchNote>>({});
  const pending = Object.keys(drafts).length;
  useEffect(() => { if (!pending) return; const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [pending]);
  const clearDraft = (slug: string) => setDrafts(prev => { const next = { ...prev }; delete next[slug]; return next; });
  const file = useRef<HTMLInputElement>(null), prefs = useMemo(() => ({ ...defaultPreferences(), capital }), [capital]);
  const { data, loading, error, refresh } = useDiscoveryData(prefs, favorites, "watchlist", publicationId);
  const today = localDay(), dueCount = [...favorites].filter(slug => isReviewDue(notes.notes[slug], today)).length;
  const indexed = new Map(data?.rows.map(row => [row.slug, row]));
  const all = [...favorites].map(slug => ({ slug, row: indexed.get(slug), note: notes.notes[slug], name: indexed.get(slug)?.name ?? notes.notes[slug]?.name ?? slug }));
  const entries = all.filter(item => `${item.name} ${item.row?.symbol ?? ""} ${item.note?.note ?? ""}`.toLowerCase().includes(search.toLowerCase()) && (filter === "all" || filter === "due" && isReviewDue(item.note, today) || item.note?.stage === filter || filter === "watching" && !item.note)).sort((a, b) => Number(isReviewDue(b.note, today)) - Number(isReviewDue(a.note, today)) || (a.note?.reviewDate || "9999").localeCompare(b.note?.reviewDate || "9999") || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(entries.length / 20)), shown = entries.slice((Math.min(page, pages) - 1) * 20, Math.min(page, pages) * 20);
  const exportBackup = () => {
    if (notes.blocked || !notes.ready) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: 1, app: "TOVENIT", exportedAt: new Date().toISOString(), favorites: [...favorites], notes: notes.notes }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `tovenit-watchlist-${today}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage("관심종목과 메모를 백업 파일로 내보냈습니다.");
  };
  const restore = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      if (picked.size > 4_000_000) throw Error("백업 파일은 4MB 이하여야 합니다.");
      const merged = mergeWatchBackup(notes.notes, favorites, parseWatchBackup(await picked.text()));
      const old = localStorage.getItem(FAVORITES_KEY);
      localStorage.setItem(FAVORITES_KEY, serializeFavoriteSlugs(merged.favorites));
      if (!notes.write(merged.notes)) { if (old === null) localStorage.removeItem(FAVORITES_KEY); else localStorage.setItem(FAVORITES_KEY, old); throw Error("저장 공간을 확인한 뒤 다시 복원해 주세요."); }
      onRestoreFavorites(merged.favorites); setRemoved(null); setMessage(`관심종목 ${merged.favorites.size}개를 복원했습니다. 겹치는 메모는 더 최근 기록을 남겼습니다.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "백업을 복원하지 못했습니다."); }
    finally { if (file.current) file.current.value = ""; }
  };
  return <div className="discovery-space">
    <div className="discovery-heading"><div><span className="eyebrow">YOUR RESEARCH</span><h2>관심종목 <span className="heading-count">{favorites.size}</span></h2><p>발견한 종목에 이유를 남기고, 다음에 확인할 내용을 이어가세요.</p></div><button className="button" onClick={onMap}>지도에서 찾기<ArrowRight size={15}/></button></div>
    <div className="watch-intro"><div><span className="watch-intro-icon"><CalendarDays size={22}/></span><div><strong>{dueCount ? `다시 볼 종목이 ${dueCount}개 있어요` : "다음 확인을 준비해 두세요"}</strong><p>{dueCount ? "오늘까지 확인하기로 한 종목을 먼저 보여드립니다." : "메모에 다시 볼 날짜를 정하면, 이곳에 모아 드려요."}</p></div>{dueCount > 0 && <button className="text-button" onClick={() => { setFilter("due"); setPage(1); }}>모아 보기<ArrowRight size={15}/></button>}</div><div className="watch-backup"><span>이 브라우저에 저장 · 다른 기기로 옮길 때 백업</span><div><button className="text-button" disabled={notes.blocked || !notes.ready} onClick={exportBackup}><Download size={15}/>백업</button><button className="text-button" disabled={notes.blocked || !notes.ready} onClick={() => file.current?.click()}><Upload size={15}/>복원</button><input ref={file} type="file" accept=".json,application/json" aria-label="관심종목 백업 파일" hidden onChange={e => void restore(e.target.files?.[0])}/></div></div></div>
    {notes.error && <p className="discovery-banner" role="alert">{notes.error}</p>}
    {pending > 0 && <p className="discovery-banner" role="status">저장 전 메모 {pending}개가 있습니다. 각 종목에서 ‘기록 저장’을 눌러 주세요.</p>}
    {message && <div className="discovery-banner" role="status"><span>{message}</span><button className="icon-button" aria-label="백업 안내 닫기" onClick={() => setMessage("")}><X size={15}/></button></div>}
    {removed && <div className="discovery-banner" role="status"><span>{removed.name} 관심종목을 해제했습니다. 메모는 보관됩니다.</span><button className="text-button" onClick={() => { if (!favorites.has(removed.slug)) onFavorite(removed.slug); setRemoved(null); }}>되돌리기</button></div>}
    {favorites.size === 0 ? <div className="watch-empty"><Star size={34}/><h3>찾아둔 종목을 이곳에 모으세요</h3><p>전체종목이나 지도에서 별표를 누르면 함께 저장됩니다.<br/>메모와 다시 볼 날짜를 더해 나만의 검토 목록을 만들 수 있어요.</p><div><button className="button primary-button" onClick={onMap}>후보 지도 둘러보기<ArrowRight size={16}/></button><button className="button" onClick={onTable}>전체종목 보기</button></div></div> : <>
      <div className="watch-toolbar"><div className="choice-buttons watch-filters" role="group" aria-label="관심종목 검토 상태"><button aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setPage(1); }}>전체 {favorites.size}</button><button aria-pressed={filter === "due"} onClick={() => { setFilter("due"); setPage(1); }}>다시 볼 종목 {dueCount}</button>{Object.entries(WATCH_STAGES).map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key as WatchStage); setPage(1); }}>{label}</button>)}</div><label className="search-box"><Search size={16}/><input aria-label="관심종목·메모 검색" placeholder="종목·메모 검색" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}/></label></div>
      <div className="watch-list-heading"><span>{entries.length}개 · 확인 날짜순</span><label>배수 기준<select aria-label="관심종목 배수 기준" value={capital} onChange={e => setCapital(e.target.value as "mcap" | "fdv")}><option value="mcap">유통 시총</option><option value="fdv">FDV</option></select></label></div>
      {error && <p className="discovery-banner" role="alert">{error} 메모는 계속 볼 수 있습니다. <button className="text-button" onClick={refresh}>다시 불러오기</button></p>}
      {loading && <p className="discovery-banner" role="status">관심종목의 최신 검증 자료를 불러오고 있습니다. 메모는 계속 확인할 수 있습니다.</p>}
      <div className="watch-list">{shown.map(item => {
        const note = item.note ?? newWatchNote(item.name, item.row?.identity ?? "", item.row && data ? { pr: item.row.cells.pr.value, capital, dataAt: data.updatedAt } : null);
        const due = isReviewDue(item.note, today), identityChanged = !!item.note?.identity && !!item.row && item.note.identity !== item.row.identity;
        return <article className={"watch-card" + (editing === item.slug ? " editing" : "")} key={item.slug}>
          <div className="watch-card-main"><div className="watch-coin-heading"><button className="favorite-button saved" aria-label={`${item.name} 관심종목 해제`} aria-pressed="true" onClick={() => { setRemoved({ slug: item.slug, name: item.name }); onFavorite(item.slug); }}><Star size={17} fill="currentColor"/></button><button className="discovery-coin" disabled={!item.row || !data} onClick={e => { if (item.row && data) onDetail(item.row, data, e.currentTarget); }} aria-label={`${item.name} 상세 보기`}><span className="coin-monogram">{(item.row?.symbol ?? item.name).slice(0, 2)}</span><span><strong>{item.name}</strong><small>{item.row?.symbol ?? (loading ? "자료 확인 중" : "현재 검증본에서 찾지 못했습니다")}</small></span></button></div>
            <div className="watch-metrics"><div><small>P/R · 30일</small><strong>{fmtMult(item.row?.cells.pr.value ?? null)}</strong></div><div><small>P/HR · 30일</small><strong>{fmtMult(item.row?.cells.phr.value ?? null)}</strong></div><div><small>Revenue · 30일</small><strong>{fmtUsd(item.row?.revenue30d ?? null)}</strong></div></div>
            <div className="watch-card-actions"><span className={`watch-stage stage-${note.stage}`}>{WATCH_STAGES[note.stage]}</span><button className="button" aria-expanded={editing === item.slug} onClick={() => setEditing(editing === item.slug ? null : item.slug)}><FilePenLine size={15}/>{editing === item.slug ? "메모 닫기" : item.note ? "기록 수정" : "메모 쓰기"}</button></div></div>
          <div className="watch-card-note"><p>{note.note || "관심을 둔 이유를 남겨 보세요."}</p><span className={due ? "review-due" : ""}><CalendarDays size={13}/>{note.reviewDate ? `${note.reviewDate}${due ? " · 확인할 날짜" : " 다시 보기"}` : "다시 볼 날짜 미정"}</span></div>
          {identityChanged && <p className="discovery-banner">토큰 연결이 이전 기록과 달라졌습니다. 상세에서 확인해 주세요.</p>}
          {editing === item.slug && <NoteEditor key={item.slug} initial={note} draft={drafts[item.slug] ?? note} onDraft={draft => setDrafts(prev => ({ ...prev, [item.slug]: draft }))} disabled={!notes.ready || notes.blocked} onSave={updated => { const ok = notes.patch(item.slug, updated); if (ok) clearDraft(item.slug); return ok; }} onCancel={() => { clearDraft(item.slug); setEditing(null); }}/>}
        </article>;
      })}</div>
      {!entries.length && <div className="discovery-empty"><p>조건에 맞는 관심종목이 없습니다.</p><button className="text-button" onClick={() => { setFilter("all"); setSearch(""); }}>전체 관심종목 보기</button></div>}
      {pages > 1 && <div className="discovery-pagination"><button className="button" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>이전</button><span>{Math.min(page, pages)} / {pages}</span><button className="button" disabled={page >= pages} onClick={() => setPage(n => n + 1)}>다음</button></div>}
      <p className="watch-footnote">별표는 세 탭에서 함께 사용합니다. 메모·검토 상태·날짜는 기기 간 자동 동기화되지 않습니다. 브라우저 데이터를 지우기 전에 백업해 주세요.</p>
    </>}
  </div>;
}
