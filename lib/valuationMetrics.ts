import { eligibleCapital } from "./capitalEligibility";
import type { CoinRaw } from "./types";
import { revenueAmount, historyMatches, annualizedMultiple, type RevenueWindowDays } from "./revenueHistory";
import { sourceDefinitionsChanged, revenueKind } from "./fundamentals";

export type CapitalBasis = "mcap" | "fdv";
export interface SalesEvidence {
  id: string;
  geckoId: string;
  symbol: string;
  amountUsd: number;
  basis: "annualized_estimate" | "reported_ttm";
  asOf: string;
  reviewedAt: string;
  validUntil: string;
  publisher: string;
  url: string;
  scope: string;
  limitation: string;
  status: "current" | "expired" | "identity_mismatch";
}

/** No automatic conversion of DefiLlama Revenue, fees, burns or customer deposits into company sales. */
export function salesMultiple(c: CoinRaw, basis: CapitalBasis = "mcap"): number | null {
  const s = c.sales;
  if (!s || s.status !== "current" || !eligibleCapital(c) || s.geckoId !== c.geckoId || s.symbol !== c.symbol) return null;
  return annualizedMultiple(c[basis], s.amountUsd, 365);
}

export function salesReason(c: CoinRaw): string {
  if (c.capitalExclusionReason) return "스테이블코인 · 배수 비적용";
  if (!eligibleCapital(c)) return "토큰 연결 확인 필요";
  if (!c.sales) return "사업 매출 자료 없음";
  if (c.sales.status === "expired") return "매출 추정 기준일 경과 · 재검토 필요";
  if (c.sales.status !== "current") return "매출과 토큰 연결 불일치";
  return c.sales.basis === "annualized_estimate" ? `사업 매출 추정 · ${c.sales.asOf}` : `1년 보고 매출 · ${c.sales.asOf}`;
}

export function protocolMultiple(c: CoinRaw, days: RevenueWindowDays = 30, basis: CapitalBasis = "mcap"): number | null {
  if (!eligibleCapital(c) || sourceDefinitionsChanged(c) || revenueKind(c) !== "protocol_revenue" || !historyMatches(c)) return null;
  return annualizedMultiple(c[basis], revenueAmount(c, days), days);
}

export function protocolReason(c: CoinRaw, days: RevenueWindowDays): string {
  if (c.capitalExclusionReason) return "스테이블코인 · 배수 비적용";
  if (c.identityStatus !== "verified") return "토큰 연결 확인 필요";
  if (sourceDefinitionsChanged(c)) return "원천 정의 변경 · 재검토 필요";
  if (revenueKind(c) === "holder_return") return "환원으로 분류";
  if (revenueKind(c) !== "protocol_revenue") return "프로토콜 수익 근거 부족";
  if (!historyMatches(c)) return "수익 이력 정의 불일치";
  const p = c.revenueHistory?.periods[days];
  if (p?.total === null) return `이력 부족 ${p.reportedDays}/${days}일`;
  if (revenueAmount(c,days) === null) return "기간별 수익 자료 없음";
  return "수익 0 이하 또는 토큰 가치 없음";
}

// Canonical signature shared by the independently fetched holder history and current component set.
export function holderScope(c: Pick<CoinRaw, "fundamentals" | "holderValue">): string {
  const eligible = new Set(c.holderValue.components.filter(p => p.eligible).map(p => p.slug));
  return JSON.stringify(c.fundamentals.holders.filter(p => eligible.has(p.slug)).map(p => [p.slug, p.definition, p.status, c.holderValue.components.find(h => h.slug === p.slug)?.name, c.holderValue.components.find(h => h.slug === p.slug)?.economicType]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));
}
export function holderHistoryMatches(c: CoinRaw): boolean {
  return !!c.holderHistory && c.holderHistory.definitionFingerprint === holderScope(c);
}
export function holderAmount(c: CoinRaw, days: RevenueWindowDays): number | null {
  if (sourceDefinitionsChanged(c) || !holderHistoryMatches(c)) return null;
  return c.holderHistory!.periods[days].total;
}
export function holderMultiple(c: CoinRaw, days: RevenueWindowDays = 30, basis: CapitalBasis = "mcap"): number | null {
  if (!eligibleCapital(c)) return null;
  return annualizedMultiple(c[basis], holderAmount(c, days), days);
}
export function datedHolderValue(c: CoinRaw): CoinRaw["holderValue"] {
  const current = holderAmount(c, 30);
  const previous = !sourceDefinitionsChanged(c) && holderHistoryMatches(c) ? c.holderHistory!.previous30.total : null;
  const yearly = holderAmount(c, 365);
  return { ...c.holderValue, eligibleCurrent30d: current, eligiblePrevious30d: previous,
    eligibleRunRate: current !== null && current > 0 ? current * 365 / 30 : null,
    eligibleTtm: yearly, currentVsEligibleTtmRatio: current !== null && current > 0 && yearly !== null && yearly > 0 ? current * 365 / 30 / yearly : null };
}
export function holderReason(c: CoinRaw, days: RevenueWindowDays): string {
  if (c.capitalExclusionReason) return "스테이블코인 · 배수 비적용";
  if (!eligibleCapital(c)) return "토큰 연결 확인 필요";
  if (sourceDefinitionsChanged(c)) return "원천 정의 변경 · 재검토 필요";
  if (!c.holderValue.components.some(p => p.eligible)) return c.holderValue.phrUnavailableReason ?? "적격 환원 자료 없음";
  if (!c.holderHistory) return "일별 환원 이력 없음";
  if (!holderHistoryMatches(c)) return "환원 이력 정의 불일치";
  const p = c.holderHistory.periods[days];
  if (p.total === null) return `이력 부족 ${p.reportedDays}/${days}일`;
  if (p.total <= 0) return "환원액 0 이하";
  return `${days === 365 ? "365일 합계" : `${days}일 연환산`} · ${p.end} UTC까지`;
}
