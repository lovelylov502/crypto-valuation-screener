"use client";

import { useEffect } from "react";
import type { CoinScored } from "@/lib/types";
import type { DecisionSummary } from "@/lib/decision";
import { bucketLabel } from "@/lib/decision";
import { fmtMult, fmtPct, fmtUsd } from "@/lib/format";

export interface CoinDecisionRow {
  coin: CoinScored;
  decision: DecisionSummary;
}

function coinUrl(c: CoinScored): string {
  if (c.geckoId) return `https://www.coingecko.com/en/coins/${c.geckoId}`;
  return `https://defillama.com/protocol/${c.slug.replace(/^parent#/, "")}`;
}

function bucketClass(bucket: DecisionSummary["bucket"]): string {
  switch (bucket) {
    case "research-priority": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "cheap-but-unclear-capture": return "border-amber-400/40 bg-amber-400/10 text-amber-200";
    case "dilution-risk": return "border-red-400/40 bg-red-400/10 text-red-200";
    case "clear-but-expensive": return "border-sky-400/40 bg-sky-400/10 text-sky-200";
    case "narrative-only": return "border-purple-400/40 bg-purple-400/10 text-purple-200";
    case "data-missing": return "border-slate-400/30 bg-slate-400/10 text-slate-300";
    case "ignore": return "border-slate-500/30 bg-slate-500/10 text-slate-400";
  }
}

function severityClass(severity: "high" | "medium" | "low"): string {
  if (severity === "high") return "border-red-400/40 bg-red-400/10 text-red-200";
  if (severity === "medium") return "border-amber-400/40 bg-amber-400/10 text-amber-200";
  return "border-slate-400/30 bg-slate-400/10 text-slate-300";
}

export function CandidateDrawer({ row, onClose }: { row: CoinDecisionRow | null; onClose: () => void }) {
  useEffect(() => {
    if (!row) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [row, onClose]);

  if (!row) return null;
  const { coin, decision } = row;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="후보 상세 닫기"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <aside className="absolute inset-y-0 right-0 w-full overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-2xl sm:max-w-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${bucketClass(decision.bucket)}`}>
              {bucketLabel(decision.bucket)} · 우선도 {decision.priority}
            </span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight">
              {coin.name}
              {coin.symbol && <span className="ml-2 text-base text-[var(--color-muted)]">{coin.symbol}</span>}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{coin.category ?? "기타"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            닫기
          </button>
        </div>

        <section className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <h3 className="text-sm font-semibold">한줄 판단</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text)]">{decision.thesis}</p>
        </section>

        <section className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="P/HR" value={fmtMult(coin.multiples.phr)} />
          <Metric label="holder revenue" value={fmtUsd(coin.holderRevenueAnnual)} />
          <Metric label="FDV/Mcap" value={fmtMult(coin.multiples.dilution)} />
          <Metric label="밸류 점수" value={coin.valueScore === null ? "–" : `${coin.valueScore}`} />
          <Metric label="포획 점수" value={coin.valueCapture.score === null ? "–" : `${coin.valueCapture.score}`} />
          <Metric label="귀속 비중" value={coin.valueCapture.holderRevenueShare === null ? "–" : fmtPct(coin.valueCapture.holderRevenueShare * 100)} />
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-semibold">근거</h3>
          <div className="mt-2 space-y-2">
            {decision.evidence.length > 0 ? decision.evidence.map((item) => (
              <div key={`${item.label}-${item.detail}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-xs text-[var(--color-muted)]">{item.source} · {item.strength}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">{item.detail}</p>
              </div>
            )) : (
              <p className="rounded-lg border border-[var(--color-border)] p-3 text-sm text-[var(--color-muted)]">아직 강한 근거가 없습니다.</p>
            )}
          </div>
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-semibold">리스크 / 모르는 것</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {decision.risks.map((risk) => (
              <span key={risk.label} title={risk.detail} className={`rounded-full border px-2.5 py-1 text-xs ${severityClass(risk.severity)}`}>
                ⚠ {risk.label}
              </span>
            ))}
            {decision.unknowns.map((unknown) => (
              <span key={unknown} className="rounded-full border border-slate-400/30 bg-slate-400/10 px-2.5 py-1 text-xs text-slate-300">
                ? {unknown}
              </span>
            ))}
            {decision.risks.length === 0 && decision.unknowns.length === 0 && (
              <span className="text-sm text-[var(--color-muted)]">큰 구조 리스크가 자동 감지되지 않았습니다.</span>
            )}
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <h3 className="text-sm font-semibold">다음 리서치 질문</h3>
          <ol className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--color-muted)]">
            {decision.nextQuestions.map((question, index) => (
              <li key={question} className="flex gap-2">
                <span className="text-[var(--color-accent)]">{index + 1}.</span>
                <span>{question}</span>
              </li>
            ))}
          </ol>
        </section>

        <a
          href={coinUrl(coin)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
        >
          원자료 열기
        </a>
      </aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <div className="text-[11px] text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
