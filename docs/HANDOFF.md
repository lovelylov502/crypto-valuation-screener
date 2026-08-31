# Handoff

마지막 작업 기준: 2026-08-31 KST

## 현재 제품

- 제품명: **크립토 밸류에이션 리서치**
- 라이브 URL: https://crypto-valuation-screener.vercel.app
- 점수 버전: `rediscovery-v3-holder-classifier`
- 범위: 펀더멘털 개선이 가격보다 앞선 후보를 찾는 크립토 전용 단일 화면 스크리너

## 프로덕션 소스 안전 규칙

- canonical 루트: `C:\Users\TAE\Workspace\projects\hermes\crypto-valuation-screener`
- 배포 금지 legacy 루트: `C:\Users\TAE\Workspace\projects\taegyu\holder revenue`
- 정상 배포 명령: `npm run deploy:production`
- preflight는 canonical 실경로, Git fetch/push 원격, Vercel project `prj_zOmxeQWmBjp5MAUmmYFALM8AC6Cc`, team `team_2dxBFycQaaHuXjESEf0kCkFG`, project name을 모두 확인한다.
- 배포 완료 조건에는 canonical `/`와 `/api/screener` HTTP 200, 고급 UI 표식, `scoreVersion=rediscovery-v3-holder-classifier`, 구형 UI 표식 부재가 포함된다.
- 전체 절차와 배포 없는 양성·음성 probe는 [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md)에 있다. 원시 `vercel deploy` 명령은 정상 절차로 사용하지 않는다.

## 2026-08-31 wrong-source rollback 복구

- 작업 시작 시 라이브 `/api/screener`는 HTTP 200이었지만 `scoreVersion`이 없고 6,794행·7,833,660바이트였다. `/`에는 `저평가 80+`와 `고평가 20 이하`가 남아 있어 legacy 배포로 되돌아간 상태를 재확인했다.
- canonical은 `recovery-production`의 `65ac2bc41917eb26f435d3d947ca151c9eed7698` 위에 기존 source/doc 변경을 그대로 보존했다.
- 복구 배포 ID·고유 URL·최종 readback은 아래 현재 배포·검증 절에 기록한다.

## 2026-08-17 holder value 정규화

- primary holder-value figure와 P/HR을 적격 최근 30일 합계의 연환산(`30d × 365/30`)으로 변경했다. DefiLlama `total1y`는 `원천 HR TTM`으로 분리했다.
- child별 `HoldersRevenue` 방법론을 직접 분배·시장매입·매입+소각·수수료 소각·ve/voter/locker·불명확으로 분리한다. 앞의 세 유형만 일반 P/HR과 holder-value 점수에 들어간다.
- 분류 상태는 `defillama-derived`다. component의 전체 방법론 문장은 API에 싣지 않고 유형·적격 여부·30일·직전 30일·TTM·짧은 사유만 보존한다.
- parent는 적격 child만 합산한다. fee burn·제한된 수익권·불명확 child는 raw/excluded 합계에 남는다.
- 적격 최근 30일이 0/누락인데 TTM이 양수면 P/HR을 비우고 중단·불연속 경고를 표시한다.
- fees·revenue·holder revenue·volume overview의 `doublecounted === true` row는 parent 합계에서 제외한다.
- UI의 `현재 홀더가치/년`, `원천 HR TTM`, 경제유형·DL 파생·경고 표시, `현재 홀더가치만` 필터가 이 의미를 따른다.

## 2026-08-17 classifier 독립 감사 보완

- 첫 구현 배포 `dpl_CYQd1JspKrpYAJeS4N4hrrttumKy`는 독립 read-only 감사에서 `bought back`/open-market buy/명시적 staker 분배를 놓치고 `holders who vote/voted`를 직접분배로 올리는 문제가 확인돼 최종 승인하지 않았다.
- buyback은 `buy back`·`bought back`·`by back`·open-market buy를 구체적으로 인식한다. 직접분배는 `goes to TOKEN stakers`, `paid out to people who stake TOKEN` 같은 지급 동작+수익자 조합만 확장했다.
- `vote/voted/voting`·bribe·gauge·locker, 부정형(`no revenue`, `0%`, 중단), vague governance-holder 문구, LP/referrer/trader/raffle/PoL 등과 섞인 component는 제외한다.
- 두 번째 독립 감사에서 `Fees are not distributed`, `holders do not receive`, `no fees go to`, `distributions have ended` 같은 자연스러운 부정·중단 문장이 긍정 동사에 걸리는 P0가 확인됐다. holder/staker 지급 문장에 한정한 부정·중단 레이어를 긍정 분류보다 먼저 적용하고, 축약형과 `no longer`·`stopped paying`도 같은 제외 사유로 처리한다.
- burn은 매입 토큰 소각의 명시적 연결이나 burn-address 전송이 있을 때만 `buyback_and_burn`이다. NEAR의 `not burned`와 Pump의 `sourced from onchain burns`는 `market_buyback`으로 남긴다.
- live `dailyHoldersRevenue` 1,002행 중 금액이 있고 `doublecounted`가 아닌 422행을 모두 검사했다. eligible 178행(직접분배 61·시장매입 66·매입+소각 51)에서 부정/제한 표식과 LP/referrer/trader/raffle/PoL 표식은 각각 0행이었다. Camelot·NICKEL·MineBean·MineLoot·Dune·Venice의 명시적 매입토큰 소각과 DefiTuna의 treasury 공급분 제외 직접분배도 과잉 제외 없이 보존했다.

