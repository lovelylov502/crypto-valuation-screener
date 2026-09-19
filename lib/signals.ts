import type { CoinRaw, ScoreGates } from "./types";
import { revenueAmount, historyMatches } from "./revenueHistory";
import { businessRevenue, businessFees, revenueLabel, feeLabel, definitionIssue, sourceDefinitionsChanged } from "./fundamentals";

export type FlowState =
  "growing" | "declining" | "flat" | "from_zero" | "to_zero" | "unknown";
export interface FlowComparison {
  state: FlowState;
  changePct: number | null;
}
export type OpportunityTrack = "business" | "holder" | "transition";
export interface OpportunitySignals {
  business: boolean;
  holder: boolean;
  transition: boolean;
  revenue: FlowComparison;
  fees: FlowComparison;
  eligibleHolder: FlowComparison;
  conditionalHolder: FlowComparison;
  conditionalCurrent30d: number | null;
  dataIssues: string[];
  risks: string[];
  marketAhead: boolean;
  reasons: string[];
}

/** Zero is an observation; null is missing. Neither becomes an infinite growth rate. */
export function compareFlow(
  current: number | null,
  previous: number | null,
): FlowComparison {
  if (
    current === null ||
    previous === null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    current < 0 ||
    previous < 0
  ) {
    return { state: "unknown", changePct: null };
  }
  if (previous === 0)
    return {
      state: current > 0 ? "from_zero" : "flat",
      changePct: current === 0 ? 0 : null,
    };
  const changePct = (current / previous - 1) * 100;
  return {
    state:
      current === 0
        ? "to_zero"
        : current > previous
          ? "growing"
          : current < previous
            ? "declining"
            : "flat",
    changePct,
  };
}

export function flowLabel(flow: FlowComparison): string {
  if (flow.state === "from_zero") return "0 → 양수";
  if (flow.state === "unknown") return "비교 불가";
  if (flow.state === "to_zero") return "양수 → 0";
  if (flow.changePct === null) return "비교 불가";
  return `${flow.changePct > 0 ? "+" : ""}${flow.changePct.toFixed(1)}%`;
}

export function deriveOpportunities(
  coin: CoinRaw,
  gates: ScoreGates,
): OpportunitySignals {
  const revenue = historyMatches(coin) ? compareFlow(revenueAmount(coin, 30), coin.revenueHistory ? coin.revenueHistory.previous30.total : coin.revenuePrev30d) : compareFlow(null, null);
  const fees = compareFlow(coin.fees30d, coin.feesPrev30d);
  const eligibleHolder = compareFlow(
    coin.holderValue.eligibleCurrent30d,
    coin.holderValue.eligiblePrevious30d,
  );
  const conditional = coin.holderValue.components.filter(
    (c) => c.economicType === "ve_voter_locker_distribution",
  );
  const sum = (key: "current30d" | "previous30d") =>
    conditional.length > 0 && conditional.every((c) => c[key] !== null)
      ? conditional.reduce((s, c) => s + c[key]!, 0)
      : null;
  const conditionalCurrent30d = sum("current30d");
  const conditionalHolder = compareFlow(
    conditionalCurrent30d,
    sum("previous30d"),
  );
  const improving = (f: FlowComparison) =>
    f.state === "growing" || f.state === "from_zero";
  // Discovery signals are observations, independent of experimental score and investment-risk gates.
  // Identity still fails closed: uncertain token joins cannot become an opportunity.
  const verified = coin.identityStatus === "verified" && !sourceDefinitionsChanged(coin);
  const business = verified && ((businessRevenue(coin) && improving(revenue)) || (businessFees(coin) && improving(fees)));
  const holder =
    verified &&
    ((coin.holderValue.eligibleCurrent30d ?? 0) > 0 ||
      (conditionalCurrent30d ?? 0) > 0);
  const transition =
    verified &&
    [eligibleHolder, conditionalHolder].some(
      (f) => f.state === "from_zero" || f.state === "to_zero",
    );
  const dataIssues: string[] = [];
  const issue = definitionIssue(coin);
  if (issue) dataIssues.push(issue);
  if (!historyMatches(coin)) dataIssues.push("일별 이력과 현재 집계 정의 불일치 · 배수·변화 비교 보류");
  const risks: string[] = [];
  if (coin.identityStatus !== "verified") dataIssues.push(coin.identityReason);
  if (!gates.marketData)
    dataIssues.push("시세·60일 가격·거래량 누락 또는 지연");
  if ([revenue, fees, eligibleHolder].every(f => f.state === "unknown"))
    dataIssues.push("실적 비교 자료 부족 · 누락 또는 음수 금액 확인");
  const currentRevenue = revenueAmount(coin, 30);
  const previousRevenue = coin.revenueHistory ? coin.revenueHistory.previous30.total : coin.revenuePrev30d;
  if (currentRevenue !== null && previousRevenue === null)
    dataIssues.push("직전 30일 집계액 누락");
  if (currentRevenue === null)
    dataIssues.push("최근 30일 집계액 누락");
  if (coin.revenueHistory && coin.revenueHistory.periods[365].reportedDays < 365)
    dataIssues.push(`1년 집계 이력 ${coin.revenueHistory.periods[365].reportedDays}/365일`);
  if (coin.holderValue.warning?.includes("이력 누락"))
    dataIssues.push("홀더 구성요소 일부 이력 누락");
  if (coin.fdv === null) dataIssues.push("FDV 미확인");
  if (coin.listedAt === null) dataIssues.push("상장일 미확인");
  if (coin.totalVolume !== null && !gates.liquidity) risks.push("낮은 유동성");
  if (coin.fdv !== null && !gates.dilution) risks.push("높은 희석 비율");
  if (coin.listedAt !== null && !gates.matureProject)
    risks.push("상장 90일 미만");
  if (!gates.activity) risks.push("낮은 최근 활동");
  const reasons: string[] = [];
  if (businessRevenue(coin) && improving(revenue)) reasons.push(`${revenueLabel(coin)} ${flowLabel(revenue)}`);
  if (businessFees(coin) && improving(fees)) reasons.push(`${feeLabel(coin)} ${flowLabel(fees)}`);
  if ((coin.holderValue.eligibleCurrent30d ?? 0) > 0)
    reasons.push(`홀더 흐름 ${flowLabel(eligibleHolder)}`);
  if ((conditionalCurrent30d ?? 0) > 0) reasons.push("락업·투표 조건부 배분");
  if (transition) reasons.push("관측 흐름 전환 · 정책 변경 여부 확인 필요");
  return {
    business,
    holder,
    transition,
    revenue,
    fees,
    eligibleHolder,
    conditionalHolder,
    conditionalCurrent30d,
    dataIssues,
    risks,
    reasons: verified
      ? reasons
      : [sourceDefinitionsChanged(coin) ? "원천 정의 변경 · 재검토 필요" : "토큰 매칭 미확인 · 금액의 귀속 대상을 먼저 확인해 주세요"],
    marketAhead:
      (coin.priceChange30d ?? 0) > 20 || (coin.priceChange60d ?? 0) > 30,
  };
}
