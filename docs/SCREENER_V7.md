# V7: sales evidence, holder windows and comparison workspace

Reviewed 2026-09-20. Rule version: `research-v7-sales-and-holder-windows`.

## Why VVV exposed a material error

DefiLlama's Venice Revenue/Fees series measures holder return, not Venice AI's business sales. Renaming the old ratio in v6 prevented one misleading label but did not answer the business-sales question. Separately, an FDV-based multiple and a circulating-market-cap multiple cannot be compared without naming the numerator.

[Sacra](https://sacra.com/c/venice-ai/) estimates $110M of annualized business revenue for August 2026. This is an external run-rate estimate, not audited TTM or verified contractual ARR. Using the historical example $1.35B mcap and $2.27B FDV gives 12.3x and 20.6x respectively. The actual UI uses current market values. A 100x-plus holder-return multiple can coexist with a roughly 20x FDV/sales multiple; they have different denominators.

[Venice's official explanation](https://venice.ai/lp/vvv) describes a portion of monthly revenue funding VVV buy-and-burn. The [DefiLlama adapter](https://github.com/DefiLlama/dimension-adapters/blob/master/fees/venice/index.ts) values burned tokens in USD. Burn-time valuation is not independently reconciled to cash purchase expenditure here.

## Metric contract

| Label | Denominator | Guard |
|---|---|---|
| P/S business sales | Separately reviewed annual business sales or annualized estimate | Exact token identity, scope, source, date, review deadline and estimate badge required |
| P/R protocol revenue | Protocol-retained revenue for the chosen window | Reviewed protocol-revenue definition; history scope must match |
| P/HR holder return | Eligible distribution/buyback/buy-and-burn daily amounts | Reviewed eligible components and identical names, definitions and economic scope; full dated window required |

All three use the selected current mcap or FDV. A shorter window is annualized as amount × 365 / days. A 365-day window must contain 365 completed UTC days. Missing data is never zero. No shorter-window sales history is fabricated from the one annual sales estimate. P/R without a dated series can use the provider's disclosed rolling 7/30/90-day total, visibly separated from completed UTC windows; provider total1y alone never becomes TTM.

These labels intentionally distinguish business sales from protocol revenue. [Token Terminal](https://tokenterminal.com/resources/articles/token-terminal-key-metrics-faq) and some other crypto services call a protocol-revenue multiple P/S. This application does not assume those definitions are universal company sales. See also [DefiLlama's definitions](https://docs.llama.fi/analysts/data-definitions).

## Identity and source safeguards

- Numeric CMC IDs require symbol agreement. Conflicting/missing declared IDs do not fall through to a same-ticker asset. Gecko IDs never fall through to a different project's name match. Substring matching is removed.
- Parent links from the protocol directory and all overview feeds are used, including children absent from the overview. A parent's market cap is not summed across children.
- Stablecoin directory asset ID/slug plus symbol matches exclude issued supply from investment-token multiples, opportunities and scores. Governance tokens of stablecoin protocols are distinct. The directory is a required source; a fetch failure cannot silently disable this check.
- Ambiguous chart names, unknown definitions, changed definitions and unmatched daily-history scope hold the affected metric. Raw amounts remain available with their original labels.
- `fundamentalErrors` validates every served row and refreshed response. The full audit additionally validates every joined input row. Sales, protocol and holder multiples are recomputed for contract validation.

## Reproducible all-universe audit

Command: `npx tsx scripts/audit-valuation.ts <output> <read-only-v6-checkout> [replay-receipts]`.

The script captures public response bodies once, saves hashes and compressed receipts, then feeds the same bodies to v6 and v7. A replay can reuse the successful receipts without confounding price movements. It saves both scored results, all new inputs, per-row changes and reasons for removed rows. Failed sources fail the audit.

2026-09-20 audit: source bodies collected 01:37 UTC; final replay 01:55 UTC. Old joined universe 6,940; new universe 6,192, all contract-checked. Screenable rows 723 → 584. The union contains 741 rows: 386 retained rows changed, 180 unchanged, 157 removed/grouped, 18 newly present. Of removed rows, 78 were consolidated under explicit parents, 72 no longer met the $1M market-cap screen after identity/source correction, and 7 lacked supported market/TVL data. There were 61 market numerator/source changes, 17 P/HR changes and 25 score changes; these are overlapping counts.

Coverage in that observation: P/S 1; P/R 89; P/HR 7d/30d/90d/365d = 21/24/22/16. Six stablecoin rows were excluded from valuation. Zero contract failures and zero failed sources. API payload 3,387,156 bytes, below 4.5 MB. These counts describe the captured observation; live coverage changes with source availability and market thresholds.

Automated checking of every supported row is not an independent financial or onchain audit of every project. P/S business-sales evidence currently covers Venice only. Other projects retain explicit unavailable sales and their independently eligible P/R/P/HR data.

## UX decisions and validation

[TradingView's saved screens](https://www.tradingview.com/support/solutions/43000718804-how-to-create-save-and-update-a-custom-screen/), its [watchlist filtering](https://www.tradingview.com/support/solutions/43000724549-how-to-scan-watchlist-or-flagged-list/), and [Koyfin's screens](https://www.koyfin.com/help/my-screens/) informed separation of universe, filters and displayed columns. This is an adaptation to the existing product, not a copied interface.

- One comparison table; persistent left filters/column controls; a right evidence drawer. Settings no longer expand above and push away the results.
- Watchlist/universe filters preserve selected columns. Column ordering, numerator and filter choices persist locally. Adding four period columns preserves P/S and the current comparison.
- The old generic market-cap/typed-amount column presets were removed. Optional raw amounts and experimental scores are separate from the three named headline ratios.
- Source/estimate status and exact calculation evidence are available from each ratio. Missing values explain the reason instead of implying zero. Keyboard dialog closing, focus return and a trapped mobile control panel support keyboard navigation.

## Recurrence prevention and maintenance

The existing daily 09:17 KST archive now includes `quality.json`: coverage by metric/window, expired sales evidence, source-definition changes and contract failures. Calculation files, sales registry and capital eligibility rule hashes are recorded. This does not create a new notification automation.

New sales records require an external evidence review with numerator/denominator scope and exact token linkage, then a dated registry entry and regression example. Never add a multiplier or hard-coded target ratio to reproduce an expected answer. Expired evidence withholds P/S until re-reviewed. Policy changes and history-scope changes invalidate comparisons with the old browser baseline.

The daily archive records evidence for later inspection; it does not promise detection of upstream mistakes that preserve the same declared methodology. Provider integrity, cash-versus-burn valuation, rights, costs and audited financial statements remain explicit research limits.
