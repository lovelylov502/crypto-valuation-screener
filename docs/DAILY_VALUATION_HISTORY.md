# Daily valuation history

The historical store is a separate Turso Free database. The existing verified screener publication remains the source for current rows. No detail-page layout changes are included.

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

## Connection and operation

`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are server-only variables. GitHub Actions holds the database-scoped writer; Vercel production holds a separate read-only token. Local `.env.history*.local` files are Git-ignored. Never use a `NEXT_PUBLIC_` variable for credentials.

```text
npm run history:sync -- --local --archives --cache <outside-Git-directory> --archive-tag history-initial-YYYYMMDD
npm run history:archive -- --cache <same-directory> --tag history-initial-YYYYMMDD
npm run history:publish -- --cache <same-directory>
```

Load the writer environment only for remote synchronization/import. `--database` selects a local staging SQLite filename. Import is resumable and copies changed rows only. Source archives use immutable GitHub releases and independent SHA-256 readback; they never move the screener's published pointer.

`Daily valuation history` follows successful `Verified screener publication` runs on main. It is serialized, skips automatic repeats within five hours, and also supports manual continuation. It fetches at most 80 market histories per run, prioritizing source-bearing assets by market cap. Provider-wide deferrals are persisted. Full-series reconciliation runs once per UTC day; subsequent wakes only process pending market assets, keeping repeated full-table reads out of the free allowance. Daily source refresh and market backfill are independent: one provider's rate limit does not discard acquired fundamentals.

[Turso Free](https://turso.tech/pricing) currently includes 5 GB, 10 million rows written and 500 million rows read per month. The writer reserves at most 8 million estimated monthly writes atomically and stops before a conservative 4 GB storage boundary. Primary-key writes are counted twice with transaction overhead; unchanged content is skipped. No secondary indexes, paid plans or payment method are required. This application budget covers this application's writes; manual/external writers must share the allowance. Platform usage remains the authoritative total.

## Query API

`GET /api/history?slug=parent%23maker&days=30&range=all`

`range=ytd`, `from=YYYY-MM-DD`, `to=YYYY-MM-DD`, `after=YYYY-MM-DD` and `limit=1..1000` are supported. Responses contain asset coverage, dated market points, four stored multiples, denominator totals/coverage/reasons, the underlying daily fundamentals, and source receipts. Follow `nextCursor` until null. During a batch update, a multiple whose stored value does not agree with the returned inputs is withheld with `valuationState=updating`. Queries are parameterized and cached for ten minutes; requests never trigger collection. A configured read-only connection is required. Missing assets return 404, invalid ranges 400, and unavailable storage 503.

Verification covers dated numerator changes, no look-ahead, complete windows, missing/zero/negative/conflicting data, scope changes, token identity, parent matching, pre-730-day history, provenance, idempotency, pagination and atomic free-quota rejection. Local tests do not substitute for remote import, permission and production API verification.
