# CLAUDE.md — 크립토 밸류에이션 스크리너

코인의 **저평가/고평가**를 펀더멘털(수수료·매출·holder revenue·TVL)로 판단하는 Next.js 스크리너.
가격이 아니라 멀티플을 **섹터 내 백분위로 정규화**해 0~100 종합 점수로 보여준다.

> 상세 문서는 [`docs/`](./docs) 참고 — 방법론·아키텍처·작업 이력.

## 빠른 시작

```bash
# 사내/로컬 CA 환경: outbound fetch SSL 오류 방지 위해 항상 필요
$env:NODE_OPTIONS="--use-system-ca"   # PowerShell
npm run dev      # http://localhost:3000
npm test         # 밸류에이션 엔진 단위 테스트 (vitest)
npm run build    # 프로덕션 빌드 (타입체크 포함)
```

## 데이터 소스 (전부 무료, API 키 불필요)

| 소스 | 용도 |
|---|---|
| DefiLlama `/protocols` | name·symbol·category·gecko_id·**mcap**·tvl |
| DefiLlama `/overview/fees` | 수수료 |
| `…/fees?dataType=dailyRevenue` | 프로토콜 매출 |
| `…/fees?dataType=dailyHoldersRevenue` | **홀더 귀속 수익 (P/HR 핵심)** |
| DefiLlama `/overview/dexs` | 거래량 |
| CoinGecko `/coins/markets` | FDV·공급량·**시총 symbol 폴백** |

모든 fetch·조인은 `lib/sources.ts`에 모여 있다.

## 절대 잊지 말 것 (이번 작업에서 데인 것들)

1. **parent 단위로 집계한다.** DefiLlama는 한 프로젝트를 child로 쪼갠다(예: `hyperliquid-perps` + `hyperliquid-spot`). `parentProtocol`로 묶어 합산하지 않으면 holder revenue가 분산돼 누락된다.
2. **gecko_id가 있으면 symbol 폴백 금지.** gecko_id 없을 때만 symbol로 CoinGecko 시총을 붙이고, 그것도 **현금흐름(fees/매출/holder rev)이 있는 그룹에만** 적용한다. 안 그러면 같은 심볼의 무관한 엔트리(브릿지 등)에 시총이 잘못 붙는다.
3. **게이트로 노이즈 제거** — `lib/valuation.ts`: 시총<$1M(판단보류) · 매출/수수료 둘 다<$100K(좀비) · 최근 30일 현금흐름 0(stale) · 멀티플>1000(글리치 클리핑) · 밸류 멀티플<2개(단일 신호 보류).
4. **점수 로직은 `lib/valuation.ts` 순수 함수.** 바꾸면 `lib/valuation.test.ts`로 검증.
5. **`bodycation`은 남의 팀이 아니라 사용자 개인 Vercel 계정의 slug다.** 배포는 `--scope bodycation`.

## 밸류에이션 점수 (요약)

종합 점수 = 섹터 백분위 가중 평균 (높을수록 저평가).
**밸류 멀티플만** 합 100으로 가중: **P/HR 40% · P/S 25% · Mcap/TVL 20% · P/F 15%**.
성장·희석은 밸류 팩터가 아니므로 가중에 섞지 않고 **산출 후 각 ±5점 보정**으로만 반영(팩터 오염 방지).
별도 **가치포획 점수**는 holder revenue 존재, 매출 대비 귀속 비중, P/HR 상대 매력, 희석 리스크를 합쳐 “매출이 토큰에 실제로 꽂히는가”를 본다.
P/F는 supply-side 몫까지 포함하는 가장 거친 지표라 최저 가중. P/F·Mcap/TVL은 화면엔 숨기지만 데이터가 풍부해 holder revenue 없는 토큰의 점수를 받친다.
Mcap/TVL은 TVL이 유효한 섹터(`MCAP_TVL_SECTORS` 화이트리스트)에서만 점수 반영 — 체인·브릿지·CEX 등은 제외.
→ 상세: [`docs/METHODOLOGY.md`](./docs/METHODOLOGY.md)

## 배포 (Vercel, 개인 계정)

```bash
$env:NODE_OPTIONS="--use-system-ca"
$tok = (Get-Content "$HOME\.claude\settings.json" -Raw | ConvertFrom-Json).env.VERCEL_TOKEN
npx vercel deploy --prod --yes --scope bodycation --token $tok
```
라이브: https://crypto-valuation-screener.vercel.app · GitHub: lovelylov502/crypto-valuation-screener

## 파일 구조

```
app/
  page.tsx              # 서버컴포넌트 → buildScreener() → 점수 있는 코인만 전달
  api/screener/route.ts # 동일 데이터 JSON 엔드포인트
lib/
  sources.ts            # 데이터 fetch + parent 집계 + 조인  ★데이터 정합성 핵심
  valuation.ts          # 멀티플·섹터백분위·종합점수 (순수함수)  ★점수 로직
  valuation.test.ts     # 엔진 단위 테스트
  screener.ts           # sources + valuation 조립
  format.ts             # $1.2B / 12.3x / +5% 포맷
components/
  ScreenerClient.tsx    # 테이블 — 정렬·필터·코인열 고정 (클라이언트)
  ScoreBadge.tsx        # 점수 색상 배지
```

## 알아두면 좋은 것

- 빌드 시 `Failed to set Next.js data cache … over 2MB` 경고는 **무해**. `/protocols`(10MB) 등이 fetch 데이터 캐시 한도를 넘을 뿐, 페이지 ISR(30분)이 실제 캐싱을 담당한다.
- 투자 조언 아님. CEX·체인·브릿지처럼 TVL이 가치와 무관한 섹터는 Mcap/TVL 신호를 신뢰하지 말 것.
