import type { ValueLabel } from "@/lib/types";

// 점수 0(고평가·빨강) → 100(저평가·초록) HSL 그라데이션
function scoreColor(score: number): string {
  const hue = Math.round(score * 1.2); // 0=red, 120=green
  return `hsl(${hue} 70% 45%)`;
}

export function ScoreBadge({
  score,
  label,
  confidence,
}: {
  score: number | null;
  label: ValueLabel;
  confidence: number;
}) {
  if (score === null) {
    return (
      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs text-[var(--color-muted)] bg-[var(--color-panel-2)]">
        판단보류
      </span>
    );
  }
  const lowConf = confidence < 0.4;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center justify-center rounded-md px-2 py-0.5 text-sm font-bold text-white tabular-nums"
        style={{ backgroundColor: scoreColor(score) }}
        title={`${label} · 신뢰도 ${Math.round(confidence * 100)}%`}
      >
        {score}
      </span>
      {lowConf && (
        <span
          className="text-amber-400 text-xs"
          title={`신뢰도 낮음 (${Math.round(confidence * 100)}%) — 데이터 부족/약신호`}
        >
          ⚠
        </span>
      )}
    </span>
  );
}
