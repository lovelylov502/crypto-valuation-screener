# 아키텍처

## 데이터 흐름

```
DefiLlama(4종) + CoinGecko
        │  fetch + parent 집계 + 조인
        ▼
   lib/sources.ts  ──→  CoinRaw[]
        │  멀티플·섹터백분위·종합점수 (순수함수)
        ▼
   lib/valuation.ts ──→ CoinScored[]
        │  조립 + 카테고리/정렬/FDV커버리지
        ▼
   lib/screener.ts ──→ ScreenerResponse
        ├──→ app/page.tsx (서버컴포넌트, ISR 30분) ──→ components/ScreenerClient.tsx
        └──→ app/api/screener/route.ts (JSON)
```

서버에서 전 코인 점수를 계산해 **점수가 산출된 코인만** 클라이언트로 전달한다. 필터·정렬은 클라이언트에서 즉시 처리(리페치 없음).

## 조인이 핵심 (가장 까다로운 부분)

DefiLlama는 한 프로젝트를 **여러 child 엔트리로 쪼갠다**. 예: Hyperliquid =
`hyperliquid-perps` + `hyperliquid-spot-orderbook` + `hyperliquid-l1` …
그리고 시총(mcap)·gecko_id는 child에 없을 수 있고(=0/빈), holder revenue는 child별로 분산된다.

이걸 그대로 slug 단위로 조인하면 → 시총 누락 + 수익 분산 → **주요 토큰(HYPE 등)이 통째로 누락**된다.

### 해결: parent 단위 집계 (`lib/sources.ts`)

1. overview(fees/revenue/holderRev/dexs)에서 `slug → parentProtocol` 매핑 수집.
2. `groupKey(slug) = parentProtocol ?? slug` 로 모든 데이터를 그룹화.
3. 그룹별로 fees·매출·holder revenue·거래량을 **합산** (직전 30일 `total60dto30d`까지 합산해 성장률 재계산).
4. `/protocols`도 같은 groupKey로 묶어 그룹별 대표 메타(name·category·logo·symbol) 선정.

### 시총(mcap) 매칭 우선순위

```
1. DefiLlama가 아는 mcap (그룹 내 최대, >0)
2. 없으면 CoinGecko:
   - gecko_id 있으면 byId 매칭 (폴백 없음 — 상위 1000 밖이면 시총 없음)
   - gecko_id 없을 때만 symbol 폴백 (시총 최상위 매칭) + 현금흐름 있는 그룹에만
```

> ⚠️ **symbol 폴백의 함정**: gecko_id가 있는데도 폴백하면, 상위 1000 밖 코인(예 HyperBlast, gecko=`hyperblast`)이 같은 심볼의 대형 코인(HYPE) 시총을 잘못 가져온다. 그래서 **gecko_id가 있으면 절대 폴백하지 않고**, 폴백은 **실제 현금흐름이 있는 그룹에만** 적용한다.

## 캐싱

- 페이지·API route 모두 `revalidate = 1800` (30분 ISR).
- DefiLlama 응답이 2MB를 넘어(`/protocols` ~10MB) Next의 **fetch 데이터 캐시**엔 안 들어가지만, **페이지 레벨 ISR이 실제 캐싱**을 담당하므로 문제없다. 빌드 시 나오는 `Failed to set Next.js data cache … over 2MB` 경고는 무시.
- CoinGecko는 무료 레이트리밋 때문에 상위 ~1000개(per_page 250 × 4페이지)만, TTL 6시간.

## 성능 (스크리너 테이블)

- 슬라이더/입력 등 필터는 즉시 state 반영, 무거운 테이블 렌더는 `useDeferredValue`로 지연 → 드래그 버벅임 완화.
- 규모 필터는 로그 슬라이더 ↔ 숫자입력(M 단위) 양방향 동기화.
- 코인 이름 열은 `position: sticky; left: 0` 으로 가로 스크롤 시 고정.

## 환경

- 사내/로컬 CA 환경이라 Node의 outbound TLS가 막힘 → `NODE_OPTIONS=--use-system-ca` 필수 (dev·build·deploy 모두).
- Windows / PowerShell. 디렉토리명에 공백(`holder revenue`)이 있어 Vercel `--project` 이름을 명시해야 함.
