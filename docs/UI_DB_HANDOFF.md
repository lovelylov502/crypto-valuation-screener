# 고정 비교표 UI → DB 연결 인수인계

## v0.5.0 통합 상태 · 2026-10-20

고정 비교표와 상세 차트에 일별 원자료 조회를 연결했다. 목록 API는 해당 페이지의 비교 요약을 한 번에 붙이고, 상세 `/api/history`는 같은 날짜의 자본 값과 하루 Revenue·Holders Revenue로 계산한 배수를 반환한다. 조회 요약은 원본 공개본·해시·재현 계약과 별도로 관리한다.

과거 비교의 기준 분포는 최근 비교점을 제외한 이전 365일이다. 365일 모두 양수인 유효 배수와 비교 가능한 수익 집계 기준을 갖춰야 `ready`로 표시한다. 전역 `asOf`는 검증된 공개본의 UTC 수집일에서 하루를 뺀 날짜와 UTC 기준 어제 중 이른 날짜다. 최근 완료된 UTC 날짜보다 하루를 넘게 뒤처지면 `stale_data`로 보류한다. 빠진 최근 값을 더 오래된 날짜에서 가져오지 않는다.

로컬 검사와 읽기 전용 실데이터 성능 측정을 진행했다.[^v050-read-bench] 실제 배포 확인과 수정된 원자료 워크플로의 실행 검증은 남아 있다. 아래 원문은 UI 단독 작업 당시의 완료 범위, 미연결 상태와 정책 결정을 기다리던 내용을 보존한 인수인계 기록이다. 현재 조회 계약은 [날짜별 원자료](./DAILY_RAW_DATA.md)를 따른다.

[^v050-read-bench]: 2026-10-20, 200종목 일괄 조회에서 캐시 전 FDV 3.045초·유통 시총 4.292초, 유통 시총의 캐시 재조회 89ms를 측정했다. 읽기 전용 연결로 DB 쓰기는 0회였다. 이 수치는 해당 조회의 성능 측정이며 배포·스케줄 실행 증거와 별도로 보존한다.

## 원본 UI 인수인계

작성일: 2026-10-20. UI 브랜치: `codex/valuation-table-ui`.
분기 기준 커밋: `486757cc60a8765c96535e12e37094b3d1c509c4`.

## 작업 위치와 완료 범위

- UI 체크아웃: `C:\Users\TAE\.codex\worktrees\valuation-table-ui\crypto-valuation-screener`
- DB 작업 체크아웃: `C:\Users\TAE\.codex\worktrees\3621\crypto-valuation-screener`. 이 문서의 UI 작업에서는 이 체크아웃을 수정하지 않았다.
- 구현: 고정 열 배치, 중앙값에서 최근 값까지 이어지는 막대, 계산 기준·자료 부족 문구, 기존 설정 이관, 응답 형식 검사.
- 미연결: DB의 일별 배수 요약을 목록 API에 붙이는 서버 처리. 현재 API가 선택 필드를 보내지 않으면 `과거 비교 연결 준비 중`으로 표시한다.
- DB 스키마·수집·스케줄·토큰·서버 비밀값은 변경하지 않았다. 로컬 검수의 가상 수치는 제품 코드와 공개 데이터에 포함하지 않는다.
- 상세페이지와 일별 수집/계산 수정은 DB 작업 브랜치의 범위다. 이 UI 브랜치는 기존 상세페이지를 유지한다.

## 고정된 화면과 두 계산 기준

| 위치 | 표시 | 계산 |
|---|---|---|
| 왼쪽 첫 열 | 종목 · 선택한 FDV 또는 유통 시총 | 최신 공개본의 값 |
| 왼쪽 P/R 5열 | 24시간 / 7일 / 30일 / 90일 / 1년 | 최신 가치 ÷ 해당 기간 Revenue의 연환산액 |
| 왼쪽 P/HR 5열 | 같은 5개 기간 | 최신 가치 ÷ 해당 기간 Holders Revenue의 연환산액 |
| 오른쪽 P/R 과거 비교 | 최근 일별 배수, 이전 365일 최저·중앙값·최고 | 해당 날짜 가치 ÷ (해당 날짜 24시간 Revenue × 365) |
| 오른쪽 P/HR 과거 비교 | 같은 형식 | 해당 날짜 가치 ÷ (해당 날짜 24시간 Holders Revenue × 365) |

