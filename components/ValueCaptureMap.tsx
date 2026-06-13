"use client";

import { fmtMult } from "@/lib/format";
import type { CoinDecisionRow } from "./CandidateDrawer";

export function ValueCaptureMap({ rows, onSelect }: { rows: CoinDecisionRow[]; onSelect: (row: CoinDecisionRow) => void }) {
  const direct = (row: CoinDecisionRow) => row.coin.valueCapture.label === "강한 가치포획" || row.coin.valueCapture.label === "가치포획 후보";
  const cheap = (row: CoinDecisionRow) => (row.coin.valueScore ?? -1) >= 70;
  const quadrants = [
    { title: "싸고 포획 명확", desc: "검토 우선 후보", rows: rows.filter((r) => cheap(r) && direct(r)).slice(0, 8) },
    { title: "비싸지만 포획 명확", desc: "좋은 사업이지만 가격 확인", rows: rows.filter((r) => !cheap(r) && direct(r)).slice(0, 8) },
    { title: "싸지만 포획 불명확", desc: "저평가 함정 가능성", rows: rows.filter((r) => cheap(r) && !direct(r)).slice(0, 8) },
    { title: "비싸고 포획 불명확", desc: "우선순위 낮음", rows: rows.filter((r) => !cheap(r) && !direct(r)).slice(0, 8) },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">Value capture map</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">싸냐? vs 토큰에 꽂히냐?</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-muted)]">
          같은 저평가 점수라도 토큰 포획 경로가 없으면 함정입니다. 먼저 2x2로 구조를 분리합니다.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {quadrants.map((q) => (
          <div key={q.title} className="min-h-[260px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{q.title}</h3>
                <p className="mt-1 text-xs text-[var(--color-muted)]">{q.desc}</p>
              </div>
              <span className="text-xs text-[var(--color-muted)]">{q.rows.length}개</span>
            </div>
            <div className="mt-4 space-y-2">
              {q.rows.length > 0 ? q.rows.map((row) => (
                <button key={row.coin.slug} type="button" onClick={() => onSelect(row)} className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-left text-sm hover:border-[var(--color-accent)]">
                  <span className="truncate font-medium">{row.coin.name}</span>
                  <span className="text-xs text-[var(--color-muted)]">P/HR {fmtMult(row.coin.multiples.phr)}</span>
                  <span className="text-xs text-[var(--color-muted)]">{row.coin.valueScore ?? "–"}점</span>
                </button>
              )) : (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted)]">후보 없음</div>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
