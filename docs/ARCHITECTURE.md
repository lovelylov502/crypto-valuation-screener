# 아키텍처

> Current contract: [SCREENER_V6.md](./SCREENER_V6.md), `research-v6-fundamental-scope`. The sections below are the historical v3 baseline and are superseded where they conflict with v6.

## 데이터 흐름

```
DefiLlama(5 endpoints + methodology) + CMC Keyless + CoinGecko
        │  fetch + parent/component 집계 + canonical 토큰 검증
        ▼
   lib/holderValue.ts + lib/sources.ts  ──→  CoinRaw[]
        │  멀티플·섹터백분위·종합점수 (순수함수)
        ▼
   lib/valuation.ts ──→ 게이트 + 4축 점수 + 상태/신뢰도
        │  조립 + 카테고리/정렬/FDV커버리지
        ▼
   lib/screener.ts ──→ ScreenerResponse
        ├──→ app/page.tsx (서버컴포넌트, ISR 30분) ──→ components/ScreenerClient.tsx
        └──→ app/api/screener/route.ts (JSON)
```

서버에서 전 코인 점수를 계산한 뒤 `lib/screener.ts`에서 시총 $1M 이상 자산만 공통 응답으로 조립한다. 페이지와 `/api/screener`는 같은 universe를 받고, 판단보류도 표에 남긴다. 필터·정렬은 클라이언트에서 즉시 처리한다(리페치 없음).

## 조인이 핵심 (가장 까다로운 부분)

DefiLlama는 한 프로젝트를 **여러 child 엔트리로 쪼갠다**. 예: Hyperliquid =
`hyperliquid-perps` + `hyperliquid-spot-orderbook` + `hyperliquid-l1` …
그리고 시총(mcap)·gecko_id는 child에 없을 수 있고(=0/빈), holder revenue는 child별로 분산된다.

이걸 그대로 slug 단위로 조인하면 → 시총 누락 + 수익 분산 → **주요 토큰(HYPE 등)이 통째로 누락**된다.

### 해결: parent 집계와 토큰 정체성 검증 분리 (`lib/sources.ts`)

1. overview(fees/revenue/holderRev/dexs)에서 `slug → parentProtocol` 매핑 수집.
2. `groupKey(slug) = parentProtocol ?? slug` 로 모든 데이터를 그룹화.
3. fees·매출·거래량은 `doublecounted === true` row를 뺀 뒤 그룹별로 합산한다. 직전 30일 `total60dto30d`도 합산해 성장률을 재계산한다.
4. holder revenue는 child별 `HoldersRevenue` 설명을 먼저 경제유형으로 분류한다. 부정형·voter/bribe/gauge 제한·혼합 수익자를 선제 제외하고, 매입 문법과 매입 토큰 소각의 명시적 연결을 구분한다. 적격 최근 30일만 연환산하고, raw TTM·제외 합계·component·불연속 사유를 함께 보존한다. holder overview의 `doublecounted === true` row도 제외한다.
5. `/protocols`도 같은 groupKey로 묶어 그룹별 대표 메타(name·category·logo·symbol) 선정.
6. parent 구성원에 여러 `gecko_id` 또는 심볼이 있으면 `ambiguous`로 표시하고 점수 산출을 중단.
7. 단일 토큰 그룹만 CMC canonical 자산과 엄격히 매칭한다.

`CoinRaw.holderValue`의 primary는 `eligibleRunRate = eligibleCurrent30d × 365/30`이다. `rawTtm`은 별도 원천값이며 P/HR에 들어가지 않는다. `components`에는 전체 방법론 문장 대신 slug·경제유형·적격 여부·30일·직전 30일·TTM·짧은 분류 사유만 담아 Vercel 응답 크기를 제한한다.

### 시장 데이터 매칭 우선순위

```
1. CoinGecko `gecko_id`와 CMC slug의 정확 일치.
2. parent slug 또는 프로젝트명+심볼의 정확 일치.
3. 단일 심볼 후보이면서 프로젝트명/slug도 일치.
4. 검증된 예외만 `CMC_SLUG_OVERRIDES`로 연결.
5. canonical CMC가 없으면 DefiLlama/CoinGecko 보조 시총은 표시할 수 있지만 발견 점수는 보류.
```

> ⚠️ **symbol 폴백의 함정**: 같은 심볼을 쓰는 자산이 많으므로 symbol-only 매칭은 금지한다. 자동 매칭이 실패하면 coverage보다 정확성을 우선해 `데이터 보류`로 남긴다.

## 캐싱

- 페이지·API route 모두 `revalidate = 1800` (30분 ISR).
- DefiLlama와 CMC 원천 응답은 2MB를 넘어 Next의 **fetch 데이터 캐시**에 들어가지 않는다. 빌드·ISR 때 보이는 경고는 원천 fetch가 route 간에 재사용되지 않는다는 뜻이며, 각 route 재생성은 현재 원천을 다시 조회한다. 이 경고는 아래 15.2MB API route 응답 실패와 별개의 제약이다.
- CoinMarketCap Keyless listings 5000개는 TTL 30분, 429 응답은 지수 백오프한다.
- CoinGecko는 1년·ATH·ATL 보조를 위해 상위 ~1000개(per_page 250 × 4페이지)만, TTL 6시간.
- 점수와 섹터 분포는 전체 원천 universe로 계산한다. 이후 `lib/screener.ts`에서 시총 $1M 이상만 남겨 페이지와 `/api/screener`에 동일하게 전달한다. 2026-08-17 복구 전 전체 6,701행 API는 15.20MB라 Vercel Function 4.5MB 응답 한도를 넘겼다. holder-value compact component metadata를 추가한 현재 canonical 응답은 664행·1,741,502바이트다.
- `updatedAt`은 계산 완료 시각이다. `marketDataFreshness.oldestAt`~`newestAt`은 반환 행에 포함된 CMC `quote.last_updated`의 실제 범위다. DefiLlama overview에는 모든 행에 공통으로 쓸 원천 갱신 시각이 없어 계산 시각을 원천 시각처럼 표시하지 않는다.
- ISR은 요청 시점에 만료를 감지한다. TTL 뒤 첫 요청은 stale 응답을 받고 백그라운드 재생성을 시작할 수 있다.

## 성능 (스크리너 테이블)

- 슬라이더/입력 등 필터는 즉시 state 반영, 무거운 테이블 렌더는 `useDeferredValue`로 지연 → 드래그 버벅임 완화.
- 점수·시총·TVL·P/HR·P/S 범위는 한 트랙의 양손잡이 슬라이더 ↔ 숫자입력을 양방향 동기화. P/HR 범위와 `현재 홀더가치만`은 적격 current run-rate를 따른다.
- 기본 열은 `현재 홀더가치/년`에 경제유형·DefiLlama-derived·경고를 압축 표시하고, raw TTM은 `원천 HR TTM` 선택 열로 분리한다.
- `발굴 후보`·`65+ 전체`·`데이터 보류` 프리셋은 상태/점수 필터와 정렬을 함께 바꾼다.
- 코인 이름 열은 `position: sticky; left: 0` 으로 가로 스크롤 시 고정.

## 환경

- 사내/로컬 CA 환경이라 Node의 outbound TLS가 막힘 → `NODE_OPTIONS=--use-system-ca` 필수 (dev·build·deploy 모두).
- canonical 프로젝트 경로는 `projects/hermes/crypto-valuation-screener`다. Vercel 배포 scope는 `bodycation`, 프로젝트는 `crypto-valuation-screener`다.
