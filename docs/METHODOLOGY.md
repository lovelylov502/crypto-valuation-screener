# 재발견 후보 점수 방법론

> Current contract: [SCREENER_V8.md](./SCREENER_V8.md), `research-v8-coverage-and-holder-types`. The sections below preserve the historical v3 baseline. V8 includes reviewed native fee burns and conditional staking/lock/voter distributions with explicit conditions; its eligibility, sales/revenue distinction and dated-window rules supersede conflicting statements below.

목표는 단순히 멀티플이 낮은 코인이 아니라 **토큰에 귀속되는 펀더멘털은 개선되지만 가격에는 아직 충분히 반영되지 않은 프로젝트**를 찾는 것이다.

아래에 기록된 당시 점수 버전은 `rediscovery-v3-holder-classifier`다.

## Holder value 정규화와 적격성

DefiLlama `dailyHoldersRevenue`는 직접 현금 분배만 뜻하지 않는다. 각 child protocol의 `methodology.HoldersRevenue`를 다음 경제유형으로 보수적으로 분류한다.

| 경제유형 | 일반 P/HR | 처리 |
|---|---:|---|
| 직접 홀더·스테이커 분배 | 포함 | 분배·지급·보상 방식이 구체적으로 명시된 경우 |
| 시장매입 | 포함 | `buy back`·`bought back`·`by back`·open-market 매입처럼 실제 토큰 매입이 명시된 경우 |
| 시장매입 후 소각 | 포함 | 매입한 토큰의 소각이 문법적으로 연결되거나 burn address 전송이 명시된 경우 |
| 수수료·네이티브 토큰 소각 | 제외 | 시장매입 없이 프로토콜 수수료가 소각되는 경우 |
| ve/voter/locker 한정 분배 | 제외 | ordinary token holder 전체가 아닌 제한된 수익권 |
| 불명확·기타 | 제외 | `Money going to governance token holders` 같은 귀속 방식 미상 문구 또는 방법론 누락 |

분류는 DefiLlama 설명에서 파생한 `defillama-derived` 상태다. 공식 검증·온체인 검증으로 부르지 않는다.

분류 경계는 다음과 같이 보수적으로 적용한다.

- `goes to TOKEN stakers`, `paid out to people who stake TOKEN`처럼 수익자와 지급 동작이 함께 명시된 흐름은 직접 분배다. `goes to holders`만 있는 문장은 일반화하지 않는다.
- `vote/voted/voting`, vote-escrow, bribe, gauge, voter, locker로 수익권이 제한되면 `ve/voter/locker`로 제외한다.
- holder/staker 지급 문장 안의 부정·중단을 긍정 분류보다 먼저 적용한다. `is/are/was/were not distributed/paid/allocated/shared`, `holders do not/did not/no longer receive/get/earn`, `no fees/revenue/rewards go to`, `does/did not go to`, 지급·분배·revenue sharing의 `ended/ceased/stopped/suspended/disabled`와 자연스러운 축약형도 불명확으로 제외한다. 긍정·부정 문장이 섞여 금액을 분리할 수 없는 component도 보수적으로 제외한다.
- `not burned`는 시장매입으로 남긴다. `buyback (sourced from onchain burns...)`처럼 burn이 조달·주변 문맥일 뿐이면 매입+소각으로 올리지 않는다.
- 일반 홀더·스테이커와 LP·referrer·trader·raffle·protocol-owned-liquidity 같은 수익자가 한 component에 섞여 금액을 나눌 수 없으면 불명확으로 제외한다.

2026-08-17 live `dailyHoldersRevenue` 재감사에서는 원본 1,002행 중 금액이 있고 `doublecounted`가 아닌 422행을 전수 분류했다. eligible 178행에서 holder-flow 부정, vote/bribe/gauge/locker, LP/referrer/trader/raffle/PoL 위험 표식은 각각 0행이었다. 별도 부정·중단 adversarial corpus 34개도 모두 제외됐다. 이 개수는 DefiLlama 원천 변화에 따라 달라지는 시점 스냅샷이다.

- 현재 적격 holder value = parent 안의 적격 child `total30d` 합계.
- 현재 holder-value run-rate = `적격 30일 합계 × 365/30`.
- P/HR = `시총 / 현재 holder-value run-rate`.
- raw TTM = `doublecounted`가 아닌 전체 child `total1y` 합계. 경제유형별 component와 제외 합계를 함께 보존하며 P/HR 분모로 쓰지 않는다.
- 최근·직전 30일 추세는 같은 적격 component 집합의 `total30d`와 `total60dto30d` 합계끼리 비교한다.
- 적격 최근 30일이 0/누락인데 적격 TTM이 양수면 현재 P/HR을 비우고 중단·불연속 경고를 표시한다.
- fees·revenue·holder revenue·volume overview에서 `doublecounted === true`인 row는 parent 합계에서 제외한다.

## 1. 점수보다 먼저 적용하는 필수 게이트

다음 조건 중 하나라도 실패하면 발견 점수를 산출하지 않고 `데이터 보류`로 분류한다.

