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

  // 수수료/매출 (DefiLlama /overview/fees)
  feesAnnual: number | null; // 연율화 수수료
  fees30d: number | null;
  feesChange30dover30d: number | null; // 최근 30일 vs 직전 30일 변화율(%)

  // 매출 (DefiLlama dataType=dailyRevenue)
  revenueAnnual: number | null;
  revenue30d: number | null;

  // 거래량 (DefiLlama /overview/dexs)
  volumeAnnual: number | null;
  volume30d: number | null;

  // 공급/희석 (CoinGecko /coins/markets, 상위 코인만 보강)
  fdv: number | null; // 완전희석가치
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
}

// 밸류에이션 엔진이 덼붙이는 결과
export interface CoinScored extends CoinRaw {
  multiples: {
    pf: number | null; // P/F = mcap / feesAnnual
    ps: number | null; // P/S = mcap / revenueAnnual
    mcapTvl: number | null; // mcap / tvl
    fdvTvl: number | null; // fdv / tvl
    dilution: number | null; // fdv / mcap (희석 위험)
  };
  // 같은 섹터 내 "숌 정도" 백분위 (0~100, 높을수록 저평가)
  sectorPercentiles: {
    pf: number | null;
    ps: number | null;
    mcapTvl: number | null;
  };
  growthScore: number | null; // 성장성 점수 0~100
  valueScore: number | null; // 종합 점수 0~100 (높을수록 저평가)
  label: ValueLabel;
  confidence: number; // 0~1
  lowActivity: boolean; // 좀비(매출 미미) 여부
}

export type ValueLabel =
  | "저평가"
  | "다소 저평가"
  | "적정"
  | "다소 고평가"
  | "고평가"
  | "판단보류";

export interface ScreenerResponse {
  coins: CoinScored[];
  categories: string[];
  updatedAt: string; // ISO
  fdvCoverage: number; // FDV 보강된 코인 수
}
