"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { CoinScored, MarketDataFreshness } from "@/lib/types";
import { fmtKstMinute, fmtUsd, fmtMult, fmtPct } from "@/lib/format";
import {
  clampRangePosition,
  hasEligibleCurrentHolderValue,
  matchesRange,
  parseFavoriteSlugs,
  parseStoredSelection,
  serializeFavoriteSlugs,
  serializeStoredSelection,
} from "@/lib/screenerFilters";
import { holderEconomicTypeLabel } from "@/lib/holderValue";
import {
  COLUMN_GROUP_LABELS,
  COLUMN_PRESETS,
  DEFAULT_VISIBLE_COLUMNS,
  SCREENER_COLUMNS as COLS,
  type ColumnGroup,
  type SortKey,
} from "@/lib/screenerColumns";
import { ScoreBadge } from "./ScoreBadge";

const FAVORITES_STORAGE_KEY = "crypto-valuation-favorites-v1";
const COLUMNS_STORAGE_KEY = "crypto-valuation-columns-v3";
const PAGE_SIZE = 50;

// 로그 슬라이더(0~100) <-> USD 양방향. 0이면 필터 없음, 100이면 $100B
function sliderToUsd(s: number): number {
  if (s <= 0) return 0;
  return Math.pow(10, 6 + (s / 100) * 5); // 1e6 ~ 1e11
}
function usdToSlider(usd: number): number {
  if (usd <= 0) return 0;
  return Math.max(0, Math.min(100, ((Math.log10(usd) - 6) / 5) * 100));
}

// P/HR 같은 멀티플용 로그 슬라이더. 0이면 필터 없음, 100이면 1000x
function sliderToMultiple(s: number): number {
  if (s <= 0) return 0;
  return Math.pow(10, -1 + (s / 100) * 4); // 0.1x ~ 1000x
}
function multipleToSlider(v: number): number {
  if (v <= 0) return 0;
  return Math.max(0, Math.min(100, ((Math.log10(v) + 1) / 4) * 100));
}

// 코인 외부 링크: canonical CMC 우선, 없으면 CoinGecko/DefiLlama 폴백
function coinUrl(c: CoinScored): string {
  if (c.cmcSlug) return `https://coinmarketcap.com/currencies/${c.cmcSlug}/`;
  if (c.geckoId) return `https://www.coingecko.com/en/coins/${c.geckoId}`;
  return `https://defillama.com/protocol/${c.slug.replace(/^parent#/, "")}`;
}

function sortValue(c: CoinScored, key: SortKey): number | string | null {
  switch (key) {
    case "name": return c.name.toLowerCase();
    case "category": return (c.category ?? "").toLowerCase();
    case "valueScore": return c.valueScore;
    case "scoreAxes": return c.scoreAxes.discovery;
    case "confidence": return c.confidence;
    case "gateStatus": return c.gates.passed ? 1 : 0;
    case "captureScore": return c.valueCapture.score;
    case "ps": return c.multiples.ps;
    case "phr": return c.multiples.phr;
    case "revenueAnnual": return c.revenueAnnual;
    case "holderValueRunRate": return c.holderValue.eligibleRunRate;
    case "holderValueTtm": return c.holderValue.rawTtm;
    case "revenue30d": return c.revenue30d;
    case "mcap": return c.mcap;
    case "totalVolume": return c.totalVolume;
    case "fdv": return c.fdv;
    case "tvl": return c.tvl;
    case "priceChange7d": return c.priceChange7d;
    case "priceChange14d": return c.priceChange14d;
    case "priceChange30d": return c.priceChange30d;
    case "priceChange60d": return c.priceChange60d;
    case "priceChange1y": return c.priceChange1y;
    case "athChangePercentage": return c.athChangePercentage;
    case "atlChangePercentage": return c.atlChangePercentage;
    case "feesChange7d": return c.feesChange7dover7d;
  }
}

function changeClass(v: number | null): string {
  if (v === null) return "";
  return v >= 0 ? "text-emerald-400" : "text-red-400";
}

function captureClass(score: number | null): string {
  if (score === null) return "text-[var(--color-muted)]";
  if (score >= 70) return "text-emerald-400";
  if (score >= 45) return "text-amber-300";
  return "text-[var(--color-muted)]";
}

function toggleButtonClass(active: boolean): string {
  return `shrink-0 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-blue-200"
      : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-muted)] hover:text-[var(--color-text)]"
  }`;
}

function holderTypeSummary(c: CoinScored): string {
  const labels = [
    ...new Set(
      c.holderValue.components.map((component) =>
        holderEconomicTypeLabel(component.economicType),
      ),
    ),
  ];
  if (labels.length === 0) return "유형 없음";
  if (labels.length <= 2) return labels.join("+");
  return `${labels.slice(0, 2).join("+")} 외 ${labels.length - 2}`;
}