1. **토큰 정체성**: 프로젝트/parent 현금흐름과 canonical 시장 토큰의 연결이 확인돼야 한다.
2. **시장 데이터**: 12시간 이내 CMC 가격·시총·60일 변화·24시간 거래량이 있어야 한다.
3. **펀더멘털 이력**: 적격 holder value·매출·수수료 중 하나 이상에서 최근 30일과 직전 30일 값이 있어야 한다.
4. **유동성**: `24h 거래량 ≥ max($100K, min($5M, 시총×0.5%))`.
5. **희석**: FDV가 있어야 하며 `FDV/Mcap > 3.33`이면 언락 정보를 확보하기 전까지 보류한다.
6. **상장기간**: CMC 상장 90일 미만은 기존 점수 대신 `신규 프로젝트` 트랙으로 보낸다.
7. **활동성과 규모**: 연 수수료·매출·현재 적격 holder-value run-rate가 모두 $100K 미만이거나 최근 현금흐름이 없으면 보류한다. 시총 $1M 미만도 보류한다.

## 2. 발견 점수 100점

결측값은 0점으로 남기며, 남은 지표의 가중치를 재정규화하지 않는다.

### 펀더멘털 가치 30

| 항목 | 점수 |
|---|---:|
| 섹터 P/HR 백분위 | 15 |
| 섹터 P/S 백분위 | 5 |
| 섹터 P/F 백분위 | 3 |
| Mcap/TVL 백분위(화이트리스트 섹터만) | 2 |
| 현재 적격 holder-value yield | 5 |

P/S와 P/F는 P/HR과 현금흐름이 겹치므로 보조 지표로만 쓴다. 섹터별 유효 표본이 8개 미만이면 글로벌 시장으로 fallback하지 않는다.

### 펀더멘털 개선 25

| 항목 | 점수 |
|---|---:|
| 적격 holder value 최근 30일 vs 직전 30일 | 10 |
| 매출 최근 30일 vs 직전 30일 | 7 |
| 수수료 최근 30일 vs 직전 30일 | 3 |
| 최근 30일 vs 1년 월평균 지속성 | 5 |

변화율은 ±100%에서 클리핑해 일시적 폭증이 점수를 지배하지 못하게 한다.

### 가격 미발견 25

| 항목 | 점수 |
|---|---:|
| 60일 가격 수익률의 섹터 중앙값 대비 지연 | 10 |
| 펀더멘털 성장과 60일 가격의 괴리 | 8 |
| 30일·1년 가격 재평가 여부 | 4 |
| CMC 시총 순위와 현금흐름 순위의 괴리 | 3 |

가격 하락 자체에는 점수를 주지 않는다. 펀더멘털 변화가 양수일 때만 성장-가격 괴리와 가격 맥락 점수를 부여한다.

### 토큰·시장 품질 20

| 항목 | 점수 |
|---|---:|
| 현재 적격 holder value 기반 가치포획 | 8 |
| FDV/Mcap 희석 | 5 |
| 24시간 거래 유동성 | 4 |
| 데이터 완성도·신선도 | 3 |

적격 holder-value run-rate의 매출/수수료 분모가 없으면 귀속 비율을 100%로 가정하지 않고 결측으로 둔다. 적격 현재 흐름이 없는 fee burn·ve/voter/locker·불명확 row에는 holder-value 점수를 주지 않는다.

## 3. 상태와 신뢰도

- `발굴 후보`: 80점 이상, 모든 게이트 통과, 각 축 50% 이상, 신뢰도 B 이상.
- `관찰`: 65점 이상.
- `근거 부족`: 50~64점.
- `제외`: 50점 미만.
- `가치 함정`: 가치 축은 높지만 개선 축이 약함.
- `재평가 진행 중`: 펀더멘털은 개선되지만 30/60일 가격이 이미 크게 상승.
- `데이터 보류`: 필수 게이트 실패.
- `신규 프로젝트`: CMC 상장 90일 미만.

신뢰도 A/B/C는 점수와 분리한다. canonical CMC 연결, 시장 데이터, FDV, 섹터 백분위, 각 현금흐름 변화, 60일 섹터 표본, 1년 가격 데이터의 가용 비율로 산출한다.

## 4. 데이터 소스

- DefiLlama: fees, revenue, holders revenue, `HoldersRevenue` 방법론, `doublecounted`, TVL, 프로젝트/parent 구조
- CoinMarketCap Keyless Public API: canonical ID, 가격, 시총, FDV, 24시간 거래량, 7/30/60/90일 변화
- CoinGecko: 명시적 `gecko_id`가 있는 자산의 1년·ATH·ATL 보조값

ATH·ATL은 참고 열이며 점수에는 사용하지 않는다.
`updatedAt`은 수집과 점수 계산이 끝난 시각이다. 시장 데이터 신선도 판정과 화면 표시는 CMC가 제공한 행별 `last_updated` 및 그 범위를 사용한다. DefiLlama 집계 응답에는 모든 행에 공통으로 적용할 수 있는 원천 갱신 시각이 없으므로 계산 시각을 DefiLlama 원천 시각으로 해석하지 않는다.
