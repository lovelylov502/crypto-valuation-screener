"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
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

const FAVORITES_KEY = "crypto-valuation-favorites-v1";
const COLUMNS_KEY = "crypto-valuation-columns-v4";
const PAGE_SIZE = 30;
const TRACKS: {
  key: OpportunityTrack;
  name: string;
  description: string;
  number: string;
}[] = [
  {
    key: "business",
    name: "실적 개선",
    description: "매출·수수료가 늘어나는 곳",
    number: "01",
  },
  {
    key: "holder",
    name: "홀더 배분",
    description: "배분·매입·조건부 보상 발생",
    number: "02",
  },
  {
    key: "transition",
    name: "흐름 전환",
    description: "홀더 금액의 0 ↔ 양수 변화",
    number: "03",
  },
];
type View = "all" | "signals" | "favorites" | "changes" | "data";

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
  } = useScreenerData(initialData);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("all");
  const [tracks, setTracks] = useState<Set<OpportunityTrack>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [minMcap, setMinMcap] = useState(0);
  const [maxMcap, setMaxMcap] = useState(0);
  const [minTvl, setMinTvl] = useState(0);
  const [maxTvl, setMaxTvl] = useState(0);
  const [minPhr, setMinPhr] = useState(0);
  const [maxPhr, setMaxPhr] = useState(0);
  const [minPs, setMinPs] = useState(0);
  const [maxPs, setMaxPs] = useState(0);
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
  const [sortKey, setSortKey] = useState<SortKey>("signals");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);

  useEffect(() => {
    try {
      setFavoriteSlugs(parseFavoriteSlugs(localStorage.getItem(FAVORITES_KEY)));
      const saved =
        localStorage.getItem(COLUMNS_KEY) ??
        localStorage.getItem("crypto-valuation-columns-v3");
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
    } catch {
      setPreferencesError(true);
    }
  }, [favoriteSlugs, visibleColumns, storedReady]);

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
      business: coins.filter((c) => c.opportunities.business).length,
      holder: coins.filter((c) => c.opportunities.holder).length,
      transition: coins.filter((c) => c.opportunities.transition).length,
      signals: coins.filter(
        (c) =>
          c.opportunities.business ||
          c.opportunities.holder ||
          c.opportunities.transition,
      ).length,
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
      setSortDir(key === "name" || key === "category" ? "asc" : "desc");
    }
    setPage(1);
  };
  const reset = () => {
    setSearch("");
    setView("all");
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
    setSortKey("signals");
    setSortDir("desc");
    setPage(1);
  };
  const activeCount = [
    cats.size > 0,
    minMcap > 0 || maxMcap > 0,
    minTvl > 0 || maxTvl > 0,
    minPhr > 0 || maxPhr > 0,
    minPs > 0 || maxPs > 0,
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
        if (q && !`${c.name} ${c.symbol ?? ""}`.toLowerCase().includes(q))
          return false;
        if (tracks.size && ![...tracks].some((t) => o[t])) return false;
        if (view === "signals" && !o.business && !o.holder && !o.transition)
          return false;
        if (view === "favorites" && !favoriteSlugs.has(c.slug)) return false;
        if (view === "changes" && !changes.get(c.slug)?.meaningful)
          return false;
        if (view === "data" && o.dataIssues.length === 0) return false;
        if (cats.size > 0 && (!c.category || !cats.has(c.category)))
          return false;
        if (hideInactive && c.lowActivity) return false;
        if (holderOnly && !hasEligibleCurrentHolderValue(c.holderValue))
          return false;
        if (excludeRisk && c.highDilution) return false;
        if (completeOnly && c.confidenceGrade === "C") return false;
        if (newOnly && c.status !== "신규 프로젝트") return false;
        return (
          matchesRange(c.mcap, minMcap, maxMcap) &&
          matchesRange(c.tvl, minTvl, maxTvl) &&
          matchesRange(c.multiples.phr, minPhr, maxPhr) &&
          matchesRange(c.multiples.ps, minPs, maxPs) &&
          matchesRange(c.valueScore, minScore, maxScore)
        );
      })
      .sort((a, b) => {
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
    minPs,
    maxPs,
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
    minPs,
    maxPs,
    minScore,
    maxScore,
  ]);
  const pages = Math.max(1, Math.ceil(deferredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
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
    const blob = new Blob([JSON.stringify(makeSnapshot(data), null, 2)], {
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
    <main className="research-app">
      <a className="skip-link" href="#screener-results">
        결과 표로 이동
      </a>
      <header className="app-header">
        <div>
          <p className="eyebrow">
            CRYPTO VALUATION <span>RESEARCH DESK</span>
          </p>
          <h1>크립토 밸류에이션 리서치</h1>
          <p className="intro">
            실적 개선과 홀더 배분을 함께 살펴보는 크립토 스크리너
          </p>
        </div>
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
          <p>
            매출·홀더 배분·P/S·P/HR은 최근 30일 기준으로 비교합니다. 금액의 생성
            시각과 이 화면의 수집·계산 시각은 다릅니다.
          </p>
          <div className="source-grid">
            <div>
              <strong>DefiLlama</strong>
              <p>수수료·매출·홀더 금액. 원천 생성 시각은 제공되지 않습니다.</p>
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

      <section className="track-grid" aria-label="포착 기준">
        {TRACKS.map((t) => (
          <button
            key={t.key}
            className={`track-card ${t.key} ${tracks.has(t.key) ? "selected" : ""}`}
            aria-pressed={tracks.has(t.key)}
            onClick={() => toggleSet(setTracks, t.key)}
          >
            <span className="track-top">
              <span className="track-number">{t.number}</span>
              <span>
                {tracks.has(t.key) ? (
                  <Check size={18} />
                ) : (
                  <ArrowUpRight size={18} />
                )}
              </span>
            </span>
            <span className="track-title">
              {t.name}
              <strong>{data ? counts[t.key] : "–"}</strong>
            </span>
            <span className="track-description">{t.description}</span>
          </button>
        ))}
      </section>
      <div className="track-caption">
        <span>
          {tracks.size > 0
            ? `${tracks.size}개 기준 중 하나라도 해당하는 종목 · 다른 필터와 함께 적용`
            : "기준을 누르면 해당 종목만 표시합니다. 한 종목에 여러 신호가 겹칠 수 있습니다."}
        </span>
        {tracks.size > 0 && (
          <button className="text-button" onClick={() => setTracks(new Set())}>
            기준 해제
          </button>
        )}
      </div>

      <section className="workspace" aria-label="스크리너">
        <div className="view-bar" aria-label="결과 보기">
          {(
            [
              { key: "all", label: "전체", count: coins.length },
              { key: "signals", label: "신호 있음", count: counts.signals },
              { key: "favorites", label: "관심종목", count: counts.favorites },
              {
                key: "changes",
                label: "지난 확인 이후",
                count: counts.changes,
              },
              { key: "data", label: "자료 확인 필요", count: counts.data },
            ] as { key: View; label: string; count: number }[]
          ).map((item) => (
            <button
              key={item.key}
              className={`view-button ${view === item.key ? "selected" : ""}`}
              aria-pressed={view === item.key}
              onClick={() => setView(item.key)}
            >
              {item.key === "favorites" && <Star size={14} />} {item.label}
              <span>{item.count}</span>
            </button>
          ))}
        </div>
        <div className="toolbar">
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
              <MultipleRangeFilter
                label="P/S 범위"
                min={minPs}
                max={maxPs}
                onMinChange={setMinPs}
                onMaxChange={setMaxPs}
              />
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
            <div className="column-presets">
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
                  .map((t) => TRACKS.find((x) => x.key === t)!.name)
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
                      : "신호 있음"}
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
              {baseline
                ? `비교 기준 ${fmtKstMinute(baseline.at)} · 신호 진입·이탈, 점수 3점, 매출·홀더 금액 5% 및 $100 이상 변화`
                : "첫 방문입니다. 이번 자료를 저장한 뒤 다음 확인부터 변화를 표시합니다."}
            </p>
            {baseline && (
              <button className="text-button" onClick={acknowledge}>
                현재 자료까지 확인함
              </button>
            )}
          </div>
        )}
        <div className="results-heading" id="screener-results" tabIndex={-1}>
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
                {COLS.map((c) => (
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
        <div
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
              {deferredRows.slice(pageStart, pageStart + PAGE_SIZE).map((c) => (
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
                  </th>
                  {selectedCols.map((col) => (
                    <td
                      key={col.key}
                      className={col.key === "signals" ? "signal-column" : ""}
                    >
                      {renderCell(c, col.key)}
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
        <div className="pagination">
          <span>
            {deferredRows.length ? pageStart + 1 : 0}–
            {Math.min(pageStart + PAGE_SIZE, deferredRows.length)} /{" "}
            {deferredRows.length}개
          </span>
          <nav aria-label="결과 페이지">
            <button
              className="icon-button"
              aria-label="이전 페이지"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {currentPage} / {pages}
            </span>
            <button
              className="icon-button"
              aria-label="다음 페이지"
              disabled={currentPage === pages}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </nav>
          <span className="table-help">코인 이름을 눌러 근거 확인</span>
        </div>
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
          change={changes.get(selectedCoin.slug)!}
          onClose={() => setSelectedSlug(null)}
        />
      )}
    </main>
  );
}