function holderValueDetail(c: CoinScored): string {
  const componentDetail = c.holderValue.components.map((component) =>
    `${component.name}: ${holderEconomicTypeLabel(component.economicType)} · ${component.eligible ? "P/HR 포함" : "제외"} · 30d ${fmtUsd(component.current30d)} · TTM ${fmtUsd(component.ttm)} · ${component.reason}`,
  );
  return [
    "DefiLlama-derived 분류 (공식·온체인 검증 아님)",
    c.holderValue.currentVsEligibleTtmRatio !== null
      ? `현재 run-rate / 적격 TTM ${c.holderValue.currentVsEligibleTtmRatio.toFixed(2)}x`
      : null,
    c.holderValue.excludedDoublecountedCount > 0
      ? `doublecounted ${c.holderValue.excludedDoublecountedCount}개 제외`
      : null,
    c.holderValue.warning,
    ...componentDetail,
  ].filter((value): value is string => !!value).join(" / ");
}

// 셀 렌더 (코인 제외)
function renderCell(c: CoinScored, key: SortKey) {
  switch (key) {
    case "category":
      return (
        <span
          title={c.category ?? undefined}
          className="text-[var(--color-muted)] block max-w-[100px] truncate"
        >
          {c.category ?? "–"}
        </span>
      );
    case "valueScore":
      return (
        <ScoreBadge
          score={c.valueScore}
          status={c.status}
          confidenceGrade={c.confidenceGrade}
          confidence={c.confidence}
          reasons={c.gates.reasons}
        />
      );
    case "scoreAxes":
      return (
        <span
          title={c.scoreNotes.join(" · ") || "산출 근거 없음"}
          className="inline-grid min-w-[165px] grid-cols-4 gap-1 text-center text-[10px]"
        >
          {[
            ["가치", c.scoreAxes.value, 30],
            ["개선", c.scoreAxes.improvement, 25],
            ["미발견", c.scoreAxes.discovery, 25],
            ["품질", c.scoreAxes.quality, 20],
          ].map(([label, value, maximum]) => (
            <span key={String(label)} className="rounded bg-[var(--color-panel-2)] px-1 py-1">
              <span className="block text-[var(--color-muted)]">{label}</span>
              <strong className="block text-xs text-[var(--color-text)]">
                {value}/{maximum}
              </strong>
            </span>
          ))}
        </span>
      );
    case "confidence":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <strong>{c.confidenceGrade}</strong>
          <span className="text-xs text-[var(--color-muted)]">
            {Math.round(c.confidence * 100)}%
          </span>
        </span>
      );
    case "gateStatus":
      return c.gates.passed ? (
        <span className="text-emerald-400">통과</span>
      ) : (
        <span
          title={c.gates.reasons.join(" · ")}
          className="inline-flex max-w-[190px] flex-col items-end"
        >
          <strong className="text-amber-300">{c.gates.reasons.length}개 미통과</strong>
          <span className="block max-w-[190px] truncate text-[10px] text-[var(--color-muted)]">
            {c.gates.reasons[0]}
          </span>
        </span>
      );
    case "captureScore":
      return (
        <span
          title={[...c.valueCapture.signals, ...c.valueCapture.risks.map((r) => `위험: ${r}`)].join(" · ") || c.valueCapture.label}
          className="inline-flex flex-col items-end gap-0.5 whitespace-nowrap"
        >
          <span className={`font-semibold tabular-nums ${captureClass(c.valueCapture.score)}`}>
            {c.valueCapture.score ?? "–"}
          </span>
          <span className="text-[11px] text-[var(--color-muted)]">{c.valueCapture.label}</span>
        </span>
      );
    case "ps": return fmtMult(c.multiples.ps);
    case "phr":
      return (
        <span className="inline-flex min-w-[120px] flex-col items-end gap-0.5">
          <strong>{fmtMult(c.multiples.phr)}</strong>
          {c.multiples.phr === null &&
            ((c.holderValue.rawTtm ?? 0) > 0 || c.holderValue.warning) && (
              <span
                className="block max-w-[160px] truncate text-[10px] text-amber-300"
                title={holderValueDetail(c)}
              >
                {c.holderValue.phrUnavailableReason}
              </span>
            )}
        </span>
      );
    case "revenueAnnual": return fmtUsd(c.revenueAnnual);
    case "holderValueRunRate":
      return (
        <span
          title={holderValueDetail(c)}
          className="inline-flex min-w-[155px] flex-col items-end gap-0.5"
        >
          <strong className={c.holderValue.eligibleRunRate !== null ? "text-emerald-300" : "text-[var(--color-muted)]"}>
            {fmtUsd(c.holderValue.eligibleRunRate)}
            {c.holderValue.warning && <span className="ml-1 text-amber-300">⚠</span>}
          </strong>
          <span className="block max-w-[180px] truncate text-[10px] text-[var(--color-muted)]">
            {holderTypeSummary(c)} · DL 파생
          </span>
        </span>
      );
    case "holderValueTtm":
      return (
        <span
          title={holderValueDetail(c)}
          className="inline-flex min-w-[120px] flex-col items-end gap-0.5"
        >
          <span>{fmtUsd(c.holderValue.rawTtm)}</span>
          <span className="text-[10px] text-[var(--color-muted)]">
            {(c.holderValue.excludedTtm ?? 0) > 0 ? "제외 유형 포함" : "raw TTM"}
          </span>
        </span>
      );
    case "revenue30d": return fmtUsd(c.revenue30d);
    case "mcap": return fmtUsd(c.mcap);
    case "totalVolume": return fmtUsd(c.totalVolume);
    case "fdv":
      return (
        <span className="whitespace-nowrap">
          {fmtUsd(c.fdv)}
          {c.highDilution && (
            <span title="유통량 30% 미만 (MC/FDV<0.3) — 미래 언락 매도압 주의" className="ml-1 text-amber-400">⚠</span>
          )}
        </span>
      );
    case "tvl": return fmtUsd(c.tvl);
    case "priceChange7d":
      return <span className={changeClass(c.priceChange7d)}>{fmtPct(c.priceChange7d)}</span>;
    case "priceChange14d":
      return <span className={changeClass(c.priceChange14d)}>{fmtPct(c.priceChange14d)}</span>;
    case "priceChange30d":
      return <span className={changeClass(c.priceChange30d)}>{fmtPct(c.priceChange30d)}</span>;
    case "priceChange60d":
      return <span className={changeClass(c.priceChange60d)}>{fmtPct(c.priceChange60d)}</span>;
    case "priceChange1y":
      return <span className={changeClass(c.priceChange1y)}>{fmtPct(c.priceChange1y)}</span>;
    case "athChangePercentage":
      return <span className={changeClass(c.athChangePercentage)}>{fmtPct(c.athChangePercentage)}</span>;
    case "atlChangePercentage":
      return <span className={changeClass(c.atlChangePercentage)}>{fmtPct(c.atlChangePercentage)}</span>;
    case "feesChange7d":
      return (
        <span className="inline-flex flex-col items-end gap-0.5">
          <span className={changeClass(c.feesChange7dover7d)}>{fmtPct(c.feesChange7dover7d)}</span>
          <span className={`${changeClass(c.feesChange30dover30d)} text-[11px] opacity-75`}>
            30d {fmtPct(c.feesChange30dover30d)}
          </span>
        </span>
      );
    default: return null;
  }
}

