import type { DecisionBucket } from "./decision";

export type ReportSeverity = "high" | "medium" | "low";
export type ReportStrength = "strong" | "medium" | "weak";
export type ResearchReportReviewStatus = "관찰 중" | "업데이트 필요" | "아카이브";

export interface ResearchReportMetric {
  label: string;
  value: string;
  note?: string;
  source?: string;
}

export interface ResearchReportEvidence {
  label: string;
  detail: string;
  strength: ReportStrength;
  sourceLabel: string;
  sourceUrl: string;
}

export interface ResearchReportRisk {
  label: string;
  severity: ReportSeverity;
  detail: string;
  monitor?: string;
}

export interface ResearchReportScenario {
  name: string;
  priceRange: string;
  marketCapRange: string;
  assumptions: string[];
  evidenceNeeded: string;
}

export interface ResearchReportSection {
  title: string;
  summary: string;
  bullets: string[];
}

export interface ResearchReportSource {
  label: string;
  url: string;
  note?: string;
}

export interface ResearchReportAlly {
  group: string;
  names: string[];
  note: string;
}

export interface ResearchReportInterview {
  date: string;
  speaker: string;
  venue: string;
  url: string;
  points: string[];
}

export interface ResearchReport {
  id: string;
  protocol: {
    name: string;
    symbol: string;
    geckoId: string;
    defillamaSlug: string;
    slugMatchers: string[];
  };
  title: string;
  subtitle: string;
  /** 조사자가 투자 판단을 작성/확정한 날짜. */
  researchedAt: string;
  /** 가격·시총·TVL·매출·언락 등 숫자 데이터의 기준 시각. */
  dataAsOf: string;
  /** 현재 리포트 사용 상태. */
  reviewStatus: ResearchReportReviewStatus;
  /** 다음에 다시 열어볼 조건이나 날짜. */
  nextReviewAt?: string;
  /** @deprecated use dataAsOf */
  asOf: string;
  fxNote: string;
  bucket: DecisionBucket;
  thesis: string;
  verdict: string;
  nextAction: string;
  metrics: ResearchReportMetric[];
  evidence: ResearchReportEvidence[];
  risks: ResearchReportRisk[];
  scenarios: ResearchReportScenario[];
  sections: ResearchReportSection[];
  interviews: ResearchReportInterview[];
  allies: ResearchReportAlly[];
  openQuestions: string[];
  sources: ResearchReportSource[];
}

