# 작업 이력

## 2026-09-09 — v4 production publication

Published commit `bc9f614` through `npm run deploy:production`; deployment `dpl_4CxPS1VCdBrZykwNEBUT1guhZd19` is READY at the canonical public URL. All local gates and public page/API readback passed (696 rows, 2,213,583 API bytes). Live browser filtering and same-period detail passed with no console errors or warnings. Full deployment identity and evidence locations are in HANDOFF.md.

GitHub rejected publication of the new workflow because the active credential lacks `workflow` scope. Preserved the complete workflow at local branch `codex/screener-signal-ux-overhaul`, commit `ad6afc1`, and published the web application separately. Twice-daily unattended collection remains pending user authorization of the additional credential scope; request-based and manual website refresh are live.

## 2026-09-08 — signal and UX overhaul

Implemented the agreed broader discovery scope and refreshed the single-table experience. Added explicit source/refresh states, independent business/holder/transition observations, conservative zero/missing aggregation, same-window cashflow multiples and measured holder ratios, conditional-holder visibility, previous-view history and immutable daily collection receipts. Revised the production readback contract to v4 markers without changing source/deployment identity safeguards.

Added regression coverage for accounting, signal independence, history and refresh recovery. Introduced lucide-react for accessible controls and tsx for the snapshot CLI; updated the existing transitive nanoid patch after the dependency audit reported an advisory. npm audit reports zero vulnerabilities. See SCREENER_V4.md for complete behavior and deployment/schedule limits.


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

## 9. 크립토 밸류에이션 리서치로 범위 확정

- 제품명을 **크립토 밸류에이션 리서치**로 변경.
- 목적을 크립토의 저평가·고평가 후보 탐색과 근거 검증으로 명확화.
- `저·고평가 후보`를 기본 화면으로 변경하고 고평가 후보를 별도 노출.
- 주식 리포트 IREN을 제거하고, 조사노트가 DefiLlama/CoinGecko로 식별 가능한 크립토만 포함하도록 테스트 추가.
- Google OAuth client secret 파일 패턴을 `.gitignore`에 추가.

## 10. 단일 스크리너로 재단순화

- 사용자 피드백에 따라 조사노트·후보 큐·가치포획 맵·방법론을 포함한 탭 구조를 전부 제거.
- `app/page.tsx`에서 `ScreenerClient`를 직접 렌더하도록 변경.
- `저평가 80+`, `고평가 20 이하`, `점수 전체` 빠른 보기를 추가하고 점수 범위와 정렬을 함께 전환.
- 점수·시총·TVL·P/HR·P/S를 한 트랙의 양손잡이 범위로 통일하고 숫자 입력과 동기화.
- P/S 범위, 고희석 제외, 전체 초기화, 결과/전체 개수 표시를 추가.
- 사용하지 않는 decision/research/onchain 모듈과 관련 컴포넌트·스케치를 제거해 데이터 호출과 코드 복잡도를 줄임.
- 범위 손잡이 경계·프리셋·범위 매칭은 `lib/screenerFilters.ts` 순수 함수와 테스트로 분리.

## 11. 신규 감지·관심종목 단순화

- 네 단계 검토 상태 대신 코인별 별표 하나로 관심종목을 선택하도록 단순화.
- 별표는 브라우저 `localStorage`에 저장하고 `★ 관심만` 체크 필터를 추가.
- DefiLlama 최근 30일 등록 또는 7일 수수료 50% 이상 성장·30일 현금흐름 $10K 이상을 `신규 감지`로 표시.
- `신규만` 체크 필터를 추가하고 신규 판정·관심종목 직렬화 로직을 순수 함수 테스트로 검증.

## 12. Holder value 30일 정규화·경제유형 분리

