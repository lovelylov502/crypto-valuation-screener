export type SortKey =
  | "psSales"
  | "pr"
  | "pr7d"
  | "pr90d"
  | "pr1y"
  | "phr7d"
  | "phr90d"
  | "phr1y"
  | "price"
  | "change1d"
  | "multiple7d"
  | "multiple90d"
  | "multiple1y"
  | "revenue7d"
  | "revenue90d"
  | "revenue1y"
  | "holderRoute"
  | "payoutAsset"
  | "holderCondition"
  | "signals"
  | "revenueGrowth"
  | "holderGrowth"
  | "valueScore"
  | "scoreAxes"
  | "confidence"
  | "gateStatus"
  | "captureScore"
  | "name"
  | "category"
  | "revenueMultiple"
  | "phr"
  | "revenueAnnual"
  | "holderValueRunRate"
  | "holderValueTtm"
  | "revenue30d"
  | "mcap"
  | "totalVolume"
  | "fdv"
  | "tvl"
  | "priceChange7d"
  | "priceChange14d"
  | "priceChange30d"
  | "priceChange60d"
  | "priceChange1y"
  | "athChangePercentage"
  | "atlChangePercentage"
  | "feesChange7d";

export type ColumnGroup =
  | "valuation"
  | "fundamentals"
  | "market"
  | "performance";

export interface ScreenerColumn {
  key: SortKey;
  label: string;
  title: string;
  group: ColumnGroup;
}

export const COLUMN_GROUP_LABELS: Record<ColumnGroup, string> = {
  valuation: "배수 · 비교 지표",
  fundamentals: "집계액 · 홀더 환원",
  market: "가격 · 시총 · 공급",
  performance: "가격 변화",
};

