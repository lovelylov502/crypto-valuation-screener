"use client";

import { useMemo, useState } from "react";
import type { CoinScored, OnchainDashboard, OnchainMetric } from "@/lib/types";
import { fmtKstMinute, fmtMult, fmtPct, fmtUsd } from "@/lib/format";
import { ScreenerClient } from "./ScreenerClient";

type Tab = "dashboard" | "capture" | "screener";

function coinUrl(c: CoinScored): string {
  if (c.geckoId) return `https://www.coingecko.com/en/coins/${c.geckoId}`;
  return `https://defillama.com/protocol/${c.slug.replace(/^parent#/, "")}`;
}

function changeClass(v: number | null): string {
  if (v === null) return "text-[var(--color-muted)]";
  return v >= 0 ? "text-emerald-400" : "text-red-400";
}

function captureClass(score: number | null): string {
  if (score === null) return "text-[var(--color-muted)]";
  if (score >= 70) return "text-emerald-400";
  if (score >= 45) return "text-amber-300";
  return "text-[var(--color-muted)]";
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtPlainPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "–";
  return `${v.toFixed(1)}%`;
}

function momentumScore(c: CoinScored): number {
  const p14 = c.priceChange14d ?? 0;
  const p30 = c.priceChange30d ?? 0;
  const fee7 = Math.max(-100, Math.min(100, c.feesChange7dover7d ?? 0));
  const value = (c.valueScore ?? 50) - 50;
  return p14 * 0.55 + p30 * 0.25 + fee7 * 0.1 + value * 0.1;
}

function statusFor(c: CoinScored): string {
  if ((c.priceChange7d ?? 0) >= 35 || (c.priceChange14d ?? 0) >= 80) return "과열주의";
  if ((c.priceChange14d ?? 0) >= 20 && (c.priceChange30d ?? 0) >= 20) return "강세";
  return "관찰";
}

function fmtOnchainValue(metric: OnchainMetric): string {
  if (metric.value === null) return "–";
  if (metric.key === "realizedPrice") return fmtUsd(metric.value);
  return metric.value.toFixed(2);
}

function onchainMessage(metric: OnchainMetric): string {
  if (metric.status === "ok") return metric.updatedAt ? fmtKstMinute(metric.updatedAt) : "갱신됨";
  if (metric.status === "missing-token") return "API 토큰 필요";
  return "데이터 불가";
}

