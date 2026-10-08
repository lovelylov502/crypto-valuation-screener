import type { HolderEconomicType } from "./holderValue";

const HOLDER_ECONOMIC_TYPE_LABELS: Record<HolderEconomicType, string> = {
  direct_distribution: "직접 분배",
  market_buyback: "시장매입",
  buyback_and_burn: "매입+소각",
  native_fee_burn: "수수료 소각",
  ve_voter_locker_distribution: "ve/투표자",
  mixed_holder_return: "복수 환원 방식",
  unclear_other: "불명확",
};

export function holderEconomicTypeLabel(type: HolderEconomicType): string {
  return HOLDER_ECONOMIC_TYPE_LABELS[type];
}
