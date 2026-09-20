# 크립토 밸류에이션 리서치

프로토콜 수익·서비스 매출·홀더 환원·추정 손익을 구분하고, 같은 종류의 집계액과 토큰 시총을 비교하는 스크리너.
주식·일반 기업 리서치, 조사노트, 후보 큐 같은 별도 워크플로는 다루지 않는다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinMarketCap Keyless](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api) · [CoinGecko](https://coingecko.com)

## Current v8

- P/S uses separately sourced business sales, with scope, estimate status, date and expiry. P/R uses reviewed protocol revenue or service receipts. P/HR includes reviewed buybacks, distributions, native fee burns and conditional staking/lock/voter distributions, with mechanisms and recipient conditions shown separately. Missing evidence stays unavailable.
- A full-width table replaces the permanent left panel. Filter and display buttons open separate accessible dialogs. Drag handles, arrow keys and move buttons reorder columns. Column order, numerator choice, watchlist and filters persist in the same browser, including existing V7 preferences; dialogs start closed. Details open on the right without replacing the table.
- Whole-universe/watchlist and MCap/FDV remain visible buttons. Availability can use one period or any supported period. Coverage shows distinct rows, overlapping metric counts, source-present withheld rows and missing sources separately. New period columns stay beside their metric; the four-period action groups 1 year / 90 / 30 / 7 days without resetting other columns.
- MCap/FDV selection applies consistently to all three multiples. Holder and protocol multiples offer 7/30/90/365-day windows; incomplete 365-day coverage is never TTM.
- Exact asset IDs and symbol agreement replace substring ticker matching. Protocol-directory parent links eliminate duplicate child rows. Stablecoin issued supply cannot produce investment-token multiples or scores.
- Missing FDV stays blank. A separately labeled circulating-cap multiple is a reference only and never enters FDV filtering, sorting or coverage.
- Every response checks the valuation contract. Definition drift, missing daily observations and expired sales evidence hold the affected metrics. Reviewed component histories recover explicit days omitted by overview charts; missing dates are never filled as zero. Daily archives include coverage by period and numerator, a definition-review queue and calculation-source hashes.
- The server caches a compressed joined snapshot for 30 minutes. Browser observations retain up to 60 days and the review baseline moves only when acknowledged.

Current rule version: `research-v8-coverage-and-holder-types`. See [SCREENER_V8.md](./docs/SCREENER_V8.md) for definitions, coverage and audit; [HANDOFF.md](./docs/HANDOFF.md) for deployment receipts; [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for production guards. Earlier version documents are historical where superseded.

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
