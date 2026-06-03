// $1.23B 식 축약
export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

// 멀티플 (12.3x)
export function fmtMult(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}Kx`;
  if (v >= 100) return `${v.toFixed(0)}x`;
  if (v >= 10) return `${v.toFixed(1)}x`;
  return `${v.toFixed(2)}x`;
}

// 퍼센트 (+12.3%)
export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
}
