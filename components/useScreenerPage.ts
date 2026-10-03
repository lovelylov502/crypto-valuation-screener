"use client";
import { useEffect, useMemo, useState } from "react";
import type { ScreenerPage } from "@/lib/screenerQuery";
import type { WorkspacePreferences } from "@/lib/workspacePreferences";
import { fundamentalErrors } from "@/lib/fundamentalContract";
import { RULE_VERSION } from "@/lib/fundamentals";
import type { PublicationJournal } from "@/lib/publicationTypes";
import { STATUS_POLL_MS } from "@/lib/collectionSchedule";

export function pageUrl(prefs: WorkspacePreferences, favorites: Set<string>, page: number, size: number) {
  return "/api/screener?" + new URLSearchParams({ prefs: JSON.stringify(prefs), favorites: [...favorites].join(","), page: String(page), size: String(size) });
}
export function useScreenerPage(initial: ScreenerPage | null, prefs: WorkspacePreferences, favorites: Set<string>, page: number, size: number, ready: boolean) {
  const [data, setData] = useState(initial);
  const [publication, setPublication] = useState<PublicationJournal | undefined>(initial?.publication);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const url = useMemo(() => pageUrl(prefs, favorites, page, size), [prefs, favorites, page, size]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setRefreshing(true);
    const deadline = setTimeout(() => controller.abort("timeout"), 30000);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("검증본을 불러오지 못했습니다. 수집 상태를 확인해 주세요.");
        const next = await response.json() as ScreenerPage;
        if (next.scoreVersion !== RULE_VERSION || !next.pagination || !Number.isFinite(Date.parse(next.updatedAt)) || Date.parse(next.updatedAt) > Date.now() + 300000 || !Array.isArray(next.coins) || next.coins.some(c => fundamentalErrors(c).length)) throw new Error("자료 형식을 확인하지 못했습니다.");
        if (!controller.signal.aborted) { setData(next); setPublication(next.publication); setCheckedAt(new Date().toISOString()); setError(""); }
      } catch (e) {
        if (!controller.signal.aborted || controller.signal.reason === "timeout") setError(controller.signal.aborted ? "조회가 지연되고 있습니다. 다시 시도해 주세요." : e instanceof Error ? e.message : "조회 실패");
      } finally {
        clearTimeout(deadline);
        if (!controller.signal.aborted || controller.signal.reason === "timeout") setRefreshing(false);
      }
    }, 200);
    return () => { clearTimeout(timer); clearTimeout(deadline); controller.abort(); };
  }, [url, refreshCount, ready]);
  useEffect(() => {
    if (!ready) return;
    let active = true, busy = false, last = 0;
    const check = async () => {
      if (busy || document.visibilityState !== "visible" || Date.now() - last < STATUS_POLL_MS) return;
      busy = true; last = Date.now();
      try {
        const response = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("수집 상태 확인에 실패했습니다.");
        const next = await response.json() as PublicationJournal;
        if (next.schema !== 1 || !next.attempt) throw new Error("수집 기록 형식을 확인하지 못했습니다.");
        if (active) { setPublication(next); if (next.published?.id && next.published.id !== data?.publication?.published?.id) setRefreshCount(n => n + 1); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "수집 상태 조회 실패"); }
      finally { busy = false; }
    };
    void check();
    const timer = setInterval(check, STATUS_POLL_MS);
    window.addEventListener("focus", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [ready, data?.publication?.published?.id]);
  return { data, publication, refreshing, error, checkedAt, refresh: () => setRefreshCount(n => n + 1) };
}
