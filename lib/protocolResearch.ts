import type { CoinScored } from "./types";

export interface ProtocolResearch {
  description: string;
  source: string;
  reviewedAt: string;
  scope: string;
  holder?: {
    funding: string;
    route: string;
    asset: string;
    recipient: string;
    condition: string;
    status: string;
    source: string;
  };
}

// Source-backed research records. No inferred payout asset or policy from an amount alone.
export const PROTOCOL_RESEARCH: Record<string, ProtocolResearch> = {
  "pendle": {
    description: "이자가 발생하는 자산을 원금 권리와 미래 이자 권리로 나눠 거래하는 서비스입니다. 이용자는 만기까지의 수익률을 고정하거나 미래 이자에 투자할 수 있습니다. 수익과 거래에 붙는 수수료가 주요 재원이며, 그룹에는 별도 금리 상품인 Boros도 포함될 수 있습니다.",
    source: "https://docs.pendle.finance/pendle-v2/Introduction", reviewedAt: "2026-09-12", scope: "Pendle V2 중심 · 그룹 금액은 구성 제품 합산",
    holder: { funding: "Pendle V2의 관련 수익·거래 수수료", route: "수수료 → PENDLE 시장매입 → 활성 보유자 배분", asset: "sPENDLE · 별도 에어드롭은 원래 자산", recipient: "참여 조건을 충족한 sPENDLE 보유자", condition: "PPP 투표 등 활성 조건. 출금 대기 14일 또는 즉시 출금 수수료 5%. 매입과 후속 배분은 같은 자금입니다.", status: "공식 문서상 시행 · 개별 실행 거래는 미대조", source: "https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/sPENDLE" },
  },
  "hyperliquid": {
    description: "자체 블록체인에서 무기한 선물과 현물 거래를 제공하는 거래소입니다. 이용자가 주문을 내고 거래할 때 수수료가 발생합니다. 거래 수수료는 Assistance Fund, 유동성 제공 구조, 시장 배포자 등 여러 수익자에게 나뉩니다.",
    source: "https://hyperliquid.gitbook.io/hyperliquid-docs", reviewedAt: "2026-09-12", scope: "Hyperliquid 거래 서비스 · 수수료 수익자별 범위 구분",
    holder: { funding: "Assistance Fund에 귀속된 거래 수수료", route: "귀속 수수료 → HYPE 매입 → 소각", asset: "HYPE 소각 · 보유자 직접 지급 없음", recipient: "직접 수령인 없음", condition: "일반 HYPE 보유만으로 현금이 지급되지 않습니다. 전체 거래 수수료와 Fund 귀속분을 구분해야 합니다.", status: "공식 문서상 시행 · 개별 실행 거래는 미대조", source: "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees" },
  },
  "liquity": {
    description: "암호자산을 담보로 달러 연동 자산을 빌릴 수 있는 대출 프로토콜입니다. V1은 ETH 담보와 LUSD를 사용하고, 대출 발행과 LUSD 환매에 수수료가 붙습니다. V2의 BOLD 및 투표 인센티브는 별도 구조이므로 버전별 수익과 수령 조건을 구분해야 합니다.",
    source: "https://docs.liquity.org/liquity-v1/faq/general", reviewedAt: "2026-09-12", scope: "아래 환원 설명은 Liquity V1 기준",
    holder: { funding: "V1 대출 발행·LUSD 환매 수수료", route: "수수료 → LQTY 스테이커 직접 배분", asset: "LUSD + ETH", recipient: "LQTY 스테이커", condition: "LQTY를 스테이킹해야 수령합니다. V1 스테이킹에는 고정 락업 기간이 없습니다. V2의 보상 구조와 합산하지 않습니다.", status: "V1 공식 문서상 시행 · 개별 실행 거래는 미대조", source: "https://docs.liquity.org/liquity-v1/faq/staking" },
  },
  "aave": {
    description: "자산을 맡겨 이자를 받거나 담보를 제공하고 다른 자산을 빌리는 대출 시장입니다. 차입자가 지불하는 이자는 공급자와 프로토콜에 나뉩니다. 그룹 매출은 여러 체인·버전의 금액을 합산하므로 개별 시장의 대출 수요와 수수료 구성을 함께 살펴볼 수 있습니다.",
    source: "https://aave.com/help/aave-101/introduction-to-aave", reviewedAt: "2026-09-12", scope: "대출 시장 중심 · 그룹 금액은 구성 제품 합산",
  },
  "uniswap": {
    description: "지갑에서 토큰을 교환할 수 있는 탈중앙 거래 프로토콜입니다. 유동성 공급자가 거래 자산을 제공하고 거래자는 교환 수수료를 냅니다. 거래 수수료 전체와 프로토콜이 확보한 수익은 구분해야 하며, 버전·풀마다 수수료 구성이 다를 수 있습니다.",
    source: "https://docs.uniswap.org/concepts/overview", reviewedAt: "2026-09-12", scope: "Uniswap 프로토콜 · 인터페이스 사업과 구분",
  },
  "lido": {
    description: "ETH 등을 스테이킹하고 그 지분을 나타내는 유동성 토큰을 받는 서비스입니다. 이용자는 스테이킹에 참여하면서 stETH 같은 토큰을 다른 곳에서도 사용할 수 있습니다. 스테이킹 보상 전체와 프로토콜이 수수료로 확보한 몫, LDO 보유자에게 돌아가는 금액을 구분해야 합니다.",
    source: "https://docs.lido.fi/", reviewedAt: "2026-09-12", scope: "Lido 유동성 스테이킹 중심",
  },
  "morpho": {
    description: "담보 자산과 대출 자산을 조합한 개별 대출 시장을 만들고 이용할 수 있는 프로토콜입니다. 공급자는 직접 시장에 자금을 넣거나 여러 시장에 배분하는 볼트를 이용합니다. 차입 이자, 볼트 운영 수수료, 프로토콜 귀속 수익은 서로 다른 항목입니다.",
    source: "https://docs.morpho.org/get-started/", reviewedAt: "2026-09-12", scope: "Morpho 시장·볼트 · 관리 주체별 수익 구분",
  },
  "gmx": {
    description: "암호자산 현물 교환과 레버리지 무기한 선물 거래를 제공하는 프로토콜입니다. 거래자는 포지션을 열고 닫거나 자산을 교환하면서 수수료를 냅니다. 유동성 공급자가 받는 수익과 프로토콜·GMX 토큰에 귀속되는 금액을 나눠 살펴봐야 합니다.",
    source: "https://docs.gmx.io/docs/trading/overview/", reviewedAt: "2026-09-12", scope: "GMX 거래 서비스 · 버전별 구성 확인",
    holder: { funding: "관련 프로토콜 수수료의 27%", route: "수수료 → GMX 매입 → Treasury 적립 · 스테이커 배분 중단", asset: "GMX · 현재 즉시 지급 없음", recipient: "향후 배분 대상은 GMX 스테이커", condition: "공식 문서는 GMX 가격 $90 도달 시 적립분을 배분한다고 명시합니다. 지분은 스테이킹 수량·기간에 따른 staking power 기준입니다.", status: "공식 문서상 매입 지속·배분 중단 · 개별 실행 거래는 미대조", source: "https://docs.gmx.io/docs/tokenomics/gmx-token/" },
  },
  "curve-dex": {
    description: "스테이블코인처럼 가격이 비슷한 자산을 포함해 여러 토큰의 교환을 제공하는 거래 프로토콜입니다. 이용자는 풀의 유동성을 사용해 교환하고 수수료를 냅니다. 풀 공급자 수익, 프로토콜 수익, CRV 발행 보상과 투표 인센티브는 별도로 구분해야 합니다.",
    source: "https://docs.curve.finance/", reviewedAt: "2026-09-12", scope: "Curve 교환 서비스 중심 · 대출 제품은 별도",
  },
};

export function protocolResearch(c: Pick<CoinScored, "slug">): ProtocolResearch | undefined {
  const key = c.slug.replace(/^parent#/, "");
  return PROTOCOL_RESEARCH[key] ?? (key === "liquity-v1" ? PROTOCOL_RESEARCH.liquity : undefined);
}
