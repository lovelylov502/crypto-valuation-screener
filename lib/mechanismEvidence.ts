/** Reviewed references supplement the automated classification; they never overwrite amounts. */
export const MECHANISM_EVIDENCE: Record<
  string,
  {
    reviewedAt: string;
    title: string;
    url: string;
    route: string;
    condition: string;
  }
> = {
  "parent#pendle": {
    reviewedAt: "2026-09-08",
    title: "Pendle · sPENDLE 배분 조건",
    url: "https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/sPENDLE",
    route: "프로토콜 수수료 → 시장매입 → 활성 sPENDLE 보유자 배분",
    condition:
      "거버넌스 참여 조건과 언스테이킹 대기·즉시 출금 비용을 확인해야 합니다. 매입과 후속 배분은 같은 자금 흐름입니다.",
  },
  "parent#hyperliquid": {
    reviewedAt: "2026-09-08",
    title: "Hyperliquid · 거래 수수료",
    url: "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees",
    route: "Assistance Fund 귀속 수수료 → HYPE 자동 매입·소각",
    condition:
      "모든 거래 수수료가 같은 경로로 귀속되지는 않습니다. HLP·배포자 등 다른 수익자를 포함한 전체 금액과 구분합니다.",
  },
};
