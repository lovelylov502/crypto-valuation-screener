# 크립토 밸류에이션 리서치

현금흐름은 개선되지만 가격에는 아직 충분히 반영되지 않은 **재발견 전 후보**를 찾는 단일 화면 스크리너.
주식·일반 기업 리서치, 조사노트, 후보 큐 같은 별도 워크플로는 다루지 않는다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinMarketCap Keyless](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api) · [CoinGecko](https://coingecko.com)

## 핵심 기능

- `발굴 후보` / `65+ 전체` / `데이터 보류` 빠른 보기
- 발견 점수·시총·TVL·P/HR·P/S 범위와 신뢰도 B+ 필터
- 한 트랙의 좌우 손잡이로 최소·최대 동시 조절
- 코인·심볼 검색, 섹터 다중 선택
- 좀비 숨김, 현재 홀더가치만, 고희석 제외
- 적격 최근 30일 연환산 holder value와 DefiLlama raw TTM 분리
- component별 경제유형·DefiLlama-derived 상태·P/HR 제외/불연속 경고
- CMC 상장 90일 미만 자산을 `신규 트랙`으로 분리
- 별표 관심종목과 `★ 관심만` 필터 (브라우저에 자동 저장)
- 4축 점수·필수 게이트 사유·60일 가격 변화·거래량 열
- 모든 열 정렬, 코인 열 고정, CoinMarketCap/CoinGecko/DefiLlama 외부 링크
- 전체 초기화와 현재 결과/전체 개수 표시

페이지와 `/api/screener`는 같은 시총 $1M 이상 스크리닝 universe를 반환한다. `updatedAt`은 계산 완료 시각이며, 실제 CMC 시세 시각은 `marketDataFreshness.oldestAt`~`newestAt`과 각 행의 `marketDataUpdatedAt`으로 따로 확인한다.

## 핵심 방법론

- 필수 게이트: canonical 토큰 연결, 최신 CMC 시세·60일·거래량, 30일 비교 이력, 유동성, 희석, 90일 상장기간, 활동성.
- 발견 점수 100점 = 펀더멘털 가치 30 · 개선 25 · 가격 미발견 25 · 토큰/시장 품질 20.
- P/HR은 최근 30일 적격 holder value를 `30d × 365/30`으로 연환산해 계산한다. raw TTM은 P/HR 분모로 쓰지 않는다.
- P/HR 적격 유형은 직접 분배·명시적 시장매입·매입 후 소각이다. 수수료 소각·ve/voter/locker 한정 분배·불명확 유형은 raw 값만 보존한다.
- `vote/voted/voting`·bribe·gauge 제한, 부정형(`no revenue`, `0%`)과 홀더 외 수익자 혼합은 적격에서 제외한다. burn은 매입 토큰의 소각이 명시적으로 연결될 때만 `매입+소각`이다.
- P/HR을 15점 핵심으로 두고 P/S·P/F·Mcap/TVL의 중복 영향은 합계 10점으로 제한한다.
- 최근 30일 적격값이 0/누락인데 TTM이 양수면 현재 P/HR을 비우고 중단·불연속 경고를 표시한다.
- 섹터 표본 8개 미만은 글로벌 시장으로 fallback하지 않으며, 결측 지표를 재가중하지 않는다.
- 점수와 데이터 신뢰도 A/B/C를 분리하고 `가치 함정`·`재평가 진행 중`·`데이터 보류`를 별도 판정한다.

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

## 프로덕션 배포

프로덕션 소스는 `C:\Users\TAE\Workspace\projects\hermes\crypto-valuation-screener` 하나다. `C:\Users\TAE\Workspace\projects\taegyu\holder revenue`는 폐기된 중복 체크아웃이므로 Vercel 연결과 배포를 금지한다.

승인된 로컬 환경에서 `VERCEL_TOKEN`을 불러온 뒤 canonical 루트에서 다음 명령만 사용한다.

```powershell
npm run deploy:production
```

이 명령은 canonical 실경로·Git fetch/push 원격·로컬 Vercel 연결, clean `main`과 `origin/main` 일치, 인증된 원격 project/team을 먼저 검사하고 테스트·타입 검사·프로덕션 빌드를 통과한 뒤 배포한다. 마지막에는 canonical `/`와 `/api/screener`를 다시 읽어 고급 UI와 API 계약을 확인한다. 전체 정책과 배포 없는 점검 명령은 [프로덕션 배포 안전 규칙](./docs/DEPLOYMENT.md)에 있다.

## 면책

투자 조언이 아니다. 점수는 온체인 펀더멘털 기반의 상대가치 참고값이며, 토큰 이코노믹스·베스팅·법적 권리·내러티브·시장 수급은 별도 검증해야 한다.