왼쪽 기존 `referenceMultiple` 계산은 그대로 사용한다. 1년 열은 원천 1년 합계이며, 제공처 집계 표시는 유지한다. 수익 금액 열은 삭제했지만 금액·증가·홀더 수익 필터, 상세 근거와 내보내기 데이터는 유지한다. 열 표시·순서 설정은 제거했다. 기존 저장 설정에서 관심종목, 필터, 분자와 남아 있는 열의 정렬은 보존한다. 없어진 열의 정렬은 P/R 30일 오름차순으로 바꾼다.

오른쪽에는 기간별 수익 선택기가 없다. `365일`은 **과거 비교 범위**다. 매일 계산하는 분모는 언제나 **그 날짜 하루 수익 × 365**다. 왼쪽의 최신 24시간 배수와 오른쪽의 완료된 UTC 날짜 배수는 관측 시각이 달라 값이 다를 수 있다.

막대는 최저~최고의 선형 눈금이다. 중앙값을 실제 위치에 표시하고, 그 좌표에서 최근 값까지 파란선(중앙값보다 낮음) 또는 붉은선(높음)을 잇는다. 중앙값과 같으면 색 선의 길이는 0이다. 범위를 벗어나면 끝에서 멈추고 `과거 최저 미만` / `과거 최고 초과`를 표시한다. 퍼센트·점·일괄 50% 중앙값 위치는 사용하지 않는다.

## 연결 지점

형식 정의와 검사는 [`lib/valuationComparison.ts`](../lib/valuationComparison.ts), 표시는 [`components/ValuationComparisonCell.tsx`](../components/ValuationComparisonCell.tsx)와 [`components/ScreenerClient.tsx`](../components/ScreenerClient.tsx)에 있다.

[`ScreenerPage`](../lib/screenerQuery.ts)에 선택 필드 `valuationComparison?: ValuationComparisonPage`를 추가했다. [`/api/screener`](../app/api/screener/route.ts)의 기존 검색·정렬·페이지 처리 다음에, **해당 페이지 종목 전체의 요약을 한 번에** 붙이면 UI가 사용한다.

```ts
// 개념 예시. readDailyComparisonBatch는 DB 브랜치에서 구현할 함수다.
const prefs = parseWorkspace(params.get("prefs"));
const result = queryScreener(data, prefs, favorites, page, size);
const valuationComparison = await readDailyComparisonBatch({
  slugs: result.coins.map(c => c.slug),
  capital: prefs.capital,
});
return jsonResponse({ ...result, valuationComparison }, request.signal);
```

이 필드는 기존 불변 스크리너 공개본을 수정하지 않는 조회용 응답이다. 원본 스냅샷·해시·재현 계약에 덧붙여 저장하지 않는다. 기본 목록 데이터가 정상이고 이력만 실패하면 목록 전체를 실패시키지 않는다. 이력 미연결 상태를 유지하고 서버에서 해당 실패를 기록한다.

## API 예시

아래는 형식 설명용 가상 수치다. `asOf`는 최근 비교점의 완료된 UTC 날짜다. 이 날짜를 제외한 직전 365일을 기준 분포로 삼는다.

```json
{
  "valuationComparison": {
    "schema": 1,
    "capital": "fdv",
    "revenueDays": 1,
    "asOf": "2026-10-19",
    "baseline": {
      "from": "2025-10-19",
      "to": "2026-10-18",
      "expectedDays": 365
    },
    "rows": {
      "example-token": {
        "pr": {
          "status": "ready",
          "validDays": 365,
          "latest": { "date": "2026-10-19", "value": 5 },
          "minimum": 3,
          "median": 15,
          "maximum": 30
        },
        "phr": { "status": "insufficient", "validDays": 22 }
      },
      "parent#example": {
        "pr": {
          "status": "unavailable",
          "validDays": 0,
          "reason": "missing_capital"
        },
        "phr": {
          "status": "unavailable",
          "validDays": 300,
          "reason": "non_positive_revenue"
        }
      }
    }
  }
}
```

