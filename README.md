# 크립토 밸류에이션 리서치

P/S와 실제 매출의 규모·추이를 비교해 추가 조사할 크립토 종목을 찾는 단일 화면 스크리너.
주식·일반 기업 리서치, 조사노트, 후보 큐 같은 별도 워크플로는 다루지 않는다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinMarketCap Keyless](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api) · [CoinGecko](https://coingecko.com)

## Current v5.1

- Current market cap stays fixed across P/S based on actual 365-day revenue and annualized rolling 90/30/7-day revenue. The 20x reference is editable and highlights rows without excluding higher multiples. Price direction does not control research inclusion.
- The main presets are discovery, P/S and revenue trend, holder return mechanisms, and price/supply. Legacy experimental scores are optional.
- Details begin with token price, 24h/7d/30d changes, market cap and FDV, then business descriptions, dated revenue windows, 13 non-overlapping weekly totals and holder policy evidence.
- Official research records distinguish buybacks, burning, distributions, payout assets, recipients, conditions and policy status. Unknown facts stay explicit. Korean translations of provider descriptions fill uncovered projects, with the original available in a disclosure.
- The list defaults to 100 rows. A native dropdown offers 50/100/200 and remembers the choice. Numbered pagination appears above and below the table; vertical scrolling follows the document with column headers held in view.
- The review baseline moves only when explicitly acknowledged. Browser observations retain up to 60 days; unattended daily archives remain separate.
- Large source responses bypass the 2MB fetch-cache limit. The server caches a compressed joined snapshot for 30 minutes; the refresh API adds no second response cache.

Current rule version: `research-v5-ps-revenue`. See [HANDOFF.md](./docs/HANDOFF.md) for dated validation and deployment receipts, and [SCREENER_V5.md](./docs/SCREENER_V5.md) for calculation rules, coverage and research maintenance. [SCREENER_V4.md](./docs/SCREENER_V4.md) preserves the earlier contract. Production safety remains in [DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## 개발

```bash
npm install
# 사내/로컬 CA 환경에서 fetch SSL 오류 시 (PowerShell)
$env:NODE_OPTIONS="--use-system-ca"
npm run dev
npm test
npx tsc --noEmit
npm run build
```

## 프로덕션 배포

프로덕션 소스는 `C:\Users\TAE\Workspace\projects\hermes\crypto-valuation-screener` 하나다. `C:\Users\TAE\Workspace\projects\taegyu\holder revenue`는 폐기된 중복 체크아웃이므로 Vercel 연결과 배포를 금지한다.

승인된 로컬 환경에서 `VERCEL_TOKEN`을 불러온 뒤 canonical 루트에서 다음 명령만 사용한다.

```powershell
npm run deploy:production
```

이 명령은 canonical 실경로·Git fetch/push 원격·로컬 Vercel 연결, clean `main`과 `origin/main` 일치, 인증된 원격 project/team을 먼저 검사하고 테스트·타입 검사·프로덕션 빌드를 통과한 뒤 배포한다. 마지막에는 canonical `/`와 `/api/screener`를 다시 읽어 고급 UI와 API 계약을 확인한다. 전체 정책과 배포 없는 점검 명령은 [프로덕션 배포 안전 규칙](./docs/DEPLOYMENT.md)에 있다.

## 면책

투자 조언이 아니다. 점수는 온체인 펀더멘털 기반의 상대가치 참고값이며, 토큰 이코노믹스·베스팅·법적 권리·내러티브·시장 수급은 별도 검증해야 한다.