## 현재 배포·검증

- 프로덕션 배포 ID: `dpl_BDFVzUPp6G48q8GdzSuV4NaaLqkA`
- 고유 URL: https://crypto-valuation-screener-iq34mxvpb-bodycation.vercel.app
- canonical alias: https://crypto-valuation-screener.vercel.app
- `npm run verify:local`은 canonical preflight, 배포 안전 probe 5개, Vitest 122개(6 files), TypeScript, production build, `git diff --check`를 모두 통과했다.
- Vercel API readback은 배포 상태 `READY`, target `production`, 예상 project/team, canonical alias를 확인했다.
- canonical `/`: HTTP 200, `X-Vercel-Cache: HIT`, 2,200,011바이트. `발굴 후보`·`65+ 전체`·`데이터 보류`가 있고 `저평가 80+`·`고평가 20 이하`는 없다.
- canonical `/api/screener`: HTTP 200, `X-Vercel-Cache: HIT`, 687행·1,802,734바이트, `scoreVersion=rediscovery-v3-holder-classifier`, `updatedAt=2026-08-31T02:27:58.197Z`였다.
- 배포 CLI 자식 출력은 토큰을 마스킹한다. 기존 노출 가능 토큰은 폐기했고 프로젝트 범위 교체 토큰의 예상 project/team 접근과 기존 토큰의 HTTP 403을 확인했다.
- Aave: raw TTM $25,657,337, 적격 current 30d 0, P/HR 없음·stale 경고.
- Canton: raw current 30d $50,700,736, `native_fee_burn`, P/HR 없음.
- Aerodrome: raw current 30d $3,411,328, `ve_voter_locker_distribution`, P/HR 없음.
- Hyperliquid: 적격 current 30d $29,016,112, run-rate $353,029,362.67, `market_buyback`, P/HR 약 42.00x.
- Jupiter는 명시적 buyback child $1,333,318.48만 적격 합산하고 불명확 perpetual child $500,247를 제외해 `mixed`다. Pump·EdgeX는 `market_buyback`, Pancake는 `buyback_and_burn`이며 모두 component 합계와 parent 합계가 일치했다.
- Lido는 `market_buyback`이지만 current 30d 0·TTM $4,030,385라 P/HR 없음·stale이다. Yearn·Sushi·GMX·Tectonic·send.fun은 명시적 staker 직접분배로 분류되고, Sushi V3 부정형 current $11,965는 제외된다. Ramses CL·Aquarius는 voter/bribe 제한으로 제외되고 NEAR Intents는 `market_buyback`이다.
- Venice는 `bought back and burned`를 `buyback_and_burn`으로 분류해 current 30d $625,749·run-rate $7,613,279.50·P/HR 약 76.30x다.

## 2026-08-17 응답 크기 복구 기준선

- 기존 프로덕션 배포 `dpl_fbz9m795dPtEraqg9jSiyMrZtxFZ`의 `/api/screener`는 6,701행·15,196,170바이트였다. Vercel Function 응답 한도 4.5MB를 넘어 30분 ISR 재검증이 `stale_error`로 끝났고, `updatedAt=2026-07-28T05:18:46.397Z`인 마지막 정상 응답을 계속 반환했다.
- 같은 배포의 `/`는 시총 $1M 이상만 렌더해 요청 후 2026-08-17 데이터로 재생성됐다. DefiLlama 5개 endpoint, CMC Keyless, CoinGecko는 모두 HTTP 200이었고 기존 파싱 스키마도 유지됐다.
- 점수와 섹터 분포는 전체 원천 universe로 계산한 뒤, 페이지와 API 응답에는 시총 $1M 이상 스크리닝 universe만 싣도록 공통 경계를 `lib/screener.ts`로 옮겼다. canonical identity 규칙과 행 필드는 줄이지 않았다.
- `marketDataFreshness`를 추가해 계산 완료 시각(`updatedAt`)과 실제 CMC `quote.last_updated` 범위를 분리했다. 화면에도 두 시각을 함께 표시한다.
- 새 프로덕션 배포: `dpl_4QwE3auiiaN1bTRiirJXQptSPFZg`
- 고유 배포 URL: https://crypto-valuation-screener-k90pwlibr-bodycation.vercel.app

## 현재 데이터와 점수

