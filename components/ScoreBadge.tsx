import type { CandidateStatus, ConfidenceGrade } from "@/lib/types";

const STATUS_CLASS: Record<CandidateStatus, string> = {
  "발굴 후보": "border-emerald-400/40 bg-emerald-400/15 text-emerald-300",
  "관찰": "border-blue-400/40 bg-blue-400/15 text-blue-300",
  "근거 부족": "border-amber-400/40 bg-amber-400/15 text-amber-300",
  "제외": "border-slate-500/40 bg-slate-500/15 text-slate-300",
  "가치 함정": "border-red-400/40 bg-red-400/15 text-red-300",
  "재평가 진행 중": "border-violet-400/40 bg-violet-400/15 text-violet-300",
  "데이터 보류": "border-slate-500/40 bg-slate-500/15 text-slate-400",
  "신규 프로젝트": "border-cyan-400/40 bg-cyan-400/15 text-cyan-300",
};

const GRADE_CLASS: Record<ConfidenceGrade, string> = {
  A: "border-emerald-400/40 text-emerald-300",
  B: "border-blue-400/40 text-blue-300",
  C: "border-amber-400/40 text-amber-300",
};

export function ScoreBadge({
  score,
  status,
  confidenceGrade,
  confidence,
  reasons,
}: {
  score: number | null;
  status: CandidateStatus;
  confidenceGrade: ConfidenceGrade;
  confidence: number;
  reasons: string[];
}) {
  const detail = reasons.join(" · ");
  return (
    <span className="inline-flex min-w-[150px] flex-col items-end gap-1">
      <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status]}`}
          title={detail || status}
        >
          {status}
        </span>
        {score !== null && (
          <strong className="text-base tabular-nums text-[var(--color-text)]">
            {score}
          </strong>
        )}
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${GRADE_CLASS[confidenceGrade]}`}
          title={`데이터 신뢰도 ${Math.round(confidence * 100)}%`}
        >
          {confidenceGrade}
        </span>
      </span>
      {score === null && reasons[0] && (
        <span
          className="block max-w-[190px] truncate text-[10px] text-[var(--color-muted)]"
          title={detail}
        >
          {reasons[0]}
        </span>
      )}
    </span>
  );
}