export const PENDLE_REPORT: ResearchReport = {
  id: "pendle",
  protocol: {
    name: "Pendle",
    symbol: "PENDLE",
    geckoId: "pendle",
    defillamaSlug: "pendle",
    slugMatchers: ["pendle", "parent#pendle"],
  },
  title: "Pendle 리서치 메모",
  subtitle: "DeFi 수익률 토큰화 → 온체인 금리/펀딩레이트 시장으로 확장하는 팀인지 점검",
  researchedAt: "2026-06-22",
  dataAsOf: "2026-06-22 09:10 KST",
  reviewStatus: "관찰 중",
  nextReviewAt: "Boros 거래량/OI·holder revenue 30d run-rate 변곡 시",
  asOf: "2026-06-22 09:10 KST",
  fxNote: "USD/KRW 1,531.0원 기준. 가격 시나리오는 유통량 171.0M PENDLE 기준 단순 산식이며 투자 조언이 아닙니다.",
  bucket: "research-priority",
  thesis:
    "Pendle은 제품 PMF와 토큰 가치포획이 모두 보이는 드문 DeFi 토큰이다. TTM 기준 P/HR은 낮아 보이지만 최근 30d run-rate가 둔화되어, Boros·PT 담보·RWA/stable-yield 확장이 실제 매출로 붙는지 확인해야 한다.",
  verdict:
    "일은 잘하고 있다. sPENDLE 전환, 80% buyback/분배 구조, Boros 문서화, PT 담보 확장은 좋은 실행 신호다. 약점은 현재 holder revenue 규모가 아직 작고, 기관/RWA는 명명된 TradFi mandate가 아니라 옵션 가치라는 점.",
  nextAction:
    "매수 판단 전에는 Boros 거래량/OI/수수료, sPENDLE 보상 지속성, Aave·money market PT 담보 채택, RWA/stable-yield 시장의 반복 유입을 4개 지표로 추적한다.",
  metrics: [
    { label: "가격", value: "$1.40 (약 2,143원)", source: "CoinGecko", note: "24h -0.6%, 30d -24.8%" },
    { label: "시총", value: "$238.6M (약 3,653억원)", source: "CoinGecko" },
    { label: "FDV", value: "$392.8M (약 6,014억원)", source: "CoinGecko", note: "FDV/Mcap 1.65x" },
    { label: "TVL", value: "$985.4M (약 1.51조원)", source: "DefiLlama", note: "staking/pool2 제외" },
    { label: "TTM fees", value: "$24.9M", source: "DefiLlama overview", note: "30d run-rate $10.7M" },
    { label: "TTM revenue", value: "$24.2M", source: "DefiLlama overview", note: "30d run-rate $10.5M" },
    { label: "TTM holder revenue", value: "$20.7M", source: "DefiLlama overview", note: "30d run-rate $8.4M" },
    { label: "Mcap / Holder Revenue", value: "11.8x TTM", source: "계산", note: "30d run-rate 기준 28.4x" },
    { label: "30d 프로토콜 거래량", value: "$835.1M", source: "DefiLlama", note: "연율 약 $10.16B" },
    { label: "언락", value: "팀·투자자 물량 2024-09 완전 베스팅", source: "Pendle Docs", note: "2026-04 이후 인센티브용 2% terminal inflation" },
  ],
  evidence: [
    {
      label: "직접 가치포획 구조",
      detail:
        "공식 문서는 YT 수익/포인트 5% 수수료, swap fee 일부, 그리고 남은 수수료의 80%를 PENDLE buyback에 배정한다고 설명한다. sPENDLE 활성 보유자는 환매된 PENDLE 보상을 받을 수 있다.",
      strength: "strong",
      sourceLabel: "Pendle Docs — Fees / sPENDLE",
      sourceUrl: "https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/sPENDLE",
    },
    {
      label: "언락 리스크 완화",
      detail:
        "공식 tokenomics 문서 기준 팀·투자자 토큰은 2024년 9월 fully vested. 이후 유통량 증가는 인센티브·생태계 빌딩과 terminal inflation이 핵심이다.",
      strength: "strong",
      sourceLabel: "Pendle Docs — Tokenomics",
      sourceUrl: "https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/Tokenomics",
    },
    {
      label: "Boros 확장",
      detail:
        "Boros docs는 CEX/Hyperliquid funding-rate를 oracle로 가져와 YU 시장에서 long/short·헤지·cash-and-carry 고정화를 가능하게 한다고 설명한다. Pendle이 spot yield에서 margin rate trading으로 넘어가는 시도다.",
      strength: "medium",
      sourceLabel: "Boros Docs",
      sourceUrl: "https://docs.pendle.finance/boros-docs/Introduction",
    },
    {
      label: "기관/RWA 접점은 옵션 가치",
      detail:
        "인터뷰와 앱 시장에는 USDG·sUSDS·USDat·USDai 등 stable/RWA-like 자산이 보인다. 그러나 BlackRock/JPM/Franklin 같은 named TradFi mandate, 법적 권리·커스터디·회계 경로는 아직 확인 대상이다.",
      strength: "medium",
      sourceLabel: "Pendle API / 2026 interviews",
      sourceUrl: "https://api-v2.pendle.finance/core/v1/markets/all",
    },
    {
      label: "초기 VC 네트워크",
      detail:
        "2021년 private round는 Mechanism Capital lead, Crypto.com Capital·HashKey·Spartan·CMS·imToken·DeFi Alliance·Lemniscap 등 참여로 공식 발표됐다.",
      strength: "strong",
      sourceLabel: "Pendle Medium — $3.7M private round",
      sourceUrl: "https://medium.com/pendle/pendle-raises-3-7m-to-create-the-next-layer-of-defi-yield-markets-3b059bfbaa1",
    },
  ],
  risks: [
    {
      label: "현재 매출 규모 작음",
      severity: "high",
      detail:
        "TTM holder revenue는 $20.7M으로 괜찮지만 최근 30d run-rate는 $8.4M까지 낮아졌다. 밸류가 싸 보이는지는 어느 기간의 매출을 믿느냐에 달려 있다.",
      monitor: "holder revenue 30d run-rate가 TTM 수준($20M+)으로 회복되는지",
    },
    {
      label: "Boros 실행 리스크",
      severity: "medium",
      detail:
        "금리/펀딩레이트 트레이딩은 기관·프로 트레이더에겐 논리적이지만 교육, UX, oracle, 마켓메이커, 청산 리스크가 모두 필요하다.",
      monitor: "Boros OI, volume, fee revenue, 반복 사용 주소",
    },
    {
      label: "RWA 과대포장 위험",
      severity: "medium",
      detail:
        "RWA/stable-yield 시장이 있어도 기관용 인프라라고 부르려면 named mandate, legal rights, custody/accounting, 충분한 시장 깊이가 필요하다.",
      monitor: "regulated issuer·custodian·money market의 명시적 채택",
    },
    {
      label: "희석/인센티브",
      severity: "low",
      detail:
        "팀·VC cliff는 끝났지만 인센티브와 ecosystem fund 물량, 2% terminal inflation은 계속 존재한다. 단, FDV/Mcap 1.65x라 고희석 토큰은 아니다.",
      monitor: "circulating supply, sPENDLE/vePENDLE 잔고, emission 변경 거버넌스",
    },
  ],
  scenarios: [
    {
      name: "Bear / 숫자 후퇴",
      priceRange: "$0.18–$0.70",
      marketCapRange: "$30M–$120M",
      assumptions: [
        "holder revenue가 $3M–$6M 연율로 내려감",
        "Boros가 니치 제품으로 남고 PT 담보·RWA 유입이 둔화",
        "시장이 P/HR 10–20x만 부여",
      ],
      evidenceNeeded: "30d fees·holder revenue 감소, active markets 유동성 축소, sPENDLE 보상 약화",
    },
    {
      name: "Base / 지금의 PMF 유지",
      priceRange: "$1.17–$3.07",
      marketCapRange: "$200M–$525M",
      assumptions: [
        "sustainable holder revenue $15M–$25M 범위 유지",
        "P/HR 12–25x 범위 유지",
        "Boros는 초기 traction만 있고 핵심 매출은 V2 yield markets",
      ],
      evidenceNeeded: "TVL $1B 안팎 유지, 30d volume $0.8B 이상, holder revenue 30d run-rate 회복",
    },
    {
      name: "Bull / DeFi rates 인프라",
      priceRange: "$7.02–$17.54",
      marketCapRange: "$1.2B–$3.0B",
      assumptions: [
        "Boros·PT collateral·stable/RWA markets가 holder revenue $30M–$50M+ 연율로 끌어올림",
        "시장이 Pendle을 DeFi 금리 인프라로 보고 P/HR 40–60x 부여",
        "기관/RWA는 최소한 named product·custody·market depth 증거가 붙음",
      ],
      evidenceNeeded: "Boros fee line item, Aave/Morpho/Euler 담보 확장, regulated RWA issuer와 명명된 반복 유동성",
    },
  ],
  sections: [
    {
      title: "사업 비전",
      summary:
        "Pendle은 수익률이 변동하는 자산을 PT/YT로 쪼개 고정수익·롱수익·LP 전략을 가능하게 하는 yield market이다.",
      bullets: [
        "공식 문서는 Pendle을 LST/LRT/stablecoin/RWA 위에 올라가는 second-order derivative layer로 설명한다.",
        "Boros는 spot yield market을 margin 기반 funding-rate/interest-rate trading으로 확장한다.",
        "핵심 비전은 ‘모든 yield/rate를 거래 가능한 시장으로 만든다’에 가깝다.",
      ],
    },
    {
      title: "전통금융과의 접점 / 적대성",
      summary:
        "적대라기보다 TradFi 금리파생상품을 DeFi로 번역하려는 쪽이다. 단, TradFi가 바로 온다는 증거는 아직 약하다.",
      bullets: [
        "Pendle docs는 BIS의 $400T+ OTC interest derivative 시장을 DeFi로 가져온다는 프레이밍을 쓴다.",
        "Boros는 Binance/Hyperliquid 같은 perp funding rate를 oracle로 가져오는 구조라 CEX·전통/중앙화 시장과도 연결된다.",
        "기관용 Citadels/KYC instantiation 언급은 있었지만, 명명된 TradFi mandate나 regulated fund가 Pendle PT/YT를 쓰는 hard proof는 아직 없다.",
      ],
    },
    {
      title: "일을 잘하고 있는지",
      summary:
        "실행력은 좋다. 단, 투자자는 ‘좋은 제품’과 ‘좋은 가격’을 분리해야 한다.",
      bullets: [
        "공식 docs가 2026-06-19 기준으로 tokenomics·sPENDLE·Boros를 최신화했다.",
        "Pendle API 기준 전체 747개 시장, active liquidity $100k+ 시장 100개 이상이 확인된다.",
        "sPENDLE로 vePENDLE의 긴 락업/낮은 참여 문제를 줄이고, buyback/reward 구조를 더 직접화했다.",
        "다만 current revenue scale은 아직 작아서 Boros와 PT collateral이 실제 fee line으로 잡히는지 봐야 한다.",
      ],
    },
    {
      title: "언락 / 공급",
      summary:
        "VC·팀 cliff보다 인센티브·ecosystem 물량과 terminal inflation 관리가 더 중요해진 단계다.",
      bullets: [
        "공식 문서: 팀·투자자 물량은 2024-09 fully vested.",
        "2026-04 이후 인센티브용 2% per annum terminal inflation 전환.",
        "CoinGecko 기준 circulating 171.0M, total 281.5M, FDV/Mcap 1.65x. 비유통분은 sPENDLE/vePENDLE·ecosystem fund·multisig 등도 포함되어 단순 cliff-unlock으로 보면 안 된다.",
      ],
    },
  ],
  interviews: [
    {
      date: "2026-06-06",
      speaker: "TN Lee, co-founder/CEO",
      venue: "Medici Presents: Level Up",
      url: "https://youtu.be/aa5SSHluVW4",
      points: [
        "Citadels는 기관/KYC instantiation 방향으로 설명됨.",
        "Boros는 funding-rate trading과 broader rate market 확장 벡터.",
        "Solana/멀티체인, PT collateral, institutional products가 하반기 방향으로 언급됨.",
      ],
    },
    {
      date: "2026-04-30",
      speaker: "Dan, Growth Lead",
      venue: "DIA Oracles — Inside Pendle",
      url: "https://youtu.be/WrO0XB3NnfQ",
      points: [
        "대부분의 자본은 funds/institutions/bigger players에서 오고, attention은 retail에서 온다고 설명.",
        "USDG by Paxos 등 RWA/stable-yield 자산과 대규모 저슬리피지 스왑 가능성을 언급.",
        "Boros는 별도 토큰 없이 revenue가 Pendle로 돌아오게 하겠다는 방향. 정확한 형태는 미정이라고 밝힘.",
      ],
    },
    {
      date: "2026-03-24",
      speaker: "Dan, Growth Lead",
      venue: "Decrypted interview",
      url: "https://youtu.be/PIo-3VBThQ0",
      points: [
        "내부 north star는 Pendle penetration — yield market 중 Pendle이 차지하는 비중.",
        "Boros는 spot yield market에서 leverage/margin yield market으로의 자연스러운 전환이라고 설명.",
        "oracle만 있으면 funding, staking, treasury bill, real-estate rates까지 이론상 지원 가능하다고 언급.",
      ],
    },
  ],
  allies: [
    {
      group: "초기 투자자/VC",
      names: ["Mechanism Capital", "Crypto.com Capital", "HashKey Capital", "Spartan Group", "CMS", "imToken", "DeFi Alliance", "Lemniscap", "LedgerPrime", "Parataxis", "Signum Capital"],
      note: "Pendle 공식 2021 private round 발표 기준. Binance Labs strategic investment는 널리 언급되지만 이번 웹 업데이트에는 1차 검증 전까지 보조 메모로만 둔다.",
    },
    {
      group: "친한/연결된 DeFi·yield 프로젝트",
      names: ["Ethena / sUSDe / srUSDe", "Paxos USDG", "Sky sUSDS", "Usual USD0++", "Midas mAPOLLO", "Strata", "Aave", "Morpho", "Euler"],
      note: "앱 시장·인터뷰·PT collateral 방향에서 반복 등장. 개별 법적 partnership과 단순 market listing은 구분해야 한다.",
    },
    {
      group: "시장/인프라 접점",
      names: ["Binance funding rates", "Hyperliquid funding rates", "CEX/perp venues", "oracles"],
      note: "Boros는 funding-rate oracle을 통해 중앙화/온체인 perp 시장의 금리 변동을 거래 대상으로 삼는다.",
    },
  ],
  openQuestions: [
    "Boros revenue가 DefiLlama holder revenue에 어떻게/언제 잡히는가?",
    "sPENDLE rewards가 반복 가능한 실수익인지, 일회성 points/airdrop 효과인지 분해할 수 있는가?",
    "PT collateral이 Aave 외 money market으로 확장될 때 청산·oracle 리스크는 누가 부담하는가?",
    "Citadels 또는 기관용 Pendle 제품에서 named institution, legal rights, custody/accounting path가 확인되는가?",
    "Binance Labs 전략투자 원문은 CAPTCHA/차단 없이 1차 출처로 재검증 가능한가?",
  ],
  sources: [
    { label: "CoinGecko PENDLE market data", url: "https://www.coingecko.com/en/coins/pendle", note: "2026-06-22 09:10 KST 조회" },
    { label: "DefiLlama Pendle protocol", url: "https://defillama.com/protocol/pendle", note: "TVL·fees·revenue·holder revenue" },
    { label: "Pendle Tokenomics", url: "https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/Tokenomics" },
    { label: "Pendle Fees", url: "https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/Fees" },
    { label: "Pendle sPENDLE", url: "https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/sPENDLE" },
    { label: "Pendle Introduction", url: "https://docs.pendle.finance/pendle-v2/Introduction" },
    { label: "Boros Docs", url: "https://docs.pendle.finance/boros-docs/Introduction" },
    { label: "Pendle markets API", url: "https://api-v2.pendle.finance/core/v1/markets/all" },
    { label: "Pendle $3.7M private round", url: "https://medium.com/pendle/pendle-raises-3-7m-to-create-the-next-layer-of-defi-yield-markets-3b059bfbaa1" },
  ],
};