function DualRangeSlider({
  minPosition,
  maxPosition,
  onMinChange,
  onMaxChange,
  minLabel,
  maxLabel,
  step = 0.5,
}: {
  minPosition: number;
  maxPosition: number;
  onMinChange: (position: number) => void;
  onMaxChange: (position: number) => void;
  minLabel: string;
  maxLabel: string;
  step?: number;
}) {
  const changeMin = (next: number) => onMinChange(clampRangePosition("min", next, minPosition, maxPosition));
  const changeMax = (next: number) => onMaxChange(clampRangePosition("max", next, minPosition, maxPosition));

  return (
    <div className="relative mt-3 h-6">
      <div className="absolute left-0 right-0 top-2.5 h-1 rounded-full bg-[var(--color-border)]">
        <div
          className="absolute h-full rounded-full bg-[var(--color-accent)]"
          style={{ left: `${minPosition}%`, right: `${100 - maxPosition}%` }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={step}
        value={minPosition}
        onChange={(event) => changeMin(Number(event.target.value))}
        aria-label={minLabel}
        className="dual-range-input z-20"
      />
      <input
        type="range"
        min={0}
        max={100}
        step={step}
        value={maxPosition}
        onChange={(event) => changeMax(Number(event.target.value))}
        aria-label={maxLabel}
        className="dual-range-input z-30"
      />
    </div>
  );
}

function UsdRangeFilter({
  label, minUsd, maxUsd, onMinChange, onMaxChange,
}: {
  label: string;
  minUsd: number;
  maxUsd: number;
  onMinChange: (usd: number) => void;
  onMaxChange: (usd: number) => void;
}) {
  const setMin = (usd: number) => onMinChange(maxUsd > 0 ? Math.min(usd, maxUsd) : usd);
  const setMax = (usd: number) => onMaxChange(usd > 0 ? Math.max(usd, minUsd) : 0);

  return (
    <div className="min-w-[250px]">
      <div className="mb-2 text-xs text-[var(--color-muted)]">{label}</div>
      <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
        <label className="flex items-center gap-1">
          <span>최소 $</span>
          <input
            type="number" min={0} step={1}
            value={minUsd > 0 ? Math.round(minUsd / 1e6) : ""}
            onChange={(e) => {
              const m = parseFloat(e.target.value);
              setMin(Number.isFinite(m) && m > 0 ? m * 1e6 : 0);
            }}
            placeholder="0"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
          <span>M</span>
        </label>
        <label className="flex items-center gap-1">
          <span>최대 $</span>
          <input
            type="number" min={0} step={1}
            value={maxUsd > 0 ? Math.round(maxUsd / 1e6) : ""}
            onChange={(e) => {
              const m = parseFloat(e.target.value);
              setMax(Number.isFinite(m) && m > 0 ? m * 1e6 : 0);
            }}
            placeholder="∞"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
          <span>M</span>
        </label>
      </div>
      <DualRangeSlider
        minPosition={usdToSlider(minUsd)}
        maxPosition={maxUsd > 0 ? usdToSlider(maxUsd) : 100}
        onMinChange={(position) => setMin(sliderToUsd(position))}
        onMaxChange={(position) => setMax(position >= 100 ? 0 : sliderToUsd(position))}
        minLabel={`${label} 최소`}
        maxLabel={`${label} 최대`}
      />
    </div>
  );
}

function MultipleRangeFilter({
  label, min, max, onMinChange, onMaxChange,
}: {
  label: string;
  min: number;
  max: number;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
}) {
  const setMin = (v: number) => onMinChange(max > 0 ? Math.min(v, max) : v);
  const setMax = (v: number) => onMaxChange(v > 0 ? Math.max(v, min) : 0);

  return (
    <div className="min-w-[250px]">
      <div className="mb-2 text-xs text-[var(--color-muted)]">{label}</div>
      <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
        <label className="flex items-center gap-1">
          <span>최소</span>
          <input
            type="number" min={0} step={0.1}
            value={min > 0 ? Number(min.toFixed(1)) : ""}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setMin(Number.isFinite(v) && v > 0 ? v : 0);
            }}
            placeholder="0"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
          <span>x</span>
        </label>
        <label className="flex items-center gap-1">
          <span>최대</span>
          <input
            type="number" min={0} step={0.1}
            value={max > 0 ? Number(max.toFixed(1)) : ""}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setMax(Number.isFinite(v) && v > 0 ? v : 0);
            }}
            placeholder="∞"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
          <span>x</span>
        </label>
      </div>
      <DualRangeSlider
        minPosition={multipleToSlider(min)}
        maxPosition={max > 0 ? multipleToSlider(max) : 100}
        onMinChange={(position) => setMin(sliderToMultiple(position))}
        onMaxChange={(position) => setMax(position >= 100 ? 0 : sliderToMultiple(position))}
        minLabel={`${label} 최소`}
        maxLabel={`${label} 최대`}
      />
    </div>
  );
}

