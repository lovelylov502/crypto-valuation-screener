"use client";
import { useEffect, useRef, useState } from "react";
import { assertDiscoveryPage, type DiscoveryPage } from "@/lib/discoveryTypes";
import type { WorkspacePreferences } from "@/lib/workspacePreferences";
import { readJsonText } from "@/lib/jsonTransport.mjs";

export function useDiscoveryData(prefs: WorkspacePreferences, favorites: Set<string>, mode: "map" | "watchlist", publicationId?: string, onPublicationChanged?: () => void) {
  const publicationChanged = useRef(onPublicationChanged);
  publicationChanged.current = onPublicationChanged;
  const [data, setData] = useState<DiscoveryPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const query = JSON.stringify(prefs), saved = mode === "watchlist" || prefs.view === "favorites" ? [...favorites].sort().join(",") : "";
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    void (async () => {
      try {
        let joined: DiscoveryPage | null = null;
        for (let page = 1; ; page++) {
          const response = await fetch("/api/discovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, prefs: JSON.parse(query), favorites: saved ? saved.split(",") : [], page }), cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
          const raw: unknown = JSON.parse(await readJsonText(response));
          if (!response.ok) throw Error("자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
          assertDiscoveryPage(raw, prefs.capital);
          if (joined && (raw.publicationId !== joined.publicationId || raw.snapshotSha256 !== joined.snapshotSha256 || raw.total !== joined.total)) { if (!controller.signal.aborted) publicationChanged.current?.(); throw Error("수집 자료가 갱신되었습니다. 다시 불러와 주세요."); }
          if (joined === null) joined = raw;
          else { const previous: DiscoveryPage = joined; joined = Object.assign({}, previous, { rows: previous.rows.concat(raw.rows), historyStatus: previous.historyStatus === "unavailable" ? "unavailable" : raw.historyStatus }); }
          if (raw.page !== page || new Set(joined.rows.map(r => r.slug)).size !== joined.rows.length) throw Error("조회 범위를 확인하지 못했습니다. 다시 불러와 주세요.");
          if (page >= raw.pages) break;
        }
        if (!controller.signal.aborted) { setData(joined); if (joined && publicationId && joined.publicationId !== publicationId) publicationChanged.current?.(); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "자료를 불러오지 못했습니다."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [query, saved, mode, publicationId, retry, prefs.capital]);
  return { data, loading, error, refresh: () => setRetry(n => n + 1) };
}
