"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Download,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import type { ScreenerResponse } from "@/lib/types";
import type { OpportunityTrack } from "@/lib/signals";
import { MULTIPLE_REFERENCE, researchMultiple, researchReasons, revenueGrowing, holderTransitionReasons } from "@/lib/research";
import { fmtKstMinute } from "@/lib/format";
import {
  hasEligibleCurrentHolderValue,
  matchesRange,
  parseFavoriteSlugs,
  parseStoredSelection,
  serializeFavoriteSlugs,
} from "@/lib/screenerFilters";
import {
  COLUMN_GROUP_LABELS,
  COLUMN_PRESETS,
  DEFAULT_VISIBLE_COLUMNS,
  SCREENER_COLUMNS as COLS,
  type ColumnGroup,
  type SortKey,
} from "@/lib/screenerColumns";
import { compareSnapshot, makeSnapshot } from "@/lib/snapshotHistory";
import { SNAPSHOT_STALE_MS, REVALIDATE_MS } from "@/lib/screenerRefresh";
import { CoinDetail } from "./CoinDetail";
import { renderCell, sortValue } from "./ScreenerCells";
import {
  MultipleRangeFilter,
  ScoreRangeFilter,
  UsdRangeFilter,
} from "./RangeFilters";
import { useScreenerData } from "./useScreenerData";
import { Pagination } from "./Pagination";
import { PAGE_SIZE_KEY, parsePageSize } from "@/lib/pagination";
import { useWindowTableHeader } from "./useWindowTableHeader";
import { REVENUE_LABELS, KIND_ORDER, revenueKind, revenueLabel, type RevenueKind } from "@/lib/fundamentals";
import { revenueBasis } from "@/lib/revenueHistory";

const FAVORITES_KEY = "crypto-valuation-favorites-v1";
const COLUMNS_KEY = "crypto-valuation-columns-v6";

const TRACK_NAMES: Record<OpportunityTrack, string> = {
  business: "사업 수익·수수료 성장",
  holder: "홀더 환원",
  transition: "홀더 0↔양수",
};
type View = "all" | "signals" | "holder" | "favorites" | "changes" | "data";