- `capital`: 요청의 `fdv` 또는 `mcap`과 일치해야 한다. FDV가 없을 때 시총으로 대체하지 않는다.
- `rows`: 화면의 정확한 `slug`가 키다. 부모 프로젝트의 `parent#...`도 원형을 유지한다. 목록의 모든 종목에 P/R·P/HR 상태를 각각 보낸다.
- `validDays`: **기준 365일 안에서 해당 배수를 유효하게 계산한 서로 다른 UTC 날짜 수**다. 최근 비교점은 세지 않는다. P/R와 P/HR의 일수는 다를 수 있다. 다운로드된 행 수나 수집 소요 일수가 아니다.
- `latest.date`: 전역 `asOf`와 같아야 한다. 그 날짜 값이 없으면 과거 값을 최근 값으로 옮겨 보내지 않는다.
- `ready`: 양수인 유한 배수와 `minimum ≤ median ≤ maximum`을 보낸다. 최근 값은 과거 범위 밖일 수 있다. 숫자는 반올림하지 않고 전송하며 UI에서 표시만 포맷한다.
- `insufficient`: 비교에 필요한 이력이 부족할 때 사용한다. 화면에 `1년 비교 자료 부족`, `배수 계산 가능: 22일 / 365일`처럼 표시한다.
- `unavailable.reason`: `not_collected`, `missing_capital`, `missing_revenue`, `non_positive_revenue`, `definition_changed` 중 하나다.
- 필드 자체가 없거나 `null`이면 미연결 상태다. 잘못된 분자·기간·날짜·숫자·누락 행은 `비교 자료 확인 필요`로 표시한다. 잘못된 값을 0으로 바꾸거나 막대를 그리지 않는다.

## DB 계산 조건

DB 체크아웃에서 읽어 확인한 연결 대상은 `docs/DAILY_RAW_DATA.md`, `lib/dailyRawData.ts`, `lib/dailyRawDatabase.ts`다. 새 원천은 `daily_raw_assets` / `daily_raw_days` / `daily_raw_sources`에 저장하며, `readDailyRaw`는 정확한 `{ slug, identity }`와 날짜 범위·커서로 읽는다. **기존 `history_*`와 `/api/history`가 새 원천을 자동으로 읽는 구조는 아니다.** 기존 후행 기간 배수를 그대로 목록에 붙이지 말고 새 일별 원천에서 같은 날짜 배수를 계산해야 한다. 이 확인은 코드·문서 확인이며 원격 DB의 수집 완료율 확인은 아니다.

서버는 요청 종목의 검증된 토큰 정체성과 `daily_raw_assets.identity`를 먼저 맞춘다. 같은 slug라도 토큰 이전 전후의 서로 다른 identity를 합치지 않는다. 원시 셀의 `complete` 양수만 배수 계산에 쓰고, `partial` / `missing` / `conflict`와 0·음수는 원래 상태와 근거를 유지한다. `fees`는 수집 원천으로 보존하되 이 P/R·P/HR 분모에는 넣지 않는다.

1. 날짜마다 그 날짜의 검증된 FDV/시총과 **같은 UTC 날짜**의 Revenue/Holders Revenue를 결합한다. 현재 FDV를 과거 수익에 나누지 않는다.
2. 끝나지 않은 UTC 날짜는 제외한다. 해당 날짜 자본 값의 관측 시각과 원천 증거는 DB에 보존한다.
3. 날짜 중복은 하나로 정리한 뒤 통계를 낸다. 누락·음수·0 수익은 유효 배수/중앙값에 넣지 않는다. 0을 수익 미확인과 혼동하지 않는다.
4. 원천 구성·토큰 연결·집계 정의가 달라진 날짜는 서로 비교 가능한지 확인한다. 혼합된 집계 기준을 그대로 한 중앙값으로 만들지 않는다.
5. 과거 중앙값은 일별 배수들의 중앙값이다. `중앙 FDV ÷ 중앙 수익`, 기간 수익으로 계산한 단일 배수, 현재 배수의 시계열로 대체하지 않는다.
6. `asOf`는 API 전체가 공유하는 검증된 완료일로 고른다. 기준일과 집계 revision을 함께 캐시 키에 사용한다. 표에는 `asOf`가 보인다. 자료가 며칠 이상 오래됐을 때 보류할지는 DB 운영 정책에서 정해야 한다.

**서버 연결 전에 확정할 정책:** 부분 이력을 언제 `ready`로 인정할지 정해야 한다. UI는 90일·180일 같은 임의 기준을 넣지 않았다. `ready`의 유효 일수가 365보다 적으면 그 일수도 표시한다. `insufficient`를 `ready`로 바꾸는 최소 일수와 결측 허용 범위는 DB 쪽의 테스트 가능한 정책으로 둔다. 아직 이 정책과 실제 DB 통계는 검증하지 않았다.

