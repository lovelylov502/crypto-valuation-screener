# Full directory and short-window research

The workflow is low 30-day P/R → revenue growth → eligible holder return. The table always starts with every discovered project, including unknown caps and non-investment assets. Explicit filters can combine low multiples, increasing revenue and eligible holder flow; no preset silently promotes a project as undervalued.

## Scope and transport

Merge DefiLlama `/protocols`, `/config.parentProtocols`, fee/revenue/holder overviews and DEX overview. Parent links group products; parent token metadata participates in exact-ID reconciliation. Conflicting identities withhold valuation, not directory membership. Projects, verified unique investment tokens and computable multiples have separate counts. The directory is the union of these public endpoints, not a guarantee of every asset on every DefiLlama product.

`GET /api/screener?prefs=<JSON>&favorites=<comma-separated-slugs>&page=1&size=100` returns a `ScreenerPage`. `coins` is a page; `pagination.total` is the complete directory; `pagination.filtered` counts the full filtered set. Sizes are 50/100/200. Search/filter/sort run before slicing. Exports walk the complete result and reject a collection-time change. No external database or paid provider is added.

One gzip snapshot is split into SHA-256-addressed base64 chunks below 2 MB, then its manifest is cached. A reader verifies chunk hashes and observation time; missing chunks rebuild the snapshot. Fresh values are returned directly because Next can persist entries after a request. A 30-minute in-process value and concurrent-build promise avoid repeated source work. Server-response cache headers remain no-store.

## Arithmetic and source boundaries

- P/R uses reviewed protocol revenue/service receipts; separately sourced business P/S remains supplementary evidence. P/HR uses reviewed eligible holder flows.
- 24h is the latest **completed UTC day**. It is not live rolling 24h. P/R and P/HR use the same dated basis. Provider rolling totals remain separately labeled reference data.
- 1/7/30/90 days annualize by `365 / days`; 1 year requires 365 dated observations. Annualization does not predict future revenue.
- Growth compares the immediately preceding equal window. A full yearly comparison needs 730 days. Incomplete constituent/date coverage stays null. No zero filling, partial-year TTM or silent FDV→MCap substitution.
- A zero baseline yields “0에서 발생” or “0 유지”; negative baselines use dollar change without a misleading growth percentage. Percent and absolute growth sort independently. Complete 7-day histories expose peak-day concentration.
- Cash distributions, buybacks, burns and conditional lock/voter payouts retain their distinct mechanisms. Inflation/unlocks are not subtracted; FDV/cap is a dilution reference, not a net-holder-return metric.

## AERO review (2026-09-26)

Exact six-field provider methodologies were reviewed and registered for `aerodrome-v1`, `aerodrome-slipstream`, and `aero-lite`. V1/Slipstream revenue and holder revenue include staked-pool fees and external voting incentives. Their amounts overlap and must not be added. Payouts require AERO locking and pool voting; ordinary token ownership does not automatically receive the whole denominator. Emission/rebase flows are distinct.

Sources: [official Aerodrome docs](https://aerodrome.finance/docs), [DefiLlama V1 adapter](https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/aerodrome/index.ts), [Slipstream adapter](https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/aerodrome-slipstream/index.ts), [Aero Lite adapter](https://github.com/DefiLlama/dimension-adapters/blob/master/dexs/aero-lite/index.ts). This is methodology/code review, not transaction-by-transaction payout verification. Methodology drift still disables the reviewed classification.

At the verified observation, the combined revenue history includes only 9 complete days across all three constituents. Thus AERO P/R 24h and 7d calculate, while 30d/90d/1y are withheld. The eligible two-component holder history has full coverage. Raw provider 30-day revenue remains inspectable; it does not replace the missing combined daily history.

## Local observation receipt

2026-09-26 05:33:09 UTC: 7,123 projects; 2,798 linked unique eligible investment tokens; zero failed source observations. Across MCap and any displayed period, 140 projects have P/R, 74 have P/HR, and their union is 168. Source-present but withheld: 1,527; missing relevant period data: 5,428. Counts overlap for P/R and P/HR and change over time.

All 7,123 rows were paged once without duplicates or losses. Maximum 200-row response: 1,610,781 bytes; default response: 881,238 bytes. Snapshot inputs, outputs, source receipt, coverage and replay verification remain ignored under `snapshot-output/v9/final/2026-09-26T05-33-09-472Z`. No production deployment is claimed.

## Settings and interaction

Default periods: 24h, 7d, 30d, 90d, 1y for P/R, revenue and P/HR. Row expansion uses horizontal market, growth and holder bands, with evidence below a disclosure. CMC is the market link; DefiLlama is the fallback. Search sees the full directory. Identity/header remain fixed within the scrolling table. Mobile scrolls the table, not the document.

Favorites and workspace keys stay unchanged. Only the exact old default layout migrates automatically; user-defined columns, thresholds and numerator survive. Legacy growth/holder views become composable flags. P/S-only retired controls follow the existing migration. Graphs, the right-hand detail panel and browser-baseline navigation are removed from the active screen; old stored history is preserved.
