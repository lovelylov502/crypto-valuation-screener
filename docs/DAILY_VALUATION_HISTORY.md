# Daily valuation history

The historical store is a separate Turso Free database. The verified screener publication supplies the current table and latest detail summaries; `/api/history` supplies the dated detail charts. Their observation times and update progress remain separate.

## Calculation and dates

- A row dated D retains an actual USD price, circulating market cap and/or FDV observed on UTC date D. CoinGecko historical daily observations use 00:00 UTC; archived screener quotes retain their actual provider timestamp. FDV can have a different time from the midnight price, disclosed in `fdvAt`.
- A trailing N-day denominator covers D−N through D−1. This avoids using the unfinished day D. N is 1, 7, 30, 90 or 365.
- `P/R = capital / (Revenue × 365 / N)`; `P/HR = capital / (Holders Revenue × 365 / N)`. Both market-cap and FDV versions are persisted. These are DefiLlama source-reference multiples, independently of economic classification review.
- A complete, consistently scoped window and verified token identity are required. Partial groups, conflicts, missing dates and nonpositive denominators do not produce a multiple. Reported zero and negative amounts remain distinct from missing data.
- Historical revenues are reconstructed from the provider's available dated series, which may have been revised. They are not proof of what the provider had published on the historical date. Original HTTP receipts, hashes and observation times remain available.
- Missing FDV stays null. Current supply is never multiplied by a historical price. A legacy snapshot's fallback provider capital is omitted if its own quote timestamp cannot be established. Token migrations do not splice differently identified token prices together.

## Available history

All dated Revenue and Holders Revenue points in the verified raw bundle are retained, without the current screen's 730-day summary limit. Exact parent summaries can restore older parent totals; incomplete child sums cannot.

