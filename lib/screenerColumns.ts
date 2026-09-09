export type SortKey =
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
  valuation: "밸류에이션",
  fundamentals: "펀더멘털",
  market: "시장",
  performance: "가격 성과",
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
  { key: "ps", label: "P/S", title: "시총 / (최근 30일 매출 × 365/30). P/HR과 동일 기간", group: "valuation" },
  { key: "revenueAnnual", label: "매출 TTM/연환산", title: "전체 구성요소 TTM 우선, 불완전하면 전체 최근 30일 연환산. P/S에는 최근 30일만 사용", group: "fundamentals" },
  { key: "revenue30d", label: "매출 30일", title: "최근 30일 매출 (원값)", group: "fundamentals" },
  { key: "fdv", label: "FDV", title: "완전희석가치 (CoinMarketCap 우선)", group: "market" },
  { key: "tvl", label: "TVL", title: "예치자산", group: "market" },
  { key: "priceChange14d", label: "14일", title: "CoinGecko 14일 가격 변화율", group: "performance" },
  { key: "feesChange7d", label: "수수료 변화", title: "최근 7일 vs 직전 7일 수수료 변화 (30일 변화 보조 표시)", group: "fundamentals" },
];

export const DEFAULT_VISIBLE_COLUMNS: SortKey[] = [
  "signals",
  "revenue30d",
  "phr",
  "holderValueRunRate",
  "mcap",
  "priceChange30d",
];

export const COLUMN_PRESETS: { label: string; keys: SortKey[] }[] = [
  { label: "핵심", keys: DEFAULT_VISIBLE_COLUMNS },
  { label: "실적 비교", keys: ["signals", "revenue30d", "revenueGrowth", "ps", "mcap", "priceChange30d"] },
  { label: "홀더 배분", keys: ["signals", "holderValueRunRate", "holderGrowth", "holderValueTtm", "phr", "mcap"] },
  {
    label: "가격 성과",
    keys: ["mcap", "totalVolume", "priceChange7d", "priceChange14d", "priceChange30d", "priceChange60d", "priceChange1y", "athChangePercentage", "atlChangePercentage"],
  },
  {
    label: "점수 근거",
    keys: ["valueScore", "scoreAxes", "confidence", "gateStatus", "captureScore", "phr", "ps", "holderValueRunRate", "holderValueTtm", "revenueAnnual", "mcap"],
  },
];
