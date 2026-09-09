import type { HolderValueSummary } from "./holderValue";
import type { OpportunitySignals } from "./signals";

// 조인된 코인 1건의 원천 데이터 (밸류에이션 계산 전)
export interface CoinRaw {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  geckoId: string | null;
  cmcId: number | null;
  cmcSlug: string | null;
  logo: string | null;
  listedAt: number | null; // CMC date_added 우선, 없으면 DefiLlama 최초 등록 Unix timestamp
  isParent: boolean;
  identityStatus: IdentityStatus;
  identityReason: string;

  // 시장 데이터 (CoinMarketCap Keyless 우선, CoinGecko 보조)
  mcap: number | null; // 유통 시가총액
  tvl: number | null;
  change1d: number | null; // 가격/시총 24h 변화율(%)
  change7d: number | null;
  price: number | null;
  marketCapRank: number | null;
  totalVolume: number | null;
  numMarketPairs: number | null;
  marketDataUpdatedAt: string | null;
  priceChange7d: number | null;
  priceChange14d: number | null; // CoinGecko 보조
  priceChange30d: number | null;
  priceChange60d: number | null;
  priceChange90d: number | null;
  priceChange1y: number | null; // CoinGecko 보조
  athChangePercentage: number | null; // 현재가의 사상 최고가 대비 변화율
  atlChangePercentage: number | null; // 현재가의 사상 최저가 대비 변화율

  // 수수료/매출 (DefiLlama /overview/fees)
  feesAnnual: number | null; // 연율화 수수료
  fees1y: number | null;
  fees7d: number | null;
  fees30d: number | null;
  feesPrev30d: number | null;
  feesChange7dover7d: number | null; // 최근 7일 vs 직전 7일 변화율(%)
  feesChange30dover30d: number | null; // 최근 30일 vs 직전 30일 변화율(%)

  // 매출 (DefiLlama dataType=dailyRevenue)
  revenueAnnual: number | null;
  revenue1y: number | null;
  revenue30d: number | null;
  revenuePrev30d: number | null;

  // DefiLlama holder revenue를 component 경제유형별로 분리한 보수적 요약.
  // primary는 적격 최근 30일 연환산이며 raw TTM은 별도 보존한다.
  holderValue: HolderValueSummary;

  // 거래량 (DefiLlama /overview/dexs)
  volumeAnnual: number | null;
  volume30d: number | null;

  // 공급/희석 (CoinGecko /coins/markets, 상위 코인만 보강)
  fdv: number | null; // 완전희석가치
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
}

// 밸류에이션 엔진이 덧붙이는 결과
export interface ValueCapture {
  score: number | null; // 0~100, 높을수록 토큰 홀더가 실제 가치를 잘 포획
  label: ValueCaptureLabel;
  eligibleHolderValueShare: number | null; // 동일 최근 30일 금액 비율. 1 초과도 보존
  shareBasis: "revenue30d" | "fees30d" | null;
  signals: string[];
  risks: string[];
}

export interface CoinScored extends CoinRaw {
  opportunities: OpportunitySignals;
  peerCounts: { phr: number; ps: number; pf: number };
  multiples: {
    pf: number | null; // P/F = mcap / (fees30d * 365 / 30)
    ps: number | null; // P/S = mcap / (revenue30d * 365 / 30)
    phr: number | null; // P/HR = mcap / holderValue.eligibleRunRate
    mcapTvl: number | null; // mcap / tvl
    fdvTvl: number | null; // fdv / tvl
    dilution: number | null; // fdv / mcap (희석 위험)
  };
  // 같은 섹터 내 "싼 정도" 백분위 (0~100, 높을수록 저평가)
  sectorPercentiles: {
    pf: number | null;
    ps: number | null;
    phr: number | null;
    mcapTvl: number | null;
  };
  scoreAxes: ScoreAxes;
  valueScore: number | null; // 발견 점수 0~100. 필수 게이트 실패 시 null
  valueCapture: ValueCapture; // 토큰 홀더 가치포획 품질/리스크
  status: CandidateStatus;
  confidence: number; // 0~1
  confidenceGrade: ConfidenceGrade;
  scoreNotes: string[];
  gates: ScoreGates;
  lowActivity: boolean; // 좀비(매출 미미)/신선도 미달 여부
  highDilution: boolean; // 유통량 30% 미만(MC/FDV<0.3) — 미래 언락 매도압 경고
}

export type IdentityStatus = "verified" | "review" | "ambiguous";

export type CandidateStatus =
  | "발굴 후보"
  | "관찰"
  | "근거 부족"
  | "제외"
  | "가치 함정"
  | "재평가 진행 중"
  | "데이터 보류"
  | "신규 프로젝트";

export type ConfidenceGrade = "A" | "B" | "C";

export interface ScoreAxes {
  value: number; // 0~30
  improvement: number; // 0~25
  discovery: number; // 0~25
  quality: number; // 0~20
}

export interface ScoreGates {
  passed: boolean;
  reasons: string[];
  identity: boolean;
  marketData: boolean;
  fundamentalHistory: boolean;
  liquidity: boolean;
  dilution: boolean;
  matureProject: boolean;
  activity: boolean;
  scale: boolean;
  liquidityThreshold: number | null;
}

export type ValueCaptureLabel =
  | "강한 가치포획"
  | "가치포획 후보"
  | "간접 포획"
  | "포획 불명확"
  | "판단보류";

export interface MarketDataFreshness {
  source: "CoinMarketCap";
  oldestAt: string | null;
  newestAt: string | null;
  timestampedCoinCount: number;
}

export interface ScreenerResponse {
  coins: CoinScored[];
  categories: string[];
  updatedAt: string; // ISO
  marketDataFreshness: MarketDataFreshness;
  fdvCoverage: number; // FDV 보강된 코인 수
  cmcCoverage: number;
  verifiedIdentityCount: number;
  discoveryCandidateCount: number;
  scoreVersion: string;
  sources: SourceObservation[];
}

export interface SourceObservation {
  url: string;
  observedAt: string; // 이 수집에서 응답을 읽은 시각. 원천 데이터 생성 시각과 다름
  status: "ok" | "error";
}
