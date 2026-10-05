# TOVENIT · 토베닛

**토큰의 가치를 읽는 기준.** 브랜드 표기·색상·이미지 사용 기준은 [브랜드 가이드](./docs/BRAND.md)를 참고한다.

프로토콜 수익·서비스 매출·홀더 환원·추정 손익을 구분하고, 같은 종류의 집계액과 토큰 시총을 비교하는 스크리너.
주식·일반 기업 리서치, 조사노트, 후보 큐 같은 별도 워크플로는 다루지 않는다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinMarketCap Keyless](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api) · [CoinGecko](https://coingecko.com)

## Current product and data engine

- Collection has two daily slots at 11:00/23:00 KST, one serialized writer, separate attempt/publication state and bounded retries. A failed attempt no longer consumes the entire slot. See [PUBLICATION.md](./docs/PUBLICATION.md) for trigger, lease and recovery semantics.

- Every new candidate retains original HTTP responses and must reproduce its normalization and complete output in an offline replay. Accounted local failures withhold affected metrics while valid current rows can publish. Required census, identity, financial and source-integrity failures still block publication. [ARCHITECTURE.md](./docs/ARCHITECTURE.md) defines the active contract.

- Collection status distinguishes global publication holds, interrupted/missed schedules, stale data, browser errors and partial source coverage. Whole-snapshot issue counts survive filtering and pagination. Row details explain affected source scopes. A blocked candidate retains the complete previous verified snapshot; valid partial publication exposes its current unavailable fields.

- P/S uses separately sourced business sales, with scope, estimate status, date and expiry. P/R uses reviewed protocol revenue or service receipts. P/HR includes reviewed buybacks, distributions, native fee burns and conditional staking/lock/voter distributions, with mechanisms and recipient conditions shown separately. Missing evidence stays unavailable.
- The approved Quiet Ledger mockups define the off-white light theme, neutral charcoal dark theme, compact toolbar and numeric hierarchy. The upper-right theme switch follows the system initially and remembers explicit choices under `tovenit-theme`. Click a column heading to sort; missing values stay last and hiding the sorted column falls back to a visible sort. Details expand directly below the selected row: a Korean introduction, four key summaries, one five-period comparison table, holder mechanisms/conditions, consolidated sources and a closed calculation disclosure. No right sidebar or charts.
- Defaults show P/R, Revenue source amounts and P/HR for 24h / 7 / 30 / 90 days / 1 year, plus holder mechanism. Source amounts remain visible when definition review or history is insufficient for calculation; their meaning, collection time and provider-period fallback are disclosed. Default ordering is 30-day P/R ascending. Revenue can sort by amount, growth rate or dollar increase; growth retains its review and complete-period requirements. P/S stays supplementary business-sales evidence in coin details. Display settings keep ordered columns with pointer/keyboard reordering; old default columns migrate while custom settings and favorites survive.
- Search, favorites, MCap/FDV and small filter/column controls stay visible. Low-multiple thresholds, growth and eligible holder flow can be combined. Range conditions share an explicit 1/7/30/90/365-day window; source availability has its own window. Coverage distinguishes projects, linked unique tokens, computable ratios, source-present withheld rows and missing data.
- Column order, numerator, favorites and filters persist under the existing browser keys. Old growth/holder views migrate into combinable conditions. See [design-qa.md](./design-qa.md) for reference comparison and interaction checks.
- 24h means the most recent completed UTC day, not a rolling live day. 1/7/30/90-day multiples annualize; a year requires 365 observed days. Growth compares adjacent equal periods, using up to 730 days. Zero, missing, negative and zero-to-positive denominators remain distinct.
- Exact asset IDs and symbol agreement replace substring ticker matching. Protocol-directory parent links eliminate duplicate child rows. Stablecoin issued supply cannot produce investment-token multiples or scores.
- Missing FDV stays blank. A separately labeled circulating-cap multiple is a reference only and never enters FDV filtering, sorting or coverage.
- Every response checks the valuation contract. Definition drift, missing daily observations and expired sales evidence hold the affected metrics. Reviewed component histories and exact-scope parent histories recover explicit days omitted by overview charts; missing dates are never filled as zero. Parent recovery requires matching IDs, component sets, definitions and overlapping amounts. Daily archives include coverage by period and numerator, a definition-review queue and calculation-source hashes.
- The union of protocol directory, parent metadata, fees, revenue, holder and DEX lists is retained without a market-cap cutoff. Parent token metadata recovers AERO. Details show an independent DefiLlama link and a market link. CMC takes priority for the market link; an exact CoinGecko ID is the fallback. Missing identities stay explicitly unlinked. Verified URLs remain usable independently of a transient quote failure.
- Every explicit CoinGecko ID is queried in batches, regardless of market-cap rank; canonical CMC IDs missing from its discovery list are queried directly. Lookup outcomes and field sources distinguish provider omissions, identity conflicts and request failures. Partially reported group amounts remain visible with component counts, without entering multiples.
- Every response accounts for source membership, every requested quote ID, available provider amounts and financial invariants. Original daily history is collected independently of economic approval; unknown definitions still cannot generate multiples. Supplementary request deferrals remain explicit.
- The homepage is a static shell and never waits for upstream collection. The API reads a persisted, hash-verified snapshot; scheduled/manual GitHub Actions share one publication gate and permanent Release journal. Failed candidates cannot replace the last verified snapshot. Original timestamps remain visible during failures and UTC rollover. The browser polls a small status endpoint every ten minutes while visible and loads new rows when the published ID changes. See [PUBLICATION.md](./docs/PUBLICATION.md).
- `npm run audit:coverage` verifies every live row against the persisted archive and financial contracts. New pipeline releases are reproduced from their hashed original source bundle, without later source queries changing the evidence. Legacy releases retain their witness/live-check paths. Protected historical operation is explicitly distinguished from fresh recovery. `SCREENER_BASE_URL` and `SCREENER_AUDIT_DIR` select the server and evidence directory.

Current rule version: `research-v10-source-revenue-recovery`. See [SCREENER_V10.md](./docs/SCREENER_V10.md) for this repair, [SCREENER_V9.md](./docs/SCREENER_V9.md) for the full directory, [SCREENER_V8.md](./docs/SCREENER_V8.md) for the underlying definition review rules, [HANDOFF.md](./docs/HANDOFF.md) for deployment receipts and [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for production guards. Earlier version documents are historical where superseded.

The October 5 data-engine redesign keeps those financial rules and adds `pipeline.schema=1`. Its [acceptance record](./docs/RELIABILITY_ACCEPTANCE_2026-10-05.md) links the deployed commit, successful recovery, complete source replay, independent review and still-pending natural scheduled acceptance.

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
