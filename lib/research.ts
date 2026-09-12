import type { CoinScored } from "./types";
import { psMultiple, revenueAmount, type RevenueWindowDays } from "./revenueHistory";
import { flowLabel } from "./signals";

export const PS_REFERENCE = 20;
export function researchPs(coin: CoinScored, days: RevenueWindowDays = 30): number | null {
  if (coin.identityStatus !== "verified") return null;
  return psMultiple(coin.mcap, revenueAmount(coin, days), days);
}
export function revenueGrowing(coin: CoinScored): boolean {
  return coin.identityStatus === "verified" && ["growing", "from_zero"].includes(coin.opportunities.revenue.state);
}
export function holderTransitionReasons(coin: CoinScored): string[] {
  return [
    { name: "홀더 금액", flow: coin.opportunities.eligibleHolder },
    { name: "조건부 보상", flow: coin.opportunities.conditionalHolder },
  ].filter(({ flow }) => flow.state === "from_zero" || flow.state === "to_zero")
    .map(({ name, flow }) => `${name} ${flowLabel(flow)}`);
}
export function researchReasons(coin: CoinScored, reference = PS_REFERENCE): string[] {
  if (coin.identityStatus !== "verified") return ["토큰 연결 확인 필요"];
  const ps = researchPs(coin);
  const reasons: string[] = [];
  if (ps !== null && ps <= reference) reasons.push(`P/S ${reference}배 이하`);
  if (revenueGrowing(coin)) reasons.push(coin.opportunities.revenue.state === "from_zero" ? "매출 0 → 양수" : `매출 +${coin.opportunities.revenue.changePct!.toFixed(1)}%`);
  if (coin.opportunities.holder) reasons.push("홀더 환원 관측");
  return reasons;
}