export function ScreenerClient({
  initialData,
}: {
  initialData: ScreenerResponse | null;
}) {
  const {
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
    history,
  } = useScreenerData(initialData);
  const [multipleReference, setMultipleReference] = useState(MULTIPLE_REFERENCE);
  const [psReferenceDraft, setPsReferenceDraft] = useState(String(MULTIPLE_REFERENCE));
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("all");
  const [kind, setKind] = useState<RevenueKind | "all">("all");
  const activeReference = kind !== "all" && kind !== "unknown" && kind !== "mixed" ? multipleReference : null;
  const [tracks, setTracks] = useState<Set<OpportunityTrack>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [minMcap, setMinMcap] = useState(0);
  const [maxMcap, setMaxMcap] = useState(0);
  const [minTvl, setMinTvl] = useState(0);
  const [maxTvl, setMaxTvl] = useState(0);
  const [minPhr, setMinPhr] = useState(0);
  const [maxPhr, setMaxPhr] = useState(0);
  const [minMultiple, setMinPs] = useState(0);
  const [maxMultiple, setMaxPs] = useState(0);
  const [minScore, setMinScore] = useState(0);
  const [maxScore, setMaxScore] = useState(0);
  const [hideInactive, setHideInactive] = useState(false);
  const [holderOnly, setHolderOnly] = useState(false);
  const [excludeRisk, setExcludeRisk] = useState(false);
  const [completeOnly, setCompleteOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [favoriteSlugs, setFavoriteSlugs] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<SortKey>>(
    new Set(DEFAULT_VISIBLE_COLUMNS),
  );
  const [storedReady, setStoredReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const resultsRef = useRef<HTMLDivElement>(null);
  const tableRef = useWindowTableHeader();
  const [sortKey, setSortKey] = useState<SortKey>("revenueMultiple");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);

  useEffect(() => {
    try {
      setFavoriteSlugs(parseFavoriteSlugs(localStorage.getItem(FAVORITES_KEY)));
      const saved = localStorage.getItem(COLUMNS_KEY);
      setPageSize(parsePageSize(localStorage.getItem(PAGE_SIZE_KEY)));
      const reference = Number(localStorage.getItem("crypto-revenueMultiple-reference-v1"));
      if (Number.isFinite(reference) && reference > 0) { setMultipleReference(reference); setPsReferenceDraft(String(reference)); }
      setVisibleColumns(
        parseStoredSelection(
          saved,
          COLS.map((c) => c.key),
          DEFAULT_VISIBLE_COLUMNS,
        ),
      );
    } catch {
      setPreferencesError(true);
    }
    setStoredReady(true);
  }, []);
  useEffect(() => {
    if (!storedReady) return;
    try {
      localStorage.setItem(
        FAVORITES_KEY,
        serializeFavoriteSlugs(favoriteSlugs),
      );
      localStorage.setItem(COLUMNS_KEY, JSON.stringify([...visibleColumns]));
      localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
      localStorage.setItem("crypto-revenueMultiple-reference-v1", String(multipleReference));
    } catch {
      setPreferencesError(true);
    }
  }, [favoriteSlugs, visibleColumns, storedReady, multipleReference, pageSize]);

  const coins = useMemo(() => data?.coins ?? [], [data]);
  const comparisonBaseline =
    baseline && data && Date.parse(baseline.at) <= Date.parse(data.updatedAt)
      ? baseline
      : null;
  const changes = useMemo(
    () =>
      new Map(
        coins.map((c) => [
          c.slug,
          compareSnapshot(c, comparisonBaseline, data?.scoreVersion ?? ""),
        ]),
      ),
    [coins, comparisonBaseline, data?.scoreVersion],
  );
  const counts = useMemo(
    () => ({
      holder: coins.filter((c) => c.opportunities.holder).length,
      signals: coins.filter(revenueGrowing).length,
      favorites: coins.filter((c) => favoriteSlugs.has(c.slug)).length,
      changes: coins.filter((c) => changes.get(c.slug)?.meaningful).length,
      data: coins.filter((c) => c.opportunities.dataIssues.length > 0).length,
    }),
    [coins, favoriteSlugs, changes],
  );
  const toggleSet = <T,>(
    setter: React.Dispatch<React.SetStateAction<Set<T>>>,
    key: T,
  ) =>
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "category" || key.startsWith("revenueMultiple") ? "asc" : "desc");
    }
    setPage(1);
  };
  const reset = () => {
    setSearch("");
    setView("all");
    setKind("all");
    setTracks(new Set());
    setCats(new Set());
    setMinMcap(0);
    setMaxMcap(0);
    setMinTvl(0);
    setMaxTvl(0);
    setMinPhr(0);
    setMaxPhr(0);
    setMinPs(0);
    setMaxPs(0);
    setMinScore(0);
    setMaxScore(0);
    setHideInactive(false);
    setHolderOnly(false);
    setExcludeRisk(false);
    setCompleteOnly(false);
    setNewOnly(false);
    setSortKey("revenueMultiple");
    setSortDir("asc");
    setPage(1);
  };
  const activeCount = [
    kind !== "all",
    cats.size > 0,
    minMcap > 0 || maxMcap > 0,
    minTvl > 0 || maxTvl > 0,
    minPhr > 0 || maxPhr > 0,
    minMultiple > 0 || maxMultiple > 0,
    minScore > 0 || maxScore > 0,
    hideInactive,
    holderOnly,
    excludeRisk,
    completeOnly,
    newOnly,
  ].filter(Boolean).length;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return coins
      .filter((c) => {
        const o = c.opportunities;
        if (kind !== "all" && revenueKind(c) !== kind) return false;
        if (q && !`${c.name} ${c.symbol ?? ""}`.toLowerCase().includes(q))
          return false;
        if (tracks.size && ![...tracks].some((t) => o[t])) return false;
        if (view === "signals" && !revenueGrowing(c)) return false;
        if (view === "holder" && !(tracks.has("transition") ? o.transition : o.holder)) return false;
        if (view === "favorites" && !favoriteSlugs.has(c.slug)) return false;
        if (view === "changes" && !changes.get(c.slug)?.meaningful)
          return false;
        if (view === "data" && o.dataIssues.length === 0) return false;
        if (cats.size > 0 && (!c.category || !cats.has(c.category)))
          return false;
        if (hideInactive && c.lowActivity) return false;
        if (holderOnly && (!hasEligibleCurrentHolderValue(c.holderValue) || c.multiples.phr === null))
          return false;
        if (excludeRisk && c.highDilution) return false;
        if (completeOnly && c.confidenceGrade === "C") return false;
        if (newOnly && c.status !== "신규 프로젝트") return false;
        return (
          matchesRange(c.mcap, minMcap, maxMcap) &&
          matchesRange(c.tvl, minTvl, maxTvl) &&
          matchesRange(c.multiples.phr, minPhr, maxPhr) &&
          (["all", "unknown", "mixed"].includes(kind) || matchesRange(researchMultiple(c), minMultiple, maxMultiple)) &&
          matchesRange(c.valueScore, minScore, maxScore)
        );
      })
      .sort((a, b) => {
        if (["revenueMultiple", "multiple7d", "multiple90d", "multiple1y", "revenue7d", "revenue30d", "revenue90d", "revenue1y", "revenueAnnual", "revenueGrowth"].includes(sortKey)) {
          const group = KIND_ORDER.indexOf(revenueKind(a)) - KIND_ORDER.indexOf(revenueKind(b));
          if (group) return group;
          const basis = revenueBasis(a).localeCompare(revenueBasis(b));
          if (basis) return basis;
        }
        const av = sortValue(a, sortKey),
          bv = sortValue(b, sortKey);
        if (av === null && bv === null) return a.name.localeCompare(b.name);
        if (av === null) return 1;
        if (bv === null) return -1;
        const direction = sortDir === "asc" ? 1 : -1;
        const diff =
          typeof av === "string" && typeof bv === "string"
            ? av.localeCompare(bv)
            : Number(av) - Number(bv);
        return (
          diff * direction ||
          (b.mcap ?? 0) - (a.mcap ?? 0) ||
          a.name.localeCompare(b.name)
        );
      });
  }, [
    coins,
    kind,
    search,
    tracks,
    view,
    favoriteSlugs,
    changes,
    cats,
    hideInactive,
    holderOnly,
    excludeRisk,
    completeOnly,
    newOnly,
    minMcap,
    maxMcap,
    minTvl,
    maxTvl,
    minPhr,
    maxPhr,
    minMultiple,
    maxMultiple,
    minScore,
    maxScore,
    sortKey,
    sortDir,
  ]);
  const deferredRows = useDeferredValue(rows);
  useEffect(() => {
    setPage(1);
  }, [
    search,
    kind,
    tracks,
    view,
    cats,
    hideInactive,
    holderOnly,
    excludeRisk,
    completeOnly,
    newOnly,
    minMcap,
    maxMcap,
    minTvl,
    maxTvl,
    minPhr,
    maxPhr,
    minMultiple,
    maxMultiple,
    minScore,
    maxScore,
  ]);
  const pages = Math.max(1, Math.ceil(deferredRows.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageStart = (currentPage - 1) * pageSize;
  const moveToResults = () => requestAnimationFrame(() => {
    resultsRef.current?.focus({ preventScroll: true });
    resultsRef.current?.scrollIntoView({ block: "start" });
  });
  const changePage = (next: number) => { setPage(next); moveToResults(); };
  const changePageSize = (size: number) => { setPageSize(size); setPage(1); moveToResults(); };
  const selectedCols = [...visibleColumns]
    .map((key) => COLS.find((c) => c.key === key))
    .filter((c) => c !== undefined);
  const selectedCoin = coins.find((c) => c.slug === selectedSlug);
  const snapshotAge = data && now ? now - Date.parse(data.updatedAt) : 0;
  const sourceFailures =
    data?.sources.filter((s) => s.status === "error").length ?? 0;
  const freshLabel = !data
    ? "자료 준비 중"
    : snapshotAge > SNAPSHOT_STALE_MS
      ? "오래된 자료"
      : sourceFailures
        ? "일부 자료 미수집"
        : "최근 수집 자료";
  const hasFilters =
    search !== "" || view !== "all" || tracks.size > 0 || activeCount > 0;
  const sortArrow = (key: SortKey) =>
    sortKey === key ? (
      sortDir === "desc" ? (
        <ArrowDown size={13} />
      ) : (
        <ArrowUp size={13} />
      )
    ) : null;
  const exportSnapshot = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ ...makeSnapshot(data), definitions: Object.fromEntries(data.coins.map(c => [c.slug, c.fundamentals])) }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `screener-${data.updatedAt.replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="research-app revenueMultiple-workspace">
      <a className="skip-link" href="#screener-results">
        결과 표로 이동
      </a>
      <header className="app-header">
        <div>
          <h1>크립토 리서치</h1>
          <p className="intro">집계의 의미를 확인하고 같은 종류끼리 비교합니다</p>
        </div>
        <div className="reference-setting"><label htmlFor="revenueMultiple-reference">배수 참고선 <input id="revenueMultiple-reference" type="number" min="0.1" step="1" disabled={activeReference === null} value={psReferenceDraft} onChange={e => { setPsReferenceDraft(e.target.value); const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) setMultipleReference(v); }} onBlur={() => setPsReferenceDraft(String(multipleReference))} /> 배</label><small>{activeReference === null ? "집계 종류를 선택하면 적용" : REVENUE_LABELS[kind as RevenueKind]}</small></div>
        <div className="update-block">
          <span
            className={`freshness ${snapshotAge > SNAPSHOT_STALE_MS || sourceFailures ? "caution" : ""}`}
          >
            {freshLabel}
          </span>
          <p>
            {data ? fmtKstMinute(data.updatedAt) : "첫 데이터를 불러옵니다"}
          </p>
          <button
            className="button refresh-button"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? "spinning" : ""} />
            {refreshing ? "확인 중" : "최신 자료 확인"}
          </button>
        </div>
      </header>
      <div className="update-feedback" role="status" aria-live="polite">
        {error ? (
          <span className="error-text">
            {error} {data ? "표에는 마지막으로 받은 자료를 유지합니다." : ""}
          </span>
        ) : (
          message || "화면을 열거나 돌아오면 최신 자료를 확인합니다."
        )}
        {data && snapshotAge >= REVALIDATE_MS && !refreshing && (
          <span className="caution-text">
            {" "}
            현재 자료는 30분 이상 경과했습니다.
          </span>
        )}
        <button
          className="text-button"
          onClick={() => setSourceOpen((v) => !v)}
          aria-expanded={sourceOpen}
          aria-controls="source-details"
        >
          수집 상태와 기준
        </button>
      </div>
      {sourceOpen && (
        <section className="source-details" id="source-details">
          <h2>데이터를 읽는 기준</h2>
          <p>프로토콜 수익·서비스 매출·홀더 환원·추정 손익을 구분합니다. 집계액 관련 정렬은 종류와 기간 기준별로 묶으며, 참고선과 배수 범위는 한 종류를 선택했을 때 적용됩니다.</p>
          <p>
            각 배수는 현재 토큰 시총을 해당 집계액의 연환산 값으로 나눕니다. 정의 미확인·혼합·변경 항목의 배수는 보류합니다. 토큰 시총과 FDV를 회사 지분 가치로 해석할 수 없으며, 원천 집계가 사업 전체 매출을 뜻하지는 않습니다.
          </p>
          <div className="source-grid">
            <div>
              <strong>DefiLlama</strong>
              <p>수수료·집계액·홀더 금액. 원천 생성 시각은 제공되지 않습니다.</p>
            </div>
            <div>
              <strong>CoinMarketCap</strong>
              <p>
                원천{" "}
                {data?.marketDataFreshness.oldestAt
                  ? fmtKstMinute(data.marketDataFreshness.oldestAt)
                  : "미확인"}{" "}
                ~{" "}
                {data?.marketDataFreshness.newestAt
                  ? fmtKstMinute(data.marketDataFreshness.newestAt)
                  : "미확인"}
              </p>
            </div>
            <div>
              <strong>CoinGecko</strong>
              <p>일부 가격·공급 데이터 보강. 캐시 주기 최대 6시간.</p>
            </div>
          </div>
          <p>
            마지막 서버 확인 {checkedAt ? fmtKstMinute(checkedAt) : "확인 중"} ·{" "}
            {data?.scoreVersion ?? "–"}
          </p>
          {data?.sources.map((s) => (
            <p className="source-entry" key={s.url}>
              <span className={s.status === "ok" ? "positive" : "caution-text"}>
                {s.status === "ok" ? "응답 수신" : "수집 실패"}
              </span>{" "}
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.url.includes("coingecko")
                  ? `CoinGecko 페이지 ${new URL(s.url).searchParams.get("page")}`
                  : s.url.includes("coinmarketcap")
                    ? "CoinMarketCap"
                    : new URL(s.url).pathname +
                      (new URL(s.url).searchParams.get("dataType")
                        ? ` · ${new URL(s.url).searchParams.get("dataType")}`
                        : "")}
              </a>{" "}
              · {fmtKstMinute(s.observedAt)}
            </p>
          ))}
          <p className="muted">
            일부 제공처가 실패하면 확보된 자료만 표시합니다. 배분 권리와
            운영비·인센티브·언락 일정은 별도 확인이 필요합니다.
          </p>
        </section>
      )}
      {(storageError || preferencesError) && (
        <p className="notice" role="status">
          브라우저 저장소를 사용할 수 없어 관심종목·열·이전 기록이 유지되지 않을
          수 있습니다.
        </p>
      )}

      <section className="workspace" aria-label="스크리너">
        <div className="view-bar" aria-label="결과 보기">
          {(
            [
              { key: "all", label: "전체", count: coins.length },
              { key: "signals", label: "사업 수익 성장", count: counts.signals },
              { key: "holder", label: "홀더 환원", count: counts.holder },
              { key: "favorites", label: "관심종목", count: counts.favorites },
              {
                key: "changes",
                label: "확인 후 변화",
                count: counts.changes,
              },
              { key: "data", label: "자료 상태", count: counts.data },
            ] as { key: View; label: string; count: number }[]
          ).map((item) => (
            <button
              key={item.key}
              className={`view-button ${view === item.key ? "selected" : ""}`}
              aria-pressed={view === item.key}
              onClick={() => { setView(item.key); setTracks(new Set()); }}
            >
              {item.key === "favorites" && <Star size={14} />} {item.label}
              {item.key === "favorites" && <span>{item.count}</span>}
            </button>
          ))}
        </div>
        <div className="preset-bar" aria-label="보기 프리셋">
          {COLUMN_PRESETS.filter(p => p.label !== "점수 근거").map(p => <button key={p.label} className={`preset-button ${p.keys.length === visibleColumns.size && p.keys.every(k => visibleColumns.has(k)) ? "selected" : ""}`} aria-pressed={p.keys.length === visibleColumns.size && p.keys.every(k => visibleColumns.has(k))} onClick={() => setVisibleColumns(new Set(p.keys))}>{p.label}</button>)}
        </div>
        {["multiple1y", "multiple90d", "multiple7d"].some(key => visibleColumns.has(key as SortKey)) && <div className="reading-guide"><strong>현재 시총 고정</strong><span>1년은 원천 집계액 합계 · 90/30/7일은 연환산 · 기간별 시총/집계액 배수는 과거 가격 이력이 아닙니다.</span></div>}
        <div className="toolbar">
          <label className="sort-select">집계 종류 <select aria-label="집계 종류" value={kind} onChange={e => setKind(e.target.value as RevenueKind | "all")}><option value="all">전체 · 종류별로 묶기</option>{KIND_ORDER.map(k => <option key={k} value={k}>{REVENUE_LABELS[k]}</option>)}</select></label>
          <label className="search-box">
            <Search size={17} />
            <span className="sr-only">코인 또는 심볼 검색</span>
            <input
              aria-label="코인 또는 심볼 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="코인 또는 심볼 검색"
            />
            {search && (
              <button aria-label="검색 지우기" onClick={() => setSearch("")}>
                <X size={15} />
              </button>
            )}
          </label>
          <div className="toolbar-actions">
            <button
              className={`button ${advancedOpen ? "active" : ""}`}
              onClick={() => {
                setAdvancedOpen((v) => !v);
                setColumnsOpen(false);
              }}
              aria-expanded={advancedOpen}
              aria-controls="advanced-filters"
            >
              <SlidersHorizontal size={15} />
              필터
              {activeCount > 0 && (
                <span className="count-pill">{activeCount}</span>
              )}
            </button>
            <button
              className={`button ${columnsOpen ? "active" : ""}`}
              onClick={() => {
                setColumnsOpen((v) => !v);
                setAdvancedOpen(false);
              }}
              aria-expanded={columnsOpen}
              aria-controls="column-settings"
            >
              <Columns3 size={15} />
              표시 열
            </button>
            <button
              className="icon-button export-button"
              onClick={exportSnapshot}
              aria-label="현재 스냅샷 JSON 내보내기"
              title="스냅샷 JSON 내보내기"
              disabled={!data}
            >
              <Download size={17} />
            </button>
          </div>
        </div>
        {advancedOpen && (
          <section
            id="advanced-filters"
            className="filter-panel"
            aria-label="상세 필터"
          >
            <div className="panel-heading">
              <h2>상세 필터</h2>
              <button className="text-button" onClick={reset}>
                모두 초기화
              </button>
            </div>
            <div className="filter-toggles">
              {[
                {
                  label: "최근 활동 있음",
                  value: hideInactive,
                  set: setHideInactive,
                },
                {
                  label: "P/HR 적격 배분만",
                  value: holderOnly,
                  set: setHolderOnly,
                },
                {
                  label: "고희석 제외",
                  value: excludeRisk,
                  set: setExcludeRisk,
                },
                {
                  label: "자료 완성도 B 이상",
                  value: completeOnly,
                  set: setCompleteOnly,
                },
                { label: "상장 90일 미만", value: newOnly, set: setNewOnly },
              ].map((f) => (
                <label key={f.label}>
                  <input
                    type="checkbox"
                    checked={f.value}
                    onChange={(e) => f.set(e.target.checked)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <div className="range-grid">
              <UsdRangeFilter
                label="시총 범위"
                minUsd={minMcap}
                maxUsd={maxMcap}
                onMinChange={setMinMcap}
                onMaxChange={setMaxMcap}
              />
              <MultipleRangeFilter
                label="P/HR 범위"
                min={minPhr}
                max={maxPhr}
                onMinChange={setMinPhr}
                onMaxChange={setMaxPhr}
              />
              {activeReference !== null && <MultipleRangeFilter
                label="시총/집계액 범위"
                min={minMultiple}
                max={maxMultiple}
                onMinChange={setMinPs}
                onMaxChange={setMaxPs}
              />}
              <UsdRangeFilter
                label="TVL 범위"
                minUsd={minTvl}
                maxUsd={maxTvl}
                onMinChange={setMinTvl}
                onMaxChange={setMaxTvl}
              />
              <ScoreRangeFilter
                min={minScore}
                max={maxScore}
                onMinChange={setMinScore}
                onMaxChange={setMaxScore}
              />
            </div>
            <details className="sector-picker">
              <summary>
                섹터 {cats.size ? `${cats.size}개 선택` : "전체"}
              </summary>
              <div>
                {data?.categories.map((category) => (
                  <button
                    key={category}
                    className={`chip ${cats.has(category) ? "selected" : ""}`}
                    aria-pressed={cats.has(category)}
                    onClick={() => toggleSet(setCats, category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </details>
          </section>
        )}
        {columnsOpen && (
          <section
            id="column-settings"
            className="filter-panel"
            aria-label="표시 열 설정"
          >
            <div className="panel-heading">
              <div>
                <h2>표시 열</h2>
                <p className="muted">
                  코인 이름은 고정됩니다. 선택은 이 브라우저에 저장됩니다.
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="열 설정 닫기"
                onClick={() => setColumnsOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="column-presets" aria-label="추가 프리셋">
              {COLUMN_PRESETS.map((p) => (
                <button
                  className="chip"
                  key={p.label}
                  onClick={() => setVisibleColumns(new Set(p.keys))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="column-groups">
              {(Object.keys(COLUMN_GROUP_LABELS) as ColumnGroup[]).map(
                (group) => (
                  <fieldset key={group}>
                    <legend>{COLUMN_GROUP_LABELS[group]}</legend>
                    {COLS.filter((c) => c.group === group).map((c) => (
                      <label key={c.key}>
                        <input
                          type="checkbox"
                          checked={visibleColumns.has(c.key)}
                          disabled={
                            visibleColumns.has(c.key) &&
                            visibleColumns.size === 1
                          }
                          onChange={() => toggleSet(setVisibleColumns, c.key)}
                        />
                        <span>
                          {c.label}
                          <small>{c.title}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ),
              )}
            </div>
          </section>
        )}

        {hasFilters && (
          <div className="active-filters">
            <span>적용 중</span>
            {tracks.size > 0 && (
              <span>
                {[...tracks]
                  .map((t) => TRACK_NAMES[t])
                  .join(" 또는 ")}
              </span>
            )}
            {view !== "all" && (
              <span>
                {view === "favorites"
                  ? "관심종목"
                  : view === "changes"
                    ? "이전 기록과 비교"
                    : view === "data"
                      ? "자료 확인 필요"
                      : view === "holder" ? "홀더 환원" : "사업 수익 성장"}
              </span>
            )}
            {search && (
              <button onClick={() => setSearch("")}>
                검색: {search} <X size={12} />
              </button>
            )}
            {activeCount > 0 && <span>상세 조건 {activeCount}</span>}
            <button onClick={reset}>
              모두 해제 <X size={12} />
            </button>
          </div>
        )}
        {view === "changes" && (
          <div className="comparison-note">
            <p>
              {baseline && data && baseline.scoreVersion !== data.scoreVersion
                ? "계산 기준이 바뀌어 이전 버전의 기록과 비교하지 않습니다. 아래 확인 완료를 누르면 현재 자료가 새 비교 기준이 됩니다."
                : baseline
                ? `확인 기준 ${fmtKstMinute(baseline.at)} · 조건 진입·이탈, 집계액·홀더 금액 5% 및 $100 이상 변화. 다시 방문해도 기준은 유지됩니다.`
                : "첫 방문입니다. 이번 자료를 저장한 뒤 다음 확인부터 변화를 표시합니다."}
            </p>
            {baseline && (
              <button className="text-button" onClick={acknowledge}>
                여기까지 확인 완료
              </button>
            )}
            <p className="muted">방문 사이 생겼다가 사라진 변화는 남지 않을 수 있습니다. 확인 기준과 최신 자료의 차이를 보여줍니다.</p>
          </div>
        )}
        {view === "holder" && <div className="comparison-note"><p>최근 30일 매입·분배 또는 조건부 보상이 관측된 종목입니다. 아래 전환 보기를 켜면 양수 → 0으로 바뀐 종목도 포함합니다.</p><label className="inline-check"><input type="checkbox" checked={tracks.has("transition")} onChange={() => toggleSet<OpportunityTrack>(setTracks, "transition")} /> 홀더 금액이 0↔양수로 바뀐 종목만 보기</label><p className="muted">최근·직전 30일 비교입니다. 매일 한 번의 사건 목록이 아니며, 실제 정책 변경 여부는 추가 확인이 필요합니다.</p></div>}
        {view === "data" && <div className="comparison-note">가격·집계액·토큰 연결 등 부족한 항목을 종목 아래에 표시합니다. 보고된 0과 자료 누락은 구분합니다.</div>}
        <div className="results-heading" id="screener-results" ref={resultsRef} tabIndex={-1}>
          <h2>
            프로토콜 <strong>{deferredRows.length}</strong>
            <span>/ {coins.length}</span>
          </h2>
          <div>
            <label className="sort-select">
              정렬{" "}
              <select
                aria-label="결과 정렬"
                value={sortKey}
                onChange={(e) => {
                  setSortKey(e.target.value as SortKey);
                  setPage(1);
                }}
              >
                <option value="name">코인 이름</option>
                {[...selectedCols, ...COLS.filter(c => !visibleColumns.has(c.key))].map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-button"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              aria-label={
                sortDir === "desc" ? "오름차순으로 변경" : "내림차순으로 변경"
              }
            >
              {sortDir === "desc" ? (
                <ArrowDown size={16} />
              ) : (
                <ArrowUp size={16} />
              )}
            </button>
          </div>
        </div>
        <Pagination total={deferredRows.length} page={currentPage} size={pageSize} position="top" onPage={changePage} onSize={changePageSize} />
        <div
          ref={tableRef}
          className="table-scroll thin-scroll"
          role="region"
          aria-label="프로토콜 비교 표 · 가로 스크롤 가능"
          tabIndex={0}
          aria-busy={rows !== deferredRows}
        >
          <table className="screener-table">
            <caption className="sr-only">
              실적과 홀더 배분 비교. 코인 이름을 누르면 계산 근거와 조건을 볼 수
              있습니다.
            </caption>
            <thead>
              <tr>
                <th
                  className="coin-column"
                  scope="col"
                  aria-sort={
                    sortKey === "name"
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button onClick={() => onSort("name")}>
                    프로토콜 {sortArrow("name")}
                  </button>
                </th>
                {selectedCols.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    title={col.title}
                    className={col.key === "signals" ? "signal-column" : ""}
                    aria-sort={
                      sortKey === col.key
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button onClick={() => onSort(col.key)}>
                      {col.label}
                      {sortArrow(col.key)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deferredRows.slice(pageStart, pageStart + pageSize).map((c) => (
                <tr key={c.slug}>
                  <th scope="row" className="coin-column">
                    <div className="coin-identity">
                      <button
                        className={`favorite-button ${favoriteSlugs.has(c.slug) ? "saved" : ""}`}
                        aria-pressed={favoriteSlugs.has(c.slug)}
                        aria-label={`${c.name} 관심종목 ${favoriteSlugs.has(c.slug) ? "해제" : "추가"}`}
                        onClick={() => toggleSet(setFavoriteSlugs, c.slug)}
                      >
                        <Star
                          size={16}
                          fill={
                            favoriteSlugs.has(c.slug) ? "currentColor" : "none"
                          }
                        />
                      </button>
                      <button
                        className="coin-open"
                        aria-label={`${c.name} 상세 보기`}
                        onClick={() => setSelectedSlug(c.slug)}
                      >
                        {c.logo && (
                          <img
                            src={c.logo}
                            alt=""
                            width={26}
                            height={26}
                            loading="lazy"
                          />
                        )}
                        <span>
                          <strong>{c.name}</strong>
                          <small>
                            {c.symbol ?? "심볼 미확인"}
                            {changes.get(c.slug)?.meaningful && (
                              <span className="change-dot">변화</span>
                            )}
                          </small>
                        </span>
                      </button>
                    </div>
                    <div className="row-definition">{revenueLabel(c)} · {revenueBasis(c) === "completed_utc" ? "완료일 집계" : "원천 기간 집계"}</div>
                    <div className="row-reasons">{(view === "holder" && tracks.has("transition") ? holderTransitionReasons(c) : researchReasons(c, activeReference)).slice(0, 2).map(r => <span key={r}>{r}</span>)}</div>
                    {view === "data" && <p className="row-data-issue">{c.opportunities.dataIssues.join(" · ")}</p>}
                    {view === "changes" && <p className="row-data-issue">집계액 변화 {changes.get(c.slug)?.revenueDelta == null ? "–" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(changes.get(c.slug)!.revenueDelta!)} · 기준 이후</p>}
                  </th>
                  {selectedCols.map((col) => (
                    <td
                      key={col.key}
                      className={col.key === "signals" ? "signal-column" : ""}
                    >
                      <span className={activeReference !== null && col.key === "revenueMultiple" && researchMultiple(c) !== null && researchMultiple(c)! <= activeReference ? "revenueMultiple-highlight" : undefined}>{renderCell(c, col.key)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {deferredRows.length === 0 && (
          <div className="empty-state">
            <Search size={25} />
            <h3>
              {!data
                ? "데이터를 준비하고 있습니다"
                : view === "favorites" && !counts.favorites
                  ? "관심종목을 골라 주세요"
                  : view === "changes" && !baseline
                    ? "비교할 첫 기록을 남겼습니다"
                    : "이 조건에 맞는 종목이 없습니다"}
            </h3>
            <p>
              {!data
                ? error || "공개 데이터 응답을 기다리고 있습니다."
                : view === "favorites"
                  ? "코인 이름 옆 별표를 누르면 여기에 모입니다."
                  : view === "changes" && !baseline
                    ? "다음 확인부터 새 신호와 실적 변화를 볼 수 있습니다."
                    : "검색어와 적용한 기준을 확인하거나 전체 종목을 살펴보세요."}
            </p>
            <button
              className="button"
              onClick={!data ? () => void refresh() : reset}
            >
              {!data ? "다시 확인" : "전체 종목 보기"}
            </button>
          </div>
        )}
        <Pagination total={deferredRows.length} page={currentPage} size={pageSize} position="bottom" onPage={changePage} onSize={changePageSize} />
      </section>
      <footer className="app-footer">
        <p>
          DefiLlama · CoinMarketCap · CoinGecko{" "}
          <span>
            시총 $1M 이상 · 관측 신호는 투자 추천이나 수익률 예측이 아닙니다.
          </span>
        </p>
        <p>
          이 브라우저에 {historyCount}일 기록 · 최근 60일 보관 · 매일 마지막으로
          확인한 스냅샷
        </p>
      </footer>
      {selectedCoin && (
        <CoinDetail
          coin={selectedCoin}
          history={history}
          multipleReference={activeReference}
          change={changes.get(selectedCoin.slug)!}
          onClose={() => setSelectedSlug(null)}
        />
      )}
    </main>
  );
}
