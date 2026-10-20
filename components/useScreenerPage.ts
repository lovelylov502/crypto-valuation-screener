"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { assertTablePage, type TablePage } from "@/lib/tableDto";
import type { WorkspacePreferences } from "@/lib/workspacePreferences";
import { RULE_VERSION } from "@/lib/fundamentals";
import type { PublicationJournal } from "@/lib/publicationTypes";
import { STATUS_POLL_MS } from "@/lib/collectionSchedule";
import { parseCollectionRelease } from "@/lib/pipelineRelease";
import { readJsonText } from "@/lib/jsonTransport.mjs";

export interface PublicationResponseState {
  publication?:PublicationJournal; nextRequest:number; lastRequest:number; statusVersion:number;
}
export interface PublicationRequest { source:"data"|"status"; sequence:number; statusVersion:number }
/** A fresh data response supplies live mode; later accepted status and request ordering fence stale responses. */
export function mergePublicationResponse(current:PublicationResponseState,incoming:PublicationJournal|undefined,request:PublicationRequest):PublicationResponseState {
  const release=incoming?.collectionRelease===undefined?undefined:parseCollectionRelease(incoming.collectionRelease);
  if(!incoming||request.sequence<current.lastRequest||request.source==="data"&&request.statusVersion<current.statusVersion)return current;
  const publication={...incoming,...(release?{collectionRelease:release}:current.publication?.collectionRelease?{collectionRelease:current.publication.collectionRelease}:{})};
  return {...current,publication,lastRequest:request.sequence,statusVersion:current.statusVersion+Number(request.source==="status")};
}

export function pageUrl(prefs: WorkspacePreferences, favorites: Set<string>, page: number, size: number, view?: "table") {
  return "/api/screener?" + new URLSearchParams({ ...(view ? {view} : {}), prefs: JSON.stringify(prefs), favorites: [...favorites].join(","), page: String(page), size: String(size) });
}
/** An initial status response must not cancel an already pending first page. */
export const publicationRefreshNeeded = (published: string | undefined, displayed: string | undefined, pending: boolean) => !!published && published !== displayed && !pending;
export function useScreenerPage(initial: TablePage | null, prefs: WorkspacePreferences, favorites: Set<string>, page: number, size: number, ready: boolean) {
  const [data, setData] = useState(initial);
  const [publication, setPublication] = useState<PublicationJournal | undefined>(initial?.publication);
  const publicationState=useRef<PublicationResponseState>({publication:initial?.publication,nextRequest:0,lastRequest:0,statusVersion:0});
  const dataPublication = useRef(initial?.publicationId), pendingData = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const url = useMemo(() => pageUrl(prefs, favorites, page, size, "table"), [prefs, favorites, page, size]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const request:PublicationRequest={source:"data",sequence:++publicationState.current.nextRequest,statusVersion:publicationState.current.statusVersion};
    const requestedPublication = publicationState.current.publication?.published?.id;
    pendingData.current = true;
    setRefreshing(true);
    const deadline = setTimeout(() => controller.abort("timeout"), 30000);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("검증본을 불러오지 못했습니다. 수집 상태를 확인해 주세요.");
        const next: unknown = JSON.parse(await readJsonText(response));
        assertTablePage(next, prefs.capital);
        if (next.scoreVersion !== RULE_VERSION) throw new Error("자료 형식을 확인하지 못했습니다.");
        if (!controller.signal.aborted) {
          const merged=mergePublicationResponse(publicationState.current,next.publication,request);
          publicationState.current=merged;
          const latest = merged.publication?.published?.id;
          if (latest && latest !== next.publicationId && latest !== requestedPublication) setRefreshCount(n => n + 1);
          else { dataPublication.current = next.publicationId; setData(next); }
          setPublication(merged.publication);setCheckedAt(new Date().toISOString());setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted || controller.signal.reason === "timeout") setError(controller.signal.aborted ? "조회가 지연되고 있습니다. 다시 시도해 주세요." : e instanceof Error ? e.message : "조회 실패");
      } finally {
        clearTimeout(deadline);
        if (!controller.signal.aborted || controller.signal.reason === "timeout") pendingData.current = false;
        if (!controller.signal.aborted || controller.signal.reason === "timeout") setRefreshing(false);
      }
    }, 200);
    return () => { clearTimeout(timer); clearTimeout(deadline); controller.abort(); pendingData.current = false; };
  }, [url, refreshCount, ready]);
  useEffect(() => {
    if (!ready) return;
    let active = true, busy = false, last = 0;
    const check = async () => {
      if (busy || document.visibilityState !== "visible" || Date.now() - last < STATUS_POLL_MS) return;
      busy = true; last = Date.now();
      const request:PublicationRequest={source:"status",sequence:++publicationState.current.nextRequest,statusVersion:publicationState.current.statusVersion};
      try {
        const response = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("수집 상태 확인에 실패했습니다.");
        const next = await response.json() as PublicationJournal;
        if (![1,2].includes(next.schema) || !next.attempt) throw new Error("수집 기록 형식을 확인하지 못했습니다.");
        if (active) {
          const previous=publicationState.current,merged=mergePublicationResponse(previous,next,request);
          if(merged!==previous) {
            publicationState.current=merged;setPublication(merged.publication);
            if (publicationRefreshNeeded(next.published?.id, dataPublication.current, pendingData.current)) setRefreshCount(n => n + 1);
          }
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "수집 상태 조회 실패"); }
      finally { busy = false; }
    };
    void check();
    const timer = setInterval(check, STATUS_POLL_MS);
    window.addEventListener("focus", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [ready]);
  return { data, publication, refreshing, error, checkedAt, refresh: () => setRefreshCount(n => n + 1) };
}
