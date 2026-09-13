# V5 P/S and revenue research contract

Implementation version: `research-v5-ps-revenue`. Publication uses the existing guarded deployment route. See [HANDOFF.md](./HANDOFF.md) for dated validation and deployment receipts. Older receipts remain historical.

## Research decisions

- P/S is the first research reference. The default 20x value is editable and persisted. It highlights matching rows; it never removes rows. Manual minimum/maximum filters are separate and explicit.
- Current market cap stays fixed while revenue windows change. Price direction, experimental score, holder revenue and dilution do not gate the main revenue-growth view. Token identity must be verified before a P/S or opportunity is shown.
- Revenue growth includes positive growth and a reported zero-to-positive observation. No minimum percentage is invented. Amounts and weekly totals help the user distinguish scale and persistence.
- The existing screenable universe remains market cap at least $1M. Result counts are filtered rows / this universe, not the total number of crypto projects or dividend-paying tokens.

## Calculation and source boundaries

`P/S(days) = current circulating market cap / (revenue over days * 365 / days)`, for 7, 30 and 90 days. The 365-day denominator is actual trailing revenue, with no short-history extrapolation. FDV is displayed separately and never substituted for market cap.

The new DefiLlama `dailyRevenue` overview breakdown is fetched once per collection. All periods end on the most recent completed UTC date. Current partial dates are excluded. The preceding 30 days are disjoint from the current 30 days. Thirteen disjoint 7-day totals cover 91 days; they are not a misleading chart of four overlapping revenue windows.

Components are joined by the provider's explicit `parentProtocol` or slug and exact component name. Double-counted components are excluded. Ambiguous names fail closed. Every component must report every date in a period before the total is usable. Missing observations never become zero. Reported zeros and negative amounts remain visible; nonpositive revenue has no P/S. A partial 365-day history remains unavailable even if short windows are complete.

If the daily-history endpoint is unavailable for a project, existing source 7/30/365-day aggregates can still be displayed. The detail identifies this fallback as source aggregation, has no dated weekly chart, and does not estimate 90-day revenue. When a daily history exists but a period is incomplete, the source aggregate does not silently replace the missing period.