function ScoreRangeFilter({
  min,
  max,
  onMinChange,
  onMaxChange,
}: {
  min: number;
  max: number;
  onMinChange: (score: number) => void;
  onMaxChange: (score: number) => void;
}) {
  const maxPosition = max > 0 ? max : 100;
  const setMin = (score: number) => onMinChange(Math.min(Math.max(score, 0), maxPosition));
  const setMax = (score: number) => onMaxChange(score >= 100 ? 0 : Math.max(score, min));

  return (
    <div className="min-w-[250px]">
      <div className="mb-2 text-xs text-[var(--color-muted)]">발견 점수 범위 <span className="opacity-70">(게이트 통과 자산만 산출)</span></div>
      <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
        <label className="flex items-center gap-1">
          <span>최소</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={min > 0 ? min : ""}
            onChange={(event) => {
              const score = Number(event.target.value);
              setMin(Number.isFinite(score) && score > 0 ? score : 0);
            }}
            placeholder="0"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <label className="flex items-center gap-1">
          <span>최대</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={max > 0 ? max : ""}
            onChange={(event) => {
              const score = Number(event.target.value);
              setMax(Number.isFinite(score) && score > 0 ? score : 0);
            }}
            placeholder="100"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
      </div>
      <DualRangeSlider
        minPosition={min}
        maxPosition={maxPosition}
        onMinChange={setMin}
        onMaxChange={setMax}
        minLabel="발견 점수 최소"
        maxLabel="발견 점수 최대"
        step={1}
      />
    </div>
  );
}

