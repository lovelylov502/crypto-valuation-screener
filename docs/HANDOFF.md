# Handoff

마지막 작업 기준: 2026-08-27

## 현재 제품

- 제품명: **크립토 밸류에이션 리서치**
- 라이브 URL: https://crypto-valuation-screener.vercel.app
- 기본 브랜치: `main`
- 범위: 크립토 전용 단일 화면 스크리너
- 주식·일반 기업 리포트, 정적 조사노트, 후보 큐, 가치포획 맵, 방법론 탭은 제품 범위 밖

## 현재 UX

- 내비게이션 탭 없이 `ScreenerClient`가 첫 화면에 바로 나온다.
- 빠른 보기: `저평가 80+`, `고평가 20 이하`, `점수 전체`.
- 범위: 밸류 점수, 시총, TVL, P/HR, P/S.
- 각 범위는 숫자 입력과 한 트랙의 좌우 손잡이 2개를 함께 쓴다.
- 보조 필터: 코인/심볼 검색, 좀비 숨김, 홀더수익만, 고희석 제외, 섹터 다중 선택.
- DefiLlama에 등록된 지 30일 이내이거나 7일 수수료 성장률이 50% 이상이면서 30일 현금흐름이 $10K 이상인 자산은 `신규 감지`로 표시하고 `신규만` 체크로 거른다.
- 코인 열의 별표는 브라우저에 저장되며 `★ 관심만` 체크로 모아볼 수 있다.
- 신규 감지와 관심종목은 후보 탐색에만 쓰며 밸류 점수와 가치포획 점수에는 넣지 않는다.
- 전체 초기화, 결과/전체 개수, 정렬, 코인 열 고정, 외부 링크를 지원한다.

## 핵심 파일

- `app/page.tsx`: 데이터 로드 후 단일 스크리너 렌더.
- `components/ScreenerClient.tsx`: 모든 필터·프리셋·정렬·표.
- `lib/screenerFilters.ts`: 범위 손잡이 경계, 점수 프리셋, 범위 매칭 순수 함수.
- `lib/sources.ts`: DefiLlama/CoinGecko 수집·parent 집계·조인.
- `lib/valuation.ts`: 멀티플·게이트·섹터 백분위·점수.
- `docs/METHODOLOGY.md`: 현재 방법론.

## 검증 완료

- `npm test`: 29개 통과
- `npx tsc --noEmit`: 통과
- `npm run build`: 통과
- 로컬 프로덕션 브라우저: 탭 0개, 양손잡이 5개, 저평가·고평가 프리셋, 별표 저장·새로고침 유지·관심만, 고희석 제외, 전체 초기화 확인
- 배포 직후 라이브 브라우저: 신규 감지·`신규만` 필터와 결과 행 전체의 배지 표시 확인
- 모바일: 페이지 가로 넘침 없이 표만 가로 스크롤, 코인 열 고정 확인
- 로컬 `/`·`/api/screener`: HTTP 200, 밸류·가치포획 점수와 holder revenue 비중 범위 이탈 0건
- 브라우저 콘솔 에러 0

## 알려진 검증 이슈

- `npm run lint`는 Next.js 16에서 제거된 `next lint` 스크립트를 아직 사용해 실패한다. 현재 변경은 테스트·타입체크·프로덕션 빌드로 검증했다.

브라우저 검수 기준:

- 탭 부재
- 프리셋 결과·정렬
- 양손잡이 시각·키보드 조작
- P/S·고희석·전체 초기화
- 모바일 가로 스크롤
- 콘솔 에러 0

## 배포

```powershell
$env:NODE_OPTIONS="--use-system-ca"
$tok = (Get-Content "$HOME\.codex\env.json" -Raw | ConvertFrom-Json).env.VERCEL_TOKEN
npx vercel deploy --prod --yes --scope bodycation --token $tok
```

빌드 중 2MB 초과 데이터 캐시 경고는 무해하다. 페이지 ISR 30분이 실제 캐싱을 담당한다.
