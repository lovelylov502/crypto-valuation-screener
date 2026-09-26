/** Economic meaning travels with every amount. Unknown definitions never become sales. */
export const FUNDAMENTAL_VERSION = "fundamental-definitions-v1";
export const RULE_VERSION = "research-v9-full-universe-and-24h";
export type RevenueKind = "protocol_revenue" | "service_sales" | "holder_return" | "trading_pnl" | "mixed" | "unknown";
export type FeeKind = "user_fees" | "asset_yield" | "holder_return" | "mixed" | "unknown";
export interface DefinitionComponent {
  slug: string;
  definition: string | null;
  kind: RevenueKind | FeeKind;
  reviewedAt: string | null;
  reviewNote?: string;
  source: string;
  status: "matched" | "changed" | "unreviewed" | "missing";
}
export interface MetricDefinition<K extends string = RevenueKind> {
  kind: K;
  fingerprint: string;
  components: DefinitionComponent[];
}
export interface Fundamentals {
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
  return !sourceDefinitionsChanged(coin) && ["protocol_revenue", "service_sales"].includes(revenueKind(coin));
}
export function businessFees(coin: HasFundamentals): boolean {
  return !sourceDefinitionsChanged(coin) && coin.fundamentals?.fees.kind === "user_fees";
}
export function knownRevenue(coin: HasFundamentals): boolean {
  return !sourceDefinitionsChanged(coin) && ["protocol_revenue", "service_sales", "holder_return", "trading_pnl"].includes(revenueKind(coin));
}
export function sourceDefinitionsChanged(coin: HasFundamentals): boolean {
  const f = coin.fundamentals;
  return !!f && [...f.revenue.components, ...f.fees.components, ...f.holders].some(c => c.status === "changed");
}
export function feeLabel(coin: HasFundamentals): string {
  return FEE_LABELS[coin.fundamentals?.fees.kind ?? "unknown"];
}
export function definitionIssue(coin: HasFundamentals): string | null {
  if (sourceDefinitionsChanged(coin)) return "원천 집계 정의 변경 · 배수·성장 신호·점수 보류";
  if (!knownRevenue(coin)) return `${revenueLabel(coin)} · 배수·수익 성장 비교 보류`;
  return null;
}
export const KIND_ORDER: RevenueKind[] = ["protocol_revenue", "service_sales", "holder_return", "trading_pnl", "mixed", "unknown"];
