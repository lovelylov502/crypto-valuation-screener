# Handoff

마지막 작업 기준: 2026-07-15

## 현재 상태

- 제품명: **크립토 밸류에이션 리서치** (`Crypto Valuation Research`)
- 라이브 URL: https://crypto-valuation-screener.vercel.app
- 기본 브랜치: `main`
- 제품 범위: **크립토 전용**. 주식·일반 기업 리포트는 이 저장소에 넣지 않는다.
- 기본 화면: `저·고평가 후보`. 섹터 상대가치로 싼 후보와 비싼 후보를 함께 보여주고 가치포획·희석·신선도로 검증한다.
- 로컬 검증 완료:
  - `npm test` (22개 통과)
  - `npx tsc --noEmit`
  - `npm run build`
  - 로컬 브라우저: 새 제품명·저/고평가 기본 화면·크립토 조사노트(Pendle만)·콘솔 에러 0

## 현재 UX 방향

새 IA:

- `저·고평가 후보`: 기본 홈. 저평가 검토·고평가 관찰·포획 함정·고희석·데이터 부족 후보를 보여준다.
- `크립토 조사노트`: DefiLlama/CoinGecko로 식별 가능한 크립토 리포트만 보관한다.
- `후보 큐`: 버킷별 후보 관리 화면.
- `가치포획 맵`: 싸냐 vs 토큰에 꽂히냐 2x2 구조.
- `원자료`: 기존 밸류 스크리너를 raw explorer로 보존.
- `방법론`: 상대가치 점수와 가치포획 검증 사용법.

핵심 구현 파일:

- `lib/valuation.ts`: 섹터 상대 밸류 점수 엔진.
- `lib/decision.ts`: DecisionSummary 엔진.
- `lib/researchReports.ts`: 크립토 전용 정적 조사노트.
- `components/CryptoDashboardClient.tsx`: 화면 전환 shell.
- `components/DecisionBoard.tsx`: 저·고평가 후보 홈.
- `components/CandidateDrawer.tsx`: 후보 상세 drawer.
- `components/ValueCaptureMap.tsx`: 2x2 가치포획 맵.
- `components/MethodologyScreen.tsx`: 방법론 화면.
- `components/ScreenerClient.tsx`: 원자료 탐색 테이블.

## 이전에 추가된 기능

### 1. 탭 구조

기존 밸류에이션 스크리너는 `밸류 스크리너` 탭으로 이동했고, 첫 화면은 `대시보드` 탭이 됐다.

- 구현: `components/CryptoDashboardClient.tsx`
- 기존 스크리너: `components/ScreenerClient.tsx`
- 연결: `app/page.tsx`

### 2. 시장/모멘텀 대시보드

CoinGecko `/coins/markets`에 `price_change_percentage=7d,14d,30d`를 붙여 가격 모멘텀 데이터를 보강했다.

대시보드 표시 항목:

- 14일 상승 비율
- 2~3주 모멘텀 후보 수
- 수수료 7일 개선 코인 수
- P/HR 중앙값
- 2~3주 모멘텀 후보 테이블
- 섹터별 14일 가격 흐름, 7일 수수료 흐름, 평균 밸류 점수

모멘텀 후보는 현재 아래 조건으로 필터링한다.

- 시총 `>= $10M`
- 거래량 `>= $1M`
- 14일 가격 변화율 `>= 10%`
- 30일 가격 변화율 `>= 5%`
- 7일 가격 변화율 `> -10%`

후보 정렬은 `momentumScore()`에서 14일 가격 변화율, 30일 가격 변화율, 7일 수수료 변화, 기존 밸류 점수를 섞어서 계산한다.

### 3. 스크리너 필터 개편

요청에 따라 점수 필터를 제거했다.

새 필터:

- 시총 최소/최대
- TVL 최소/최대
- P/HR 최소/최대

수수료 변화 열은 `최근 7일 vs 직전 7일`을 메인으로 표시하고, 기존 `최근 30일 vs 직전 30일`은 보조 텍스트로 남겼다.

### 4. BTC 온체인 밸류 지표

ResearchBitcoin API 연동 코드를 추가했다.

- 구현: `lib/onchain.ts`
- 응답 타입: `lib/types.ts`
- 대시보드 표시: `components/CryptoDashboardClient.tsx`

지원 지표:

- MVRV: `/v2/market_value_to_realized_value/mvrv`
- SOPR: `/v2/spent_output_profit_ratio/sopr`
- Realized Price: `/v2/realizedprice/realized_price`

API 토큰은 아래 환경변수 중 하나를 사용한다.

- `RESEARCHBITCOIN_API_TOKEN` (권장)
- `BITCOIN_LAB_API_TOKEN`

현재 Vercel 프로젝트에는 ResearchBitcoin 토큰이 없다. 그래서 라이브 대시보드에서는 온체인 카드가 `API 토큰 필요`로 표시된다. 토큰을 Vercel 환경변수에 추가하면 다음 빌드/ISR 갱신부터 실데이터가 표시된다.

## 데이터 소스

기존:

- DefiLlama `/protocols`
- DefiLlama `/overview/fees`
- DefiLlama `/overview/fees?dataType=dailyRevenue`
- DefiLlama `/overview/fees?dataType=dailyHoldersRevenue`
- DefiLlama `/overview/dexs`
- CoinGecko `/coins/markets`

추가:

- ResearchBitcoin API (토큰 필요)

## 배포 방법

PowerShell:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
$tok = (Get-Content "$HOME\.codex\env.json" -Raw | ConvertFrom-Json).env.VERCEL_TOKEN
npx vercel deploy --prod --yes --scope bodycation --token $tok
```

ResearchBitcoin 토큰 추가가 필요하면:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
$tok = (Get-Content "$HOME\.codex\env.json" -Raw | ConvertFrom-Json).env.VERCEL_TOKEN
npx vercel env add RESEARCHBITCOIN_API_TOKEN production --scope bodycation --token $tok
```

Vercel CLI가 값을 입력받는 프롬프트를 띄운다. 토큰 값은 문서나 코드에 저장하지 않는다.

## 주의할 점

- 이 프로젝트는 GitHub 저장소 `lovelylov502/crypto-valuation-screener`와 연결되어 있고 기본 브랜치는 `main`이다.
- `NODE_OPTIONS=--use-system-ca`가 없으면 Vercel CLI 또는 빌드 중 fetch가 로컬 CA 문제로 실패할 수 있다.
- DefiLlama 대형 응답은 Next fetch data cache 2MB 제한을 넘어 빌드 경고가 난다. 빌드는 성공하며 기존 문서상 무해한 경고로 취급 중이다.
- `.codex-screenshots` 같은 큰 임시 폴더를 프로젝트 안에 만들면 Next/Tailwind 빌드가 오래 걸릴 수 있다. 캡처/프로필은 `%TEMP%`에 만들 것.
- `lib/onchain.ts`는 토큰 없음/요청 실패 시 앱 전체를 실패시키지 않고 `missing-token` 또는 `unavailable` 상태로 내려준다.

## 다음 작업 후보

1. ResearchBitcoin 토큰 발급 후 Vercel 환경변수 추가.
2. 온체인 지표가 실제 값으로 뜨는지 라이브 `/api/screener`에서 확인.
3. MVRV/SOPR/Realized Price 기준 해석 문구 추가.
4. 모멘텀 후보 조건을 사용자가 조절할 수 있는 UI로 확장.
5. 초기 HTML/API 페이로드 경량화.
