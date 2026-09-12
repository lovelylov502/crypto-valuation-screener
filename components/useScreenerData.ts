"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenerResponse } from "@/lib/types";
import { fetchLatestSnapshot, REVALIDATE_MS } from "@/lib/screenerRefresh";
import {
  appendSnapshot,
  HISTORY_STORAGE_KEY,
  REVIEW_BASELINE_KEY,
  makeSnapshot,
  parseHistory,
  type Snapshot,
} from "@/lib/snapshotHistory";

export function useScreenerData(initial: ScreenerResponse | null) {
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Snapshot | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const current = useRef(initial);
  const active = useRef<AbortController | null>(null);
  const lastCheck = useRef(0);
  const history = useRef<Snapshot[]>([]);

  useEffect(() => {
    try {
      history.current = parseHistory(localStorage.getItem(HISTORY_STORAGE_KEY));
      const savedReview = parseHistory(localStorage.getItem(REVIEW_BASELINE_KEY)).at(-1);
      const firstBaseline = savedReview ?? history.current.at(-1) ?? (initial ? makeSnapshot(initial) : null);
      setBaseline(firstBaseline);
      if (firstBaseline && !savedReview) localStorage.setItem(REVIEW_BASELINE_KEY, JSON.stringify([firstBaseline]));
    } catch {
      setStorageError(true);
    }
    setReady(true);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (!ready || !data) return;
    // An old ISR response must never overwrite a newer local observation.
    history.current = appendSnapshot(history.current, makeSnapshot(data));
    setHistoryCount(history.current.length);
    try {
      localStorage.setItem(
        HISTORY_STORAGE_KEY,
        JSON.stringify(history.current),
      );
      if (!baseline) {
        const first = makeSnapshot(data);
        setBaseline(first);
        localStorage.setItem(REVIEW_BASELINE_KEY, JSON.stringify([first]));
      }
    } catch {
      setStorageError(true);
    }
  }, [data, ready, baseline]);

  const refresh = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 90_000);
    setRefreshing(true);
    setError("");
    setMessage("최신 자료 확인 중");
    try {
      const next = await fetchLatestSnapshot({
        signal: controller.signal,
        onWaiting: () => setMessage("새 스냅샷을 준비하고 있습니다"),
      });
      if (controller.signal.aborted) return;
      if (
        !current.current ||
        Date.parse(next.updatedAt) > Date.parse(current.current.updatedAt)
      ) {
        current.current = next;
        setData(next);
        setMessage("새 데이터를 반영했습니다");
      } else {
        setMessage("마지막 확인 이후 새 스냅샷 없음");
      }
      lastCheck.current = Date.now();
      setCheckedAt(new Date().toISOString());
      setNow(Date.now());
    } catch (e) {
      if (active.current === controller) {
        setError(
          controller.signal.aborted
            ? "확인이 지연되고 있습니다. 다시 시도해 주세요."
            : e instanceof Error
              ? e.message
              : "갱신 실패",
        );
        setMessage("");
      }
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const visibleRefresh = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastCheck.current > 5 * 60_000
      )
        void refresh();
    };
    const timer = setInterval(visibleRefresh, REVALIDATE_MS);
    const ageTimer = setInterval(() => setNow(Date.now()), 60_000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      clearInterval(timer);
      clearInterval(ageTimer);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
      const pending = active.current;
      active.current = null;
      pending?.abort();
    };
  }, [refresh]);

  const acknowledge = () => {
    if (!data) return;
    const snapshot = makeSnapshot(data);
    setBaseline(snapshot);
    try { localStorage.setItem(REVIEW_BASELINE_KEY, JSON.stringify([snapshot])); }
    catch { setStorageError(true); }
  };
  return {
    data,
    refreshing,
    refresh,
    message,
    error,
    checkedAt,
    baseline,
    historyCount,
    acknowledge,
    storageError,
    now,
    history: history.current,
  };
}