DefiLlama revenue represents protocol-retained fees after supply-side payments, not net earnings after operating costs. See [provider definitions](https://docs.llama.fi/list-your-project/other-dashboards) and [public API endpoints](https://api-docs.defillama.com/llms-free.txt).

`revenueHistory` is the completed-day research series. Existing `revenue30d`, `revenueAnnual`, `revenue1y` and `multiples.ps` retain the overview aggregation used by legacy accounting and scores. This preserves matching denominators for holder/revenue and holder/fees ratios. UI P/S, research revenue growth and exported browser `snapshot.ps` use `researchPs` / `revenueAmount`. The detail places legacy overview ratios under the collapsed “원천 집계와 금액 비율” disclosure and explains the difference. Do not calculate holder share by dividing an overview holder amount by a differently dated research revenue series.

24-hour and 7-day quote changes come from CMC or CoinGecko price fields. DefiLlama TVL change percentages are never used as price changes.

## Screen and interaction

- Default table: P/S30, actual revenue30 with growth, market cap, FDV and price. Reasons below the project name expose low P/S or revenue growth without a composite score.
- Four primary presets: discovery, P/S and revenue trend, holder returns, price/supply. Individual columns remain selectable, and existing scores are available only as an optional preset/detail disclosure.
- Views: all, revenue growth, current holder return observations, favorites, changes since review, and data status. Holder zero/positive transitions compare the latest two 30-day windows; transition view includes stopped flows as well as new flows.
- Details: price and 24h/7d/30d quote changes; market cap and FDV; project introduction; fixed-cap P/S periods and actual revenues; weekly revenue chart/table; holder mechanism and policy evidence; source accounting, data issues and legacy score explanations.
- Search, filters, favorites, column selection, editable P/S reference, export and manual refresh remain functional. Mobile tables scroll horizontally with the project name fixed. The detail dialog supports Escape and restores focus.
- V5.1 condenses the title, P/S reference and refresh controls into a compact header. The table has no independent vertical scrolling region; its real column header follows document scrolling and retains horizontal alignment with the pinned project column.
- Numbered pagination and a native 50/100/200 row dropdown appear above and below the table. The default is 100, and the browser remembers the selected size. Changing page or size focuses and scrolls to the results heading. Closing details restores the opening row's focus and document scroll position; list filters, page and sort remain in place.

## Project descriptions and holder research

`lib/protocolResearch.ts` contains nine Korean project introductions and four detailed policy records (Pendle, Hyperliquid, Liquity V1 and GMX), each with a source, scope and review date. These curated introductions take priority over the provider translation.

`lib/protocolDescriptions.ko.json` contains 692 source-paired Korean translations prepared on 2026-09-13. The exact complete provider description is the lookup key, preserving names such as Safe, symbols, quantities, conditions and source scope. The server attaches only each row's matching `descriptionKo`; clients do not import the entire catalog. Original descriptions remain available through “DefiLlama 원문 보기”. Provider translations do not add official research or upgrade holder-policy verification.

When a source description changes or a new one appears, the UI explicitly shows that its Korean introduction is pending and keeps the original accessible. Add a reviewed translation under the new exact source text and advance the server snapshot cache namespace when publishing catalog updates. Do not silently reuse a translation for a changed source. This is a maintained translation catalog with no external translation account, runtime LLM request or additional credential requirement. Coverage counts describe a collection date; the screenable universe changes with source data and market cap.

Holder policy records separate funding, route, payout/burn asset, recipient, participation conditions and implementation status. The amount alone cannot prove a payout asset, a legal claim, a live distribution or an executed transaction. For example, the [GMX documentation](https://docs.gmx.io/docs/tokenomics/gmx-token/) distinguishes buybacks from currently suspended staking distributions. Pendle's buyback and later distribution represent the same funding path and must not be counted twice. Liquity V1 policy is not presented as V2 policy.

The official records are distinct from DefiLlama methodology classification and source amounts. A verified document does not upgrade provider amounts to on-chain audited amounts. All remaining policy fields explicitly say they are unverified.

To extend coverage:

1. Confirm the project/token and version/component scope.
2. Read the current official product docs, tokenomics and executed governance policy; retain the direct supporting URL and review date.
3. Describe the business, who pays and what generates protocol revenue. Record each holder path, funding origin, output asset, recipient and restrictions separately. Distinguish proposals, live policies and suspended policies.
4. When sources conflict, state the unresolved scope/version discrepancy rather than reconciling amounts by assumption. Keep source observations and any transaction checks separate.
5. Add/update only supported fields in the registry, then check the matching detail. Policy changes require a source refresh; there is no unattended LLM claim-generation pipeline, paid vendor or new credential dependency.

## Review history and operations

Browser observations remain one newest snapshot per KST day, up to 60 days. The review baseline is stored separately and advances only through “여기까지 확인 완료”. Reopening or refreshing does not acknowledge changes. The first observation initializes a baseline. Older rule versions and changed token identities are not compared.

Meaningful changes include added/removed existing observation tracks or revenue/holder amount changes of at least both 5% and $100. Price and experimental score movement alone do not qualify. Exact P/S/amount deltas remain in details. Recorded historical P/S uses market cap and recent-30-day revenue captured at that observation, never current market cap backfilled into past dates. At least two compatible records are required.

Daily GitHub archives remain independent immutable research receipts; they are not a server-side event feed in this screen. A baseline preserves net changes across missed visits, but an event that starts and fully reverses between observations can be missed. The UI must not promise a complete missed-event inbox. Browser data does not synchronize across devices.

Next caches the compressed joined snapshot for 30 minutes. Raw source bodies exceed the 2MB fetch-cache ceiling and use `no-store`; the API adds no second response cache. Missing optional sources are disclosed, and the last good client table remains available during errors. Page prerender and runtime cache can start from different collection times; client refresh adopts the newer valid observation.

`snapshot:capture` hashes the revenue calculation, source, research policy and existing scoring/accounting modules alongside its output. Generated data and screenshots stay outside Git. Production root, remote, Vercel identity and clean-main requirements are unchanged.
