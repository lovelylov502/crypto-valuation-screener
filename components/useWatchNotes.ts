"use client";
import { useCallback, useEffect, useState } from "react";
import { WATCH_NOTES_KEY, parseWatchNotes, type WatchNote, type WatchNotes } from "@/lib/watchNotes";

export function useWatchNotes() {
  const [notes, setNotes] = useState<WatchNotes>({}), [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    try { setNotes(parseWatchNotes(localStorage.getItem(WATCH_NOTES_KEY))); }
    catch { setBlocked(true); setError("저장된 메모를 읽지 못했습니다. 기존 기록을 보존하며 새 저장을 멈췄습니다."); }
    setReady(true);
    const sync = (e: StorageEvent) => { if (e.key !== WATCH_NOTES_KEY) return; try { setNotes(parseWatchNotes(e.newValue)); } catch { setBlocked(true); setError("다른 창의 메모를 확인하지 못했습니다. 기존 기록을 보존합니다."); } };
    window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, []);
  const write = useCallback((next: WatchNotes) => {
    if (!ready || blocked) return false;
    try { localStorage.setItem(WATCH_NOTES_KEY, JSON.stringify({ schema: 1, notes: next })); setNotes(next); setError(""); return true; }
    catch { setError("이 브라우저에 메모를 저장하지 못했습니다. 입력한 내용을 복사한 뒤 저장 공간을 확인해 주세요."); return false; }
  }, [ready, blocked]);
  const patch = (slug: string, value: WatchNote) => {
    try { return write({ ...parseWatchNotes(localStorage.getItem(WATCH_NOTES_KEY)), [slug]: value }); }
    catch { setBlocked(true); setError("저장된 메모가 바뀌어 확인이 필요합니다. 입력을 보존하며 새 저장을 멈췄습니다."); return false; }
  };
  return { notes, ready, blocked, error, patch, write };
}
