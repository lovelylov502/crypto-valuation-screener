import type { CoinScored } from "@/lib/types";
import { holderEconomicTypeLabel } from "@/lib/holderLabels";

export { coinUrl } from "@/lib/coinLinks";
export { sortValue } from "@/lib/screenerSort";

export function holderTypeSummary(c: CoinScored, eligibleOnly = false): string {
  const labels = [
    ...new Set(
      c.holderValue.components
        .filter(
          (component) =>
            (!eligibleOnly || component.eligible) && ((component.current30d ?? 0) > 0 || (component.ttm ?? 0) > 0),
        )
        .map((component) => holderEconomicTypeLabel(component.economicType)),
    ),
  ];
  if (labels.length === 0) return "유형 없음";
  if (labels.length <= 2) return labels.join("+");
  return `${labels.slice(0, 2).join("+")} 외 ${labels.length - 2}`;
}


export function holderConditionSummary(c: CoinScored): string {
  return [...new Set(c.holderValue.components.filter(p=>p.eligible).map(p=>p.condition).filter(Boolean))].join(" · ") || "수령 조건 미확인";
}