function Dashboard({ coins, updatedAt, fdvCoverage, onchain }: {
  coins: CoinScored[];
  updatedAt: string;
  fdvCoverage: number;
  onchain: OnchainDashboard;
}) {
  const data = useMemo(() => {
    const with14d = coins.filter((c) => c.priceChange14d !== null);
    const strongMomentum = with14d.filter((c) =>
      (c.mcap ?? 0) >= 10_000_000 &&
      (c.totalVolume ?? 0) >= 1_000_000 &&
      (c.priceChange14d ?? 0) >= 10 &&
      (c.priceChange30d ?? c.priceChange14d ?? 0) >= 5 &&
      (c.priceChange7d ?? 0) > -10
    );
    const feeUp = coins.filter((c) => (c.feesChange7dover7d ?? -Infinity) > 0);
    const undervalued = coins.filter((c) => (c.valueScore ?? -1) >= 80);
    const phrValues = coins
      .map((c) => c.multiples.phr)
      .filter((v): v is number => v !== null && Number.isFinite(v));

    const categories = new Map<string, {
      count: number;
      mcap: number;
      revenue: number;
      score: number[];
      p14: number[];
      fee7: number[];
    }>();
    for (const c of coins) {
      const key = c.category ?? "기타";
      let row = categories.get(key);
      if (!row) {
        row = { count: 0, mcap: 0, revenue: 0, score: [], p14: [], fee7: [] };
        categories.set(key, row);
      }
      row.count += 1;
      row.mcap += c.mcap ?? 0;
      row.revenue += c.revenueAnnual ?? 0;
      if (c.valueScore !== null) row.score.push(c.valueScore);
      if (c.priceChange14d !== null) row.p14.push(c.priceChange14d);
      if (c.feesChange7dover7d !== null) row.fee7.push(c.feesChange7dover7d);
    }

    const categoryRows = [...categories.entries()]
      .map(([category, row]) => ({
        category,
        count: row.count,
        mcap: row.mcap,
        revenue: row.revenue,
        score: avg(row.score),
        p14: avg(row.p14),
        fee7: avg(row.fee7),
      }))
      .filter((row) => row.count >= 5)
      .sort((a, b) => (b.p14 ?? -Infinity) - (a.p14 ?? -Infinity))
      .slice(0, 10);

    return {
      marketBreadth: with14d.length === 0
        ? null
        : (with14d.filter((c) => (c.priceChange14d ?? 0) > 0).length / with14d.length) * 100,
      strongMomentum,
      feeUp,
      undervalued,
      medianPhr: median(phrValues),
      momentumRows: strongMomentum
        .sort((a, b) => momentumScore(b) - momentumScore(a))
        .slice(0, 12),
      categoryRows,
    };
  }, [coins]);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">14d 상승 비율</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{fmtPlainPct(data.marketBreadth)}</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">2~3주 모멘텀</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{data.strongMomentum.length.toLocaleString()}개</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">수수료 7d 개선</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{data.feeUp.length.toLocaleString()}개</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">P/HR 중앙값</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{fmtMult(data.medianPhr)}</div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-x-auto thin-scroll">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold">2~3주 모멘텀 후보</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-muted)]">
                <th className="px-4 py-2 text-left font-medium">코인</th>
                <th className="px-3 py-2 text-right font-medium">7d</th>
                <th className="px-3 py-2 text-right font-medium">14d</th>
                <th className="px-3 py-2 text-right font-medium">30d</th>
                <th className="px-3 py-2 text-right font-medium">수수료 7d</th>
                <th className="px-3 py-2 text-right font-medium">점수</th>
                <th className="px-4 py-2 text-right font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {data.momentumRows.map((c) => (
                <tr key={c.slug} className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-panel-2)]">
                  <td className="px-4 py-2">
                    <a
                      href={coinUrl(c)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:text-[var(--color-accent)] hover:underline"
                    >
                      {c.name}
                    </a>
                    {c.symbol && <span className="ml-1 text-xs text-[var(--color-muted)]">{c.symbol}</span>}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${changeClass(c.priceChange7d)}`}>{fmtPct(c.priceChange7d)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${changeClass(c.priceChange14d)}`}>{fmtPct(c.priceChange14d)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${changeClass(c.priceChange30d)}`}>{fmtPct(c.priceChange30d)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${changeClass(c.feesChange7dover7d)}`}>{fmtPct(c.feesChange7dover7d)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.valueScore ?? "–"}</td>
                  <td className="px-4 py-2 text-right text-xs text-[var(--color-muted)]">{statusFor(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-x-auto thin-scroll">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold">섹터 흐름</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-muted)]">
                <th className="px-4 py-2 text-left font-medium">섹터</th>
                <th className="px-3 py-2 text-right font-medium">14d</th>
                <th className="px-3 py-2 text-right font-medium">수수료</th>
                <th className="px-3 py-2 text-right font-medium">점수</th>
              </tr>
            </thead>
            <tbody>
              {data.categoryRows.map((row) => (
                <tr key={row.category} className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-panel-2)]">
                  <td className="px-4 py-2">
                    <span className="font-medium">{row.category}</span>
                    <span className="ml-1 text-xs text-[var(--color-muted)]">{row.count}</span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${changeClass(row.p14)}`}>{fmtPct(row.p14)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${changeClass(row.fee7)}`}>{fmtPct(row.fee7)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.score === null ? "–" : row.score.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">저평가 점수 80+</div>
          <div className="mt-2 text-xl font-bold tabular-nums">{data.undervalued.length.toLocaleString()}개</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">FDV 보강</div>
          <div className="mt-2 text-xl font-bold tabular-nums">{fdvCoverage.toLocaleString()}개</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">갱신</div>
          <div className="mt-2 text-xl font-bold tabular-nums">
            {fmtKstMinute(updatedAt)}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">BTC 온체인 밸류 지표</h2>
          <span className="text-xs text-[var(--color-muted)]">Source: {onchain.source}</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {onchain.metrics.map((metric) => (
            <div key={metric.key} className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                <span>{metric.label}</span>
                <span className={changeClass(metric.change7d)}>{fmtPct(metric.change7d)}</span>
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums">{fmtOnchainValue(metric)}</div>
              <div className={`mt-1 text-xs ${metric.status === "ok" ? "text-[var(--color-muted)]" : "text-amber-400"}`}>
                {onchainMessage(metric)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ValueCaptureView({ coins, updatedAt }: { coins: CoinScored[]; updatedAt: string }) {
  const data = useMemo(() => {
    const direct = coins.filter((c) =>
      c.valueCapture.label === "강한 가치포획" || c.valueCapture.label === "가치포획 후보"
    );
    const indirect = coins.filter((c) => c.valueCapture.label === "간접 포획");
    const highDilution = coins.filter((c) => c.valueCapture.risks.includes("고희석"));
    const shares = direct
      .map((c) => c.valueCapture.holderRevenueShare)
      .filter((v): v is number => v !== null);
    const rows = [...direct]
      .sort((a, b) => (b.valueCapture.score ?? -1) - (a.valueCapture.score ?? -1))
      .slice(0, 18);
    return {
      direct,
      indirect,
      highDilution,
      medianShare: median(shares),
      rows,
    };
  }, [coins]);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">가치포획 렌즈</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--color-muted)]">
              단순 매출 성장보다 <strong className="text-[var(--color-text)]">그 돈이 토큰 홀더에게 실제로 꽂히는가</strong>를 먼저 봅니다.
              holder revenue가 있으면 직접 포획, 매출/수수료만 있으면 간접 포획으로 분리합니다.
            </p>
          </div>
          <span className="text-xs text-[var(--color-muted)]">갱신 {fmtKstMinute(updatedAt)}</span>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">직접 가치포획</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-400">{data.direct.length.toLocaleString()}개</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">간접 포획</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-amber-300">{data.indirect.length.toLocaleString()}개</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">holder revenue 비중 중앙값</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{data.medianShare === null ? "–" : fmtPct(data.medianShare * 100)}</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <div className="text-xs text-[var(--color-muted)]">고희석 리스크</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-red-400">{data.highDilution.length.toLocaleString()}개</div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-x-auto thin-scroll">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">직접 가치포획 후보</h2>
          <p className="mt-1 text-xs text-[var(--color-muted)]">포획점수는 holder revenue 존재·매출 대비 귀속 비중·P/HR 상대 매력·희석 리스크를 함께 봅니다.</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-muted)]">
              <th className="px-4 py-2 text-left font-medium">코인</th>
              <th className="px-3 py-2 text-right font-medium">포획점수</th>
              <th className="px-3 py-2 text-right font-medium">귀속비중</th>
              <th className="px-3 py-2 text-right font-medium">P/HR</th>
              <th className="px-3 py-2 text-right font-medium">홀더수익/년</th>
              <th className="px-3 py-2 text-right font-medium">P/S</th>
              <th className="px-4 py-2 text-left font-medium">신호/리스크</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((c) => (
              <tr key={c.slug} className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-panel-2)]">
                <td className="px-4 py-2">
                  <a href={coinUrl(c)} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-[var(--color-accent)] hover:underline">
                    {c.name}
                  </a>
                  {c.symbol && <span className="ml-1 text-xs text-[var(--color-muted)]">{c.symbol}</span>}
                </td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${captureClass(c.valueCapture.score)}`}>{c.valueCapture.score ?? "–"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.valueCapture.holderRevenueShare === null ? "–" : fmtPct(c.valueCapture.holderRevenueShare * 100)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMult(c.multiples.phr)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(c.holderRevenueAnnual)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMult(c.multiples.ps)}</td>
                <td className="px-4 py-2 text-xs text-[var(--color-muted)]">
                  {[...c.valueCapture.signals, ...c.valueCapture.risks.map((r) => `⚠ ${r}`)].slice(0, 3).join(" · ") || "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function CryptoDashboardClient({
  coins,
  categories,
  updatedAt,
  fdvCoverage,
  onchain,
}: {
  coins: CoinScored[];
  categories: string[];
  updatedAt: string;
  fdvCoverage: number;
  onchain: OnchainDashboard;
}) {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-1">
        <button
          type="button"
          onClick={() => setTab("dashboard")}
          className={`rounded-md px-4 py-2 text-sm transition-colors ${
            tab === "dashboard"
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          대시보드
        </button>
        <button
          type="button"
          onClick={() => setTab("capture")}
          className={`rounded-md px-4 py-2 text-sm transition-colors ${
            tab === "capture"
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          가치포획
        </button>
        <button
          type="button"
          onClick={() => setTab("screener")}
          className={`rounded-md px-4 py-2 text-sm transition-colors ${
            tab === "screener"
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          밸류 스크리너
        </button>
      </div>

      {tab === "dashboard" ? (
        <Dashboard coins={coins} updatedAt={updatedAt} fdvCoverage={fdvCoverage} onchain={onchain} />
      ) : tab === "capture" ? (
        <ValueCaptureView coins={coins} updatedAt={updatedAt} />
      ) : (
        <ScreenerClient
          coins={coins}
          categories={categories}
          updatedAt={updatedAt}
          fdvCoverage={fdvCoverage}
        />
      )}
    </div>
  );
}
