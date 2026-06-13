# 작업 이력

이 프로젝트가 어떻게 만들어졌는지의 기록. (역순 아님, 시간순)

## 1. 데이터 소스 조사 & 설계

- 요구: DefiLlama MCP 등으로 코인 저/고평가 판단 툴 → 웹 배포.
- **DefiLlama 무료 API**(키 불필요)만으로 시총·TVL·수수료·매출·거래량·카테고리 확보 가능 확인. `/protocols` 응답에 `mcap`·`gecko_id`가 실제 포함됨(7,600여 개).
- 4개 엔드포인트를 `slug`로 조인(검증: fees 2,252개 중 2,092개=93% 매칭).
- FDV는 무료 API에 없어 **CoinGecko `/coins/markets`**로 상위 코인 보강.
- 결정: 전체 코인, 규모(시총/TVL) 필터, P/F·P/S·Mcap/TVL·섹터상대·성장성, 스크리너 테이블, Next.js+Vercel.

## 2. 초기 구축

- Next.js 16 + TS + Tailwind v4 + Vitest 스캐폴딩.
- 데이터 레이어(`lib/sources.ts`), 밸류에이션 엔진(`lib/valuation.ts`) + 단위 테스트, API route, 스크리너 UI.
- **노이즈 발견**: 토큰 미발행/마이크로캡이 Mcap/TVL≈0으로 "초저평가" 1위를 독식 → **시총 $1M 게이트** + 밸류 멀티플 없으면 판단보류로 수정.
- 빌드·스모크 테스트 통과 → GitHub(`lovelylov502/crypto-valuation-screener`) 푸시.

## 3. Vercel 배포 (삽질 기록)

- 토큰 비대화형 배포가 자꾸 `bodycation` 팀으로 감 → 한참 "남의 팀"으로 오해하고 토큰을 두 번 재발급하게 함.
- **진상**: `team_2dxBF…`의 name이 "lovelylov502-2848's projects", **slug가 `bodycation`** — 즉 `bodycation`은 사용자 **개인 계정의 slug**였다. 처음부터 다 맞았던 것.
- 교훈: Vercel 개인 계정도 내부적으로 team 형태이고 slug가 비직관적일 수 있다. CLI는 개인 계정을 username으로 `--scope` 지정하는 걸 거부 → slug(`bodycation`)를 쓴다.
- 라이브: https://crypto-valuation-screener.vercel.app

## 4. UI 개편 & holder revenue 도입

- 사용자 요청: 코인 이름 열 고정 / P/F·Mcap/TVL·FDV/TVL·수수료년 열 삭제 / 필터 숫자입력 + 버벅임 해결.
- 고수 방식 조사(Token Terminal·Messari) → **P/HR(홀더수익 기준 크립토 PER)** 을 점수 핵심(28%)으로 채택. NVT·Real Yield는 중복/커버리지 한계로 제외.
- DefiLlama `dataType=dailyHoldersRevenue` 추가(858개 커버), P/HR·홀더수익/년·매출30d 열 추가.
- 코인 열 sticky 고정, 규모 필터 숫자입력(M단위)+슬라이더 동기화, `useDeferredValue`로 버벅임 완화, 최소점수·홀더수익보유 필터 추가.

## 5. parent 집계 버그 수정 (Hyperliquid 누락)

- 증상: "홀더수익 있는 것만" 필터에 **Hyperliquid(holder revenue 1위, 연 $835M)가 없음**.
- 원인 2중:
  1. Hyperliquid의 DefiLlama 엔트리는 `gecko_id`가 비어 CoinGecko 시총($16.3B)이 안 붙음 → 마이크로캡 오인.
  2. holder revenue가 `hyperliquid-perps`+`spot`로 분산 → `parent#hyperliquid` 합산 필요.
- 수정: **데이터 레이어를 parent 단위 집계로 재작성** + gecko_id 없을 때만 symbol 폴백(현금흐름 그룹 한정).
- 부작용 차단: 같은 심볼(HYPE)의 무관한 엔트리(Bridge·HyperBlast)에 시총이 잘못 붙던 것 제거.
- 결과: **Hyperliquid 한 행, 시총 $16.3B · holder revenue $875M · P/HR 18.6x**. Aave V2+V3 등 멀티-엔트리 프로토콜 정합성도 함께 개선.

## 6. 문서화 & 정리

- `CLAUDE.md`, `docs/`(METHODOLOGY·ARCHITECTURE·WORKLOG) 작성.

## 7. 크립토 상황 대시보드 & 온체인 지표 준비

- 사용자 요청: 기존 스크리너를 탭으로 옮기고, 크립토 시장 상황을 한눈에 보는 대시보드 추가.
- `components/CryptoDashboardClient.tsx` 추가: `대시보드` / `밸류 스크리너` 탭 구조.
- CoinGecko `price_change_percentage=7d,14d,30d`를 붙여 가격 모멘텀 데이터 보강.
- 2~3주 모멘텀 후보, 섹터 흐름, 14일 상승 비율, 수수료 7일 개선 지표 추가.
- 기존 점수 필터 제거. 시총/TVL은 최소·최대 범위 필터로 변경. P/HR 최소·최대 범위 필터 추가.
- 수수료 변화는 `최근 7일 vs 직전 7일`을 주 표시로 변경하고, 30일 전후 비교는 보조 표시로 유지.
- ResearchBitcoin API 연동 모듈(`lib/onchain.ts`) 추가. MVRV·SOPR·Realized Price 지원 준비.
- ResearchBitcoin은 `X-API-Token` 필요. 현재 Vercel 환경변수에는 토큰이 없어 라이브에서는 `API 토큰 필요`로 표시.
- 배포 완료: https://crypto-valuation-screener.vercel.app (`dpl_8QQ7AjJLZVsC4hg1mrxtGugmwv6T`)
- 별도 인수인계 문서: `docs/HANDOFF.md`

## 8. Token Value Capture Workbench 전환

- 사용자 동의 후 기존 숫자표 중심 UX를 **Token Value Capture Workbench**로 전환.
- `lib/decision.ts` 추가: 각 코인을 `research-priority`, `cheap-but-unclear-capture`, `dilution-risk`, `data-missing` 등 실제 리서치 상태로 분류하고 thesis/evidence/risks/unknowns/nextQuestions를 만든다.
- `lib/decision.test.ts` 추가: 직접 holder revenue 후보, 포획 불명확 함정, 고희석, 데이터 부족 케이스를 TDD로 검증.
- `CryptoDashboardClient`를 새 IA로 재작성: `의사결정`, `후보 큐`, `가치포획 맵`, `원자료`, `방법론`.
- `DecisionBoard`, `CandidateDrawer`, `ValueCaptureMap`, `MethodologyScreen` 컴포넌트 추가.
- 기존 `ScreenerClient`는 `원자료` 탭으로 보존해서 숫자 검산/필터링 용도로 유지.
- 검증: `npm test` 18개 통과, `npx tsc --noEmit`, `npm run build`, 로컬 브라우저 스모크(탭/상세 drawer/콘솔 에러 0).