The anonymous [CoinGecko market-chart API](https://docs.coingecko.com/demo/reference/coins-id-market-chart) provides at most 365 historical days. We respect that limit and Retry-After, request at most five times per minute, and checkpoint completed assets. Archived screener market/FDV observations are also imported. Newly observed dates are retained indefinitely. The API returns the full available range, YTD or explicit dates; unavailable source history remains unavailable.

## Detail charts

The detail modal places the project introduction and latest key metrics on the left, with two charts on the right: price/market cap/FDV above, P/R/P/HR below. Both charts share the date cursor. Pointer input or the left/right arrow keys inspect dates; Home and End select the range boundaries. The existing research view retains the complete introduction, English original, five-period comparison, holder conditions, source links and calculation evidence. It also discloses the chart's source receipts, stored coverage, linked publication, calculation version and separate market/FDV observation times.

`7D`, `1M`, `3M` and `1Y` cover 7, 30, 90 and 365 UTC dates including today; `YTD` starts on January 1 UTC. `MAX`, selected initially, follows every API cursor and uses the full stored market range. The initial provider acquisition limit does not cap subsequently retained observations. An absent UTC date or null series value breaks that line; isolated valid observations remain visible.

The revenue denominator is a separate 1/7/30/90/365-day control, initially 30 days. The capital control starts with the table's MCap/FDV choice and changes the detail view locally. The top chart uses a USD price axis and a separate USD market-cap/FDV axis. The bottom chart reads the selected stored multiples; it never infers missing FDV or calculates a withheld multiple in the browser. Its 365-day denominator requires 365 completed dates, even when the latest screener summary has a separately labeled provider-year total.

The client requires the historical asset to match the current screener token identity and retains one calculation version and publication identity across pages. A changed identity or pagination boundary returns an explicit error rather than combining token histories. Loading, empty date ranges, a missing stored asset, identity updates and storage failures have distinct states. Current summaries remain available independently of chart loading.

## Connection and operation

`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are server-only variables. GitHub Actions holds the database-scoped writer; Vercel production holds a separate read-only token. Local `.env.history*.local` files are Git-ignored. Never use a `NEXT_PUBLIC_` variable for credentials.

```text
npm run history:sync -- --local --archives --cache <outside-Git-directory> --archive-tag history-initial-YYYYMMDD
npm run history:archive -- --cache <same-directory> --tag history-initial-YYYYMMDD
npm run history:publish -- --cache <same-directory>
```

Load the writer environment only for remote synchronization/import. `--database` selects a local staging SQLite filename. Import is resumable and copies changed rows only. Source archives use immutable GitHub releases and independent SHA-256 readback; they never move the screener's published pointer.

`Daily valuation history` follows successful `Verified screener publication` runs on main. It is serialized and also supports manual continuation. A new published snapshot runs its latest-data pass immediately; the five-hour automatic cooldown applies only to repeated continuation of the same snapshot. The pass reconciles current quotes, available dated source corrections and token identity across assets before historical market downloads use the remaining time. Source-bearing assets come first, then market cap. A provider rate limit cannot discard acquired fundamentals or delay that pass behind market backfill.

Reconciliation compares hashes and scopes for every available dated input, including older provider corrections. Financial payload reads and recalculation cover the affected market dates and their complete denominator lookback. Unchanged values retain their original source witness. Previously observed dates remain stored when later responses omit them. New assets, calculation/identity/eligibility changes, interrupted updates and assets whose last consistency check was at least 30 days earlier receive a full consistency pass when reconciled.

Each run has a 40-minute work budget, leaving time for source archiving before the job timeout. An asset is marked `updating` before changed inputs are written; its final checkpoint follows all series and valuations in the ordered, quota-reserved write stream. Interruption leaves that marker for a full consistency pass on the next attempt. Completed assets for the same snapshot are skipped on continuation. `--reconcile` explicitly includes all assets again; `--time-budget-seconds` can shorten a manual run. A stale HTTP connection gets one read-only reconnect; writes with an unknown outcome are never blindly replayed.

After the latest-data pass finishes, the standard workflow allows at most 80 new market requests per run with at least 12 seconds between requests. `--max-market` selects a smaller or explicit manual request budget within the work deadline. Original receipts and parsed points are checkpointed before applying them to an asset; `marketHistoryId` is committed only after that application succeeds. A later attempt can apply an acquired series without fetching it again. Provider-wide and per-asset retry deadlines survive continuation and `--force`. HTTP 401/403 pauses that provider for at least 24 hours; HTTP 429 honors Retry-After. A valid empty HTTP 200 series retains its receipt, marks that asset unavailable for 24 hours and allows other assets to continue; a later refresh also preserves the empty original. Recoverable per-asset failures leave pending work, while database, integrity and quota failures stop the run.

Reports separate latest reconciliation, downloaded versus cached histories, pending application, valuation calculations, database request counts and returned rows. Returned rows are application measurements; the platform's billed reads and total usage remain authoritative.

[Turso Free](https://turso.tech/pricing) currently includes 5 GB, 10 million rows written and 500 million rows read per month. The writer reserves at most 8 million estimated monthly writes atomically and stops before a conservative 4 GB storage boundary. Primary-key writes are counted twice with transaction overhead; unchanged content is skipped. No secondary indexes, paid plans or payment method are required. This application budget covers this application's writes; manual/external writers must share the allowance. Platform usage remains the authoritative total.

## Query API

`GET /api/history?slug=parent%23maker&days=30&range=all`

`range=ytd`, `from=YYYY-MM-DD`, `to=YYYY-MM-DD`, `after=YYYY-MM-DD` and `limit=1..1000` are supported. Responses contain asset coverage, dated market points, four stored multiples, denominator totals/coverage/reasons, the underlying daily fundamentals, and source receipts. Follow `nextCursor` until null. Only the requested denominator window is recomputed for response consistency. A stored multiple is withheld with `valuationState=updating` when its inputs disagree, the asset is being reconciled, or its checkpoint changes during the query. Queries are parameterized and cached for ten minutes; requests never trigger collection. A configured read-only connection is required. Missing assets return 404, invalid ranges 400, and unavailable storage 503.

Verification covers dated numerator changes, no look-ahead, complete windows, missing/zero/negative/conflicting data, scope changes, token identity, parent matching, pre-730-day history, provenance, idempotency, pagination, changed-date reconciliation, interrupted-write recovery and atomic free-quota rejection. Local tests do not substitute for remote import, permission and production API verification.
