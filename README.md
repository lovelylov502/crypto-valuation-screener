# 크립토 밸류에이션 리서치

크립토의 **저평가·고평가 후보**를 펀더멘털로 직접 걸러보는 단일 화면 스크리너.
주식·일반 기업 리서치, 조사노트, 후보 큐 같은 별도 워크플로는 다루지 않는다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinGecko](https://coingecko.com)

## 핵심 기능

- `저평가 80+` / `고평가 20 이하` 빠른 보기
- 밸류 점수·시총·TVL·P/HR·P/S 범위 필터
- 한 트랙의 좌우 손잡이로 최소·최대 동시 조절
- 코인·심볼 검색, 섹터 다중 선택
- 좀비 숨김, 홀더수익만, 고희석 제외
- 모든 열 정렬, 코인 열 고정, CoinGecko/DefiLlama 외부 링크
- 전체 초기화와 현재 결과/전체 개수 표시

## 핵심 방법론

- P/HR 40% · P/S 25% · Mcap/TVL 20% · P/F 15%
- 같은 섹터 내 백분위로 정규화하며, 점수가 높을수록 상대적 저평가로 본다.
- 성장·희석은 밸류 점수에 섞지 않고 각각 최대 ±5점만 보정한다.
- 시총 $1M, 활동성 $100K, 최근 현금흐름, 극단 멀티플, 최소 2개 신호 게이트로 노이즈를 줄인다.
- 낮은 멀티플만으로 매수 후보가 되지는 않는다. 가치포획·희석·지속성을 별도 확인해야 한다.

자세한 문서:

- [제품 브리프](./docs/PRODUCT_BRIEF.md)
- [스크리너 UX 스펙](./docs/UX_REDESIGN_SPEC.md)
- [밸류에이션 방법론](./docs/METHODOLOGY.md)
- [아키텍처](./docs/ARCHITECTURE.md)

## 개발

```bash
npm install
# 사내/로컬 CA 환경에서 fetch SSL 오류 시 (PowerShell)
$env:NODE_OPTIONS="--use-system-ca"
npm run dev
npm test
npx tsc --noEmit
npm run build
```

## 면책

투자 조언이 아니다. 점수는 온체인 펀더멘털 기반의 상대가치 참고값이며, 토큰 이코노믹스·베스팅·법적 권리·내러티브·시장 수급은 별도 검증해야 한다.