- 사용자 피드백으로 DefiLlama `dailyHoldersRevenue`의 `total1y` 우선 사용과 모든 child 무차별 합산이 비교 불가능한 P/HR을 만든다는 점을 확인했다.
- `lib/holderValue.ts`를 추가해 child 방법론을 직접 분배·시장매입·매입+소각·수수료 소각·ve/voter/locker·불명확으로 분류했다. 분류는 `defillama-derived`이며 공식·온체인 검증으로 표시하지 않는다.
- 일반 P/HR과 holder-value 점수는 직접 분배·시장매입·매입+소각의 최근 30일 합계만 `×365/30`으로 연환산한다. raw TTM과 제외 합계·component는 별도 보존한다.
- 적격 최근 30일이 0/누락인데 TTM이 양수면 P/HR을 만들지 않고 중단·불연속 경고를 남긴다. 적격 추세도 최근/직전 30일의 같은 component 집합끼리 비교한다.
- fees·revenue·holder revenue·volume parent 합산에서 `doublecounted === true` row를 제외했다.
- UI에 `현재 홀더가치/년` 기본 열, `원천 HR TTM` 선택 열, 경제유형·DL 파생·경고, 적격 current 기준의 `현재 홀더가치만` 필터를 연결했다.
- 점수 버전을 `rediscovery-v2-holder-value`로 올렸다. 이전 작업 이력의 `홀더수익/년`·과거 P/HR 수치는 당시 구현 기록이며 현재 의미가 아니다.
- TDD RED는 미구현 분류 모듈, `doublecounted` 미제외, raw TTM 기반 P/HR, fee-burn 포획점수, raw 추세, holder-only 필터, UI 열 계약, 표시명, metadata rename·TTM 비교비율에서 각각 확인했다. GREEN 후 전체 44개 테스트가 통과했다.
- 실데이터 변환은 666행·약 1.72MB였고, canonical API readback은 666행·1,902,074바이트였다.
- 프로덕션 배포 `dpl_CYQd1JspKrpYAJeS4N4hrrttumKy`, 고유 URL `https://crypto-valuation-screener-6u4zczrzk-bodycation.vercel.app`, canonical alias `https://crypto-valuation-screener.vercel.app`를 확인했다.
- 로컬·canonical 데스크톱/390×844 모바일에서 열·tooltip·Aave/Canton/Aerodrome 경고·내부 표 스크롤·문서 overflow·console error를 확인했다.

## 13. Holder-value classifier 독립 감사 후 경계 강화

- 첫 배포 `dpl_CYQd1JspKrpYAJeS4N4hrrttumKy`는 독립 read-only 감사에서 매입·직접분배 false negative와 voter 제한 false positive가 확인돼 최종 승인하지 않았다.
- strict TDD로 Lido·Kodiak V3의 `bought back`/open-market buy 문법, Yearn·Sushi·GMX·Tectonic·send.fun의 명시적 staker 분배, Ramses·Aquarius의 `holders who vote/voted`, NEAR의 `not burned`, Pump의 incidental burn, 부정·vague·혼합 수익자 문구를 회귀 고정했다.
- 첫 classifier RED는 34개 중 13개 실패, live 전수검사에서 찾은 혼합 수익자·명시적 매입토큰 소각 회귀의 두 번째 RED는 52개 중 18개 실패였다. 이후 live 전후 차이 감사에서 찾은 과잉 제외 6개를 대표하는 세 번째 RED는 56개 중 4개 실패였다. 수정 후 holder-value 테스트 56개가 통과했다.
- live `dailyHoldersRevenue` 1,002행 중 금액이 있고 `doublecounted`가 아닌 422행을 모두 검사했다. 최종 분류는 eligible 178행(직접분배 61·시장매입 66·매입+소각 51), 제외 244행(ve/voter/locker 66·수수료 소각 46·불명확 132)이었다. eligible의 부정/제한 표식과 LP/referrer/trader/raffle/PoL 표식은 모두 0행이었다.
- 점수 대상 집합이 바뀌어 버전을 `rediscovery-v3-holder-classifier`로 올렸다. 전체 85개 테스트·typecheck·production build 후 `dpl_CWm85spvnfYJocqyoYyLcvj138kA`를 배포했다.
- canonical API는 664행·1,741,502바이트·PRERENDER였고 scoreVersion과 대표 parent/component 합계, Venice 과잉 제외 복구를 확인했다. 고유 URL은 Deployment Protection으로 보호돼 token 기반 `vercel curl`로 같은 readback을 확인했다.
- canonical 1440×900/390×844 브라우저 스모크에서 열·TTM 선택·tooltip·대표 경고·holder-only 필터·내부 표 스크롤·문서 overflow·console error를 확인했다.

## 14. Holder-flow 부정·중단 P0 보완