- DefiLlama: fees, revenue, holders revenue, component 방법론·doublecounted, TVL, parent 구조
- CoinMarketCap Keyless: canonical ID, 가격, 시총, FDV, 거래량, 7/30/60/90일 변화
- CoinGecko: 명시적 gecko_id 자산의 1년·ATH·ATL 보조값
- 필수 게이트: 토큰 정체성, 최신 시장 데이터, 30일 비교 이력, 유동성, 희석, 상장 90일, 활동성, 시총
- 4축: 가치 30 · 개선 25 · 미발견 25 · 품질 20. P/HR·holder-value 점수·추세는 적격 current 30일 기준
- 결측값 재가중 없음, 섹터 표본 8개 미만 global fallback 없음
- 상태: 발굴 후보, 관찰, 근거 부족, 제외, 가치 함정, 재평가 진행 중, 데이터 보류, 신규 프로젝트
- 점수와 신뢰도 A/B/C 분리

## 현재 UX

- 빠른 보기: `발굴 후보`, `65+ 전체`, `데이터 보류`, `전체`
- 판정/점수 셀에 상태·점수·신뢰도와 첫 게이트 실패 사유 표시
- 4축 점수, 24시간 거래량, 60일 가격 변화 기본 열
- 신뢰도 B+, 신규 트랙, 좀비, 현재 홀더가치, 고희석, 관심종목 필터
- 열 선택·정렬, 양손잡이 범위, 섹터 다중 선택, 페이지네이션

## 주요 정합성 사례

- `parent#aave`: 적격 current 0·TTM 양수 → P/HR 없음·불연속 경고
- `canton`: 수수료 소각 → raw 보존·일반 P/HR 제외
- `parent#aerodrome`: veAERO voter 귀속 → raw 보존·일반 P/HR 제외
- `parent#jupiter`: 명시적 buyback child만 적격 합산, 불명확 child 별도 보존
- `parent#securitize`: 여러 심볼이 섞여 `ambiguous` → 데이터 보류
- `parent#magpie-ecosystem`: 여러 gecko_id/심볼 → 데이터 보류
- `parent#pump`: 검증된 CMC `pump-fun` override → `재평가 진행 중`
- `ore-protocol`: FDV/Mcap 3.33 초과·언락 미확인 → 데이터 보류

## 응답 크기 복구 당시 검증 (이전 배포)

- `npm test`: 21개 통과 (3 files)
- `npx tsc --noEmit`: 통과
- `npm run build`: 통과
- 프로덕션 `/`: HTTP 200, `rediscovery-v1`, `발굴 후보`, `CMC 원천`, 계산/원천 ISO 시각 확인
- 프로덕션 `/api/screener`: HTTP 200, `X-Vercel-Cache: HIT`, 1,476,462바이트, 663행, 최소 시총 $1,003,138.84
- API 계산 완료: `2026-08-17T02:43:34.746Z`; CMC 원천 범위: `2026-08-17T02:41:00.000Z`~`2026-08-17T02:42:00.000Z` (570행)
- coverage: CMC 570, identity verified 653, FDV 597; `parent#securitize`와 `parent#magpie-ecosystem`은 계속 `ambiguous`·`데이터 보류`
- PancakeSwap 표본: DefiLlama live fees/revenue/holder revenue 30일 합계가 API와 일치. CMC live 가격은 2분 뒤 API 대비 0.0204% 차이. CoinGecko `usual` 1년 변화율은 양쪽 모두 -87.4%.
- 새 배포 runtime 로그의 `/`와 `/api/screener` 요청은 200/HIT이며 오류 로그 없음

## 알려진 제한

- 발견 점수는 미래 초과수익률 백테스트가 축적되기 전의 실험적 모델이다.
- 공개 데이터만으로 개별 토큰 언락 일정을 검증할 수 없어, 고희석 자산은 보수적으로 보류한다.
- holder-value 경제유형은 DefiLlama 방법론 문구 기반 분류이며 공식·온체인 확인을 대신하지 않는다. 불명확한 문구는 보수적으로 일반 P/HR에서 제외한다.
- 2MB를 넘는 DefiLlama·CMC 원천 응답은 Next fetch data cache에 저장되지 않아 route 재생성마다 다시 조회한다. 이 경고는 15.2MB API 응답 실패 원인이 아니며, 페이지/API route ISR은 완성된 route 결과를 30분 캐시한다.
- DefiLlama overview에는 통일된 원천 갱신 시각이 없다. `updatedAt`은 계산 완료 시각이고 CMC만 실제 원천 시각 범위를 별도로 노출한다.
- 30분 TTL 뒤 첫 요청은 stale 응답을 받고 백그라운드 재생성을 시작할 수 있다. 현재 배포의 초기 PRERENDER·canonical alias·upstream 대조는 검증했으며 다음 TTL 만료 주기까지 기다리지는 않았다.

## 배포

정상 배포 명령은 `npm run deploy:production` 하나다. 토큰 로드와 전체 절차는 [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md)를 따른다.
