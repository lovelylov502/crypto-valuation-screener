"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { CoinScored } from "@/lib/types";
import { fmtKstMinute, fmtUsd, fmtMult, fmtPct } from "@/lib/format";
import { ScoreBadge } from "./ScoreBadge";

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

// 코인 외부 링크: CoinGecko 우선, 없으면 DefiLlama 폴백
function coinUrl(c: CoinScored): string {
  if (c.geckoId) return `https://www.coingecko.com/en/coins/${c.geckoId}`;
  return `https://defillama.com/protocol/${c.slug.replace(/^parent#/, "")}`;
}

type SortKey =
  | "valueScore"
  | "captureScore"
  | "name"
  | "category"
  | "ps"
  | "phr"
  | "revenueAnnual"
  | "holderRevenueAnnual"
  | "revenue30d"
  | "mcap"
  | "fdv"
  | "tvl"
  | "priceChange14d"
  | "priceChange30d"
  | "feesChange7d";

interface Col {
  key: SortKey;
  label: string;
  title: string;
}

// 코인(고정 열)을 제외한 나머지 컬럼 — 전부 우측정렬 숫자
const COLS: Col[] = [
  { key: "category", label: "섹터", title: "카테고리" },
  { key: "valueScore", label: "점수", title: "종합 밸류 점수 (0~100, 높을수록 저평가)" },
  { key: "captureScore", label: "포획", title: "토큰 홀더 가치포획 점수 — 매출이 토큰에 실제로 꽂히는지" },
  { key: "ps", label: "P/S", title: "시총 / 연매출 (낮을수록 쌈)" },
  { key: "phr", label: "P/HR", title: "시총 / 홀더귀속수익 — 크립토 PER (낮을수록 쌈)" },
  { key: "revenueAnnual", label: "매출/년", title: "연율화 프로토콜 매출" },
  { key: "holderRevenueAnnual", label: "홀더수익/년", title: "토큰 홀더에게 귀속되는 연간 수익 (실질 배당)" },
  { key: "revenue30d", label: "매출 30d", title: "최근 30일 매출 (원값)" },
  { key: "mcap", label: "시총", title: "유통 시가총액" },
  { key: "fdv", label: "FDV", title: "완전희석가치 (CoinGecko, 상위코인)" },
  { key: "tvl", label: "TVL", title: "예치자산" },
  { key: "priceChange14d", label: "가격 14d", title: "CoinGecko 14일 가격 변화율" },
  { key: "priceChange30d", label: "가격 30d", title: "CoinGecko 30일 가격 변화율" },
  { key: "feesChange7d", label: "수수료Δ", title: "최근 7일 vs 직전 7일 수수료 변화 (30일 변화 보조 표시)" },
];

function sortValue(c: CoinScored, key: SortKey): number | string | null {
  switch (key) {
    case "name": return c.name.toLowerCase();
    case "category": return (c.category ?? "").toLowerCase();
    case "valueScore": return c.valueScore;
    case "captureScore": return c.valueCapture.score;
    case "ps": return c.multiples.ps;
    case "phr": return c.multiples.phr;
    case "revenueAnnual": return c.revenueAnnual;
    case "holderRevenueAnnual": return c.holderRevenueAnnual;
    case "revenue30d": return c.revenue30d;
    case "mcap": return c.mcap;
    case "fdv": return c.fdv;
    case "tvl": return c.tvl;
    case "priceChange14d": return c.priceChange14d;
    case "priceChange30d": return c.priceChange30d;
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
      return <ScoreBadge score={c.valueScore} label={c.label} confidence={c.confidence} />;
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
    case "phr": return fmtMult(c.multiples.phr);
    case "revenueAnnual": return fmtUsd(c.revenueAnnual);
    case "holderRevenueAnnual": return fmtUsd(c.holderRevenueAnnual);
    case "revenue30d": return fmtUsd(c.revenue30d);
    case "mcap": return fmtUsd(c.mcap);
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
    case "priceChange14d":
      return <span className={changeClass(c.priceChange14d)}>{fmtPct(c.priceChange14d)}</span>;
    case "priceChange30d":
      return <span className={changeClass(c.priceChange30d)}>{fmtPct(c.priceChange30d)}</span>;
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
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          type="range" min={0} max={100} step={0.5}
          value={usdToSlider(minUsd)}
          onChange={(e) => setMin(sliderToUsd(Number(e.target.value)))}
          className="w-full accent-[var(--color-accent)]"
        />
        <input
          type="range" min={0} max={100} step={0.5}
          value={maxUsd > 0 ? usdToSlider(maxUsd) : 100}
          onChange={(e) => setMax(sliderToUsd(Number(e.target.value)))}
          className="w-full accent-[var(--color-accent)]"
        />
      </div>
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
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          type="range" min={0} max={100} step={0.5}
          value={multipleToSlider(min)}
          onChange={(e) => setMin(sliderToMultiple(Number(e.target.value)))}
          className="w-full accent-[var(--color-accent)]"
        />
        <input
          type="range" min={0} max={100} step={0.5}
          value={max > 0 ? multipleToSlider(max) : 100}
          onChange={(e) => setMax(sliderToMultiple(Number(e.target.value)))}
          className="w-full accent-[var(--color-accent)]"
        />
      </div>
    </div>
  );
}