- 두 번째 독립 read-only 감사에서 배포 `dpl_CWm85spvnfYJocqyoYyLcvj138kA`가 `Fees are not distributed to holders`, `holders do not receive fees`, `no fees go to stakers`, `distributions have ended` 같은 문장을 직접분배로 오분류하는 P0를 확인해 승인하지 않았다.
- strict TDD 기준선은 holder-value 56개 통과였다. production 변경 전 첫 test-only RED는 85개 중 11개가 실제 `direct_distribution` false positive로 실패했고, 전용 제외 사유까지 고정하자 18개가 실패했다. 첫 수정 후 85개가 통과했다.
- adversarial probe에서 축약형, `no longer go`, `stopped paying`, `fee sharing ... ceased` 8개 경계를 추가로 찾았다. 두 번째 test-only RED는 93개 중 8개 실패였고, 최종 holder-value GREEN은 93개 통과다.
- holder/staker 지급 문장 안의 부정·중단만 문장 경계로 검사한다. unrelated burn negation은 건드리지 않아 NEAR Intents는 `market_buyback`, Pump의 onchain burn 조달 문구도 `market_buyback`으로 보존한다.
- 부정·중단 adversarial corpus 34개와 NEAR·Hyperliquid·Lido·Kodiak·Yearn·Sushi·Ramses·Aquarius·Pump·Pancake·Venice 보존 corpus 11개가 모두 통과했다.
- live `dailyHoldersRevenue` 1,002행 중 금액이 있고 비중복인 422행을 다시 검사했다. eligible 178행(직접분배 61·시장매입 66·매입+소각 51)의 holder-flow 부정, vote/bribe/gauge/locker, LP/referrer/trader/raffle/PoL 위험 표식은 각각 0행이었다.
- 전체 검증은 6 files·122 tests, typecheck, production build가 통과했다. 점수 공식·대상 의미를 바꾸지 않은 classifier bugfix라 `rediscovery-v3-holder-classifier`를 유지한다.
- production `dpl_9EejUd7cfdMGahBKPZ42U8aWrgUL`(`https://crypto-valuation-screener-cpifn4tgh-bodycation.vercel.app`)을 배포하고 canonical alias의 `/`·`/api/screener` HTTP 200, Ready, 664행·1,741,573 raw bytes·새 `updatedAt`, protected deployment의 token readback을 확인했다.
- canonical 1440×900/390×844 smoke는 문서 overflow 0, 표 내부 스크롤, holder/TTM label·tooltip, Aave/Canton/Aerodrome 경고, console error 0을 확인했다. HANDOFF의 favicon·외부 DefiLlama 아이콘 비차단 404 구분은 유지한다.

## 15. Wrong-source 프로덕션 롤백 방지

- 2026-08-31, 폐기된 `C:\Users\TAE\Workspace\projects\taegyu\holder revenue` 체크아웃의 commit `b6545b7a7c859707b6131b43f18858ce6fcf56bf`가 canonical과 같은 Vercel project/team에 연결된 채 배포돼 라이브와 remote `main`이 구형 UI로 되돌아간 사실을 확인했다.
- canonical `C:\Users\TAE\Workspace\projects\hermes\crypto-valuation-screener`의 `65ac2bc41917eb26f435d3d947ca151c9eed7698` 위에 있던 source/doc 변경은 초기 상태와 전체 diff를 확인한 뒤 그대로 보존했다.
- `scripts/deploy-contract.mjs`에 canonical 실경로, Git fetch/push 원격, Vercel project/team/name, legacy 금지 경로를 고정했다. 경로를 복제하고 동일한 `.vercel/project.json`을 넣어도 root 검사를 통과할 수 없다.
- `npm run deploy:production`은 preflight, 결정론적 양성·음성 probe, 전체 테스트, TypeScript, production build, `git diff --check`, Vercel 배포, canonical live readback을 순서대로 실행한다.
- canonical `/`는 `발굴 후보`·`65+ 전체`·`데이터 보류`를 요구하고 구형 프리셋을 거부한다. `/api/screener`는 score version, 고급 행 필드, 4.5MB 미만 payload를 확인한다.
- legacy 루트의 `.vercel/project.json`은 없는 상태를 확인하고 루트 `AGENTS.md`와 `LEGACY_DEPLOYMENT_BLOCKED.md`를 추가했다. source와 `.git` 이력은 보존했다. 초기 read-only identity probe 뒤 최종 음성 검증은 안전한 임시 noncanonical fixture에서 수행했으며, legacy에서는 application/build/test/deploy를 실행하지 않는 hard stop을 유지한다.
- 초기 복구 배포 `dpl_BDFVzUPp6G48q8GdzSuV4NaaLqkA`(`https://crypto-valuation-screener-iq34mxvpb-bodycation.vercel.app`)이 고급 UI를 복원했다. clean·synchronized `main`까지 요구하는 최종 가드와 guarded main promotion 전의 중간 복구였으며 아래 최종 배포가 이를 대체한다.
- canonical `/`는 HTTP 200·HIT·2,200,011바이트이며 고급 UI 표식 3개가 있고 구형 표식은 없다. `/api/screener`는 HTTP 200·HIT·687행·1,802,734바이트·`scoreVersion=rediscovery-v3-holder-classifier`·`updatedAt=2026-08-31T02:27:58.197Z`였다.
- Windows 터미널 자식 출력에 기존 인증값이 나타날 수 있는 경로를 발견해 해당 토큰을 폐기하고 프로젝트 범위 토큰으로 교체했다. 기존 토큰은 HTTP 403, 교체 토큰은 예상 project/team HTTP 200이었다. 배포 래퍼는 CLI 출력을 캡처·마스킹하며 이 동작을 회귀 probe로 고정했다.

