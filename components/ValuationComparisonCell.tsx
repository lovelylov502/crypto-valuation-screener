import { fmtMult } from "@/lib/format";
import { comparisonGeometry, type ComparisonReading, type ComparisonUnavailableReason } from "@/lib/valuationComparison";

const unavailable: Record<ComparisonUnavailableReason, string> = {
  not_collected: "비교 기준일의 일별 이력 없음", missing_capital: "최근 날짜의 시총·FDV 없음", missing_revenue: "최근 날짜의 하루 수익 없음",
  non_positive_revenue: "최근 하루 수익이 0 이하", definition_changed: "수익 집계 기준 확인 필요",
  stale_data: "최근 UTC 완료일보다 2일 이상 오래된 자료",
  not_prepared: "최신 일별 비교 요약 준비 중",
};

export function ValuationComparisonCell({ reading, label, capitalLabel }: { reading: ComparisonReading; label: string; capitalLabel: string }) {
  if (reading.status !== "ready") {
    const title = reading.status === "insufficient" ? "1년 비교 자료 부족" : reading.status === "loading" ? "과거 비교 불러오는 중" : reading.status === "unconnected" ? "과거 비교 연결 준비 중" : reading.status === "invalid" ? "비교 자료 확인 필요" : "산출 불가";
    const latest = reading.status === "insufficient" ? reading.latest : undefined;
    const description = reading.status === "insufficient" && latest ? `${label} · ${latest.date} UTC · 최근 ${fmtMult(latest.value)} · 1년 비교 자료 부족 · 배수 계산 가능 ${reading.validDays}일 / 365일` : undefined;
    return <span className={`history-comparison comparison-${reading.status}`} title={description}>
      {latest && <span className="comparison-latest">최근 <strong>{fmtMult(latest.value)}</strong></span>}
      <strong>{title}</strong>
      {reading.status === "insufficient" ? <><span>배수 계산 가능: {reading.validDays}일 / 365일</span><small>해당일 {capitalLabel}·수익으로 계산할 수 있는 날짜</small></>
        : <small>{reading.status === "loading" ? `${capitalLabel} 기준으로 바꾸고 있습니다.` : reading.status === "unconnected" ? "날짜별 배수 요약을 기다립니다." : reading.status === "invalid" ? "계산 기준이 맞는지 확인이 필요합니다." : reading.reason === "missing_capital" ? `최근 날짜의 ${capitalLabel} 없음` : unavailable[reading.reason]}</small>}
    </span>;
  }
  const g = comparisonGeometry(reading.minimum, reading.median, reading.maximum, reading.latest.value);
  const description = `${label} · ${reading.latest.date} UTC · 최근 ${fmtMult(reading.latest.value)} · 이전 365일 최저 ${fmtMult(reading.minimum)}, 중앙값 ${fmtMult(reading.median)}, 최고 ${fmtMult(reading.maximum)} · 배수 계산 가능 ${reading.validDays}일 / 365일`;
  return <span className={`history-comparison comparison-${g.tone}`} title={description}>
    <span className="comparison-latest">최근 <strong>{fmtMult(reading.latest.value)}</strong><small>{g.outside === "below" ? "과거 최저 미만" : g.outside === "above" ? "과거 최고 초과" : reading.validDays < 365 ? `${reading.validDays}/365일` : ""}</small></span>
    <span className="comparison-rail" role="img" aria-label={description}>
      <span className="comparison-segment" style={{ left: `${g.left}%`, width: `${g.width}%` }}/>
      <span className="comparison-median" style={{ left: `${g.medianPosition}%` }}/>
    </span>
    <span className="comparison-labels"><span>최저 <b>{fmtMult(reading.minimum)}</b></span><span>중앙값 <b>{fmtMult(reading.median)}</b></span><span>최고 <b>{fmtMult(reading.maximum)}</b></span></span>
  </span>;
}
