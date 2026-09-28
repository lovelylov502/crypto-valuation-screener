# v10 · source revenue and quote coverage recovery

The FWA report exposed a display dependency on valuation eligibility: a valid provider amount disappeared whenever the revenue definition was unreviewed or a dated window was incomplete. The 2026-09-27 audit snapshot contained 7,125 projects, including 931 with positive provider 30-day revenue but a blank revenue cell. Of those 931, 215 had verified token identity and eligible positive market capitalization; 131 of the 215 had unregistered or missing definitions. These are overlapping counts, not additional omissions.

The first repair remained uncommitted and local: the public service still served v9. The next audit also found that the four-page CoinGecko rank scan stopped at 1,000 assets, while FWA's quote was on page five. The existing deployment verifier allowed an absent FWA cap and empty multiples. Therefore restoring Revenue display alone could not close the incident.

## Completion plan and checks

1. Preserve the full DefiLlama source universe and query all explicit asset IDs. Verify source membership, query outcomes and quote fields independently.
2. Recover exact-scope parent dates when any or all children are absent. Keep raw provider amounts visible when calculation evidence is incomplete; test zero, negative, partial and missing values separately.
3. Detect recurrence through per-snapshot contracts and comparisons with the prior successful daily archive. Test rate-limit failures, rank changes, definition drift and UTC date boundaries.
4. Release through the canonical guarded command, then verify every live page and the user's FWA browser view. Local tests and a local browser are not a production receipt.

## Source display and calculations

`revenueReading` displays a matching, complete UTC window when available, otherwise the provider's finite 24h/7d/30d/1y amount. Fallback amounts carry a provider-period label, source URL and observation time. A provider 1y total without 365 dated days is explicitly labeled; no 90-day amount is invented. Zero, negative and missing amounts remain distinct. Amount sorting uses the displayed amount.

If only some non-doublecounted children report a period amount, their sum remains visible as a partial aggregation with reported/expected component counts. It is display evidence only: strict complete-group values still feed ratios and growth. This also protects source amounts when a newly listed child has no period total yet.

P/R, P/HR, growth filters and growth sorting retain their economic-definition, identity and history checks. Displaying an unreviewed amount does not approve it as protocol revenue. Holder returns, trading PnL and mixed/unknown definitions retain their separate labels. Existing saved column IDs, order, filters and favorites are unchanged.

## FWA identity and history

The former `fake-world-assets` review did not follow the split into V1 and V2. Separate reviews now bind V1 to DefiLlama ID `8292` and V2 to `8767`, with all six methodology fields checked. V1's definitions match the earlier review. The official `fees/fwa-v2` adapter assigns the team share plus burned-token funding to Revenue and actual buyback/burn expenditure to HoldersRevenue. V1 includes retroactive buybacks funded by previously earned fees. The holder/revenue share remains withheld because those periods need not represent the same earned revenue.

A new component can have fewer daily observations than its parent. Requiring every child to exist on every historical date shortened FWA's 30-day window to nine observations. Parent supplementation now accepts explicit completed UTC dates from the provider after checking the parent ID, exact child ID set, names, all six methodology fields, double-counting flags and existing overlapping amounts. It never inserts zero for missing child days. A holder subset cannot consume a broader parent total.

The candidate scan includes missing recent days even if every child is absent from the overview chart. An empty breakdown can still reach validated parent recovery. Both history caches and the joined snapshot expire their date key at UTC midnight, even within the normal 30-minute lifetime. The joined snapshot retains the date collection started, separately from its completion timestamp: a request spanning midnight cannot keep the previous day's history in the next day's memory cache.

Revenue requests are limited to reviewed revenue groups; holder requests use the eligible holder scope. This keeps the bounded request budget available for computable periods. Current parent names are derived from provider links, preserving renamed parents such as Sky and Derive. Mismatched parent scope or values retain the original history and a `withheld` supplementary-source observation with the reason shown in the data guide. These received-but-withheld series are counted separately from failed requests in daily archives.

## Quote collection and recurrence detection

All unique explicit CoinGecko IDs from the directory, parents and overviews are requested in batches of at most 250; market-cap rank is irrelevant. Every ID gets a received, not-returned or failed lookup record. CMC discovery follows every 5,000-row page until the provider returns the final page; canonical CMC IDs absent from that list use direct quotes. A symbol conflict is recorded as an identity mismatch. Each cap, price and FDV field falls back independently and records its provider. Metadata from every source row participates in the join, so a directory row cannot discard an ID supplied by an overview.

