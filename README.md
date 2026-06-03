# 크립토 밸류에이션 스크리너

가격이 아니라 **펀더멘털**(수수료·매출·예치자산)로 코인의 저평가/고평가를 가늠하는 웹 스크리너.
각 밸류에이션 멀티플을 **같은 섹터 안에서 백분위로 정규화**한 뒤 가중 평균해 **0~100 종합 점수**(높을수록 저평가)로 보여줍니다.

데이터: [DefiLlama](https://defillama.com) · [CoinGecko](https://coingecko.com) (무료 API, 키 불필요)

## 점수 산정 방법

- **P/F** = 시총 / 연수수료, **P/S** = 시총 / 연매출, **Mcap/TVL** = 시총 / 예치자산 (모두 낮을수록 쌈)
- 연율화: 최근 1년 값(없으면 30일 × 12.17)
- **섹터 정규화**: 멀티플을 같은 카테고리 내 백분위로 변환 (DEX vs Liquid Staking 등 구조 차이 보정). 섹터 표본 < 5개면 전체 시장 분포로 fallback
- **활동성 필터**: 연 매출/수수료가 $100K 미만이면 P/F·P/S 비교에서 제외(좀비), 시총 $1M 미만은 점수 미산출
- **성장성(GARP)**: 최근 30일 수수료 모멘텀 반영
- **희석 위험**: FDV/Mcap (CoinGecko 상위 코인 보강)
- 가중치: P/F 30% · P/S 25% · Mcap/TVL 20% · 성장성 15% · 희석 10% (결측 지표는 재정규화)

## 스택

- Next.js 16 (App Router) · TypeScript · Tailwind CSS v4
- 서버에서 4개 DefiLlama 엔드포인트 + CoinGecko를 `slug`/`gecko_id`로 조인 후 점수화, 페이지 ISR 30분 캐시
- Vitest 단위 테스트 (`lib/valuation.test.ts`)

## 개발

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 엔진 단위 테스트
npm run build      # 프로덕션 빌드
```

> 사내/로컬 CA 환경에서 fetch SSL 오류가 나면 `NODE_OPTIONS=--use-system-ca` 를 지정하세요.

## ⚠️ 면책

투자 조언이 아닙니다. 본 점수는 온체인 펀더멘털 기반의 상대적 참고 지표이며, 토큰 이코노믹스·베스팅·내러티브·리스크를 반영하지 않습니다. CEX·체인·브릿지처럼 TVL이 가치와 직결되지 않는 섹터는 Mcap/TVL 신호를 신뢰하지 마세요.
