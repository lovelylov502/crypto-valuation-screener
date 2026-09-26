# 크립토 밸류에이션 리서치

프로토콜 수익·서비스 매출·홀더 환원·추정 손익을 구분하고, 같은 종류의 집계액과 토큰 시총을 비교하는 스크리너.
주식·일반 기업 리서치, 조사노트, 후보 큐 같은 별도 워크플로는 다루지 않는다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinMarketCap Keyless](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api) · [CoinGecko](https://coingecko.com)

## Current UI · v9 full directory and inline details

- P/S uses separately sourced business sales, with scope, estimate status, date and expiry. P/R uses reviewed protocol revenue or service receipts. P/HR includes reviewed buybacks, distributions, native fee burns and conditional staking/lock/voter distributions, with mechanisms and recipient conditions shown separately. Missing evidence stays unavailable.
- The approved mockup informs the navy table, compact toolbar and numeric hierarchy. Click a column heading to sort; missing values stay last and hiding the sorted column falls back to a visible sort. Details expand directly below the selected row: market facts, adjacent revenue periods, holder mechanism and calculation evidence. No right sidebar or charts.
- Defaults show P/R, protocol revenue and P/HR for 24h / 7 / 30 / 90 days / 1 year, plus holder mechanism. Default ordering is 30-day P/R ascending. Revenue can sort by amount, growth rate or dollar increase. P/S stays supplementary business-sales evidence in coin details. Display settings keep ordered columns with pointer/keyboard reordering; old default columns migrate while custom settings and favorites survive.
- Search, favorites, MCap/FDV and small filter/column controls stay visible. Low-multiple thresholds, growth and eligible holder flow can be combined. Range conditions share an explicit 1/7/30/90/365-day window; source availability has its own window. Coverage distinguishes projects, linked unique tokens, computable ratios, source-present withheld rows and missing data.
- Column order, numerator, favorites and filters persist under the existing browser keys. Old growth/holder views migrate into combinable conditions. See [design-qa.md](./design-qa.md) for reference comparison and interaction checks.
- 24h means the most recent completed UTC day, not a rolling live day. 1/7/30/90-day multiples annualize; a year requires 365 observed days. Growth compares adjacent equal periods, using up to 730 days. Zero, missing, negative and zero-to-positive denominators remain distinct.
- Exact asset IDs and symbol agreement replace substring ticker matching. Protocol-directory parent links eliminate duplicate child rows. Stablecoin issued supply cannot produce investment-token multiples or scores.
- Missing FDV stays blank. A separately labeled circulating-cap multiple is a reference only and never enters FDV filtering, sorting or coverage.
- Every response checks the valuation contract. Definition drift, missing daily observations and expired sales evidence hold the affected metrics. Reviewed component histories recover explicit days omitted by overview charts; missing dates are never filled as zero. Daily archives include coverage by period and numerator, a definition-review queue and calculation-source hashes.
- The union of protocol directory, parent metadata, fees, revenue, holder and DEX lists is retained without a market-cap cutoff. Parent token metadata recovers AERO. CMC links take priority; verified URLs remain usable independently of a transient quote failure. DefiLlama is the fallback.
- The server caches a compressed joined snapshot for 30 minutes in hashed chunks under Next's per-entry limit. `/api/screener` filters/sorts the whole universe before returning a page (default 100, sizes 50/100/200); `pagination.total` is the universe count. Client snapshots are no longer overwritten with partial pages; old browser history keys remain intact. Full archive capture is unchanged.

Current rule version: `research-v9-full-universe-and-24h`. See [SCREENER_V9.md](./docs/SCREENER_V9.md) for this change, [SCREENER_V8.md](./docs/SCREENER_V8.md) for the underlying definition review rules, [HANDOFF.md](./docs/HANDOFF.md) for deployment receipts and [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for production guards. Earlier version documents are historical where superseded.

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
