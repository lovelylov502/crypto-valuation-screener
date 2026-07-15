"use client";

import type { CoinScored } from "@/lib/types";
import type { DecisionBucket } from "@/lib/decision";
import { bucketLabel } from "@/lib/decision";
import { fmtKstMinute, fmtMult, fmtUsd } from "@/lib/format";
import type { CoinDecisionRow } from "./CandidateDrawer";

function bucketTone(bucket: DecisionBucket): string {
  switch (bucket) {
    case "research-priority": return "border-emerald-500/35 bg-emerald-500/10 text-emerald-300";
    case "cheap-but-unclear-capture": return "border-amber-400/35 bg-amber-400/10 text-amber-200";
    case "dilution-risk": return "border-red-400/35 bg-red-400/10 text-red-200";
    case "clear-but-expensive": return "border-sky-400/35 bg-sky-400/10 text-sky-200";
    case "narrative-only": return "border-purple-400/35 bg-purple-400/10 text-purple-200";
    case "data-missing": return "border-slate-400/30 bg-slate-400/10 text-slate-300";
    case "ignore": return "border-slate-500/30 bg-slate-500/10 text-slate-400";
  }
}

export function DecisionBoard({
  rows,
  updatedAt,
  onSelect,
}: {
  rows: CoinDecisionRow[];
  updatedAt: string;
  onSelect: (row: CoinDecisionRow) => void;
}) {
  const byBucket = (bucket: DecisionBucket) => rows.filter((row) => row.decision.bucket === bucket);
  const priority = byBucket("research-priority").slice(0, 8);
  const expensive = byBucket("clear-but-expensive").slice(0, 6);
  const traps = byBucket("cheap-but-unclear-capture").slice(0, 6);
  const dilution = byBucket("dilution-risk").slice(0, 6);
  const missing = byBucket("data-missing").slice(0, 6);
  const questions = rows
    .filter((row) => row.decision.bucket !== "ignore")
    .flatMap((row) => row.decision.nextQuestions.slice(0, 1).map((question) => ({ row, question })))
    .slice(0, 6);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">Decision board</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">오늘의 저평가·고평가 후보</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-muted)]">
              섹터 상대 밸류를 먼저 보고 <strong className="text-[var(--color-text)]">가치포획 → 희석 → 근거 → 리스크 → 다음 질문</strong> 순서로 검증합니다.
            </p>
          </div>
          <span className="text-xs text-[var(--color-muted)]">갱신 {fmtKstMinute(updatedAt)}</span>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <BucketCard label="저평가 검토" count={byBucket("research-priority").length} tone="text-emerald-300" copy="직접 포획 + 밸류 매력" />
        <BucketCard label="고평가 관찰" count={byBucket("clear-but-expensive").length} tone="text-sky-200" copy="포획은 명확하지만 비쌈" />
        <BucketCard label="싸지만 포획 약함" count={byBucket("cheap-but-unclear-capture").length} tone="text-amber-200" copy="저평가처럼 보이는 함정" />
        <BucketCard label="고희석 주의" count={byBucket("dilution-risk").length} tone="text-red-200" copy="언락/FDV 먼저 확인" />
        <BucketCard label="데이터 부족" count={byBucket("data-missing").length} tone="text-slate-300" copy="모름을 질문으로 전환" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_380px]">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="text-sm font-semibold">저평가 검토 후보</h3>
            <p className="mt-1 text-xs text-[var(--color-muted)]">사는 후보가 아니라, 먼저 리서치할 가치가 있는 후보입니다.</p>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {priority.length > 0 ? priority.map((row) => (
              <CandidateCard key={row.coin.slug} row={row} onSelect={onSelect} />
            )) : (
              <EmptyState text="현재 조건에서 검토 우선 후보가 없습니다." />
            )}
          </div>
        </div>

        <aside className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="text-sm font-semibold">오늘의 리서치 질문</h3>
            <p className="mt-1 text-xs text-[var(--color-muted)]">모르는 것을 점수로 숨기지 않고 질문으로 남깁니다.</p>
          </div>
          <div className="space-y-2 p-4">
            {questions.map(({ row, question }) => (
              <button
                key={`${row.coin.slug}-${question}`}
                type="button"
                onClick={() => onSelect(row)}
                className="block w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-left hover:border-[var(--color-accent)]"
              >
                <span className="text-xs font-semibold text-[var(--color-text)]">{row.coin.name}</span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--color-muted)]">{question}</span>
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        <Lane title="고평가/비쌈" rows={expensive} onSelect={onSelect} />
        <Lane title="싸지만 포획 불명확" rows={traps} onSelect={onSelect} />
        <Lane title="고희석/언락 주의" rows={dilution} onSelect={onSelect} />
        <Lane title="데이터 부족" rows={missing} onSelect={onSelect} />
      </section>
    </div>
  );
}

function BucketCard({ label, count, tone, copy }: { label: string; count: number; tone: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${tone}`}>{count.toLocaleString()}</div>
      <div className="mt-1 text-xs text-[var(--color-muted)]">{copy}</div>
    </div>
  );
}

function CandidateCard({ row, onSelect }: { row: CoinDecisionRow; onSelect: (row: CoinDecisionRow) => void }) {
  const { coin, decision } = row;
  const risks = [...decision.risks.map((r) => r.label), ...decision.unknowns.map((u) => `? ${u}`)].slice(0, 3);
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-accent)] hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">
            {coin.name}
            {coin.symbol && <span className="ml-1 text-xs text-[var(--color-muted)]">{coin.symbol}</span>}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-muted)]">{coin.category ?? "기타"}</div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${bucketTone(decision.bucket)}`}>
          {bucketLabel(decision.bucket)}
        </span>
      </div>
      <p className="mt-3 min-h-[42px] text-sm leading-relaxed text-[var(--color-text)]">{decision.thesis}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <MetricChip label="P/HR" value={fmtMult(coin.multiples.phr)} />
        <MetricChip label="HR" value={fmtUsd(coin.holderRevenueAnnual)} />
        <MetricChip label="FDV/Mcap" value={fmtMult(coin.multiples.dilution)} />
      </div>
      {risks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {risks.map((risk) => <span key={risk} className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">{risk}</span>)}
        </div>
      )}
      <div className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs leading-relaxed text-[var(--color-muted)]">
        다음 질문: {decision.nextQuestions[0] ?? "추가 확인 질문 없음"}
      </div>
    </button>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return <span className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-[11px] text-[var(--color-muted)]">{label} <strong className="text-[var(--color-text)]">{value}</strong></span>;
}

function Lane({ title, rows, onSelect }: { title: string; rows: CoinDecisionRow[]; onSelect: (row: CoinDecisionRow) => void }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.length > 0 ? rows.map((row) => (
          <button key={row.coin.slug} type="button" onClick={() => onSelect(row)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-left text-sm hover:border-[var(--color-accent)]">
            <span className="truncate font-medium">{row.coin.name}</span>
            <span className="shrink-0 text-xs text-[var(--color-muted)]">우선도 {row.decision.priority}</span>
          </button>
        )) : <EmptyState text="해당 후보 없음" />}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-[var(--color-border)] p-5 text-center text-sm text-[var(--color-muted)]">{text}</div>;
}
