export type SortKey =
  | "price"
  | "change1d"
  | "ps7d"
  | "ps90d"
  | "ps1y"
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
  | "ps"
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
  valuation: "가치 비교 · 기존 점수",
  fundamentals: "매출 · 홀더 환원",
  market: "가격 · 시총 · 공급",
  performance: "가격 변화",
};

export const SCREENER_COLUMNS: ScreenerColumn[] = [
  { key: "signals", label: "포착 신호", title: "실적 개선 · 현재 홀더 배분 · 관측 흐름 전환. 여러 신호가 함께 나타날 수 있습니다", group: "valuation" },
  { key: "revenueGrowth", label: "매출 변화", title: "동일 구성요소 최근 30일 / 직전 30일 변화", group: "fundamentals" },
  { key: "holderGrowth", label: "홀더 변화", title: "적격 홀더 금액 최근 30일 / 직전 30일 변화. 0과 누락을 구분", group: "fundamentals" },
  { key: "valueScore", label: "실험 점수", title: "홀더 귀속 중심의 실험적 점수. 신호 포함 여부와 독립적이며 미래 수익률 확률이 아닙니다", group: "valuation" },
  { key: "scoreAxes", label: "4축", title: "가치 30 · 개선 25 · 미발견 25 · 품질 20", group: "valuation" },
  { key: "confidence", label: "자료 완성도", title: "필드 확보율 A/B/C. 성공 확률이나 근거 신뢰도가 아닙니다", group: "valuation" },
  { key: "gateStatus", label: "게이트", title: "정체성·시세·이력·유동성·희석·상장기간·활동성 필수 조건", group: "valuation" },
  { key: "phr", label: "P/HR", title: "시총 / 적격 최근 30일 holder value 연환산 (낮을수록 쌈)", group: "valuation" },
  { key: "holderValueRunRate", label: "현재 홀더가치/년", title: "P/HR 적격 최근 30일 holder value × 365/30. DefiLlama-derived 분류", group: "fundamentals" },
  { key: "holderValueTtm", label: "원천 HR TTM", title: "DefiLlama raw trailing 1년 holder revenue. P/HR 제외 유형 포함", group: "fundamentals" },
  { key: "mcap", label: "시총", title: "유통 시가총액", group: "market" },
  { key: "totalVolume", label: "거래량 24h", title: "CoinMarketCap 24시간 거래량", group: "market" },
  { key: "priceChange7d", label: "7일", title: "CoinMarketCap 7일 가격 변화율", group: "performance" },
  { key: "priceChange30d", label: "30일", title: "CoinMarketCap 30일 가격 변화율", group: "performance" },
  { key: "priceChange60d", label: "60일", title: "CoinMarketCap 60일 가격 변화율 — 가격 미발견 축 핵심", group: "performance" },
  { key: "priceChange1y", label: "1년", title: "CoinGecko 1년 가격 변화율", group: "performance" },
  { key: "athChangePercentage", label: "ATH 대비", title: "현재가의 사상 최고가 대비 변화율", group: "performance" },
  { key: "atlChangePercentage", label: "ATL 대비", title: "현재가의 사상 최저가 대비 변화율", group: "performance" },
  { key: "category", label: "섹터", title: "카테고리", group: "market" },
  { key: "captureScore", label: "포획", title: "최근 30일 적격 경제유형만 반영한 일반 홀더 가치포획 점수", group: "valuation" },
  { key: "ps", label: "P/S · 30일", title: "현재 시총 / (최근 30일 매출 × 365/30). 완료된 UTC 날짜 기준. 20배는 참고선이며 종목을 제외하지 않습니다", group: "valuation" },
  { key: "revenueAnnual", label: "매출 TTM/연환산", title: "전체 구성요소 TTM 우선, 불완전하면 전체 최근 30일 연환산. P/S에는 최근 30일만 사용", group: "fundamentals" },
  { key: "revenue30d", label: "매출 30일", title: "최근 30일 매출 (원값)", group: "fundamentals" },
  { key: "fdv", label: "FDV", title: "완전희석가치 (CoinMarketCap 우선)", group: "market" },
  { key: "tvl", label: "TVL", title: "예치자산", group: "market" },
  { key: "priceChange14d", label: "14일", title: "CoinGecko 14일 가격 변화율", group: "performance" },
  { key: "feesChange7d", label: "수수료 변화", title: "최근 7일 vs 직전 7일 수수료 변화 (30일 변화 보조 표시)", group: "fundamentals" },
  { key: "price", label: "가격", title: "현재 토큰 가격 · USD", group: "market" },
  { key: "change1d", label: "가격 24시간", title: "토큰 가격의 24시간 변화. 포착 조건에는 반영하지 않습니다", group: "performance" },
  { key: "ps1y", label: "P/S · 1년", title: "현재 시총 / 최근 365일 실제 매출 합계. 1년 미만의 이력은 연환산하지 않습니다", group: "valuation" },
  { key: "ps90d", label: "P/S · 90일", title: "현재 시총 / (최근 90일 매출 × 365/90)", group: "valuation" },
  { key: "ps7d", label: "P/S · 7일", title: "현재 시총 / (최근 7일 매출 × 365/7). 일시적인 매출에 민감합니다", group: "valuation" },
  { key: "revenue7d", label: "매출 7일", title: "최근 7일 실제 매출. 누락은 0으로 채우지 않습니다", group: "fundamentals" },
  { key: "revenue90d", label: "매출 90일", title: "최근 90일 실제 매출 합계", group: "fundamentals" },
  { key: "revenue1y", label: "매출 1년", title: "최근 365일 실제 매출 합계 · 연환산 아님", group: "fundamentals" },
  { key: "holderRoute", label: "환원 방식", title: "공식 문서 확인 경로 우선. 미확인 종목은 원천 설명의 자동 분류를 구분해 표시", group: "fundamentals" },
  { key: "payoutAsset", label: "지급 자산", title: "보유자가 받는 자산 또는 소각 대상. 금액만으로 추정하지 않습니다", group: "fundamentals" },
  { key: "holderCondition", label: "수령 대상", title: "일반 보유자·스테이커·락업·투표자 등 공식 확인 대상", group: "fundamentals" },
];

export const DEFAULT_VISIBLE_COLUMNS: SortKey[] = [
  "ps",
  "revenue30d",
  "mcap",
  "fdv",
  "price",
];

export const COLUMN_PRESETS: { label: string; keys: SortKey[] }[] = [
  { label: "종목 훑기", keys: DEFAULT_VISIBLE_COLUMNS },
  { label: "P/S · 매출 추이", keys: ["ps1y", "ps90d", "ps", "ps7d", "revenue30d", "mcap", "fdv", "price"] },
  { label: "홀더 환원", keys: ["holderRoute", "payoutAsset", "holderCondition", "holderValueRunRate", "phr", "mcap", "fdv", "price"] },
  {
    label: "가격 · 공급",
    keys: ["price", "mcap", "fdv", "change1d", "priceChange7d", "priceChange30d", "totalVolume"],
  },
  {
    label: "점수 근거",
    keys: ["valueScore", "scoreAxes", "confidence", "gateStatus", "captureScore", "phr", "ps", "holderValueRunRate", "holderValueTtm", "revenueAnnual", "mcap"],
  },
];