## 16. Canonical main 복구와 guarded production 확정

- remote `main`을 교체하기 전에 `backup/wrong-main-b6545b7-2026-08-31`을 만들고 원격 SHA가 `b6545b7a7c859707b6131b43f18858ce6fcf56bf`인지 확인했다. 그 뒤에만 같은 expected SHA를 lease로 지정한 `force-with-lease`를 사용했다. 잘못된 commit은 삭제하지 않았다.
- 보존한 canonical source/doc 27개 변경과 배포 가드를 `c114db4d6d871e494a1e5b26adbbd64966377d68`에 커밋했다. pinned CLI dry-run 보완까지 포함한 배포 source는 `81314f796f1830c094cc72fd11d52f8cfab0588b`이며, 로컬 브랜치를 `main`으로 이름 바꾸고 `origin/main`과 동일하게 맞췄다.
- `npm run deploy:preflight`는 canonical 실경로, 정확한 Git fetch/push 원격, `main`/`origin/main`, clean worktree, `HEAD == origin/main`, Vercel project `prj_zOmxeQWmBjp5MAUmmYFALM8AC6Cc`와 team `team_2dxBFycQaaHuXjESEf0kCkFG`를 출력하고 통과했다.
- 같은 remote와 `.vercel/project.json`을 복제한 임시 fixture `C:\Users\TAE\AppData\Local\Temp\crypto-screener-preflight-fixture-20260831-1136`에서는 `WRONG_WORKING_DIRECTORY`·`WRONG_GIT_ROOT`와 종료 코드 1을 확인했다. fixture는 경로를 재확인한 뒤 제거했다.
- 최종 검증은 배포 안전 probe 6개, Vitest 122개(6 files), `npx tsc --noEmit`, `NODE_OPTIONS=--use-system-ca npm run build`, `git diff --check`가 통과했다. 로컬 1440×900·390×844 UI에서 프리셋, 검색, 열 선택, 페이지 이동, 필터 패널, 문서 overflow 0, 표 내부 스크롤, console error 0을 확인했다.
- `npm run deploy:production`이 preflight, authenticated remote project 확인, local gate, pinned Vercel CLI dry run, production deploy, canonical readback을 수행했다. 최종 배포는 `dpl_GHgHLwfUiY5CYD2bEeav4SgNCbJL`(`https://crypto-valuation-screener-fh3zzlq2x-bodycation.vercel.app`)이며 Vercel API에서 `READY`, production target, 예상 project/team, Git SHA `81314f796f1830c094cc72fd11d52f8cfab0588b`, canonical alias를 확인했다.
- 고유 배포 URL은 Vercel Login 보호 화면을 반환하므로 공개 HTML/UI/API readback은 canonical alias에서 수행했다. 고유 배포 자체의 상태·identity·alias는 authenticated Vercel API와 배포 CLI로 검증했다.
- canonical `/`는 HTTP 200·HIT·2,194,351바이트, 고급 표식 3개, 구형 표식 0개다. `/api/screener`는 HTTP 200·HIT·685행·1,797,606바이트, `scoreVersion=rediscovery-v3-holder-classifier`, 고급 row fields, `updatedAt=2026-08-31T02:49:16.805Z`를 반환했다.
- 라이브 브라우저 데스크톱에서 `데이터 보류` 프리셋을 눌러 530개 결과와 pressed 상태를 확인했다. 390×844에서는 문서 overflow 0, 338px 컨테이너 안 1,087px 표 내부 스크롤, 고급 표식 3개·구형 표식 0개·console error 0을 확인했다.