export const SCREENER_COLUMNS: ScreenerColumn[] = [
  { key: "psSales", label: "P/S · 사업 매출", title: "토큰 시총 또는 FDV ÷ 별도로 확인한 연간 사업 매출. 추정치는 기준일과 출처를 표시하며 소각액·수수료를 매출로 대체하지 않습니다", group: "valuation" },
  { key: "pr1y", label: "P/R · 1년", title: "현재 토큰 가치 ÷ 프로토콜 귀속 수익 365일 합계. 이력이 부족하면 보류", group: "valuation" },
  { key: "pr90d", label: "P/R · 90일", title: "현재 토큰 가치 ÷ (프로토콜 귀속 수익 90일 × 365/90)", group: "valuation" },
  { key: "pr", label: "P/R · 30일", title: "현재 토큰 가치 ÷ (프로토콜 귀속 수익 30일 × 365/30). 회사 전체 매출·순이익과 다릅니다", group: "valuation" },
  { key: "pr7d", label: "P/R · 7일", title: "현재 토큰 가치 ÷ (프로토콜 귀속 수익 7일 × 365/7)", group: "valuation" },
  { key: "phr1y", label: "P/HR · 1년", title: "현재 토큰 가치 ÷ 적격 환원액 365일 합계. 정확히 365일의 이력이 필요합니다", group: "valuation" },
  { key: "phr90d", label: "P/HR · 90일", title: "현재 토큰 가치 ÷ (적격 환원액 90일 × 365/90)", group: "valuation" },
  { key: "phr", label: "P/HR · 30일", title: "현재 토큰 가치 ÷ (적격 최근 30일 환원액 × 365/30). 현금 분배·시장매입과 소각을 구분하며 낮은 배수만으로 저평가를 판단하지 않습니다", group: "valuation" },
  { key: "phr7d", label: "P/HR · 7일", title: "현재 토큰 가치 ÷ (적격 환원액 7일 × 365/7). 일회성 매입에 민감합니다", group: "valuation" },
  { key: "signals", label: "포착 신호", title: "실적 개선 · 현재 홀더 배분 · 관측 흐름 전환. 여러 신호가 함께 나타날 수 있습니다", group: "valuation" },
  { key: "revenueGrowth", label: "집계액 변화", title: "동일 구성요소 최근 30일 / 직전 30일 변화", group: "fundamentals" },
  { key: "holderGrowth", label: "홀더 변화", title: "적격 홀더 금액 최근 30일 / 직전 30일 변화. 0과 누락을 구분", group: "fundamentals" },
  { key: "valueScore", label: "실험 점수", title: "홀더 귀속 중심의 실험적 점수. 신호 포함 여부와 독립적이며 미래 수익률 확률이 아닙니다", group: "valuation" },
  { key: "scoreAxes", label: "4축", title: "가치 30 · 개선 25 · 미발견 25 · 품질 20", group: "valuation" },
  { key: "confidence", label: "자료 완성도", title: "필드 확보율 A/B/C. 성공 확률이나 근거 신뢰도가 아닙니다", group: "valuation" },
  { key: "gateStatus", label: "게이트", title: "정체성·시세·이력·유동성·희석·상장기간·활동성 필수 조건", group: "valuation" },
  { key: "holderValueRunRate", label: "현재 홀더가치/년", title: "P/HR 적격 최근 30일 holder value × 365/30. DefiLlama-derived 분류", group: "fundamentals" },
  { key: "holderValueTtm", label: "홀더 원천 1년", title: "DefiLlama total1y. 365일 확보 여부 미확인 · P/HR 제외 유형 포함", group: "fundamentals" },
  { key: "mcap", label: "시총", title: "유통 시가총액", group: "market" },
  { key: "totalVolume", label: "거래량 24h", title: "CoinMarketCap 24시간 거래량", group: "market" },
  { key: "priceChange7d", label: "7일", title: "CoinMarketCap 7일 가격 변화율", group: "performance" },
  { key: "priceChange30d", label: "30일", title: "CoinMarketCap 30일 가격 변화율", group: "performance" },
  { key: "priceChange60d", label: "60일", title: "CoinMarketCap 60일 가격 변화율 — 가격 미발견 축 핵심", group: "performance" },
  { key: "priceChange1y", label: "1년", title: "CoinGecko 1년 가격 변화율", group: "performance" },
  { key: "athChangePercentage", label: "ATH 대비", title: "현재가의 사상 최고가 대비 변화율", group: "performance" },
  { key: "atlChangePercentage", label: "ATL 대비", title: "현재가의 사상 최저가 대비 변화율", group: "performance" },
  { key: "category", label: "섹터", title: "카테고리", group: "market" },
  { key: "captureScore", label: "포획", title: "최근 30일 확인된 환원 방식에 대한 실험 점수. 소각·조건부 분배를 포함하며 현금 배당 점수가 아닙니다", group: "valuation" },
  { key: "revenueAnnual", label: "원천 30일 연환산", title: "원천 최근 30일 × 365/30. 실제 1년 합계나 미래 예측을 뜻하지 않습니다", group: "fundamentals" },
  { key: "revenue30d", label: "집계액 30일", title: "최근 30일 집계액 (원값)", group: "fundamentals" },
  { key: "fdv", label: "FDV", title: "완전희석가치 (CoinMarketCap 우선)", group: "market" },
  { key: "tvl", label: "TVL", title: "예치자산", group: "market" },
  { key: "priceChange14d", label: "14일", title: "CoinGecko 14일 가격 변화율", group: "performance" },
  { key: "feesChange7d", label: "수수료 변화", title: "최근 7일 vs 직전 7일 수수료 변화 (30일 변화 보조 표시)", group: "fundamentals" },
  { key: "price", label: "가격", title: "현재 토큰 가격 · USD", group: "market" },
  { key: "change1d", label: "가격 24시간", title: "토큰 가격의 24시간 변화. 포착 조건에는 반영하지 않습니다", group: "performance" },
  { key: "revenue7d", label: "집계액 7일", title: "최근 7일 원천 집계액. 누락은 0으로 채우지 않습니다", group: "fundamentals" },
  { key: "revenue90d", label: "집계액 90일", title: "최근 90일 원천 집계액 합계", group: "fundamentals" },
  { key: "revenue1y", label: "집계액 1년", title: "최근 365일 원천 집계액 합계 · 연환산 아님", group: "fundamentals" },
  { key: "holderRoute", label: "환원 방식", title: "공식 문서 확인 경로 우선. 미확인 종목은 원천 설명의 자동 분류를 구분해 표시", group: "fundamentals" },
  { key: "payoutAsset", label: "지급 자산", title: "보유자가 받는 자산 또는 소각 대상. 금액만으로 추정하지 않습니다", group: "fundamentals" },
  { key: "holderCondition", label: "수령 대상", title: "일반 보유자·스테이커·락업·투표자 등 공식 확인 대상", group: "fundamentals" },
];

export const DEFAULT_VISIBLE_COLUMNS: SortKey[] = [
  "price",
  "mcap",
  "psSales",
  "pr",
  "phr90d",
  "phr",
];
