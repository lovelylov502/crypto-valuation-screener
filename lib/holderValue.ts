import {classifyHolderMethodology,holderMethodology} from "./holderMethodology";
export {classifyHolderMethodology} from "./holderMethodology";
import registry from "./fundamentalDefinitions.legacy-b519.json";
import { definitionReviewed } from "./fundamentalSource";
import { economicDecision } from "./economicDecisionSource";
import type { EconomicDecision } from "./economicTypes";

export type HolderEconomicType =
  | "direct_distribution"
  | "market_buyback"
  | "buyback_and_burn"
  | "native_fee_burn"
  | "ve_voter_locker_distribution"
  | "mixed_holder_return"
  | "unclear_other";

export type HolderValueAvailability =
  | "eligible"
  | "mixed"
  | "excluded"
  | "stale"
  | "none";

export interface HolderMethodologyClassification {
  economicType: HolderEconomicType;
  eligible: boolean;
  reason: string;
}

export interface HolderValueComponent extends HolderMethodologyClassification {
  decision?: EconomicDecision;
  slug: string;
  name: string;
  current30d: number | null;
  previous30d: number | null;
  ttm: number | null;
  condition?: string;
}

export interface HolderValueSummary {
  sourceStatus: "defillama-derived";
  availability: HolderValueAvailability;
  eligibleCurrent30d: number | null;
  eligiblePrevious30d: number | null;
  eligibleRunRate: number | null;
  eligibleTtm: number | null;
  currentVsEligibleTtmRatio: number | null;
  rawCurrent30d: number | null;
  rawPrevious30d: number | null;
  rawTtm: number | null;
  excludedCurrent30d: number | null;
  excludedTtm: number | null;
  excludedDoublecountedCount: number;
  phrUnavailableReason: string | null;
  warning: string | null;
  components: HolderValueComponent[];
}

export {holderEconomicTypeLabel} from "./holderLabels";

export function holderCondition(methodology: unknown, type: HolderEconomicType): string {
  const definition = holderMethodology(methodology) ?? "";
  if (type === "unclear_other") return "수령 조건 미확인";
  if (type === "ve_voter_locker_distribution") return "락업·투표 조건";
  if (/\bstak|\bxORCA\b/i.test(definition)) return "스테이킹 조건";
  if (type === "native_fee_burn" || type === "buyback_and_burn") return "토큰 소각 · 현금 지급 없음";
  if (type === "market_buyback") return "시장매입 · 직접 지급 여부 별도 확인";
  return "원천에 명시된 홀더 · 상세 조건 확인";
}

type Json = Record<string, unknown>;

interface HolderAccumulator {
  components: HolderValueComponent[];
  rawCurrent: number;
  rawPrevious: number;
  rawTtm: number;
  rawCurrentObserved: boolean;
  rawPreviousObserved: boolean;
  eligibleCurrent: number;
  eligiblePrevious: number;
  eligibleTtm: number;
  eligibleCurrentObserved: boolean;
  eligiblePreviousObserved: boolean;
  excludedCurrent: number;
  excludedTtm: number;
  excludedCurrentObserved: boolean;
  excludedDoublecountedCount: number;
}

const amount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

function createAccumulator(): HolderAccumulator {
  return {
    components: [],
    rawCurrent: 0,
    rawPrevious: 0,
    rawTtm: 0,
    rawCurrentObserved: false,
    rawPreviousObserved: false,
    eligibleCurrent: 0,
    eligiblePrevious: 0,
    eligibleTtm: 0,
    eligibleCurrentObserved: false,
    eligiblePreviousObserved: false,
    excludedCurrent: 0,
    excludedTtm: 0,
    excludedCurrentObserved: false,
    excludedDoublecountedCount: 0,
  };
}

