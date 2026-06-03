"use client";

import { useMemo, useState } from "react";
import type { CoinScored } from "@/lib/types";
import { fmtUsd, fmtMult, fmtPct } from "@/lib/format";
import { ScoreBadge } from "./ScoreBadge";

// 로그 슬라이더(0~100) → USD. 0이면 필터 없음, 100이면 $100B
function sliderToUsd(s: number): number {
  if (s <= 0) return 0;
  return Math.pow(10, 6 + (s / 100) * 5); // 1e6 ~ 1e11
}
function fmtThreshold(usd: number): string {
  return usd <= 0 ? "전체" : `≥ ${fmtUsd(usd)}`;
}

type SortKey =
  | "valueScore"
  | "name"
  | "category"
  | "pf"
  | "ps"
  | "mcapTvl"
  | "fdvTvl"
  | "mcap"
  | "fdv"
  | "tvl"
  | "feesAnnual"
  | "revenueAnnual"
  | "feesChange";

interface Col {
  key: SortKey;
  label: string;
  title: string;
  numeric: boolean;
}

const COLS: Col[] = [
  { key: "name", label: "코인", title: "프로토콜/토큰", numeric: false },
  { key: "category", label: "섹터", title: "카테고리", numeric: false },
  { key: "valueScore", label: "점수", title: "종합 밸류 점수 (0~100, 높을수록 저평가)", numeric: true },
  { key: "pf", label: "P/F", title: "시총 / 연수수료 (낮을수록 쌈)", numeric: true },
  { key: "ps", label: "P/S", title: "시총 / 연매출 (낮을수록 쌈)", numeric: true },
  { key: "mcapTvl", label: "Mcap/TVL", title: "시총 / 예치자산 (낮을수록 쌈)", numeric: true },
  { key: "fdvTvl", label: "FDV/TVL", title: "완전희석가치 / 예치자산", numeric: true },
  { key: "mcap", label: "시총", title: "유통 시가총액", numeric: true },
  { key: "fdv", label: "FDV", title: "완전희석가치 (CoinGecko, 상위코인)", numeric: true },
  { key: "tvl", label: "TVL", title: "예치자산", numeric: true },
  { key: "feesAnnual", label: "수수료/년", title: "연율화 수수료", numeric: true },
  { key: "revenueAnnual", label: "매출/년", title: "연율화 프로토콜 매출", numeric: true },
  { key: "feesChange", label: "수수료Δ", title: "최근 30일 vs 직전 30일 수수료 변화", numeric: true },
];

function sortValue(c: CoinScored, key: SortKey): number | string | null {
  switch (key) {
    case "name": return c.name.toLowerCase();
    case "category": return (c.category ?? "").toLowerCase();
    case "valueScore": return c.valueScore;
    case "pf": return c.multiples.pf;
    case "ps": return c.multiples.ps;
    case "mcapTvl": return c.multiples.mcapTvl;
    case "fdvTvl": return c.multiples.fdvTvl;
    case "mcap": return c.mcap;
    case "fdv": return c.fdv;
    case "tvl": return c.tvl;
    case "feesAnnual": return c.feesAnnual;
    case "revenueAnnual": return c.revenueAnnual;
    case "feesChange": return c.feesChange30dover30d;
  }
}

