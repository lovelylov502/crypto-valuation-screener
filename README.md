# TOVENIT · 토베닛

**토큰의 가치를 읽는 기준.** 브랜드 표기·색상·이미지 사용 기준은 [브랜드 가이드](./docs/BRAND.md)를 참고한다.

DefiLlama 원천 금액과 토큰 시총으로 참고 배수를 계산하고, 수익 분류·검토 상태·수령 조건을 함께 보여주는 스크리너.
주식·일반 기업 리서치, 조사노트, 후보 큐 같은 별도 워크플로는 다루지 않는다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinMarketCap Keyless](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api) · [CoinGecko](https://coingecko.com)

종목 상세의 차트와 목록 오른쪽의 과거 비교는 일별 원자료 DB를 조회한다. 같은 UTC 날짜의 FDV·유통 시총과 하루 수익으로 P/R·P/HR을 계산하고, 없는 날짜는 빈 구간으로 남긴다. 목록 왼쪽의 최신 배수는 검증된 스크리너 공개본과 기간별 원천 금액을 사용한다. 현재 DB와 계산 기준은 [날짜별 원자료](./docs/DAILY_RAW_DATA.md), 이전 이력 구조는 [날짜별 밸류에이션 이력](./docs/DAILY_VALUATION_HISTORY.md)을 참고한다.

앱 버전: **v0.6.1**. 변경 내역은 [CHANGELOG.md](./CHANGELOG.md)에 기록한다. 화면 하단과 `/api/status`의 `appVersion`은 `package.json`의 같은 버전을 사용한다. 데이터 공개본 ID·수집 revision·계산 규칙 버전은 각각 별도로 보존한다.

목록과 상세 조회는 Turso에 미리 준비한 압축 조회 결과를 사용한다. 목록은 필요한 숫자와 상태만 받고, 상세의 원천 근거는 선택한 종목에 한해 읽는다. 차트는 양쪽 분자의 전체 MAX 이력을 한 번 받고 기간 전환 때 재사용한다. 현재 공개본·토큰·완료일·원자료 revision을 확인한 뒤 사용하며, 원본 공개본과 재현 검사는 유지한다. 운영 방법과 이전 구조와의 차이는 [조회 성능 구조](./docs/FAST_READ_MODELS.md)에 정리했다.

## Current product and data engine

- The checked-in economic release uses the four-daily scheduler with economic writing active under the pinned verified v3 reader proof. Pipeline/journal 1/2, legacy acquisition replay and the historical Phase-A proof remain supported. [PUBLICATION.md](./docs/PUBLICATION.md) owns scheduling; [economic implementation evidence](./docs/ECONOMIC_DECISION_IMPLEMENTATION_2026-10-08.md) separates local tests, conditional source assessment and the required 72-hour operating observation.

- Every new candidate retains original HTTP responses and must reproduce its normalization and complete output in an offline replay. Accounted local failures withhold affected metrics while valid current rows can publish. Required census, identity, financial and source-integrity failures still block publication. [ARCHITECTURE.md](./docs/ARCHITECTURE.md) defines the active contract.

- Collection status distinguishes global publication holds, interrupted/missed schedules, stale data, browser errors and partial source coverage. Whole-snapshot issue counts survive filtering and pagination. Row details explain affected source scopes. A blocked candidate retains the complete previous verified snapshot; valid partial publication exposes its current unavailable fields.

- P/R and P/HR are source-reference multiples of the displayed DefiLlama Revenue and Holders Revenue amounts. Classification review is separate from arithmetic. Complete provider totals remain usable when dated daily history is incomplete, with explicit provider-period labels. Partial groups, missing capital, invalid denominators and unverified token links stay unavailable. P/S retains separately sourced business sales. See [SOURCE_REFERENCE_MULTIPLES.md](./docs/SOURCE_REFERENCE_MULTIPLES.md).
- The approved Quiet Ledger mockups define the off-white light theme, neutral charcoal dark theme, compact toolbar and numeric hierarchy. The upper-right theme switch follows the system initially and remembers explicit choices under `tovenit-theme`. Click a column heading to sort; missing values stay last. Removed saved sort columns migrate to 30-day P/R ascending. Details open in a centered modal, dismissed by the backdrop, close button or Escape, with focus returned to the selected row. The left column shows the Korean introduction and latest key metrics; the right column stacks price/market-cap/FDV and P/R/P/HR charts. Display ranges are `7D / 1M / 3M / YTD / 1Y / MAX`, with MAX selected initially. The capital basis switches between stored FDV and circulating cap; daily ratios use that date's income × 365 and missing dates break the lines. The secondary research view retains the full introduction, five-period comparison, holder mechanisms/conditions, sources and calculation disclosure, alongside historical dates and provenance.
- The fixed table groups all current P/R and P/HR periods (24h / 7 / 30 / 90 days / 1 year) on the left, with daily-history P/R and P/HR comparisons on the right. Revenue amount columns and column customization are removed; source-amount filters, detail evidence and export remain. Current ratios retain the existing period annualization and source labels. History compares `same-date capital / (that day's income × 365)` against the preceding 365 daily multiples, excluding the latest point. A blue/red segment joins the actual median position to the latest point only with all 365 valid baseline dates. The optional batched API read model uses exact token identity and comparable financial scope/definition; short, missing, zero, conflicting and stale states remain explicit. It is separate from the immutable source snapshot; see [UI/DB handoff](./docs/UI_DB_HANDOFF.md).
- Search, favorites, MCap/FDV and filter/export controls stay visible. The approved filter option 1 adds a Revenue/Holders Revenue source-amount threshold to the common 1/7/30/90/365-day window. It keeps source sums strictly above the entered USD amount before pagination, independently of classification review; missing amounts are excluded only while the condition is active. An empty amount disables the condition, and zero keeps positive amounts. Source amounts, low-multiple thresholds, growth and holder flow can be combined; source availability has its own window. Coverage distinguishes projects, linked unique tokens, computable ratios, source-present withheld rows and missing data.
- The fixed layout, numerator, favorites and filters persist under the existing browser keys. Legacy custom columns migrate without clearing filters or favorites. Old growth/holder views migrate into combinable conditions. See [design-qa.md](./design-qa.md) for reference comparison and interaction checks.
- Circulating-cap minimum and maximum accept fractional $M inputs: `0.1M` is exactly `$100,000`. Both bounds persist as USD values, and the logarithmic slider represents sub-million amounts without rounding typed bounds or collapsing the section while editing.
- Complete dated history ends on the most recent completed UTC day. Source-reference ratios may use explicitly labeled provider-period totals. 1/7/30/90-day multiples annualize; a provider year is explicitly distinguished from 365 observed days. Reviewed growth compares adjacent complete periods. Zero, missing, negative and zero-to-positive denominators remain distinct.
- Exact asset IDs and symbol agreement replace substring ticker matching. Protocol-directory parent links eliminate duplicate child rows. Stablecoin issued supply cannot produce investment-token multiples or scores.
- Missing FDV stays blank. A separately labeled circulating-cap multiple is a reference only and never enters FDV filtering, sorting or coverage.
- Immutable scoring snapshots retain their reviewed valuation contract. The primary table computes source-reference ratios independently through one shared function for display, sorting, filtering, coverage and export. Definition drift and daily gaps remain visible as metadata; they do not hide available complete provider totals. Expired sales evidence still holds P/S. Missing dates are never filled as zero, and source recovery preserves identity and scope checks.
- The union of protocol directory, parent metadata, fees, revenue, holder and DEX lists is retained without a market-cap cutoff. Parent token metadata recovers AERO. Details show official homepage, DefiLlama and market links. An exact CoinGecko ID supplies the market link; a verified CMC address is used only when the CoinGecko ID is absent. Missing identities stay explicitly unlinked. Verified URLs remain usable independently of a transient quote failure.
- Every explicit CoinGecko ID is queried in batches, regardless of market-cap rank; canonical CMC IDs missing from its discovery list are queried directly. Lookup outcomes and field sources distinguish provider omissions, identity conflicts and request failures. Partially reported group amounts remain visible with component counts, without entering multiples.
- Market acquisition revision 5 verifies CMC contracts or unique full names rather than equating vendor slugs. It prefers the identified CoinGecko quote, uses the provider of a positive market cap for price and supply, and retains verified CMC fallback. Inactive, stale and inconsistent quote fields are excluded with reasons; original earlier captures retain their exact replay semantics. See [source reference multiples](docs/SOURCE_REFERENCE_MULTIPLES.md).
- Revision 9 requires a source CMC ID or matching source contract for new CMC links. Full-name matches alone cannot supply capital. Failed CMC requests retain a previously verified ID only within unchanged, source-backed identity scope; current quote failures never reuse old prices. Parent continuity uses the parent's token rather than unrelated product IDs. Revision 8 and earlier archives still replay exactly.
- Every response accounts for source membership, every requested quote ID, available provider amounts and financial invariants. Original daily history and source-reference arithmetic are independent of economic approval; unknown definitions remain labeled and do not enter reviewed scoring. Supplementary request deferrals remain explicit.
- The homepage is a static shell and never waits for upstream collection. The API reads a persisted, hash-verified snapshot; scheduled/manual GitHub Actions share one publication gate and permanent Release journal. Failed candidates cannot replace the last verified snapshot. Original timestamps remain visible during failures and UTC rollover. The browser polls a small status endpoint every ten minutes while visible and loads new rows when the published ID changes. See [PUBLICATION.md](./docs/PUBLICATION.md).
- `npm run audit:coverage` verifies every live row against the persisted archive and financial contracts. New pipeline releases are reproduced from their hashed original source bundle, without later source queries changing the evidence. Legacy releases retain their witness/live-check paths. Protected historical operation is explicitly distinguished from fresh recovery. `SCREENER_BASE_URL` and `SCREENER_AUDIT_DIR` select the server and evidence directory.

Current rule version: `research-v10-source-revenue-recovery`. See [SCREENER_V10.md](./docs/SCREENER_V10.md) for this repair, [SCREENER_V9.md](./docs/SCREENER_V9.md) for the full directory, [SCREENER_V8.md](./docs/SCREENER_V8.md) for the underlying definition review rules, [HANDOFF.md](./docs/HANDOFF.md) for deployment receipts and [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for production guards. Earlier version documents are historical where superseded.

The October 5 data-engine redesign keeps those financial rules and adds `pipeline.schema=1`. Its [acceptance record](./docs/RELIABILITY_ACCEPTANCE_2026-10-05.md) remains historical evidence. Schema 2 adds dated-source currency separately from collection quality and preserves actual schema-1 archive replay. The four-slot repair's operational acceptance requires 72 hours, twelve proven natural regular slots and two UTC transitions after activation; local checks do not supply those observations.

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

## 버전 기록

기능·오류 수정은 별도 브랜치에서 재현 검사와 변경 내역을 작성하고 커밋한다. 출시할 때 `npm version <버전> --no-git-tag-version --ignore-scripts`로 패키지 버전을 함께 올린다. 검증한 커밋을 `main`에 반영·푸시하고 위 배포 절차를 통과한 뒤, 같은 커밋에 `v<버전>` 태그를 붙여 푸시한다. 시세 연결이나 수집 방식을 바꿨다면 새 공개본의 원천 재현과 실제 화면까지 확인한다. 과거 데이터 태그 `data-*`를 앱 버전 태그로 대체하지 않는다.

## 면책

투자 조언이 아니다. 점수는 온체인 펀더멘털 기반의 상대가치 참고값이며, 토큰 이코노믹스·베스팅·법적 권리·내러티브·시장 수급은 별도 검증해야 한다.
