# TOVENIT · 토베닛

**토큰의 가치를 읽는 기준.** 브랜드 표기·색상·이미지 사용 기준은 [브랜드 가이드](./docs/BRAND.md)를 참고한다.

프로토콜 수익·서비스 매출·홀더 환원·추정 손익을 구분하고, 같은 종류의 집계액과 토큰 시총을 비교하는 스크리너.
주식·일반 기업 리서치, 조사노트, 후보 큐 같은 별도 워크플로는 다루지 않는다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinMarketCap Keyless](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api) · [CoinGecko](https://coingecko.com)

## Current UI · v10 source revenue recovery

- Collection has two daily slots at 11:17 and 23:17 KST (02:17 and 14:17 UTC). Backup workflow wakes at +30/+60 minutes check the authoritative start journal under the same writer lock and skip a slot that already started, including failed attempts. They add no duplicate source collection and do not extend the 90-minute deadline. Independently confirmed holder definition changes retain original amounts and withhold affected calculations without blocking a verified publication. See [the acceptance rubric and observation status](./docs/RELIABILITY_ACCEPTANCE_2026-10-03.md).

- Publication now independently rechecks upstream identity withdrawals, source removals, missing quote fields and incomplete component histories on each run. Verified source absences remain unavailable; collector omissions still block publication. Incomplete runs display an unknown comparison count. See [the October 2 incident and repair](./docs/INCIDENT_2026-10-02_PUBLICATION.md).

- The top-right collection status distinguishes healthy collection, source/check errors, stale data, review holds and unknown evidence. It uses the whole-snapshot source and quote accounting, not the current search result or HTTP 200 alone. Details show providers, counts of failed asset lookups, collection/server-check times and the first failure observed within that collection. The clock rechecks freshness every 30 seconds; a publication missing the twice-daily schedule plus a 90-minute grace period is delayed, and a missing collection start is distinguished from a failed collection. A failed browser check remains visible through retries until a validated response arrives. The single scheduled publisher now persists every start/completion and retains the last verified snapshot when a candidate fails. See [the publication contract](./docs/PUBLICATION.md).

- P/S uses separately sourced business sales, with scope, estimate status, date and expiry. P/R uses reviewed protocol revenue or service receipts. P/HR includes reviewed buybacks, distributions, native fee burns and conditional staking/lock/voter distributions, with mechanisms and recipient conditions shown separately. Missing evidence stays unavailable.
- The approved mockup informs the navy table, compact toolbar and numeric hierarchy. Click a column heading to sort; missing values stay last and hiding the sorted column falls back to a visible sort. Details expand directly below the selected row: market facts, adjacent revenue periods, holder mechanism and calculation evidence. No right sidebar or charts.
- Defaults show P/R, Revenue source amounts and P/HR for 24h / 7 / 30 / 90 days / 1 year, plus holder mechanism. Source amounts remain visible when definition review or history is insufficient for calculation; their meaning, collection time and provider-period fallback are disclosed. Default ordering is 30-day P/R ascending. Revenue can sort by amount, growth rate or dollar increase; growth retains its review and complete-period requirements. P/S stays supplementary business-sales evidence in coin details. Display settings keep ordered columns with pointer/keyboard reordering; old default columns migrate while custom settings and favorites survive.
- Search, favorites, MCap/FDV and small filter/column controls stay visible. Low-multiple thresholds, growth and eligible holder flow can be combined. Range conditions share an explicit 1/7/30/90/365-day window; source availability has its own window. Coverage distinguishes projects, linked unique tokens, computable ratios, source-present withheld rows and missing data.
- Column order, numerator, favorites and filters persist under the existing browser keys. Old growth/holder views migrate into combinable conditions. See [design-qa.md](./design-qa.md) for reference comparison and interaction checks.
- 24h means the most recent completed UTC day, not a rolling live day. 1/7/30/90-day multiples annualize; a year requires 365 observed days. Growth compares adjacent equal periods, using up to 730 days. Zero, missing, negative and zero-to-positive denominators remain distinct.
- Exact asset IDs and symbol agreement replace substring ticker matching. Protocol-directory parent links eliminate duplicate child rows. Stablecoin issued supply cannot produce investment-token multiples or scores.
- Missing FDV stays blank. A separately labeled circulating-cap multiple is a reference only and never enters FDV filtering, sorting or coverage.
- Every response checks the valuation contract. Definition drift, missing daily observations and expired sales evidence hold the affected metrics. Reviewed component histories and exact-scope parent histories recover explicit days omitted by overview charts; missing dates are never filled as zero. Parent recovery requires matching IDs, component sets, definitions and overlapping amounts. Daily archives include coverage by period and numerator, a definition-review queue and calculation-source hashes.
- The union of protocol directory, parent metadata, fees, revenue, holder and DEX lists is retained without a market-cap cutoff. Parent token metadata recovers AERO. CMC links take priority; verified URLs remain usable independently of a transient quote failure. DefiLlama is the fallback.
- Every explicit CoinGecko ID is queried in batches, regardless of market-cap rank; canonical CMC IDs missing from its discovery list are queried directly. Lookup outcomes and field sources distinguish provider omissions, identity conflicts and request failures. Partially reported group amounts remain visible with component counts, without entering multiples.
- Every response accounts for source membership and checks that available quotes and Revenue amounts were retained. Daily archives compare the previous successful collection for lost projects, token identities, quotes, amounts, dated coverage and definition reviews. Request errors fail the archive job after diagnostic artifacts are saved.
- The homepage is a static shell and never waits for upstream collection. The API reads a persisted, hash-verified snapshot; scheduled/manual GitHub Actions share one publication gate and permanent Release journal. Failed candidates cannot replace the last verified snapshot. Original timestamps remain visible during failures and UTC rollover. The browser polls a small status endpoint every ten minutes while visible and loads new rows when the published ID changes. See [PUBLICATION.md](./docs/PUBLICATION.md).
- `npm run audit:coverage` checks every live row against its persisted archive, archived source-universe witness and financial contracts. Publications within 45 minutes of collection also undergo live source/missing-quote checks; older publications within the scheduled deadline are checked against their archived source witness and explicitly report that no live-source comparison ran. Explicitly blocked/running collection is verified as protected operation with `currentCollectionPassed=false`; no current-data recovery is claimed. `SCREENER_BASE_URL` selects a local test server and `SCREENER_AUDIT_DIR` retains evidence outside Git.

Current rule version: `research-v10-source-revenue-recovery`. See [SCREENER_V10.md](./docs/SCREENER_V10.md) for this repair, [SCREENER_V9.md](./docs/SCREENER_V9.md) for the full directory, [SCREENER_V8.md](./docs/SCREENER_V8.md) for the underlying definition review rules, [HANDOFF.md](./docs/HANDOFF.md) for deployment receipts and [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for production guards. Earlier version documents are historical where superseded.

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