## 무료 한도와 조회 비용

- 브라우저가 행마다 `/api/history`를 호출하지 않도록 한다. 최대 200행 페이지도 요약을 일괄 조회한다.
- 일별 수집 후 요약을 계산해 캐시하거나, 완료일·분자·수집 revision별 서버 요약 캐시를 둔다. 매 클릭마다 전체 기간을 다시 읽지 않는다.
- API는 요약 숫자와 상태만 내려준다. 원천 일별 행과 증거는 상세 조회에서 필요할 때 읽는다.
- 조회 연결은 읽기 전용이다. 브라우저에 토큰을 전달하지 않는다. 무료 한도 정책·쓰기 권한·스케줄은 기존 DB 작업에서 관리한다.
- 이번 UI의 오른쪽 비교는 정렬·필터를 제공하지 않는다. 추후 과거 대비 조건 검색을 추가한다면 **전체 종목에서 필터/정렬 후 페이지 처리**해야 한다. 화면에 있는 100행만 정렬해서 전체 순위처럼 보이게 하지 않는다.
- 내보내기는 기존 검색 결과·원천 금액·기간별 참고 배수를 유지한다. 새 이력 요약은 아직 내보내기에 포함하지 않는다.

## 합칠 때 확인할 순서

1. DB 브랜치 작업을 보존한 상태에서 UI 커밋을 병합하거나 cherry-pick한다. UI 변경은 `ScreenerClient`, 페이지 CSS, 열/설정 이관, 선택 응답 타입, 테스트와 이 문서에 한정된다. 수집·계산 파일을 UI 버전으로 덮어쓰지 않는다.
2. 기존 목록 API에 일괄 요약을 붙인다. UI의 분자와 응답 분자가 바뀔 때 서로 다른 기준을 섞지 않는지 확인한다.
3. 실제 종목 몇 개를 골라 원시 금액으로 손계산하고, 요약의 최근 값·최저·중앙값·최고·일수를 확인한다. 누락 날짜·수익 0·정의 변경·FDV 미확보도 각각 검증한다.
4. 5배/15배, 30배/15배, 같은 배수, 과거 범위 밖, 동일한 최저·최고를 검증한다. 색 선의 한쪽 끝이 중앙값 선과 같은 좌표여야 한다.
5. 필터·관심종목·기존 기간별 정렬·페이지 처리·분자 전환·상세 열기·내보내기와 저장 설정 이관을 확인한다.
6. 이력 조회 실패와 DB 미연결 시에도 기존 목록을 사용할 수 있는지 확인한다. 실제 연결 검증을 마치기 전에는 로컬 가상 자료 검수를 실데이터 검증으로 기록하지 않는다.
7. 전체 테스트·타입 검사·빌드 후 UI와 DB의 검증 커밋을 함께 통합한다. 출시 버전은 통합 시 올린다. 이 UI 브랜치에서는 v0.3.0을 유지한다.
8. 배포는 canonical 루트 `C:\Users\TAE\Workspace\projects\hermes\crypto-valuation-screener`에서 `docs/DEPLOYMENT.md`의 검사와 `npm run deploy:production`으로만 진행한다. 이 인수인계 자체가 배포 실행 기록은 아니다.

UI 검수 근거와 남은 제한은 프로젝트 루트 [`design-qa.md`](../design-qa.md)의 2026-10-20 항목에 기록한다.

## v0.6.0 조회 경로 통합 · 2026-10-20

위 내용 중 미연결·정책 미확정 표기는 초기 UI 인수인계 시점의 기록이다. v0.5.0에서 같은 날짜의 원자료와 365일 전체 유효 비교 기준을 연결했다. v0.6.0에서는 목록을 `/api/screener?view=table`, 전체 상세 근거를 `/api/coin`, 차트를 `/api/history?format=version|compact`에 연결한다. 준비한 결과가 없거나 원자료 revision·완료일이 다르면 목록 비교는 `not_prepared`로 표시하며, 없는 과거 FDV와 수익을 채우지 않는다. 원본 전체 응답·내보내기·감사 계약은 유지한다. 생성 명령, 저장 구조와 버전 검증은 [조회 성능 구조](./FAST_READ_MODELS.md)를 따른다.
