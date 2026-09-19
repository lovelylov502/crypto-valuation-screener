import type { CoinRaw, CoinScored } from "./types";
import { annualizedMultiple, revenueAmount, historyMatches, type RevenueWindowDays } from "./revenueHistory";
import { flowLabel } from "./signals";
import { businessRevenue, knownRevenue, revenueLabel, multipleLabel } from "./fundamentals";

export const MULTIPLE_REFERENCE = 20;
export function researchMultiple(coin: CoinRaw, days: RevenueWindowDays = 30): number | null {
  if (coin.identityStatus !== "verified" || !knownRevenue(coin) || !historyMatches(coin)) return null;
  return annualizedMultiple(coin.mcap, revenueAmount(coin, days), days);
}
export function revenueGrowing(coin: CoinScored): boolean {
  return coin.identityStatus === "verified" && businessRevenue(coin) && historyMatches(coin) && ["growing", "from_zero"].includes(coin.opportunities.revenue.state);
}
export function holderTransitionReasons(coin: CoinScored): string[] {
  return [
    { name: "홀더 금액", flow: coin.opportunities.eligibleHolder },
    { name: "조건부 보상", flow: coin.opportunities.conditionalHolder },
  ].filter(({ flow }) => flow.state === "from_zero" || flow.state === "to_zero")
    .map(({ name, flow }) => `${name} ${flowLabel(flow)}`);
}
export function researchReasons(coin: CoinScored, reference: number | null = null): string[] {
  if (coin.identityStatus !== "verified") return ["토큰 연결 확인 필요"];
  const revenueMultiple = researchMultiple(coin);
  const reasons: string[] = [];
  if (reference !== null && revenueMultiple !== null && revenueMultiple <= reference) reasons.push(`${multipleLabel(coin)} ${reference}배 이하`);
  if (revenueGrowing(coin)) reasons.push(coin.opportunities.revenue.state === "from_zero" ? `${revenueLabel(coin)} 0 → 양수` : `${revenueLabel(coin)} +${coin.opportunities.revenue.changePct!.toFixed(1)}%`);
  if (!knownRevenue(coin)) reasons.push("집계 정의 확인 필요");
  if (coin.opportunities.holder) reasons.push("홀더 환원 관측");
  return reasons;
}
