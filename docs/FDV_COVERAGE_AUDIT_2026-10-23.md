# FDV coverage audit — 2026-10-23

The complete current universe was inspected, including assets without prices or token identities. Archived provider originals and all stored FDV states were checked separately from current quotes. No historical FDV is inferred from today's supply.

## Pinned baseline

Publication: `data-39891465183-1-complete`, collected `2026-10-23T02:48:27.396Z`, completed history through `2026-10-22`.

| Check | Baseline |
| --- | ---: |
| Projects | 7,352 |
| Verified, capital-eligible project identities | 3,059 |
| Eligible projects with a positive current price | 1,526 |
| Eligible projects with positive current FDV, before quality review | 1,521 |
| Raw asset identities, including older/unlinked identities | 3,989 |
| Positive stored FDV dates across raw identities | 34,978 |
| Positive FDV cells failing source ownership/timestamp checks | 0 |

Among current eligible identities, 6 have over 365 FDV dates, 1,040 have 15–30, and 596 have 1–14. Another 1,197 have no positive FDV, and 220 have no exact raw identity. These categories include projects without current market quotes and are not automatically provider-request failures.

Five priced identities lack positive current FDV: Alchemist and Olive Cash have capital consistency/staleness exclusions; Delta and Parrot have provider-reported zero diluted values; DexHunter's provider omits FDV. A zero or omitted quote is not replaced by a guessed supply valuation.

## Verified repairs

The selected quote's original `last_updated` belongs to FDV even when the snapshot's preferred price comes from another provider. The older adapter accepted FDV only when the price provider matched, and some old normalized timestamps described the price rather than FDV. `originalCapturedFdv` reconstructs the selected original amount at its actual timestamp. It requires exact current/archived identity, selected provider ID and observed receipt, equal original FDV, valid quote time, and the existing anomaly/review gates. It does not rewrite a held legacy claim.

Twenty-five pinned snapshot/source-bundle pairs were replayed. Four older snapshot-only sources remain excluded. The original-record repair finds 4,121 empty completed-day FDV cells across 794 projects. Existing positive or conflicting/held cells are left intact.

The free Coin Metrics catalog was acquired again: 24 requests, 20 asset histories, 23 exact current bindings, and 6 approved FDV identities. The resulting 13,871 approved dated FDV observations use each day's actual `PriceUSD` and `SplyCur` and agree with provider capitalization. Supply consistency now uses the same relative `1e-10` tolerance as capitalization consistency. Thus 1INCH's dated supply of `1,499,999,999.997` agrees with reviewed full issuance of `1,500,000,000`; the stored valuation still uses the former. A one-token difference at that scale is rejected, as is Lido's material 3,691,500-token gap. No missing supply is replaced with a constant. The [1INCH contract](https://github.com/1inch/1inch-token/blob/master/contracts/OneInch.sol) explicitly supports minting/burning; original dated supply remains necessary.

The combined SELECT-only plan finds **4,957 empty dates across 796 projects**, with a conservative 37,736-credit upper bound. The repair is bounded to 50,000 credits within the existing 8M/4GB global limits. It uses the maintenance reserve for this reviewed correctness repair; bulk MAX acquisition continues to retain its 500,000-credit reserve. Every inserted cell carries an expected-empty-cell guard inside the write transaction. A concurrent completion fails the guard. Replaying the completed repair plans zero further changes.

Review evidence is retained outside Git and published in the repository's `fdv-recovery-20261023` Release. `.github/workflows/recover-fdv.yml` pins both asset hashes, uses the existing hosted writer, retains reports, and rebuilds current history/table reads after repair. Local credentials remain read-only. Runtime completion and the final database census must be verified separately from the dry run.

## Current quote quality

The baseline contains eight selected positive FDV amounts above their same-record price × finite maximum-supply bound (including LINQ) and Snowbank's existing CoinGecko supply-unit hold. Acquisition revision 10 applies these gates before selecting current FDV, allowing only otherwise verified consistent alternatives. A failed maximum bound supplies no replacement value. Missing maxima alone do not reject a provider-reported FDV. Original revision 1–9 archives retain their exact replay behavior.

## Remaining source limits and Geodnet

Geodnet has 1,142 positive price days but only 18 FDV days, `2026-10-05`–`2026-10-22`. The replay finds no additional completed Geodnet FDV in the verified originals. Its earlier FDV cannot be reconstructed from those price/market-cap files. Details now display the actual FDV day count and starting date.

CoinGecko's [historical chart](https://docs.coingecko.com/reference/coins-id-market-chart) supplies price, circulating market cap and volume. Its [historical total-supply endpoint](https://docs.coingecko.com/reference/coins-id-total-supply-chart) requires the Enterprise plan. The free [Coin Metrics supply](https://docs.coinmetrics.io/network-data/network-data-overview/supply/current-supply) catalog covers a limited identity set and does not cover Geodnet. The [DefiLlama free inventory](https://github.com/DefiLlama/api-docs/blob/main/llms-free.txt) provides prices without universal dated diluted supply.

Geodnet's [official token introduction](https://docs.geodnet.com/geod-token/geod-token-introduction) identifies Polygon, Solana and IoTeX deployments. A single-chain supply read cannot establish historical global supply across mint/burn bridges. Neither a paid subscription nor a new chain-supply convention was silently introduced. Missing dated evidence remains unavailable; this release does not claim complete historical FDV for every project.
