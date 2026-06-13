// 조인된 코인 1건의 원천 데이터 (밸류에이션 계산 전)
export interface CoinRaw {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  geckoId: string | null;
  logo: string | null;

  // 시장 데이터 (DefiLlama /protocols)
  mcap: number | null; // 유통 시가총액
  tvl: number | null;
  change1d: number | null; // 가격/시총 24h 변화율(%)
  change7d: number | null;
  price: number | null;
  marketCapRank: number | null;
  totalVolume: number | null;
  priceChange7d: number | null;
  priceChange14d: number | null;
  priceChange30d: number | null;

  // 수수료/매출 (DefiLlama /overview/fees)
  feesAnnual: number | null; // 연율화 수수료
  fees7d: number | null;
  fees30d: number | null;
  feesChange7dover7d: number | null; // 최근 7일 vs 직전 7일 변화율(%)
  feesChange30dover30d: number | null; // 최근 30일 vs 직전 30일 변화율(%)

  // 매출 (DefiLlama dataType=dailyRevenue)
  revenueAnnual: number | null;
  revenue30d: number | null;

  // 홀더 귀속 수익 (DefiLlama dataType=dailyHoldersRevenue) — 토큰 가치에 가장 직결
  holderRevenueAnnual: number | null;
  holderRevenue30d: number | null;

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
  holderRevenueShare: number | null; // holder revenue / protocol revenue(or fees), 0~1
  signals: string[];
  risks: string[];
}

export interface CoinScored extends CoinRaw {
  multiples: {
    pf: number | null; // P/F = mcap / feesAnnual
    ps: number | null; // P/S = mcap / revenueAnnual
    phr: number | null; // P/HR = mcap / holderRevenueAnnual (크립토 PER)
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
  growthScore: number | null; // 성장성 점수 0~100
  valueScore: number | null; // 종합 점수 0~100 (높을수록 저평가)
  valueCapture: ValueCapture; // 토큰 홀더 가치포획 품질/리스크
  label: ValueLabel;
  confidence: number; // 0~1
  lowActivity: boolean; // 좀비(매출 미미)/신선도 미달 여부
  highDilution: boolean; // 유통량 30% 미만(MC/FDV<0.3) — 미래 언락 매도압 경고
}

export type ValueLabel =
  | "저평가"
  | "다소 저평가"
  | "적정"
  | "다소 고평가"
  | "고평가"
  | "판단보류";

export type ValueCaptureLabel =
  | "강한 가치포획"
  | "가치포획 후보"
  | "간접 포획"
  | "포획 불명확"
  | "판단보류";

export interface ScreenerResponse {
  coins: CoinScored[];
  categories: string[];
  updatedAt: string; // ISO
  fdvCoverage: number; // FDV 보강된 코인 수
  onchain: OnchainDashboard;
}

export type OnchainMetricStatus = "ok" | "missing-token" | "unavailable";

export interface OnchainMetricPoint {
  time: string;
  value: number;
}

export interface OnchainMetric {
  key: "mvrv" | "sopr" | "realizedPrice";
  label: string;
  value: number | null;
  previousValue: number | null;
  change7d: number | null;
  updatedAt: string | null;
  status: OnchainMetricStatus;
  points: OnchainMetricPoint[];
}

export interface OnchainDashboard {
  source: "ResearchBitcoin";
  status: OnchainMetricStatus;
  metrics: OnchainMetric[];
}