export const IREN_REPORT: ResearchReport = {
  id: "iren",
  protocol: {
    name: "IREN Limited",
    symbol: "IREN",
    geckoId: "iren-ltd",
    defillamaSlug: "",
    slugMatchers: ["iren", "iren-limited"],
  },
  title: "IREN 아이렌 리서치 메모",
  subtitle: "비트코인 채굴장에서 AI 클라우드·GPU 데이터센터로 급전환 중인 나스닥 AI 인프라주",
  researchedAt: "2026-06-23",
  dataAsOf: "2026-06-23 11:40 KST · 주가/시총은 Nasdaq 2026-06-22 종가, 재무는 2026-03-31 10-Q 기준",
  reviewStatus: "관찰 중",
  nextReviewAt: "FY2026 10-K 또는 Microsoft/NVIDIA 첫 GPU tranche 인도·acceptance/RPO 인식 확인 시",
  asOf: "2026-06-23 11:40 KST · 주가/시총은 Nasdaq 2026-06-22 종가, 재무는 2026-03-31 10-Q 기준",
  fxNote:
    "USD/KRW 1,535.69원 기준. 가격 시나리오는 2026-04-30 보통주 357.4M주 기준 단순 산식이며, NVIDIA 투자권·전환사채·M&A 주식발행 등 완전희석을 반영하지 않은 개인 리서치 메모입니다.",
  bucket: "research-priority",
  thesis:
    "IREN은 이제 ‘비트코인 채굴주’보다 ‘전력·부지·데이터센터를 GPU 매출로 전환하는 AI 인프라 실행주’에 가깝다. 다만 현재 시총 $20.3B는 TTM 매출 $757M의 26.8x, 회사 목표 $4.4B ARR의 4.6x라 Microsoft·NVIDIA 계약 이행이 이미 상당 부분 가격에 들어가 있다.",
  verdict:
    "좋은 점은 명확하다: 4.51GW 전력 포트폴리오, Childress 실행 경험, Microsoft $9.7B·NVIDIA $3.4B 계약, Dell·Goldman/JPM 조달 라인이 모두 named proof다. 문제는 거의 모든 가치가 2027년 이후 GPU 인도·전력·파이낸싱·고객 acceptance에 걸려 있고, 그 사이 부채·ATM·전환사채·NVIDIA 투자권으로 주식 공급이 계속 늘 수 있다는 점이다.",
  nextAction:
    "추격매수보다 관찰 우선. 다음 확인 포인트는 ① Microsoft/NVIDIA tranche 실제 인도·acceptance, ② RPO가 $710M에서 의미 있게 증가하는지, ③ $4.4B ARR 중 미계약 $1.8B가 계약으로 바뀌는지, ④ post-Q share count와 전환/ATM 희석이다.",
  metrics: [
    { label: "주가", value: "$56.87 (약 8.7만원)", source: "Nasdaq", note: "2026-06-22 종가, 52주 $9.83–$76.87" },
    { label: "시총", value: "$20.3B (약 31.2조원)", source: "Nasdaq", note: "357.4M주 × $56.87" },
    { label: "TTM 매출", value: "$757.1M (약 1.16조원)", source: "SEC 10-K/10-Q 계산", note: "FY2025 + FY2026 9M - FY2025 9M" },
    { label: "P/S", value: "26.8x TTM", source: "계산", note: "AI 클라우드 전환 기대가 붙은 멀티플" },
    { label: "AI Cloud TTM", value: "$65.2M", source: "SEC segment", note: "FY2025 Q4 $7.0M + FY2026 9M $58.3M" },
    { label: "Bitcoin mining TTM", value: "$691.8M", source: "SEC segment", note: "FY2026 9M $511.5M + FY2025 Q4 $180.3M" },
    { label: "계약/목표 ARR", value: "$2.6B 계약 평균 ARR / $4.4B 목표 ARR", source: "IREN 8-K/PR", note: "$4.4B 중 $1.8B는 planned GPU deployments 추정" },
    { label: "주요 계약", value: "Microsoft $9.7B + NVIDIA $3.4B", source: "SEC 10-Q/8-K", note: "각각 약 5년 GPU services" },
    { label: "현금·부채", value: "현금 $2.21B / notes+finance lease $3.96B", source: "2026-03-31 10-Q", note: "5월 $3.0B 전환사채·$3.6B 프로젝트 금융은 post-Q 이벤트" },
    { label: "FCF 압박", value: "TTM OCF $392M / capex $1.85B", source: "SEC cash flow 계산", note: "AI 전환으로 FCF 약 -$1.46B" },
    { label: "전력·GPU", value: "4.51GW power / 약 150k GPU installed or on order", source: "2026-03-31 10-Q", note: "Childress 750MW, Sweetwater/Oklahoma/BC 포함" },
    { label: "희석 포인트", value: "NVIDIA 30M주 권리 @ $70 + ATM/전환사채", source: "SEC 10-Q/8-K", note: "May 2033 notes cap call cap $110.30" },
  ],
  evidence: [
    {
      label: "정체성 전환이 공식화됨",
      detail:
        "10-Q는 IREN을 ‘vertically integrated provider of AI Cloud Services’로 설명하고, 4.51GW 전력 포트폴리오·약 150,000 GPU installed/on order·38 EH/s 채굴 capacity를 공시했다.",
      strength: "strong",
      sourceLabel: "IREN FY2026 Q3 10-Q — Overview",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000026/iren-20260331.htm",
    },
    {
      label: "Microsoft $9.7B 계약",
      detail:
        "2025-11-02 Microsoft와 Childress 전용 GPU services 계약을 체결했다. 총 계약가치는 약 $9.7B, 평균 5년, 각 tranche delivery 전 20% 선지급 구조다. 단, 아직 deliver/accept 되지 않은 tranche는 RPO에 포함하지 않는다.",
      strength: "strong",
      sourceLabel: "IREN FY2026 Q3 10-Q — Revenue / Microsoft Agreement",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000026/iren-20260331.htm",
    },
    {
      label: "NVIDIA $3.4B 계약과 전략 파트너십",
      detail:
        "2026-05-07 NVIDIA와 5년 $3.4B GPU services 계약 및 5GW 전략 파트너십을 발표했다. NVIDIA는 최대 30M주를 주당 $70에 매수할 수 있는 권리를 받지만, 최대 600,000 NVIDIA GPU delivery volume 달성에 따라 tranche별 vesting된다.",
      strength: "strong",
      sourceLabel: "IREN FY2026 Q3 10-Q — Subsequent events / Press release",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000025/irenreportsq3fy26results.htm",
    },
    {
      label: "$4.4B ARR 목표는 일부 미계약",
      detail:
        "2026-05-26 IREN은 Dell Blackwell 구매계약으로 $4.4B ARR를 target한다고 발표했다. 단 주석상 $4.4B는 Microsoft $1.9B, NVIDIA 계약 $0.7B, planned GPU deployments $1.8B 추정의 합이며 ‘not fully contracted’라고 명시했다.",
      strength: "strong",
      sourceLabel: "IREN May 26 2026 8-K / Press release",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000030/irentrgts44bninarrwithbl.htm",
    },
    {
      label: "Microsoft용 $3.6B 프로젝트 금융",
      detail:
        "2026-05-29 Microsoft 계약을 지원하는 GPU 인프라 취득 비용 일부를 위해 약 $3.6B financing을 체결했다. 담보는 해당 subsidiary 자산, GPU, equity pledge, Microsoft cash flow이며 parent guarantee는 일부 성과/shortfall 항목으로 제한된다.",
      strength: "strong",
      sourceLabel: "IREN Jun 1 2026 8-K — Financing Agreements",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1878848/000114036126023427/ef20075181_8k.htm",
    },
    {
      label: "현실 숫자는 아직 전환 초기",
      detail:
        "FY2026 Q3 매출은 $144.8M, 그중 AI Cloud $33.6M이고, 9개월 AI Cloud 매출은 $58.3M이다. Q3 순손실은 $247.8M, 채굴장 전환 관련 impairment가 $140.4M 발생했다.",
      strength: "strong",
      sourceLabel: "IREN FY2026 Q3 10-Q — Segment / MD&A",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000026/iren-20260331.htm",
    },
  ],
  risks: [
    {
      label: "실행/인도 리스크",
      severity: "high",
      detail:
        "가치의 핵심은 전력·건물·냉각·GPU·네트워크를 제때 고객-ready compute로 바꾸는 능력이다. tranche delivery와 customer acceptance가 지연되면 RPO·매출 전환이 밀린다.",
      monitor: "RPO 증가, GPU delivery/commissioning 일정, Childress Horizons 1–6 가동률",
    },
    {
      label: "희석/부채 리스크",
      severity: "high",
      detail:
        "2026년 3월 말 notes+finance lease만 약 $3.96B이고, 이후 $3.0B 2033 전환사채·$3.6B 프로젝트 금융·ATM·NVIDIA 30M주 권리가 추가됐다. 주가가 오를수록 공급도 열린다.",
      monitor: "분기별 diluted share count, ATM 잔여한도, 전환가/캡콜 cap, NVIDIA 권리 행사 tranche",
    },
    {
      label: "고객 집중 / 계약 품질",
      severity: "high",
      detail:
        "Microsoft와 NVIDIA가 named proof이지만, 매출은 특정 대형 고객과 tranche acceptance에 집중된다. SLA, uptime, 납기, power hedge가 틀어지면 economics가 크게 흔들릴 수 있다.",
      monitor: "customer concentration disclosure, contract termination/acceptance language, RPO와 deferred revenue",
    },
    {
      label: "밸류에이션 선반영",
      severity: "high",
      detail:
        "현재 P/S 26.8x는 채굴주 숫자로는 비싸고, $4.4B ARR 목표 기준 4.6x도 ‘목표가 실제 recurring revenue가 된다’는 가정을 포함한다.",
      monitor: "시총/계약 ARR, 시총/실제 annualized AI Cloud revenue, CRWV/NBIS/CIFR 등 피어 multiple 변화",
    },
    {
      label: "GPU 가격·수명·렌탈 단가",
      severity: "medium",
      detail:
        "AI Cloud는 GPU 공급, 기술세대 교체, rental rate, utilization에 민감하다. Blackwell 이후 세대 전환이 빠르면 감가·재투자 압력이 커진다.",
      monitor: "GPU utilization, contract pricing, depreciation, impairment, capex per MW/GPU",
    },
    {
      label: "채굴 축소와 impairment",
      severity: "medium",
      detail:
        "Childress 채굴 인프라를 AI Cloud로 전환하며 $520M 추가 impairment 가능성을 공시했다. BTC 가격이 반등해도 회사 가치는 점점 AI 전환 성공에 묶인다.",
      monitor: "추가 impairment, 채굴 EH/s 감소, BTC 가격·global hashrate",
    },
  ],
  scenarios: [
    {
      name: "Bear / AI 전환 지연",
      priceRange: "$20–$38",
      marketCapRange: "$7.1B–$13.6B",
      assumptions: [
        "Microsoft/NVIDIA tranche 인도·acceptance가 늦어지고 RPO가 크게 늘지 않음",
        "$4.4B ARR 중 미계약 $1.8B가 계약화되지 않거나 GPU rental rate가 하락",
        "전환사채·ATM·M&A 주식발행으로 주당 가치가 희석",
      ],
      evidenceNeeded: "commissioning 지연, RPO 정체, capex 초과, diluted share count 급증",
    },
    {
      name: "Base / 계약은 대체로 이행",
      priceRange: "$45–$85",
      marketCapRange: "$16.1B–$30.4B",
      assumptions: [
        "Microsoft $1.9B + NVIDIA $0.7B 평균 ARR가 2027년부터 순차 인식",
        "$4.4B 목표 ARR 일부는 실제 계약으로 바뀌지만 5GW 장기 옵션은 아직 할인",
        "시장은 목표 ARR에 약 4–7x 수준을 부여하고, 희석을 일부 감안",
      ],
      evidenceNeeded: "첫 tranche acceptance, RPO·deferred revenue 증가, AI Cloud gross margin과 project-finance cost 확인",
    },
    {
      name: "Bull / 전력-to-compute 플랫폼",
      priceRange: "$95–$160",
      marketCapRange: "$34.0B–$57.2B",
      assumptions: [
        "$4.4B ARR가 de-risk되고 5GW pipeline에서 추가 hyperscaler 계약이 붙음",
        "IREN이 단순 miner rerating이 아니라 neocloud/data-center platform multiple을 받음",
        "NVIDIA 권리 행사와 전환사채 희석을 상쇄할 만큼 revenue per share가 빠르게 상승",
      ],
      evidenceNeeded: "NVIDIA 600k GPU milestone 진전, 신규 named customer, 2028+ Sweetwater/Oklahoma/Europe capacity 계약화",
    },
  ],
  sections: [
    {
      title: "무엇을 하는 회사인가",
      summary:
        "IREN은 기존 비트코인 채굴용 전력·부지·데이터센터를 AI GPU 클러스터로 전환하는 회사다.",
      bullets: [
        "수익원은 아직 대부분 Bitcoin mining이지만, 공시상 전략 초점은 AI Cloud Services다.",
        "자산의 핵심은 4.51GW 전력 capacity와 Childress 등 대형 캠퍼스 개발 경험이다.",
        "BTC를 보유하는 treasury 전략이 아니라, 채굴한 BTC를 통상 매일 현금화한다고 공시했다.",
      ],
    },
    {
      title: "가격이 이미 반영한 미래",
      summary:
        "현재 가격은 단순 채굴주가 아니라 Microsoft/NVIDIA 계약을 상당히 신뢰하는 가격이다.",
      bullets: [
        "현재 시총 $20.3B는 TTM 매출 $757M의 26.8x다.",
        "회사 목표 $4.4B ARR 대비로는 4.6x지만, 이 목표는 $1.8B planned deployment 추정을 포함해 완전 계약 상태가 아니다.",
        "계약 평균 ARR로 확인되는 $2.6B만 보면 시총/계약 ARR는 약 7.8x다.",
      ],
    },
    {
      title: "피어 밸류 비교",
      summary:
        "IREN은 순수 채굴주보다 비싸고, CoreWeave보다는 낮은 P/S처럼 보이지만 매출 확정도는 CoreWeave보다 낮다.",
      bullets: [
        "IREN: 시총 $20.3B, TTM revenue $757M, P/S 26.8x — AI 전환 기대가 붙은 중간지대.",
        "CoreWeave(CRWV): 시총 $60.7B, FY2025 revenue $5.13B, P/S 11.8x — 이미 큰 AI cloud 매출이 있는 피어.",
        "Nebius(NBIS): 시총 $72.0B, FY2025 revenue $530M, P/S 135.9x — neocloud 스토리 프리미엄이 매우 큼.",
        "Cipher(CIFR)·Core Scientific(CORZ): 각각 P/S 51.4x·29.0x — miner/HPC 전환 프록시.",
        "Riot(RIOT)·CleanSpark(CLSK): P/S 16.7x·5.8x — 더 채굴주 성격이 강해 IREN보다 낮은 멀티플을 받는다.",
      ],
    },
    {
      title: "현실 vs 꿈",
      summary:
        "현실은 BTC 채굴 현금흐름, 꿈은 hyperscaler급 AI compute platform이다.",
      bullets: [
        "현실: FY2026 9M revenue $569.8M 중 Bitcoin mining이 $511.5M, AI Cloud는 $58.3M이다.",
        "Bridge: Microsoft/NVIDIA 계약, Dell 공급, Goldman/JPM financing이 AI 매출 전환의 다리다.",
        "Dream: 5GW global pipeline과 600k NVIDIA GPU milestone이 장기 플랫폼 multiple을 정당화한다.",
      ],
    },
    {
      title: "공급/희석",
      summary:
        "이 종목은 펀더멘털뿐 아니라 주식 공급·전환사채·전략투자권을 같이 봐야 한다.",
      bullets: [
        "보통주 outstanding은 2026-04-30 기준 357.4M주다.",
        "2026년 3월 새 ATM supplement는 최대 $6B 보통주 매각을 허용했고, 4월 30일까지 24.7M주·$1.06B gross proceeds가 발행됐다.",
        "NVIDIA는 최대 30M주 @ $70 권리를 받았고, 2033 notes는 cap call cap $110.30까지 희석 방어가 있지만 그 이상은 희석 가능성이 남는다.",
      ],
    },
    {
      title: "핵심 병목",
      summary:
        "병목은 전력 확보 자체보다 ‘확보한 전력을 고객이 돈 내는 GPU capacity로 제때 전환하는가’다.",
      bullets: [
        "Bull case는 RPO와 deferred revenue가 늘고, GPU tranche acceptance가 반복될 때 열린다.",
        "Bear case는 GPU·냉각·전력·네트워크·SLA 중 하나가 늦어져 capex만 먼저 나가고 revenue가 뒤처지는 경우다.",
        "따라서 다음 분기부터는 revenue보다 RPO, 계약별 delivery, capex-to-ARR 효율을 먼저 봐야 한다.",
      ],
    },
  ],
  interviews: [
    {
      date: "2026-05-07",
      speaker: "Daniel Roberts / Anthony Lewis / Kent Draper",
      venue: "IREN Q3 FY26 results call transcript",
      url: "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000028/irentranscript.htm",
      points: [
        "경영진은 병목을 ‘secured power가 customer-ready compute로 전환되는 속도’라고 설명했다.",
        "AI infrastructure shortage와 time-to-compute를 핵심 투자 논리로 제시했다.",
        "Q3 결과는 Bitcoin mining에서 AI Cloud로 전환되는 중간 단계로 설명됐다.",
      ],
    },
  ],
  allies: [
    {
      group: "Named customers / strategic counterparties",
      names: ["Microsoft", "NVIDIA", "Dell", "Goldman Sachs", "JPMorgan", "Mirantis", "Nostrum Group"],
      note: "투자자 입장에서는 ‘동맹’이라기보다 실행 증거다. 계약·공급·금융·소프트웨어·유럽 데이터센터 개발 역량을 보강한다.",
    },
    {
      group: "핵심 자산",
      names: ["Childress 750MW", "Sweetwater 1 1.4GW", "Sweetwater 2 600MW", "Oklahoma 1.6GW", "British Columbia sites 160MW", "Spain/Nostrum 490MW"],
      note: "전력과 grid-connected land가 IREN의 원재료다. 하지만 전력만으로는 moat가 아니고, 납기·원가·고객계약으로 변환돼야 한다.",
    },
    {
      group: "피어/프록시",
      names: ["CoreWeave", "Nebius", "Core Scientific", "Cipher", "Riot", "CleanSpark", "TeraWulf"],
      note: "AI cloud pure-play, miner-to-HPC 전환주, 순수 채굴주를 나눠서 multiple을 봐야 한다.",
    },
  ],
  openQuestions: [
    "$4.4B ARR 중 planned GPU deployments $1.8B가 언제 named customer 계약으로 바뀌는가?",
    "Microsoft/NVIDIA 각 tranche의 delivery, acceptance, RPO 인식 시점은 분기별로 어떻게 진행되는가?",
    "AI Cloud gross margin은 전력비, GPU 감가, financing cost를 뺀 뒤에도 CoreWeave류 multiple을 받을 수 있는가?",
    "2026년 10-K에서 fully diluted share count, ATM 잔여한도, 전환사채 if-converted 주식수가 얼마나 늘어나는가?",
    "Blackwell 이후 GPU 세대 전환과 rental rate 하락이 5년 계약 economics를 얼마나 갉아먹는가?",
    "전력 hedge와 ERCOT/utility interconnection 조건이 예상대로 작동하는가?",
  ],
  sources: [
    { label: "Nasdaq IREN quote summary", url: "https://www.nasdaq.com/market-activity/stocks/iren", note: "주가·시총·52주 범위, 2026-06-22 종가" },
    { label: "IREN FY2026 Q3 10-Q", url: "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000026/iren-20260331.htm", note: "재무제표·segment·Microsoft agreement·subsequent events" },
    { label: "IREN Q3 FY26 results press release", url: "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000025/irenreportsq3fy26results.htm", note: "$3.4B NVIDIA contract, 5GW partnership, $3.7B ARR target" },
    { label: "IREN May 26 2026 Dell / ARR press release", url: "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000030/irentrgts44bninarrwithbl.htm", note: "$1.6B Dell Blackwell purchase, $4.4B ARR target and assumptions" },
    { label: "IREN Jun 1 2026 financing 8-K", url: "https://www.sec.gov/Archives/edgar/data/1878848/000114036126023427/ef20075181_8k.htm", note: "$3.6B Microsoft GPU project financing" },
    { label: "IREN May 14 2026 convertible notes press release", url: "https://www.sec.gov/Archives/edgar/data/1878848/000114036126021285/ef20073507_ex99-1.htm", note: "$3.0B 2033 notes, $110.30 cap-call cap" },
    { label: "IREN Q3 FY26 results transcript", url: "https://www.sec.gov/Archives/edgar/data/1878848/000187884826000028/irentranscript.htm", note: "경영진 설명/질의응답" },
    { label: "Yahoo Finance chart KRW=X / BTC-USD", url: "https://query2.finance.yahoo.com/v8/finance/chart/KRW=X?range=5d&interval=1d", note: "USD/KRW 1,535.69, BTC $64,118.63 조회" },
  ],
};

export const RESEARCH_REPORTS: ResearchReport[] = [IREN_REPORT, PENDLE_REPORT];

export function recentResearchReports(limit = 3): ResearchReport[] {
  return [...RESEARCH_REPORTS]
    .sort((a, b) => b.researchedAt.localeCompare(a.researchedAt))
    .slice(0, limit);
}
