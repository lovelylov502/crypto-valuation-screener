# CLAUDE.md — 크립토 밸류에이션 리서치

크립토의 **저평가·고평가 후보**를 펀더멘털(수수료·매출·holder revenue·TVL)로 직접 걸러보는 Next.js 단일 화면 스크리너.
이 프로젝트는 크립토 전용이다. 주식·일반 기업 리포트나 정적 조사노트는 이 저장소에 추가하지 않는다.

> 상세 문서는 [`docs/`](./docs) 참고 — 방법론·아키텍처·작업 이력.

## 빠른 시작

```bash
# 사내/로컬 CA 환경: outbound fetch SSL 오류 방지 위해 항상 필요
$env:NODE_OPTIONS="--use-system-ca"   # PowerShell
npm run dev      # http://localhost:3000
npm test         # 밸류에이션·필터 단위 테스트 (vitest)
npm run build    # 프로덕션 빌드 (타입체크 포함)
```

## 제품 원칙

1. **단일 스크리너 화면을 유지한다.** 조사노트·후보 큐·맵·방법론을 별도 탭으로 다시 늘리지 않는다.
2. **저평가·고평가는 빠른 프리셋과 점수 범위로 찾는다.** 사용자가 표를 직접 정렬·필터링하는 흐름이 핵심이다.
3. **범위 필터는 한 트랙의 양손잡이를 쓴다.** 숫자 입력과 슬라이더는 양방향 동기화한다.
4. **모든 필터는 즉시 결과 수와 표에 반영한다.** 무거운 표 렌더는 `useDeferredValue`로 지연한다.
5. **주식·일반 기업 조사 기능은 추가하지 않는다.** 필요하면 태규 투자노트로 보낸다.

## 데이터 소스 (전부 무료, API 키 불필요)

| 소스 | 용도 |
|---|---|
| DefiLlama `/protocols` | name·symbol·category·gecko_id·mcap·tvl |
| DefiLlama `/overview/fees` | 수수료 |
| `…/fees?dataType=dailyRevenue` | 프로토콜 매출 |
| `…/fees?dataType=dailyHoldersRevenue` | 홀더 귀속 수익 (P/HR 핵심) |
| DefiLlama `/overview/dexs` | 거래량 |
| CoinGecko `/coins/markets` | FDV·공급량·시총 symbol 폴백 |

모든 fetch·조인은 `lib/sources.ts`에 모여 있다.

## 데이터 정합성 규칙

1. **parent 단위로 집계한다.** `parentProtocol`로 묶어 합산하지 않으면 한 프로젝트의 holder revenue가 분산된다.
2. **gecko_id가 있으면 symbol 폴백 금지.** gecko_id가 없고 현금흐름이 있는 그룹에만 symbol 폴백을 허용한다.
3. **게이트로 노이즈를 제거한다.** 시총<$1M · 매출/수수료 둘 다<$100K · 최근 30일 현금흐름 0 · 멀티플>1000 · 밸류 멀티플<2개.
4. **점수 로직은 `lib/valuation.ts` 순수 함수다.** 바꾸면 `lib/valuation.test.ts`로 검증한다.
5. **필터 경계 로직은 `lib/screenerFilters.ts` 순수 함수다.** 바꾸면 `lib/screenerFilters.test.ts`로 검증한다.
6. **`bodycation`은 사용자 개인 Vercel 계정의 slug다.** 배포는 `--scope bodycation`.

## 밸류에이션 점수

종합 점수 = 섹터 백분위 가중 평균이며 높을수록 저평가다.
**P/HR 40% · P/S 25% · Mcap/TVL 20% · P/F 15%**.
성장·희석은 산출 후 각각 최대 ±5점만 보정한다.
별도 가치포획 점수는 holder revenue 존재, 매출 대비 귀속 비중, P/HR 상대 매력, 희석 리스크를 본다.
Mcap/TVL은 `MCAP_TVL_SECTORS` 화이트리스트에서만 점수에 반영한다.

## 배포

```bash
$env:NODE_OPTIONS="--use-system-ca"
$tok = (Get-Content "$HOME\.codex\env.json" -Raw | ConvertFrom-Json).env.VERCEL_TOKEN
npx vercel deploy --prod --yes --scope bodycation --token $tok
```

라이브: https://crypto-valuation-screener.vercel.app · GitHub: lovelylov502/crypto-valuation-screener

## 파일 구조

```text
app/
  page.tsx              # 서버컴포넌트 → 단일 ScreenerClient
  layout.tsx            # 메타데이터
  api/screener/route.ts # 동일 데이터 JSON 엔드포인트
lib/
  sources.ts            # 데이터 fetch + parent 집계 + 조인
  valuation.ts          # 멀티플·섹터백분위·종합점수
  valuation.test.ts
  screenerFilters.ts    # 양손잡이·프리셋·범위 경계 순수 함수
  screenerFilters.test.ts
  screener.ts           # sources + valuation 조립
  format.ts             # 통화·배수·변화율 포맷
components/
  ScreenerClient.tsx    # 검색·프리셋·범위·섹터·정렬·표
  ScoreBadge.tsx        # 점수 색상 배지
```

## 알아두면 좋은 것

- 빌드 시 `Failed to set Next.js data cache … over 2MB` 경고는 무해하다. 페이지 ISR(30분)이 실제 캐싱을 담당한다.
- CEX·체인·브릿지처럼 TVL이 가치와 무관한 섹터는 Mcap/TVL 신호를 신뢰하지 말 것.