export function ScreenerClient({
  coins,
  categories,
  updatedAt,
  fdvCoverage,
}: {
  coins: CoinScored[];
  categories: string[];
  updatedAt: string;
  fdvCoverage: number;
}) {
  const [search, setSearch] = useState("");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [minMcapS, setMinMcapS] = useState(0);
  const [minTvlS, setMinTvlS] = useState(0);
  const [hideZombie, setHideZombie] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("valueScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const minMcap = sliderToUsd(minMcapS);
  const minTvl = sliderToUsd(minTvlS);

  const toggleCat = (c: string) =>
    setCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "category" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = coins.filter((c) => {
      if (hideZombie && c.lowActivity) return false;
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
      // null은 방향과 무관하게 항상 뒤로
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb) * dir;
      }
      return ((va as number) - (vb as number)) * dir;
    });
    return filtered;
  }, [coins, search, cats, minMcap, minTvl, hideZombie, sortKey, sortDir]);

  const sortArrow = (key: SortKey) =>
    key === sortKey ? (sortDir === "desc" ? " ↓" : " ↑") : "";

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
            <input
              type="checkbox"
              checked={hideZombie}
              onChange={(e) => setHideZombie(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            좀비 숨김 (매출 미미)
          </label>
        </div>

        <div className="flex flex-wrap gap-6">
          <div className="min-w-[200px]">
            <div className="text-xs text-[var(--color-muted)] mb-1">
              최소 시총: <span className="text-[var(--color-text)]">{fmtThreshold(minMcap)}</span>
            </div>
            <input
              type="range" min={0} max={100} value={minMcapS}
              onChange={(e) => setMinMcapS(Number(e.target.value))}
              className="w-full accent-[var(--color-accent)]"
            />
          </div>
          <div className="min-w-[200px]">
            <div className="text-xs text-[var(--color-muted)] mb-1">
              최소 TVL: <span className="text-[var(--color-text)]">{fmtThreshold(minTvl)}</span>
            </div>
            <input
              type="range" min={0} max={100} value={minTvlS}
              onChange={(e) => setMinTvlS(Number(e.target.value))}
              className="w-full accent-[var(--color-accent)]"
            />
          </div>
        </div>

        {/* 카테고리 멀티셀렉트 */}
        <details className="group">
          <summary className="cursor-pointer text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] select-none">
            섹터 필터 {cats.size > 0 ? `(${cats.size}개 선택)` : "(전체)"}
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto thin-scroll">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => toggleCat(c)}
                className={`rounded-full px-2.5 py-1 text-xs border transition-colors ${
                  cats.has(c)
                    ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
                    : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-muted)]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          {cats.size > 0 && (
            <button
              onClick={() => setCats(new Set())}
              className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
            >
              선택 해제
            </button>
          )}
        </details>
      </div>

      {/* 결과 요약 */}
      <div className="flex items-center justify-between text-xs text-[var(--color-muted)] px-1">
        <span>{rows.length.toLocaleString()}개 표시</span>
        <span>
          FDV 보강 {fdvCoverage}개 · 갱신{" "}
          {new Date(updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
        </span>
      </div>

      {/* 테이블 */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] overflow-x-auto thin-scroll">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th className="px-3 py-2.5 text-right font-medium w-10">#</th>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  title={col.title}
                  className={`px-3 py-2.5 font-medium cursor-pointer whitespace-nowrap hover:text-[var(--color-text)] ${
                    col.numeric ? "text-right" : "text-left"
                  } ${col.key === sortKey ? "text-[var(--color-text)]" : ""}`}
                >
                  {col.label}
                  {sortArrow(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr
                key={c.slug}
                className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-panel-2)]"
              >
                <td className="px-3 py-2.5 text-right text-[var(--color-muted)] tabular-nums">{i + 1}</td>
                {/* 코인 */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-[160px]">
                    {c.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.logo} alt="" width={20} height={20} className="rounded-full shrink-0" loading="lazy" />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-[var(--color-panel-2)] shrink-0" />
                    )}
                    <span className="font-medium truncate max-w-[180px]">{c.name}</span>
                    {c.symbol && <span className="text-[var(--color-muted)] text-xs shrink-0">{c.symbol}</span>}
                  </div>
                </td>
                {/* 섹터 */}
                <td className="px-3 py-2.5 text-[var(--color-muted)] whitespace-nowrap">{c.category ?? "–"}</td>
                {/* 점수 */}
                <td className="px-3 py-2.5 text-right">
                  <ScoreBadge score={c.valueScore} label={c.label} confidence={c.confidence} />
                </td>
                {/* 멀티플 */}
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtMult(c.multiples.pf)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtMult(c.multiples.ps)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtMult(c.multiples.mcapTvl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtMult(c.multiples.fdvTvl)}</td>
                {/* 규모 */}
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd(c.mcap)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd(c.fdv)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd(c.tvl)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd(c.feesAnnual)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtUsd(c.revenueAnnual)}</td>
                <td
                  className={`px-3 py-2.5 text-right tabular-nums ${
                    c.feesChange30dover30d == null
                      ? ""
                      : c.feesChange30dover30d >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                  }`}
                >
                  {fmtPct(c.feesChange30dover30d)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-8 text-center text-[var(--color-muted)] text-sm">
            조건에 맞는 코인이 없습니다. 필터를 완화해 보세요.
          </div>
        )}
      </div>
    </div>
  );
}
