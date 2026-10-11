/** A compact label beside an unavailable number; the complete reason stays accessible. */
export function metricStatus(reason: string): string {
  if (reason.includes("비적용")) return "비적용";
  if (reason.includes("토큰 연결")) return "연결 확인";
  if (reason.includes("FDV") || reason.includes("시총")) return "시총 미확인";
  if (reason.includes("0 이하")) return "0 이하";
  if (reason.includes("원천 미연결")) return "미연결";
  if (reason.includes("이력 부족") || reason.includes("일별") || reason.includes("자료 없음") || reason.includes("원천 금액 없음")) return "자료 부족";
  if (reason.includes("일부 구성요소 집계")) return "부분 집계";
  if (reason.includes("환원으로 분류")) return "환원 자료";
  return "검토 필요";
}
