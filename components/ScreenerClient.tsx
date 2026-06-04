"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { CoinScored } from "@/lib/types";
import { fmtUsd, fmtMult, fmtPct } from "@/lib/format";
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

// 코인 외부 링크: CoinGecko 우선, 없으면 DefiLlama 폴백
function coinUrl(c: CoinScored): string {
  if (c.geckoId) return `https://www.coingecko.com/en/coins/${c.geckoId}`;
  return `https://defillama.com/protocol/${c.slug.replace(/^parent#/, "")}`;
}

type SortKey =
  | "valueScore"
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
  | "feesChange";

interface Col {
  key: SortKey;
  label: string;
  title: string;
}

// 코인(고정 열)을 제외한 나머지 컬럼 — 전부 우측정렬 숫자
const COLS: Col[] = [
  { key: "category", label: "섹터", title: "카테고리" },
  { key: "valueScore", label: "점수", title: "종합 밸류 점수 (0~100, 높을수록 저평가)" },
  { key: "ps", label: "P/S", title: "시총 / 연매출 (낮을수록 쌈)" },
  { key: "phr", label: "P/HR", title: "시총 / 홀더귀속수익 — 크립토 PER (낮을수록 쌈)" },
  { key: "revenueAnnual", label: "매출/년", title: "연율화 프로토콜 매출" },
  { key: "holderRevenueAnnual", label: "홀더수익/년", title: "토큰 홀더에게 귀속되는 연간 수익 (실질 배당)" },
  { key: "revenue30d", label: "매출 30d", title: "최근 30일 매출 (원값)" },
  { key: "mcap", label: "시총", title: "유통 시가총액" },
  { key: "fdv", label: "FDV", title: "완전희석가치 (CoinGecko, 상위코인)" },
  { key: "tvl", label: "TVL", title: "예치자산" },
  { key: "feesChange", label: "수수료Δ", title: "최근 30일 vs 직전 30일 수수료 변화" },
];

function sortValue(c: CoinScored, key: SortKey): number | string | null {
  switch (key) {
    case "name": return c.name.toLowerCase();
    case "category": return (c.category ?? "").toLowerCase();
    case "valueScore": return c.valueScore;
    case "ps": return c.multiples.ps;
    case "phr": return c.multiples.phr;
    case "revenueAnnual": return c.revenueAnnual;
    case "holderRevenueAnnual": return c.holderRevenueAnnual;
    case "revenue30d": return c.revenue30d;
    case "mcap": return c.mcap;
    case "fdv": return c.fdv;
    case "tvl": return c.tvl;
    case "feesChange": return c.feesChange30dover30d;
  }
}

// 셀 렌더 (코인 제외)
function renderCell(c: CoinScored, key: SortKey) {
  switch (key) {
    case "category":
      return <span className="text-[var(--color-muted)] whitespace-nowrap">{c.category ?? "–"}</span>;
    case "valueScore":
      return <ScoreBadge score={c.valueScore} label={c.label} confidence={c.confidence} />;
    case "ps": return fmtMult(c.multiples.ps);
    case "phr": return fmtMult(c.multiples.phr);
    case "revenueAnnual": return fmtUsd(c.revenueAnnual);
    case "holderRevenueAnnual": return fmtUsd(c.holderRevenueAnnual);
    case "revenue30d": return fmtUsd(c.revenue30d);
    case "mcap": return fmtUsd(c.mcap);
    case "fdv": return fmtUsd(c.fdv);
    case "tvl": return fmtUsd(c.tvl);
    case "feesChange":
      return (
        <span className={c.feesChange30dover30d == null ? "" : c.feesChange30dover30d >= 0 ? "text-emerald-400" : "text-red-400"}>
          {fmtPct(c.feesChange30dover30d)}
        </span>
      );
    default: return null;
  }
}

// 규모 필터 1개 (숫자입력 M단위 + 로그 슬라이더, 같은 USD 값 공유)
function ScaleFilter({
  label, usd, onChange,
}: { label: string; usd: number; onChange: (usd: number) => void }) {
  return (
    <div className="min-w-[210px]">
      <div className="flex items-center justify-between mb-1 text-xs text-[var(--color-muted)]">
        <span>{label}</span>
        <div className="flex items-center gap-1">
          <span>≥ $</span>
          <input
            type="number" min={0} step={1}
            value={usd > 0 ? Math.round(usd / 1e6) : ""}
            onChange={(e) => {
              const m = parseFloat(e.target.value);
              onChange(Number.isFinite(m) && m > 0 ? m * 1e6 : 0);
            }}
            placeholder="0"
            className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
          <span>M</span>
        </div>
      </div>
      <input
        type="range" min={0} max={100} step={0.5}
        value={usdToSlider(usd)}
        onChange={(e) => onChange(sliderToUsd(Number(e.target.value)))}
        className="w-full accent-[var(--color-accent)]"
      />
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
  const [minTvl, setMinTvl] = useState(0);
  const [minScore, setMinScore] = useState(0);
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
      if (minScore > 0 && (c.valueScore ?? -1) < minScore) return false;
      if (cats.size > 0 && (!c.category || !cats.has(c.category))) return false;
      if (minMcap > 0 && (c.mcap ?? 0) < minMcap) return false;
      if (minTvl > 0 && (c.tvl ?? 0) < minTvl) return false;
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
  }, [coins, search, cats, minMcap, minTvl, minScore, hideZombie, holderOnly, sortKey, sortDir]);

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

        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <ScaleFilter label="최소 시총" usd={minMcap} onChange={setMinMcap} />
          <ScaleFilter label="최소 TVL" usd={minTvl} onChange={setMinTvl} />
          <div className="min-w-[150px]">
            <div className="flex items-center justify-between mb-1 text-xs text-[var(--color-muted)]">
              <span>최소 점수</span>
              <input
                type="number" min={0} max={100} step={1}
                value={minScore > 0 ? minScore : ""}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setMinScore(Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);
                }}
                placeholder="0"
                className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
              />
            </div>
            <input type="range" min={0} max={100} step={1} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
          </div>
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

      <div className="flex items-center justify-between text-xs text-[var(--color-muted)] px-1">
        <span>{deferredRows.length.toLocaleString()}개 표시</span>
        <span>FDV 보강 {fdvCoverage}개 · 갱신 {new Date(updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</span>
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
