import type { DecisionBucket } from "./decision";

export type ReportSeverity = "high" | "medium" | "low";
export type ReportStrength = "strong" | "medium" | "weak";

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