export function ScreenerClient({
  coins, categories, updatedAt, fdvCoverage,
}: {
  coins: CoinScored[];
  categories: string[];
  updatedAt: string;
  fdvCoverage: number;
}) {
  const [search, setSearch] = useState("");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [minMcap, setMinMcap] = useState(0);
  const [maxMcap, setMaxMcap] = useState(0);
  const [minTvl, setMinTvl] = useState(0);
  const [maxTvl, setMaxTvl] = useState(0);
  const [minPhr, setMinPhr] = useState(0);
  const [maxPhr, setMaxPhr] = useState(0);
  const [hideZombie, setHideZombie] = useState(true);
  const [holderOnly, setHolderOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("valueScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = coins.filter((c) => {
      if (hideZombie && c.lowActivity) return false;
      if (holderOnly && c.holderRevenueAnnual == null) return false;
      if (cats.size > 0 && (!c.category || !cats.has(c.category))) return false;
      if (minMcap > 0 && (c.mcap ?? 0) < minMcap) return false;
      if (maxMcap > 0 && (c.mcap === null || c.mcap > maxMcap)) return false;
      if (minTvl > 0 && (c.tvl ?? 0) < minTvl) return false;
      if (maxTvl > 0 && (c.tvl === null || c.tvl > maxTvl)) return false;
      if (minPhr > 0 && (c.multiples.phr === null || c.multiples.phr < minPhr)) return false;
      if (maxPhr > 0 && (c.multiples.phr === null || c.multiples.phr > maxPhr)) return false;
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
  }, [coins, search, cats, minMcap, maxMcap, minTvl, maxTvl, minPhr, maxPhr, hideZombie, holderOnly, sortKey, sortDir]);

  // 입력은 즉시 반응시키고, 무거운 테이블 렌더는 지연 → 슬라이더 드래그 버벅임 완화
  const deferredRows = useDeferredValue(rows);
  const stale = deferredRows !== rows;

  const sortArrow = (key: SortKey) => (key === sortKey ? (sortDir === "desc" ? " ↓" : " ↑") : "");

  // 고정 코인 셀 공통 클래스 (헤더/바디에서 배경만 다름)
  const stickyBase = "sticky left-0 z-10 min-w-[190px] max-w-[230px]";

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="코인/심볼 검색…"
            className="flex-1 min-w-[180px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted)] cursor-pointer select-none">
            <input type="checkbox" checked={hideZombie} onChange={(e) => setHideZombie(e.target.checked)} className="accent-[var(--color-accent)]" />
            좀비 숨김
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted)] cursor-pointer select-none">
            <input type="checkbox" checked={holderOnly} onChange={(e) => setHolderOnly(e.target.checked)} className="accent-[var(--color-accent)]" />
            홀더수익 있는 것만
          </label>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
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
        </div>

        <details className="group">
          <summary className="cursor-pointer text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] select-none">
            섹터 필터 {cats.size > 0 ? `(${cats.size}개 선택)` : "(전체)"}
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto thin-scroll">
            {categories.map((c) => (
              <button key={c} onClick={() => toggleCat(c)}
                className={`rounded-full px-2.5 py-1 text-xs border transition-colors ${
                  cats.has(c)
                    ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
                    : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-muted)]"
                }`}>
                {c}
              </button>
            ))}
          </div>
          {cats.size > 0 && (
            <button onClick={() => setCats(new Set())} className="mt-2 text-xs text-[var(--color-accent)] hover:underline">선택 해제</button>
          )}
        </details>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)] px-1">
        <span>{deferredRows.length.toLocaleString()}개 표시</span>
        <span>FDV 보강 {fdvCoverage}개 · 갱신 {fmtKstMinute(updatedAt)}</span>
      </div>

      {/* 테이블 */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] overflow-x-auto thin-scroll" style={{ opacity: stale ? 0.6 : 1, transition: "opacity 120ms" }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th
                onClick={() => onSort("name")}
                title="프로토콜/토큰"
                className={`${stickyBase} bg-[var(--color-panel)] px-3 py-2.5 text-left font-medium cursor-pointer hover:text-[var(--color-text)] ${sortKey === "name" ? "text-[var(--color-text)]" : ""}`}
              >
                코인{sortArrow("name")}
              </th>
              {COLS.map((col) => (
                <th key={col.key} onClick={() => onSort(col.key)} title={col.title}
                  className={`px-3 py-2.5 font-medium cursor-pointer whitespace-nowrap hover:text-[var(--color-text)] ${col.key === "category" ? "text-left" : "text-right"} ${col.key === sortKey ? "text-[var(--color-text)]" : ""}`}>
                  {col.label}{sortArrow(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deferredRows.map((c, i) => (
              <tr key={c.slug} className="group border-b border-[var(--color-border)]/50 hover:bg-[var(--color-panel-2)]">
                {/* 코인 (고정) */}
                <td className={`${stickyBase} bg-[var(--color-panel)] group-hover:bg-[var(--color-panel-2)] px-3 py-2.5`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--color-muted)] text-xs tabular-nums w-6 text-right shrink-0">{i + 1}</span>
                    {c.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.logo} alt="" width={20} height={20} className="rounded-full shrink-0" loading="lazy" />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-[var(--color-panel-2)] shrink-0" />
                    )}
                    <a
                      href={coinUrl(c)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={c.geckoId ? "CoinGecko에서 열기" : "DefiLlama에서 열기"}
                      className="font-medium truncate hover:text-[var(--color-accent)] hover:underline"
                    >
                      {c.name}
                    </a>
                    {c.symbol && <span className="text-[var(--color-muted)] text-xs shrink-0">{c.symbol}</span>}
                  </div>
                </td>
                {COLS.map((col) => (
                  <td key={col.key} className={`px-3 py-2.5 tabular-nums ${col.key === "category" ? "text-left" : "text-right"}`}>
                    {renderCell(c, col.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {deferredRows.length === 0 && (
          <div className="p-8 text-center text-[var(--color-muted)] text-sm">조건에 맞는 코인이 없습니다. 필터를 완화해 보세요.</div>
        )}
      </div>
    </div>
  );
}
