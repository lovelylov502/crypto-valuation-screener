import type { EconomicDecision, EconomicMetric, EconomicPolicyIdentity } from "./economicTypes";
/** Economic meaning travels with every amount. Unknown definitions never become sales. */
export const FUNDAMENTAL_VERSION = "fundamental-definitions-v1";
export const RULE_VERSION = "research-v10-source-revenue-recovery";
export type RevenueKind = "protocol_revenue" | "service_sales" | "holder_return" | "trading_pnl" | "mixed" | "unknown";
export type FeeKind = "user_fees" | "asset_yield" | "holder_return" | "mixed" | "unknown";
export interface DefinitionComponent {
  decision?: EconomicDecision;
  slug: string;
  definition: string | null;
  kind: RevenueKind | FeeKind;
  reviewedAt: string | null;
  reviewNote?: string;
  source: string;
  status: "matched" | "changed" | "unreviewed" | "missing";
}
export interface MetricDefinition<K extends string = RevenueKind> {
  physicalFingerprint?: string;
  legacyPhysicalFingerprint?: string;
  kind: K;
  fingerprint: string;
  components: DefinitionComponent[];
}
export interface Fundamentals {
  economicPolicy?: EconomicPolicyIdentity;
  economicAsOf?: string;
  version: typeof FUNDAMENTAL_VERSION;
  fingerprint: string;
  revenue: MetricDefinition<RevenueKind>;
  fees: MetricDefinition<FeeKind>;
  holders: DefinitionComponent[];
  holderShareReviewed: boolean;
}
export const REVENUE_LABELS: Record<RevenueKind, string> = {
  protocol_revenue: "프로토콜 귀속 수익",
  service_sales: "서비스 매출",
  holder_return: "홀더 환원 집계액",
  trading_pnl: "추정 거래손익",
  mixed: "서로 다른 성격의 합계",
  unknown: "집계 정의 미확인",
};
export const FEE_LABELS: Record<FeeKind, string> = {
  user_fees: "사용자 수수료",
  asset_yield: "자산 운용수익",
  holder_return: "홀더 환원 집계액",
  mixed: "복합 원천 집계액",
  unknown: "수수료 정의 미확인",
};
type HasFundamentals = { fundamentals?: Fundamentals | null };
export function revenueKind(coin: HasFundamentals): RevenueKind {
  return coin.fundamentals?.revenue.kind ?? "unknown";
}
export function revenueLabel(coin: HasFundamentals): string {
  return REVENUE_LABELS[revenueKind(coin)];
}
export function multipleLabel(coin: HasFundamentals): string {
  return ({ protocol_revenue: "시총/프로토콜 수익", service_sales: "시총/서비스 매출", holder_return: "시총/홀더 환원", trading_pnl: "시총/추정 손익", mixed: "배수 비교 보류", unknown: "배수 비교 보류" })[revenueKind(coin)];
}
export function businessRevenue(coin: HasFundamentals): boolean {
  return !metricDecisionHeld(coin,"Revenue") && ["protocol_revenue", "service_sales"].includes(revenueKind(coin));
}
export function businessFees(coin: HasFundamentals): boolean {
  return !metricDecisionHeld(coin,"Fees") && coin.fundamentals?.fees.kind === "user_fees";
}
export function knownRevenue(coin: HasFundamentals): boolean {
  return !metricDecisionHeld(coin,"Revenue") && ["protocol_revenue", "service_sales", "holder_return", "trading_pnl"].includes(revenueKind(coin));
}
/** Legacy captures retain the original global hold; scoped captures use their resolved metric decision. */
export function metricDecisionHeld(coin: HasFundamentals, metric: EconomicMetric): boolean {
  const f=coin.fundamentals;
  if(!f?.economicPolicy)return sourceDefinitionsChanged(coin);
  const components=metric==="Revenue"?f.revenue.components:metric==="Fees"?f.fees.components:f.holders;
  return components.some(c=>!c.decision||["pending","evidence-unavailable"].includes(c.decision.disposition));
}
export function metricDecisionIssue(coin: HasFundamentals, metric: EconomicMetric): string | null {
  if(!metricDecisionHeld(coin,metric))return null;
  const f=coin.fundamentals;
  if(!f?.economicPolicy)return "원천 정의 변경 · 재검토 필요";
  const components=metric==="Revenue"?f.revenue.components:metric==="Fees"?f.fees.components:f.holders;
  return [...new Set(components.filter(c=>c.decision&&["pending","evidence-unavailable"].includes(c.decision.disposition)).map(c=>c.decision!.reason))].join(" · ")||"지표 검토 증거 미확인";
}
export function metricPeriodsComparable(coin:HasFundamentals,metric:EconomicMetric,current:{start:string;end:string}|undefined,previous:{start:string;end:string}|undefined):boolean {
  if(!coin.fundamentals?.economicPolicy)return true;
  if(metricDecisionHeld(coin,metric))return false;
  const f=coin.fundamentals,parts=metric==="Revenue"?f.revenue.components:metric==="Fees"?f.fees.components:f.holders;
  return parts.every(p=>{
    const boundary=p.decision?.comparabilityBoundary?.at;if(!boundary)return true;
    if(!current||!previous)return false;
    const era=(w:{start:string;end:string})=>w.end<boundary?"before":w.start>=boundary?"after":"mixed";
    return era(current)!=="mixed"&&era(current)===era(previous);
  });
}
export function metricTemporalLabel(coin:HasFundamentals,metric:EconomicMetric,period:{start:string;end:string}|undefined):string|null {
  const f=coin.fundamentals;if(!f?.economicPolicy||!period)return null;
  const parts=metric==="Revenue"?f.revenue.components:metric==="Fees"?f.fees.components:f.holders;
  return [...new Set(parts.flatMap(p=>{const b=p.decision?.comparabilityBoundary;return !b?[]:[period.end<b.at?b.before:period.start>=b.at?b.after:`${b.before} / ${b.after} · ${b.at} 수령 범위 변경 포함`];}))].join(" · ")||null;
}
export function metricComparisonAllowed(coin:HasFundamentals&{revenueHistory?:{periods:Record<number,{start:string;end:string}>;previous?:Record<number,{start:string;end:string}>;previous30:{start:string;end:string}}|null},metric:EconomicMetric,days=30):boolean {
  if(!coin.fundamentals?.economicPolicy)return true;
  const asOf=Date.parse(coin.fundamentals.economicAsOf??"");
  const end=Math.floor(asOf/86400_000)*86400_000-86400_000;
  const window=(offset:number)=>({start:new Date(end-(offset+days-1)*86400_000).toISOString().slice(0,10),end:new Date(end-offset*86400_000).toISOString().slice(0,10)});
  if(!Number.isFinite(end))return false;
  return metricPeriodsComparable(coin,metric,metric==="Revenue"?coin.revenueHistory?.periods[days]:window(0),metric==="Revenue"?(coin.revenueHistory?.previous?.[days]??(days===30?coin.revenueHistory?.previous30:undefined)):window(days));
}
export function sourceDefinitionsChanged(coin: HasFundamentals): boolean {
  const f = coin.fundamentals;
  return !!f && [...f.revenue.components, ...f.fees.components, ...f.holders].some(c => c.status === "changed");
}
export function feeLabel(coin: HasFundamentals): string {
  return FEE_LABELS[coin.fundamentals?.fees.kind ?? "unknown"];
}
export function definitionIssue(coin: HasFundamentals): string | null {
  if(coin.fundamentals?.economicPolicy) {
    const issues=(["Revenue","Fees","HoldersRevenue"] as const).map(m=>metricDecisionIssue(coin,m)).filter(Boolean);
    if(issues.length)return [...new Set(issues)].join(" · ");
    return knownRevenue(coin)?null:`${revenueLabel(coin)} · 배수·수익 성장 비교 보류`;
  }
  if (sourceDefinitionsChanged(coin)) return "원천 집계 정의 변경 · 배수·성장 신호·점수 보류";
  if (!knownRevenue(coin)) return `${revenueLabel(coin)} · 배수·수익 성장 비교 보류`;
  return null;
}
export const KIND_ORDER: RevenueKind[] = ["protocol_revenue", "service_sales", "holder_return", "trading_pnl", "mixed", "unknown"];