export function emptyHolderValueSummary(): HolderValueSummary {
  return {
    sourceStatus: "defillama-derived",
    availability: "none",
    eligibleCurrent30d: null,
    eligiblePrevious30d: null,
    eligibleRunRate: null,
    eligibleTtm: null,
    currentVsEligibleTtmRatio: null,
    rawCurrent30d: null,
    rawPrevious30d: null,
    rawTtm: null,
    excludedCurrent30d: null,
    excludedTtm: null,
    excludedDoublecountedCount: 0,
    phrUnavailableReason: "최근 30일 적격 holder value 없음",
    warning: null,
    components: [],
  };
}

function finalize(accumulator: HolderAccumulator): HolderValueSummary {
  const eligible = accumulator.components.filter(component => component.eligible);
  const excluded = accumulator.components.filter(component => !component.eligible);
  const currentComplete = eligible.length > 0 && eligible.every(c => c.current30d !== null);
  const previousComplete = eligible.length > 0 && eligible.every(c => c.previous30d !== null);
  const eligibleCurrent30d = accumulator.eligibleCurrentObserved && currentComplete
    ? accumulator.eligibleCurrent
    : null;
  const eligiblePrevious30d = accumulator.eligiblePreviousObserved && previousComplete
    ? accumulator.eligiblePrevious
    : null;
  const eligibleRunRate =
    eligibleCurrent30d !== null && eligibleCurrent30d > 0
      ? (eligibleCurrent30d * 365) / 30
      : null;
  const rawCurrent30d = accumulator.rawCurrentObserved && accumulator.components.every(c => c.current30d !== null)
    ? accumulator.rawCurrent
    : null;
  const rawPrevious30d = accumulator.rawPreviousObserved && accumulator.components.every(c => c.previous30d !== null)
    ? accumulator.rawPrevious
    : null;
  const rawTtm = accumulator.components.length > 0 && accumulator.components.every(c => c.ttm !== null) ? accumulator.rawTtm : null;
  const excludedCurrent30d = accumulator.excludedCurrentObserved && excluded.every(c => c.current30d !== null)
    ? accumulator.excludedCurrent
    : null;
  const excludedTtm = excluded.length > 0 && excluded.every(c => c.ttm !== null) ? accumulator.excludedTtm : null;
  const eligibleTtm = eligible.length > 0 && eligible.every(c => c.ttm !== null) ? accumulator.eligibleTtm : null;
  // No dated 365-day holder series is available. Never treat total1y as confirmed TTM.
  const currentVsEligibleTtmRatio = null;

  let availability: HolderValueAvailability = "none";
  let warning: string | null = null;
  let phrUnavailableReason: string | null = "최근 30일 적격 holder value 없음";

  if (eligibleRunRate !== null) {
    const hasExcluded =
      (excludedCurrent30d ?? 0) > 0 || (excludedTtm ?? 0) > 0;
    availability = hasExcluded ? "mixed" : "eligible";
    phrUnavailableReason = null;
    if (hasExcluded) {
      warning = "확인된 환원 구성만 포함 · 일부 원천 금액은 수령 대상·재원 확인 필요";
    }
  } else if (accumulator.eligibleTtm > 0) {
    availability = "stale";
    warning = "최근 30일 적격 흐름이 0/누락됐지만 원천 1년 집계는 양수 · 중단·불연속 가능";
    phrUnavailableReason = "최근 30일 적격 holder value가 0/누락";
  } else if ((rawCurrent30d ?? 0) > 0 || (rawTtm ?? 0) > 0) {
    availability = "excluded";
    warning = "원천 환원 집계는 있으나 수령 대상·재원 확인 필요";
    phrUnavailableReason = "환원 방식 확인 필요";
  }

  if (eligible.length > 0 && (!currentComplete || !previousComplete)) {
    warning = [warning, "적격 구성요소 일부의 30일 이력 누락 · 전체 성장률 비교 보류"].filter(Boolean).join(" · ");
    if (!currentComplete) phrUnavailableReason = "적격 구성요소의 최근 30일 금액 일부 누락";
  }

  return {
    sourceStatus: "defillama-derived",
    availability,
    eligibleCurrent30d,
    eligiblePrevious30d,
    eligibleRunRate,
    eligibleTtm,
    currentVsEligibleTtmRatio,
    rawCurrent30d,
    rawPrevious30d,
    rawTtm,
    excludedCurrent30d,
    excludedTtm,
    excludedDoublecountedCount: accumulator.excludedDoublecountedCount,
    phrUnavailableReason,
    warning,
    components: accumulator.components,
  };
}

