export type HolderEconomicType =
  | "direct_distribution"
  | "market_buyback"
  | "buyback_and_burn"
  | "native_fee_burn"
  | "ve_voter_locker_distribution"
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
  slug: string;
  name: string;
  current30d: number | null;
  previous30d: number | null;
  ttm: number | null;
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

const HOLDER_ECONOMIC_TYPE_LABELS: Record<HolderEconomicType, string> = {
  direct_distribution: "직접 분배",
  market_buyback: "시장매입",
  buyback_and_burn: "매입+소각",
  native_fee_burn: "수수료 소각",
  ve_voter_locker_distribution: "ve/투표자",
  unclear_other: "불명확",
};

export function holderEconomicTypeLabel(type: HolderEconomicType): string {
  return HOLDER_ECONOMIC_TYPE_LABELS[type];
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
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

function holderMethodology(methodology: unknown): string | null {
  if (!methodology || typeof methodology !== "object" || Array.isArray(methodology)) {
    return null;
  }
  return text((methodology as Json).HoldersRevenue);
}

/**
 * DefiLlama의 짧은 HoldersRevenue 설명만으로 보수적으로 경제유형을 나눈다.
 * 이 결과는 공식 검증이나 온체인 검증이 아니라 `defillama-derived` 분류다.
 */
export function classifyHolderMethodology(
  methodology: unknown,
): HolderMethodologyClassification {
  const original = holderMethodology(methodology);
  if (!original) {
    return {
      economicType: "unclear_other",
      eligible: false,
      reason: "HoldersRevenue 방법론 없음",
    };
  }

  const normalized = original.toLowerCase().replace(/[–—]/g, "-");
  const vagueGovernanceBoilerplate =
    /^(?:money|amount|revenue|fees?)\s+(?:going|go(?:es)?)\s+to\s+(?:governance\s+)?token\s+holders?\.?$/i;
  if (vagueGovernanceBoilerplate.test(original.trim())) {
    return {
      economicType: "unclear_other",
      eligible: false,
      reason: "귀속 방식이 명시되지 않은 거버넌스 홀더 문구",
    };
  }

  const negativeHolderValue =
    /\bno\s+holders?\s+revenue\b/.test(normalized) ||
    /\bno\s+(?:revenue(?:\s+share)?|fees?)\s+(?:is\s+)?(?:share(?:d)?|distributed|paid|allocated)?\s*(?:to|with|for)\s+[^.]{0,60}\b(?:holders?|stakers?)\b/.test(
      normalized,
    ) ||
    /\b(?:holders?|stakers?)\b[^.]{0,40}\b(?:have|receive|get)\s+no\s+(?:revenue|fees?|share|rewards?)\b/.test(
      normalized,
    ) ||
    /\b0(?:\.0+)?%\b[^.]{0,80}\b(?:go(?:es|ing)?|paid|distributed|allocated)\s+to\s+[^.]{0,60}\b(?:holders?|stakers?)\b/.test(
      normalized,
    ) ||
    /\bstopped\s+(?:receiving|getting|earning)\b[^.]{0,80}\b(?:fees?|revenue|rewards?)\b/.test(
      normalized,
    ) ||
    /\bno\s+part\b[^.]{0,100}\b(?:going|goes|distributed|paid)\s+to\s+[^.]{0,60}\b(?:holders?|stakers?)\b/.test(
      normalized,
    ) ||
    /\b(?:(?:protocol|fee)\s+)?(?:fees?|revenue|rewards?)\b[^.;]{0,30}\b(?:(?:is|are|was|were)\s+not|(?:isn|aren|wasn|weren)['’]t)\s+(?:distributed|paid|allocated|shared)\s+(?:out\s+)?(?:to|with|among)\s+[^.;]{0,60}\b(?:holders?|stakers?)\b/.test(
      normalized,
    ) ||
    /\b(?:holders?|stakers?)\b[^.;]{0,50}\b(?:(?:do|does|did)\s+not|(?:don|doesn|didn)['’]t|no\s+longer)\s+(?:receive|get|earn)\b/.test(
      normalized,
    ) ||
    /\b(?:holders?|stakers?)\b[^.;]{0,50}\b(?:(?:is|are|was|were)\s+(?:not|no\s+longer)|(?:isn|aren|wasn|weren)['’]t)\s+(?:paid|allocated|rewarded)\b/.test(
      normalized,
    ) ||
    /\bno\s+(?:(?:protocol|fee)\s+)?(?:fees?|revenue|rewards?)\b[^.;]{0,30}\b(?:go(?:es|ing)?|(?:is|are|was|were)\s+going)\s+to\b[^.;]{0,60}\b(?:holders?|stakers?)\b/.test(
      normalized,
    ) ||
    /\b(?:(?:protocol|fee)\s+)?(?:fees?|revenue|rewards?)\b[^.;]{0,30}\b(?:(?:(?:do|does|did)\s+not|(?:don|doesn|didn)['’]t)\s+go|no\s+longer\s+go(?:es|ing)?)\s+to\b[^.;]{0,60}\b(?:holders?|stakers?)\b/.test(
      normalized,
    ) ||
    /\b(?:(?:(?:fee|revenue)\s+)?(?:distributions?|payments?)|(?:fee|revenue)\s+sharing)\b[^.;]{0,80}\b(?:holders?|stakers?)\b[^.;]{0,40}\b(?:(?:has|have|had|is|are|was|were)\s+(?:now\s+)?(?:been\s+)?)?(?:ended|ceased|stopped|suspended|disabled)\b/.test(
      normalized,
    ) ||
    /\b(?:holder|staker)\s+(?:distributions?|payments?|revenue\s+sharing)\b[^.;]{0,40}\b(?:(?:has|have|had|is|are|was|were)\s+(?:now\s+)?(?:been\s+)?)?(?:ended|ceased|stopped|suspended|disabled)\b/.test(
      normalized,
    ) ||
    /\bstopp(?:ed|ing)\s+(?:paying|distributing|sharing|allocating)\b[^.;]{0,80}\b(?:holders?|stakers?)\b/.test(
      normalized,
    );
  if (negativeHolderValue) {
    return {
      economicType: "unclear_other",
      eligible: false,
      reason: "홀더 수익 부재·중단 문구",
    };
  }

  const restrictedBeneficiary =
    /\bve[A-Z0-9][A-Za-z0-9]*\b/.test(original) ||
    /\bvote[-\s]?escrow(?:ed)?\b|\b(?:vote|voted|voters?|voting)\b|\bbribes?\b|\blockers?\b|\bgauges?\b/.test(
      normalized,
    );
  if (restrictedBeneficiary) {
    return {
      economicType: "ve_voter_locker_distribution",
      eligible: false,
      reason: "ve·voter·locker 한정 귀속",
    };
  }

  const buyback =
    /\bbuy(?:\s|-)?backs?\b|\bbuys\s+back\b|\bbought\s+back\b|\bby\s+back\b|\bbuying\b[^.]{0,100}\btokens?\b|\b(?:buy|buying)\b[^.]{0,80}\b(?:on|from|in)\s+the\s+(?:open\s+)?market\b|\brepurchas(?:e|es|ed|ing)\b|\bbuy\s*(?:&|and)\s*burn\b/.test(
      normalized,
    );
  const burn = /\bburn(?:s|ed|ing|t)?\b/.test(normalized);
  const negatedBurn =
    /\b(?:not|never)\s+(?:be\s+|being\s+)?burn(?:s|ed|ing|t)?\b|\bno\s+burn(?:s|ed|ing)?\b/.test(
      normalized,
    );
  const buybackAndBurn =
    /\bbuy(?:\s|-)?backs?(?:[-\s]+and[-\s]+|\s*&\s*)burn(?:s|ed|ing|t)?\b|\bbuy\s*(?:&|and)\s*burn\b|\bbuy(?:\s|-)?back\b[^.;]{0,60}\band\s+burn(?:s|ed|ing|t)?\b|\bbought\s+back\s+and\s+burn(?:s|ed|ing|t)?\b|\b(?:bought|acquired)\b[^.;]{0,100}\b(?:is|are)\s+(?:permanently\s+)?burn(?:s|ed|ing|t)?\b|\bbuybacks?(?:\s+bot)?\b[^\n]{0,160}\b\d+(?:\.\d+)?%\s+(?:of\s+[^.;]{0,50}\s+)?(?:is\s+|are\s+|goes?\s+to\s+)?burn(?:s|ed|ing|t)?\b|\bbuybacks?\b[^.;]{0,120}\bburn\s+address\b|\b(?:buy(?:\s|-)?back|buys\s+back)\b[^\n]{0,160}\b(?:rest|remainder)\b[^.;]{0,40}\bburn(?:s|ed|ing|t)?\b|\bbuyback\b[^.;]{0,160}\b(?:converted|swapped)\b[^.;]{0,100}\bburn(?:s|ed|ing|t)?\b|\brepurchas(?:e|es|ed|ing)\b[^.;]{0,60}\b(?:then\s+|subsequently\s+)?burn(?:s|ed|ing|t)?\b/.test(
      normalized,
    );
  const nonHolderRecipient =
    /\b(?:distribut(?:e|es|ed)|paid|allocated|sent|go(?:es|ing)?)\s+(?:directly\s+)?(?:to|among)\s+(?:the\s+)?(?:protocol\s+)?(?:treasur(?:y|ies)|foundations?|teams?|developers?|contributors?)\b|\b(?:holders?|stakers?)\b[^.]{0,40}\b(?:and|plus)\s+(?:the\s+)?(?:protocol\s+)?(?:treasur(?:y|ies)|foundations?|teams?|developers?|contributors?)\b|\b(?:distribut(?:e|es|ed)|paid|allocated|sent|go(?:es|ing)?)\b[^.]{0,220}\b(?:liquidity\s+(?:providers?|pools?)|referrers?|traders?|raffle|jackpot|players?)\b|\b(?:holders?|stakers?)\b[^.]{0,220}\b(?:liquidity\s+(?:providers?|pools?)|referrers?|traders?|raffle|jackpot|players?)\b|\b(?:lp|liquidity)\s+stakers?\b|\badd(?:ed|ing)?\s+(?:to\s+)?liquidity\b|\bprotocol[-\s]?owned\s+liquidity\b|\bpol\b|\bbuy\s*(?:&|and)\s*lock\b/.test(
      normalized,
    );
  const unprovenMixedHolderAllocation =
    buyback &&
    /\b\d+(?:\.\d+)?%\s+to\s+[^,.;]{0,40}\bholders?\b/.test(normalized);
  const chainSpecificMixedMechanisms =
    buyback &&
    burn &&
    /\bstaking\s+(?:pool|rewards?)\b/.test(normalized) &&
    /\bon\s+(?:some|other)\s+chains?\b|\bon\s+others?\b/.test(normalized);
  if (
    nonHolderRecipient ||
    unprovenMixedHolderAllocation ||
    chainSpecificMixedMechanisms
  ) {
    return {
      economicType: "unclear_other",
      eligible: false,
      reason: "일반 홀더 외 수익자·용도와 혼합된 구성",
    };
  }

  const incidentalBurn =
    /\bsourc(?:e|ed|ing)\s+from\b[^.;]{0,80}\bburn(?:s|ed|ing|t)?\b/.test(
      normalized,
    );
  if (buyback && burn && !negatedBurn && !buybackAndBurn && !incidentalBurn) {
    return {
      economicType: "unclear_other",
      eligible: false,
      reason: "매입과 소각 금액의 관계 불명확",
    };
  }

  if (buyback && burn && !negatedBurn && buybackAndBurn) {
    return {
      economicType: "buyback_and_burn",
      eligible: true,
      reason: "명시적 시장매입 후 소각",
    };
  }
  if (buyback) {
    return {
      economicType: "market_buyback",
      eligible: true,
      reason: "명시적 토큰 시장매입",
    };
  }
  if (burn && !negatedBurn) {
    return {
      economicType: "native_fee_burn",
      eligible: false,
      reason: "시장매입 없는 수수료·네이티브 토큰 소각",
    };
  }

  const ordinaryDistribution =
    /\b(?:distribut(?:e|es|ed|ion)|paid(?:\s+out)?|payout|reward(?:s|ed)?|allocated)\b[^.]{0,100}\b(?:holders?|stakers?)\b|\b(?:holders?|stakers?)\b[^.]{0,100}\b(?:distribut(?:e|es|ed)|paid|payout|reward(?:s|ed)?|receiv(?:e|es|ed|ing)|earn(?:s|ed|ing)?)\b|\b(?:revenue|fees?|share)\b[^.]{0,100}\bgo(?:es|ing)?\s+to\b[^.]{0,60}\bstakers?\b|\bpaid\s+out\s+to\s+(?:people|users?|participants?)\s+who\s+stake\b/.test(
      normalized,
    );
  if (ordinaryDistribution) {
    return {
      economicType: "direct_distribution",
      eligible: true,
      reason: "일반 홀더·스테이커 직접 분배",
    };
  }

  return {
    economicType: "unclear_other",
    eligible: false,
    reason: "경제적 귀속 방식 불명확",
  };
}

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

function positiveOrNull(value: number): number | null {
  return value > 0 ? value : null;
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
  const eligibleCurrent30d = accumulator.eligibleCurrentObserved
    ? accumulator.eligibleCurrent
    : null;
  const eligiblePrevious30d = accumulator.eligiblePreviousObserved
    ? accumulator.eligiblePrevious
    : null;
  const eligibleRunRate =
    eligibleCurrent30d !== null && eligibleCurrent30d > 0
      ? (eligibleCurrent30d * 365) / 30
      : null;
  const rawCurrent30d = accumulator.rawCurrentObserved
    ? accumulator.rawCurrent
    : null;
  const rawPrevious30d = accumulator.rawPreviousObserved
    ? accumulator.rawPrevious
    : null;
  const rawTtm = positiveOrNull(accumulator.rawTtm);
  const excludedCurrent30d = accumulator.excludedCurrentObserved
    ? accumulator.excludedCurrent
    : null;
  const excludedTtm = positiveOrNull(accumulator.excludedTtm);
  const eligibleTtm = positiveOrNull(accumulator.eligibleTtm);
  const currentVsEligibleTtmRatio =
    eligibleRunRate !== null && eligibleTtm !== null
      ? eligibleRunRate / eligibleTtm
      : null;

  let availability: HolderValueAvailability = "none";
  let warning: string | null = null;
  let phrUnavailableReason: string | null = "최근 30일 적격 holder value 없음";

  if (eligibleRunRate !== null) {
    const hasExcluded =
      (excludedCurrent30d ?? 0) > 0 || (excludedTtm ?? 0) > 0;
    availability = hasExcluded ? "mixed" : "eligible";
    phrUnavailableReason = null;
    if (hasExcluded) {
      warning = "일부 DefiLlama holder revenue는 일반 홀더 P/HR에서 제외";
    }
  } else if (accumulator.eligibleTtm > 0) {
    availability = "stale";
    warning = "최근 30일 적격 흐름이 0/누락됐지만 TTM은 양수 — 중단·불연속 가능";
    phrUnavailableReason = "최근 30일 적격 holder value가 0/누락";
  } else if ((rawCurrent30d ?? 0) > 0 || (rawTtm ?? 0) > 0) {
    availability = "excluded";
    warning = "DefiLlama holder revenue가 일반 홀더 P/HR 제외 유형";
    phrUnavailableReason = "일반 홀더 P/HR 제외 경제유형";
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
    if (
      (current30d ?? 0) <= 0 &&
      (previous30d ?? 0) <= 0 &&
      (ttm ?? 0) <= 0
    ) {
      continue;
    }

    const classification = classifyHolderMethodology(row.methodology);
    const component: HolderValueComponent = {
      slug,
      name: text(row.name) ?? slug,
      ...classification,
      current30d,
      previous30d,
      ttm: positiveOrNull(ttm ?? 0),
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
