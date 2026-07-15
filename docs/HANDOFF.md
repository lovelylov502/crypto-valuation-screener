# Handoff

마지막 작업 기준: 2026-07-15

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
- 전체 초기화, 결과/전체 개수, 정렬, 코인 열 고정, 외부 링크를 지원한다.

## 핵심 파일

- `app/page.tsx`: 데이터 로드 후 단일 스크리너 렌더.
- `components/ScreenerClient.tsx`: 모든 필터·프리셋·정렬·표.
- `lib/screenerFilters.ts`: 범위 손잡이 경계, 점수 프리셋, 범위 매칭 순수 함수.
- `lib/sources.ts`: DefiLlama/CoinGecko 수집·parent 집계·조인.
- `lib/valuation.ts`: 멀티플·게이트·섹터 백분위·점수.
- `docs/METHODOLOGY.md`: 현재 방법론.

## 검증 완료

- `npm test`: 19개 통과
- `npx tsc --noEmit`: 통과
- `npm run build`: 통과
- 로컬 프로덕션 브라우저: 탭 0개, 양손잡이 5개, 저평가 23개·고평가 39개 프리셋, 고희석 제외, 전체 초기화 확인
- 브라우저 콘솔 에러 0

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