/** Parent별 component를 보존하면서 적격/제외 합계를 분리한다. */
export function aggregateHolderValueByGroup(
  rows: Json[],
  groupKey: (slug: string) => string,
  reviewed: (row: Json) => boolean = () => true,
): Map<string, HolderValueSummary> {
  const accumulators = new Map<string, HolderAccumulator>();
  const getAccumulator = (key: string) => {
    const existing = accumulators.get(key);
    if (existing) return existing;
    const created = createAccumulator();
    accumulators.set(key, created);
    return created;
  };

  for (const row of rows) {
    const slug = text(row.slug);
    if (!slug) continue;
    const key = groupKey(slug);
    const accumulator = getAccumulator(key);
    if (row.doublecounted === true) {
      accumulator.excludedDoublecountedCount += 1;
      continue;
    }

    const current30d = amount(row.total30d);
    const previous30d = amount(row.total60dto30d);
    const ttm = amount(row.total1y);
    const matched = reviewed(row);
    const exactReview = matched && definitionReviewed(row);
    const decision=economicDecision(row,"HoldersRevenue");
    const review = (registry as Record<string, { holderType?: HolderEconomicType; holderReason?: string; holderCondition?: string }>)[slug];
    // Overrides are bound to the exact reviewed provider methodology, never to a ticker alone.
    const classification: HolderMethodologyClassification = decision
      ? {economicType:decision.holderType??"unclear_other",eligible:decision.holderEligible===true&&decision.disposition==="approved",reason:decision.holderReason??decision.reason}
      : !matched
      ? { economicType: "unclear_other", eligible: false, reason: "원천 집계 정의 신규·변경 · 재검토 필요" }
      : exactReview && review?.holderType
        ? { economicType: review.holderType, eligible: review.holderType !== "unclear_other", reason: review.holderReason ?? "원천 환원 방식 검토" }
        : classifyHolderMethodology(row.methodology);
    const component: HolderValueComponent = {
      slug,
      name: text(row.name) ?? slug,
      ...classification,
      current30d,
      previous30d,
      ttm,
      condition: exactReview && review?.holderCondition ? review.holderCondition : holderCondition(row.methodology, classification.economicType),
      ...(decision?{decision}:{}),
    };
    accumulator.components.push(component);

    if (current30d !== null) {
      accumulator.rawCurrentObserved = true;
      accumulator.rawCurrent += current30d;
    }
    if (previous30d !== null) {
      accumulator.rawPreviousObserved = true;
      accumulator.rawPrevious += previous30d;
    }
    accumulator.rawTtm += ttm ?? 0;

    if (classification.eligible) {
      if (current30d !== null) {
        accumulator.eligibleCurrentObserved = true;
        accumulator.eligibleCurrent += current30d;
      }
      if (previous30d !== null) {
        accumulator.eligiblePreviousObserved = true;
        accumulator.eligiblePrevious += previous30d;
      }
      accumulator.eligibleTtm += ttm ?? 0;
    } else {
      if (current30d !== null) {
        accumulator.excludedCurrentObserved = true;
        accumulator.excludedCurrent += current30d;
      }
      accumulator.excludedTtm += ttm ?? 0;
    }
  }

  return new Map(
    [...accumulators.entries()].map(([key, accumulator]) => [
      key,
      finalize(accumulator),
    ]),
  );
}