type StatusMode = "candidate" | "watch" | "hold" | null;

export function ScreenerClient({
  coins,
  categories,
  updatedAt,
  marketDataFreshness,
  fdvCoverage,
  cmcCoverage,
  verifiedIdentityCount,
  discoveryCandidateCount,
  scoreVersion,
}: {
  coins: CoinScored[];
  categories: string[];
  updatedAt: string;
  marketDataFreshness: MarketDataFreshness;
  fdvCoverage: number;
  cmcCoverage: number;
  verifiedIdentityCount: number;
  discoveryCandidateCount: number;
  scoreVersion: string;
}) {
  const [search, setSearch] = useState("");
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
  const [hideZombie, setHideZombie] = useState(true);
  const [holderOnly, setHolderOnly] = useState(false);
  const [excludeHighDilution, setExcludeHighDilution] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);
  const [statusMode, setStatusMode] = useState<StatusMode>(null);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [favoriteSlugs, setFavoriteSlugs] = useState<Set<string>>(new Set());
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<SortKey>>(
    new Set(DEFAULT_VISIBLE_COLUMNS),
  );
  const [columnsReady, setColumnsReady] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("valueScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const newSlugs = useMemo(
    () => new Set(
      coins
        .filter((coin) => coin.status === "신규 프로젝트")
        .map((coin) => coin.slug),
    ),
    [coins],
  );
  const watchCount = useMemo(
    () => coins.filter((coin) => (coin.valueScore ?? 0) >= 65).length,
    [coins],
  );
  const dataHoldCount = useMemo(
    () => coins.filter((coin) => coin.status === "데이터 보류").length,
    [coins],
  );

  useEffect(() => {
    setFavoriteSlugs(parseFavoriteSlugs(window.localStorage.getItem(FAVORITES_STORAGE_KEY)));
    setFavoritesReady(true);
  }, []);

  useEffect(() => {
    if (!favoritesReady) return;
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, serializeFavoriteSlugs(favoriteSlugs));
  }, [favoriteSlugs, favoritesReady]);

  useEffect(() => {
    const storedColumns = parseStoredSelection(
      window.localStorage.getItem(COLUMNS_STORAGE_KEY),
      COLS.map((col) => col.key),
      DEFAULT_VISIBLE_COLUMNS,
    );
    setVisibleColumns(storedColumns);
    if (!storedColumns.has("valueScore")) {
      const firstVisible = COLS.find((col) => storedColumns.has(col.key))?.key ?? "name";
      setSortKey(firstVisible);
      setSortDir(firstVisible === "category" ? "asc" : "desc");
    }
    setColumnsReady(true);
  }, []);

  useEffect(() => {
    if (!columnsReady) return;
    window.localStorage.setItem(
      COLUMNS_STORAGE_KEY,
      serializeStoredSelection(visibleColumns),
    );
  }, [visibleColumns, columnsReady]);

  const toggleFavorite = (slug: string) =>
    setFavoriteSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });

  const toggleColumn = (key: SortKey) => {
    if (visibleColumns.has(key) && visibleColumns.size === 1) return;
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    if (visibleColumns.has(key) && sortKey === key) {
      setSortKey("name");
      setSortDir("asc");
    }
  };

  const applyColumnPreset = (keys: SortKey[]) => {
    setVisibleColumns(new Set(keys));
    if (!keys.includes(sortKey)) {
      setSortKey(keys.includes("valueScore") ? "valueScore" : keys[0]);
      setSortDir("desc");
    }
  };

  const toggleCat = (c: string) =>
    setCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir(key === "name" || key === "category" ? "asc" : "desc"); }
  };

  const applyPreset = (mode: Exclude<StatusMode, null>) => {
    setStatusMode(mode);
    setMinScore(mode === "watch" ? 65 : 0);
    setMaxScore(0);
    if (mode === "hold") setHideZombie(false);
    setSortKey("valueScore");
    setSortDir("desc");
  };

  const clearScoreRange = () => {
    setStatusMode(null);
    setMinScore(0);
    setMaxScore(0);
    setSortKey("valueScore");
    setSortDir("desc");
  };

  const resetFilters = () => {
    setSearch("");
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
    setHideZombie(true);
    setHolderOnly(false);
    setExcludeHighDilution(false);
    setNewOnly(false);
    setHighConfidenceOnly(false);
    setStatusMode(null);
    setFavoriteOnly(false);
    setSortKey("valueScore");
    setSortDir("desc");
  };

  const activeFilterCount = [
    search.trim().length > 0,
    cats.size > 0,
    minScore > 0 || maxScore > 0,
    minMcap > 0 || maxMcap > 0,
    minTvl > 0 || maxTvl > 0,
    minPhr > 0 || maxPhr > 0,
    minPs > 0 || maxPs > 0,
    hideZombie,
    holderOnly,
    excludeHighDilution,
    newOnly,
    highConfidenceOnly,
    statusMode !== null,
    favoriteOnly,
  ].filter(Boolean).length;

  const selectedCols = useMemo(
    () => COLS.filter((col) => visibleColumns.has(col.key)),
    [visibleColumns],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = coins.filter((c) => {
      if (hideZombie && c.lowActivity) return false;
      if (holderOnly && !hasEligibleCurrentHolderValue(c.holderValue)) return false;
      if (excludeHighDilution && c.highDilution) return false;
      if (newOnly && !newSlugs.has(c.slug)) return false;
      if (highConfidenceOnly && c.confidenceGrade === "C") return false;
      if (statusMode === "candidate" && c.status !== "발굴 후보") return false;
      if (statusMode === "watch" && (c.valueScore ?? 0) < 65) return false;
      if (statusMode === "hold" && c.status !== "데이터 보류") return false;
      if (favoriteOnly && !favoriteSlugs.has(c.slug)) return false;
      if (cats.size > 0 && (!c.category || !cats.has(c.category))) return false;
      if (!matchesRange(c.valueScore, minScore, maxScore)) return false;
      if (!matchesRange(c.mcap, minMcap, maxMcap)) return false;
      if (!matchesRange(c.tvl, minTvl, maxTvl)) return false;
      if (!matchesRange(c.multiples.phr, minPhr, maxPhr)) return false;
      if (!matchesRange(c.multiples.ps, minPs, maxPs)) return false;
      if (q) {
        const hay = `${c.name} ${c.symbol ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
    return filtered;
  }, [coins, search, cats, minScore, maxScore, minMcap, maxMcap, minTvl, maxTvl, minPhr, maxPhr, minPs, maxPs, hideZombie, holderOnly, excludeHighDilution, newOnly, newSlugs, highConfidenceOnly, statusMode, favoriteOnly, favoriteSlugs, sortKey, sortDir]);

  // 입력은 즉시 반응시키고, 무거운 테이블 렌더는 지연 → 슬라이더 드래그 버벅임 완화
  const deferredRows = useDeferredValue(rows);
  const stale = deferredRows !== rows;
  const pageCount = Math.max(1, Math.ceil(deferredRows.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pagedRows = deferredRows.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [rows]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const sortArrow = (key: SortKey) => (key === sortKey ? (sortDir === "desc" ? " ↓" : " ↑") : "");
  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" =>
    key === sortKey ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  // 고정 코인 셀 공통 클래스 (헤더/바디에서 배경만 다름)
  const stickyBase = "sticky left-0 z-10 min-w-[190px] max-w-[190px] sm:min-w-[230px] sm:max-w-[290px]";
  const visibleStart = deferredRows.length === 0 ? 0 : pageStart + 1;
  const visibleEnd = Math.min(pageStart + PAGE_SIZE, deferredRows.length);

  return (
    <div className="space-y-3">
      <section
        aria-label="스크리너 필터"
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3 sm:p-4"
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex gap-2 overflow-x-auto pb-1 thin-scroll xl:pb-0">
            <button
              type="button"
              onClick={() => applyPreset("candidate")}
              aria-pressed={statusMode === "candidate"}
              className={toggleButtonClass(statusMode === "candidate")}
            >
              발굴 후보 {discoveryCandidateCount}
            </button>
            <button
              type="button"
              onClick={() => applyPreset("watch")}
              aria-pressed={statusMode === "watch"}
              className={toggleButtonClass(statusMode === "watch")}
            >
              65+ 전체 {watchCount}
            </button>
            <button
              type="button"
              onClick={() => applyPreset("hold")}
              aria-pressed={statusMode === "hold"}
              className={toggleButtonClass(statusMode === "hold")}
            >
              데이터 보류 {dataHoldCount}
            </button>
            <button
              type="button"
              onClick={clearScoreRange}
              aria-pressed={statusMode === null && minScore === 0 && maxScore === 0}
              className={toggleButtonClass(statusMode === null && minScore === 0 && maxScore === 0)}
            >
              전체
            </button>
          </div>

          <div className="flex min-w-0 flex-1 gap-2">
            <label htmlFor="coin-search" className="sr-only">코인 또는 심볼 검색</label>
            <input
              id="coin-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="코인/심볼 검색"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              aria-expanded={advancedOpen}
              aria-controls="advanced-filters"
              className={toggleButtonClass(advancedOpen)}
            >
              필터 {activeFilterCount}
            </button>
            <button
              type="button"
              onClick={() => setColumnsOpen((open) => !open)}
              aria-expanded={columnsOpen}
              aria-controls="column-settings"
              className={toggleButtonClass(columnsOpen)}
            >
              열 {selectedCols.length}
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto border-t border-[var(--color-border)] pt-3 thin-scroll">
          <button type="button" aria-pressed={hideZombie} onClick={() => setHideZombie((value) => !value)} className={toggleButtonClass(hideZombie)}>
            좀비 숨김
          </button>
          <button type="button" aria-pressed={holderOnly} onClick={() => setHolderOnly((value) => !value)} className={toggleButtonClass(holderOnly)}>
            현재 홀더가치만
          </button>
          <button type="button" aria-pressed={excludeHighDilution} onClick={() => setExcludeHighDilution((value) => !value)} className={toggleButtonClass(excludeHighDilution)}>
            고희석 제외
          </button>
          <button type="button" aria-pressed={highConfidenceOnly} onClick={() => setHighConfidenceOnly((value) => !value)} className={toggleButtonClass(highConfidenceOnly)}>
            신뢰도 B+
          </button>
          <button type="button" aria-pressed={newOnly} onClick={() => setNewOnly((value) => !value)} className={toggleButtonClass(newOnly)}>
            신규 트랙 {newSlugs.size}
          </button>
          <button type="button" aria-pressed={favoriteOnly} onClick={() => setFavoriteOnly((value) => !value)} className={toggleButtonClass(favoriteOnly)}>
            관심만 {favoriteSlugs.size}
          </button>
          <button type="button" onClick={resetFilters} className={toggleButtonClass(false)}>
            필터 초기화
          </button>
        </div>

        {advancedOpen && (
          <div id="advanced-filters" className="mt-4 border-t border-[var(--color-border)] pt-4">
            <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
              <ScoreRangeFilter min={minScore} max={maxScore} onMinChange={setMinScore} onMaxChange={setMaxScore} />
              <UsdRangeFilter
                label="시총 범위"
                minUsd={minMcap}
                maxUsd={maxMcap}
                onMinChange={setMinMcap}
                onMaxChange={setMaxMcap}
              />
              <UsdRangeFilter
                label="TVL 범위"
                minUsd={minTvl}
                maxUsd={maxTvl}
                onMinChange={setMinTvl}
                onMaxChange={setMaxTvl}
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
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer select-none text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
                섹터 {cats.size > 0 ? `${cats.size}개 선택` : "전체"}
              </summary>
              <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto thin-scroll">
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => toggleCat(category)}
                    aria-pressed={cats.has(category)}
                    className={`rounded-full border px-2.5 py-1.5 text-xs transition-colors ${
                      cats.has(category)
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                        : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-muted)]"
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
              {cats.size > 0 && (
                <button type="button" onClick={() => setCats(new Set())} className="mt-2 text-xs text-[var(--color-accent)] hover:underline">
                  섹터 선택 해제
                </button>
              )}
            </details>
          </div>
        )}
      </section>

      {columnsOpen && (
        <section
          id="column-settings"
          aria-label="표시 열 설정"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">표시 열 설정</h2>
              <p className="mt-1 text-xs text-[var(--color-muted)]">코인 열은 항상 고정됩니다. 선택은 이 브라우저에 저장됩니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {COLUMN_PRESETS.map((preset) => (
                <button key={preset.label} type="button" onClick={() => applyColumnPreset(preset.keys)} className={toggleButtonClass(false)}>
                  {preset.label}
                </button>
              ))}
              <button type="button" onClick={() => applyColumnPreset(COLS.map((col) => col.key))} className={toggleButtonClass(false)}>
                전체 열
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 border-t border-[var(--color-border)] pt-4 md:grid-cols-2 xl:grid-cols-4">
            {(Object.keys(COLUMN_GROUP_LABELS) as ColumnGroup[]).map((group) => (
              <fieldset key={group}>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                  {COLUMN_GROUP_LABELS[group]}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {COLS.filter((col) => col.group === group).map((col) => (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => toggleColumn(col.key)}
                      aria-pressed={visibleColumns.has(col.key)}
                      title={col.title}
                      className={toggleButtonClass(visibleColumns.has(col.key))}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[var(--color-muted)]">
        <span>
          <strong className="text-[var(--color-text)]">{deferredRows.length.toLocaleString()}개</strong>
          {" "}/ 전체 {coins.length.toLocaleString()}개 · 현재 {visibleStart.toLocaleString()}–{visibleEnd.toLocaleString()}
        </span>
        <span>
          {scoreVersion} · CMC {cmcCoverage} · 정체성 확인 {verifiedIdentityCount} · FDV {fdvCoverage}
          {" · "}계산 {fmtKstMinute(updatedAt)}
          {marketDataFreshness.oldestAt && marketDataFreshness.newestAt && (
            <span title={`${marketDataFreshness.source} 원천 시각 범위 · ${marketDataFreshness.timestampedCoinCount}개`}>
              {" · "}CMC 원천 {fmtKstMinute(marketDataFreshness.oldestAt)}–{fmtKstMinute(marketDataFreshness.newestAt)}
            </span>
          )}
        </span>
      </div>

      <div
        className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] thin-scroll"
        style={{ opacity: stale ? 0.6 : 1, transition: "opacity 120ms" }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th
                aria-sort={ariaSort("name")}
                title="프로토콜/토큰"
                className={`${stickyBase} bg-[var(--color-panel)] px-3 py-2.5 text-left font-medium ${sortKey === "name" ? "text-[var(--color-text)]" : ""}`}
              >
                <button type="button" onClick={() => onSort("name")} className="w-full text-left hover:text-[var(--color-text)]">
                  코인{sortArrow("name")}
                </button>
              </th>
              {selectedCols.map((col) => (
                <th
                  key={col.key}
                  aria-sort={ariaSort(col.key)}
                  title={col.title}
                  className={`px-3 py-2.5 font-medium whitespace-nowrap ${col.key === "category" ? "text-left" : "text-right"} ${col.key === sortKey ? "text-[var(--color-text)]" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className={`w-full hover:text-[var(--color-text)] ${col.key === "category" ? "text-left" : "text-right"}`}
                  >
                    {col.label}{sortArrow(col.key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((coin, index) => (
              <tr key={coin.slug} className="group border-b border-[var(--color-border)]/50 hover:bg-[var(--color-panel-2)]">
                <td className={`${stickyBase} bg-[var(--color-panel)] px-3 py-2.5 group-hover:bg-[var(--color-panel-2)]`}>
                  <div className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-[var(--color-muted)]">{pageStart + index + 1}</span>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(coin.slug)}
                      aria-pressed={favoriteSlugs.has(coin.slug)}
                      aria-label={`${coin.name} 관심종목 ${favoriteSlugs.has(coin.slug) ? "해제" : "추가"}`}
                      title={favoriteSlugs.has(coin.slug) ? "관심종목 해제" : "관심종목 추가"}
                      className={`shrink-0 text-lg leading-none transition-colors ${favoriteSlugs.has(coin.slug) ? "text-amber-300" : "text-[var(--color-muted)] hover:text-amber-200"}`}
                    >
                      {favoriteSlugs.has(coin.slug) ? "★" : "☆"}
                    </button>
                    {coin.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coin.logo} alt="" width={20} height={20} className="shrink-0 rounded-full" loading="lazy" />
                    ) : (
                      <span className="h-5 w-5 shrink-0 rounded-full bg-[var(--color-panel-2)]" />
                    )}
                    <a
                      href={coinUrl(coin)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={coin.cmcSlug ? "CoinMarketCap에서 열기" : coin.geckoId ? "CoinGecko에서 열기" : "DefiLlama에서 열기"}
                      className="truncate font-medium hover:text-[var(--color-accent)] hover:underline"
                    >
                      {coin.name}
                    </a>
                    {coin.symbol && <span className="shrink-0 text-xs text-[var(--color-muted)]">{coin.symbol}</span>}
                    {newSlugs.has(coin.slug) && (
                      <span className="shrink-0 rounded-full bg-cyan-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300" title="CMC 상장 90일 미만 — 기존 후보 점수와 분리">
                        신규
                      </span>
                    )}
                  </div>
                </td>
                {selectedCols.map((col) => (
                  <td key={col.key} className={`px-3 py-2.5 tabular-nums ${col.key === "category" ? "text-left" : "text-right"}`}>
                    {renderCell(coin, col.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {deferredRows.length === 0 && (
          <div className="p-8 text-center text-sm text-[var(--color-muted)]">
            조건에 맞는 코인이 없습니다. 필터를 완화해 보세요.
          </div>
        )}
      </div>

      {deferredRows.length > 0 && (
        <nav aria-label="결과 페이지" className="flex items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            이전
          </button>
          <span className="min-w-20 text-center text-sm tabular-nums text-[var(--color-muted)]">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={page >= pageCount}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            다음
          </button>
        </nav>
      )}
    </div>
  );
}
