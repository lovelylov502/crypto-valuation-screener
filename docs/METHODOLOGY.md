# 밸류에이션 방법론

코인이 **싼가/비싼가**를, 가격이 아니라 프로토콜이 벌어들이는 현금흐름 대비 시가총액으로 판단한다.
핵심 철학: **절대 멀티플 비교는 무의미하다.** DEX의 P/F와 Liquid Staking의 P/F는 구조가 달라 직접 비교할 수 없다. 그래서 모든 멀티플을 **같은 섹터(category) 안에서 백분위로 정규화**한 뒤 합산한다.

## 1. 멀티플 (낮을수록 쌈)

연율화는 최근 1년 값(`total1y`) 우선, 없으면 `30일 × 365/30`.

| 멀티플 | 정의 | 의미 |
|---|---|---|
| **P/HR** | 시총 ÷ 홀더귀속수익 | **크립토 PER.** 토큰 홀더에게 실제 귀속되는 수익(바이백·분배 포함) 대비 시총. 가장 직접적 |
| P/F | 시총 ÷ 연수수료 | 프로토콜이 창출하는 전체 수수료 대비 |
| P/S | 시총 ÷ 연매출 | 프로토콜 금고로 가는 매출 대비 |
| Mcap/TVL | 시총 ÷ 예치자산 | 자본 효율. 데이터가 가장 풍부 |
| FDV/TVL, FDV/Mcap | — | 완전희석 기준 / 희석 위험(미래 공급 압력) |

> **왜 P/HR이 핵심인가**: P/F·P/S는 supply-side(LP 등)로 새는 몫을 포함하지만, holder revenue는 **토큰 보유자에게 실제 귀속되는 몫**이다. 주식의 순이익(EPS)에 가장 가깝다. Token Terminal·Messari가 강조하는 "P/E" 개념.

## 2. 게이트 (노이즈 제거)

- **활동성 게이트** (`MIN_ACTIVITY_USD = $100K`): 연 매출·수수료가 둘 다 이 미만이면 P/F·P/S·P/HR 비교에서 제외하고 `lowActivity` 플래그. (좀비 프로토콜이 분포를 왜곡하는 것 방지)
- **신선도 게이트**: 연율값은 있어도 **최근 30일 현금흐름(fees·revenue·holderRev)이 전부 0/null**이면 멈춘(stale) 프로토콜으로 보고 `lowActivity` 처리. (죽은 프로토콜이 "싸 보이는" 가짜 신호 제거)
- **규모 게이트** (`MIN_MCAP_USD = $1M`): 시총이 이 미만이면 점수 미산출(`판단보류`). 토큰 미발행/마이크로캡이 Mcap/TVL≈0으로 "초저평가"처럼 보이는 가짜 신호 제거.
- **극단 멀티플 클리핑** (`MULTIPLE_CAP = 1000`): P/F·P/S·P/HR이 이 값을 넘으면(holder revenue가 일시적으로 거의 0이 되는 데이터 글리치 등) 섹터 분포에서 제외한다. 본인은 최저 백분위로 처리돼 점수엔 반영되지만 분포 꼬리를 왜곡하지 않는다.
- **밸류 멀티플 ≥2 게이트** (`MIN_VALUE_MULTIPLES = 2`): 산출된 밸류 멀티플이 1개뿐이면 단일 신호 과신 위험으로 `판단보류`. (예: Mcap/TVL 하나로 "저평가" 단정 방지)

## 3. 섹터 정규화 (백분위)

각 멀티플을 **같은 category 내 분포**에서 백분위로 변환한다(낮은 멀티플 → 높은 "싼 정도" 점수, 0~100).
섹터 표본이 5개 미만이면 전체 시장 분포로 fallback.
백분위는 fat-tail·고왜도인 크립토 멀티플에 z-score보다 robust하다(z-score는 비정규 분포에서 왜곡). 단 비등간격(ordinal)이라 "점수 5점 차 = 펀더 5% 차"가 아님에 유의.

### Mcap/TVL 섹터 화이트리스트

Mcap/TVL은 **TVL이 사업 규모·매출의 선행지표인 섹터에서만** 점수에 반영한다(`MCAP_TVL_SECTORS`): Dexs·Lending·Yield·Derivatives·Liquid Staking·Farm·CDP·Yield Aggregator·Algo-Stables·Staking Pool·Liquidity Manager·Synthetics·Options(Vault)·Leveraged Farming·Liquid Restaking·Restaking·Insurance·NFT Lending·RWA Lending·Basis Trading·Reserve Currency·Risk Curators·Uncollateralized Lending.
체인(L1/L2)·브릿지·CEX·런치패드·게임 등 **TVL이 가치와 무관한 섹터에서는 Mcap/TVL을 점수에서 제외**한다(그 가중은 P/HR·P/S·P/F로 재분배). 화이트리스트(블랙리스트 아님)라 새 카테고리는 보수적으로 자동 제외된다.

## 4. 보조 축 (밸류 점수에 ±보정, 혼합 아님)

성장·희석은 **밸류 팩터가 아니므로** 가중 평균에 섞지 않는다(팩터 오염 방지). 밸류 점수를 먼저 낸 뒤 **각 최대 ±5점(`MAX_ADJ`)**으로만 약하게 보정한다. 중립 50 기준 `(score−50)/50 × 5`.

- **성장성(GARP)**: fees 30일 모멘텀(`change_30dover30d`)을 0~100으로. 0%=50(중립), +100%→100. → 보정 +5 ~ −5.
- **희석**: FDV/Mcap. 1배(완전유통)=100, 클수록 미래 공급 압력으로 감점. 2.5배=50(중립). → 보정 +5 ~ −5.
- **고희석 태그**: FDV/Mcap > 3.33 (= MC/FDV < 0.3, 유통량 30% 미만)이면 `highDilution` 플래그로 ⚠ 경고만 표시(점수는 막지 않음).

## 5. 종합 Value Score (0~100, 높을수록 저평가)

순수 **밸류 멀티플** 가중 평균 (결측 지표는 가중치 재정규화) + 보조 축 ±보정:

```
밸류 점수 = (P/HR 40% · P/S 25% · Mcap/TVL 20% · P/F 15%)   ← 밸류만 합 100
최종 점수 = clamp(밸류 점수 + 성장보정(±5) + 희석보정(±5), 0, 100)
```

- holder revenue(크립토 P/E)를 최우선. fees는 supply-side(LP·검증자) 몫까지 포함하는 가장 거친 지표라 최저 가중(Token Terminal·Artemis 수익 위계 기준).
- P/F·Mcap/TVL은 **화면 열에선 숨기지만** 데이터가 풍부해(holder revenue는 일부만 커버) 나머지 토큰의 점수를 받친다.
- 밸류 멀티플이 2개 미만이면 → `판단보류`.

**라벨**: 80+ 저평가 / 60~ 다소 저평가 / 40~ 적정 / 20~ 다소 고평가 / ~20 고평가
**신뢰도(confidence)**: 산출된 밸류 멀티플 수(/4) × 활동성. 낮으면 ⚠ 표시.

## 채택하지 않은 지표 (검토 후 제외)

- **NVT** (시총÷거래량): "크립토 PER"이라 불리지만 거래량이 없는 섹터(Lending 등)엔 무의미.
- **Real Yield** (홀더수익÷시총, %): P/HR의 역수라 정보 중복.