CoinGecko requests are serialized at least 12.5 seconds apart, with a 60-second minimum cooldown on 429 and a 260-second collection budget. IDs left after exhaustion are explicit failures. This respects the documented public minimum of five calls per minute without accepting silent truncation. Local successful collection took 144 seconds; functions and clients allow 300 seconds. Public provider outages or changed source identities can still prevent data collection, and remain explicit failures or withheld values.

`collectionQuality` checks unique project/source membership, query accounting, available-but-dropped quote fields and hidden raw Revenue amounts. Daily `collection-state.json` files compare lost membership, identity changes, quotes, displayed periods, previously complete history and reviewed definitions. A failed job retains its diagnostic artifacts and the last successful baseline remains the comparison target. Legitimate removals or source changes also need review; detection does not imply an app bug in every case.

The production gate adds a named FWA assertion plus all-page `audit:coverage`: independently fetched DefiLlama source lists must be represented, finite source Revenue amounts must remain visible, and missing quote fields are directly re-queried at both providers. HTTP 200 and a valid JSON shape alone no longer pass a source-loss incident.

Public readback found another recurrence risk: Next includes the cache callback's string representation in its key, and independent HTML/API minification changed that representation. The first deployed API snapshot was `2026-09-27T23:39:13.873Z`, while HTML collected again at `23:41:40.095Z`. Bound callbacks now keep that representation stable; explicit version, namespace, date and content-hash keys identify every dependency. The deployment gate requires the page to contain the exact API snapshot timestamp, catching separate cold collections as well as stale HTML.

The second hosted daily run correctly failed on a transient Stargate parent-history request and an Omnipair identity change. Omnipair entered CMC's former discovery cutoff with a zero circulating supply/market cap, masking its positive CoinGecko cap. CMC discovery now has no rank cutoff, and identified positive quote fields take precedence over zero placeholders; if every source reports zero, zero is preserved. Circulating supply follows the selected CoinGecko cap when that fallback is used. Revenue zero and negative amounts are unaffected. The live audit independently rechecks zero quote fields as well as nulls. Snapshot guards reject positive quotes masked by zero and flag loss of previously positive quotes. Adding a previously absent vendor ID is enrichment; replacing or losing an existing ID still fails the comparison.

Child and parent summaries retry transient network/429/5xx failures once, with a 15-second per-attempt timeout inside a shared 60-second budget per collector. The ordinary source requests also retry transient network errors inside their existing attempt and deadline limits. Final failures retain HTTP status and fail the daily job; parent scope/value conflicts are still withheld. Failed artifacts remain available for diagnosis and never replace the last successful comparison baseline.

Provider references: [CoinGecko ID batches](https://docs.coingecko.com/reference/coins-markets), [public rate limits](https://support.coingecko.com/hc/en-us/articles/4538771776153-What-is-the-rate-limit-for-CoinGecko-API-public-plan), [CMC Keyless API](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api), [Vercel function limits](https://vercel.com/docs/functions/limitations).

## Evidence and limits

Frozen replay of the original 7,125 rows changes the 931 blank source amounts to zero blanks. Eight independently archived exact-scope parent series recover 30 observations: Uniswap, Aerodrome, Bedrock, FWA, Folks Finance, Drift, Curve and Pyth. The live revenue collector recovers the first six; Curve and Pyth remain unreviewed and display their provider totals without approving P/R.

At the live source check on 2026-09-27 14:05 UTC, FWA's completed 30-day revenue is $281,185. The earlier screenshot and audit snapshot used a different provider observation; this is not a same-snapshot arithmetic comparison. Official source data can change after collection. Genuine source gaps, scope mismatches, unreviewed definitions, unavailable token quotes and insufficient 365-day histories still withhold affected calculations.

The second full local audit, snapshot `2026-09-27T23:25:47.705Z`, preserves 7,126 projects and all 9,427 independently fetched source members. All 1,591 available 30-day Revenue readings are displayed, including 25 partial group summaries. For the 2,768 distinct selected CoinGecko IDs, 1,531 are returned and 1,237 are explicitly not returned; request failures are zero. An independent 2,024-ID recheck of missing fields finds no available quote omitted by the app. FWA has cap $16,993,067, completed 30-day Revenue $312,957, P/R 4.4628828828 and P/HR 3.1904517382. Both Revenue and holder histories have 30/30 days. These time-specific observations do not claim that all projects have market quotes or eligible financial ratios.

Evidence remains outside Git under `C:/Users/TAE/Documents/Codex/2026-09-27/fwa-source-audit/repair` and `C:/Users/TAE/Documents/Codex/2026-09-28/fwa-coverage-repair`. See [HANDOFF.md](./HANDOFF.md) for production release receipts.
