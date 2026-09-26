"use client";
import { useEffect, useMemo, useState } from "react";
import type { ScreenerPage } from "@/lib/screenerQuery";
import type { WorkspacePreferences } from "@/lib/workspacePreferences";
import { fundamentalErrors } from "@/lib/fundamentalContract";
import { RULE_VERSION } from "@/lib/fundamentals";

export function pageUrl(prefs: WorkspacePreferences, favorites: Set<string>, page: number, size: number) {
  return "/api/screener?" + new URLSearchParams({ prefs: JSON.stringify(prefs), favorites: [...favorites].join(","), page: String(page), size: String(size) });
}
export function useScreenerPage(initial: ScreenerPage | null, prefs: WorkspacePreferences, favorites: Set<string>, page: number, size: number, ready: boolean) {
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const url = useMemo(() => pageUrl(prefs, favorites, page, size), [prefs, favorites, page, size]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setRefreshing(true);
    setError("");
    const deadline = setTimeout(() => controller.abort("timeout"), 90000);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("자료를 가져오지 못했습니다. 다시 시도해 주세요.");
        const next = await response.json() as ScreenerPage;
        if (next.scoreVersion !== RULE_VERSION || !next.pagination || !Number.isFinite(Date.parse(next.updatedAt)) || Date.parse(next.updatedAt) > Date.now() + 300000 || !Array.isArray(next.coins) || next.coins.some(c => fundamentalErrors(c).length)) throw new Error("자료 형식을 확인하지 못했습니다.");
        if (!controller.signal.aborted) { setData(next); setCheckedAt(new Date().toISOString()); }
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
    let last = Date.now();
    const check = () => { if (document.visibilityState === "visible" && Date.now() - last > 30 * 60000) { last = Date.now(); setRefreshCount(n => n + 1); } };
    const timer = setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); };
  }, []);
  return { data, refreshing, error, checkedAt, refresh: () => setRefreshCount(n => n + 1) };
}
