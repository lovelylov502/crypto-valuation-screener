# Same-date daily raw data

The database stores one row per exact token identity and UTC date, with that day's financial flows and dated market observations. The v0.5.0 chart, historical API and list comparison use the shared same-day read model below. Original `history_*` data remains available for historical audits and compatibility.

## Current chart and comparison read model

- `lib/dailyValuation.ts` calculates `capital(D) / (daily flow(D) × 365)` for both detail charts and list comparisons. Ratios require positive complete selected FDV/circulating cap and Revenue/Holders Revenue on the same completed UTC date. Fees, partial/conflicting cells, nonpositive denominators and current capital substituted into past dates do not supply a ratio. Confirmed raw zero amounts keep their own state.
- `/api/screener` attaches optional `valuationComparison` only after search, sort and pagination. The raw batch reads at most 366 dates for each of up to 200 requested exact slug/identity pairs. The latest point must be on the shared `asOf` date. From v0.6.2, the baseline uses the available distinct positive valid daily ratios within the preceding 365 dates; at least one comparable prior ratio and the exact latest ratio are required for `ready`. The bar shows the number of dates used, with an even-sized sample's median calculated as the mean of its two middle values. The latest point never enters that distribution; missing dates and missing latest values are not filled or carried forward.
- The current table route uses prepared comparison metadata with policy `available-prior-daily-ratios-v1`. Its indexed read does not download the full history payload. A policy change invalidates only the summary readiness check until a budgeted preparation rebuilds it; the same-date calculation version and MAX history contract remain independent. See [prepared read models](./FAST_READ_MODELS.md).
- `/api/history` returns schema 2 daily cells, ratios, original source metadata and per-metric measurement times. Queries bind the exact token identity and selected capital; `expectedRevision` binds continuation to the same raw-data revision. MAX follows advancing `nextCursor` pages of at most 1,000 dates until null, with one snapshot ID, identity, `asOf` and calculation version. The fixed `revenueDays=1` replaces the historical API's trailing-window `days` selector.
- The global `asOf` is the earlier of the verified snapshot's captured UTC day minus one and UTC yesterday. A lag greater than one completed UTC day is `stale_data`. Captured capital retains its actual intraday timestamp; an approved daily close for D may be timestamped at D+1 midnight. No token migration splices different identities together.
- Financial comparability binds provider, exact component scope, definition and measurement basis while allowing receipt URL/hash/time to change. The detail chart may retain valid dated regimes but breaks ratio lines when the financial definition changes. A comparison distribution mixing different financial definitions is withheld. Approved stored capital conventions retain their provenance without inventing a normalized replacement valuation.
- Summary caches distinguish reference date, exact identity and selected capital, using the run fingerprint only as a cache invalidation hint. A cold or dirty page reads every requested eligible coin in one coherent raw-row SELECT and resolves its immutable source metadata. A changed hint returns that coherent result without caching it; unrelated imports do not reject the summary. The list summary has an eight-second deadline; summary failure leaves the basic screener response usable.
- Detail continuation uses a content digest of the exact asset and full requested date range, covering all six raw cells and their immutable source hashes. Cursor and page size do not change that digest. A read-only transaction binds the cache hint, rows and sources; unrelated writes or changes outside the range retain the token, while changed scoped content rejects an old continuation. A range is limited to 32,000 dates before source loading. Its server cache expires after 120 seconds and retains at most 64,000 points and 32 MiB of encoded points/source metadata.
- The query-only read model is excluded before immutable API/archive hash reconstruction. These paths use server-side readers and do not collect data or write database rows.

Local contracts and read-only real-data benchmarks are separate from canonical deployment and actual replacement-workflow recovery. Do not infer live activation from this implementation description; retain those operational readbacks independently.

## Stored contract

Reviewed FDV correctness repairs use `scripts/recover-captured-fdv.ts` and the manual-only `recover-fdv.yml` workflow. The pinned snapshot/provider originals and optional Coin Metrics cache are replayed before any write. Only empty completed-day FDV cells qualify, protected by transaction-local expected-empty-cell guards; existing values, held/conflicting cells, prices and financials are preserved. This maintenance operation has a hard 50,000-credit run ceiling within the shared 8M/4GB limits and can consume maintenance headroom. Bulk MAX acquisition retains its 500,000-credit reserve. The [October 23 audit](./FDV_COVERAGE_AUDIT_2026-10-23.md) records the concrete evidence and remaining source limits.

| Field | Meaning |
| --- | --- |
| `price` | USD token price, with its measurement timestamp |
| `mcap` | USD circulating market capitalization, with its measurement timestamp |
| `fdv` | Verified USD fully diluted valuation, with its measurement timestamp |
| `fees` | DefiLlama's daily Fees amount for that date and exact protocol scope |
| `revenue` | DefiLlama's daily Revenue amount for that date and exact protocol scope |
| `holders` | DefiLlama's daily Holders Revenue amount for that date and exact protocol scope |

For example, March 5's multiple uses March 5's capital and March 5's own daily flow × 365. The reader calculates it from the stored cells without a previous-day or trailing-30-day denominator.

Every metric has a separate value, state, source reference and, for market data, measurement time. A project name or ticker alone cannot establish token identity. A token migration creates a different identity. Unverified links retain protocol financial history without attaching an uncertain market series.

Reported positive, zero and negative flows remain distinct. Missing, partial and conflicting values remain distinct, too. Negative market sentinels such as `-1` become missing cells; their original response remains archived. A malformed market series cannot discard independent financial history. Missing FDV is never synthesized using today's supply.

## Dates and sources

- Financial flows cover a completed UTC calendar day. Today's unfinished flows are excluded. Historical series can reflect later provider corrections; collection timestamps do not prove what was publicly known on the historical date.
- CoinGecko's public website CSV supplies its full available price/market-cap history without the anonymous API's 365-day cap. The export's event-date columns have different alignment: row D's price describes D's close at D+1 midnight, while row D's market cap describes D midnight. The importer shifts the market-cap date back one day, retains the actual timestamp, and records the verified convention in source metadata. Original API receipts for INDEX, ETH, AAVE and UNI were used to check the alignment.
- Existing archived quotes retain their actual intraday time. They are not relabeled as daily closes. A verified daily close can supersede an intraday capture, with an audit record.
- Historical quote FDV requires the exact token, value and measurement time in its hash-verified original provider response. Four older publications without pinned original market responses, mismatched quote timestamps and proven provider-record contradictions are held out. A finite `max_supply` check can reject an impossible reported FDV; it never supplies a replacement value. Missing `max_supply` alone does not invalidate an otherwise verified provider quote.
- Snowbank's CoinGecko captured FDV has a separate explicit supply-basis quality hold. Nine pinned originals show a one-billion-fold supply-scale anomaly; that identity/provider's FDV stays null/conflict pending review. The original quotes remain auditable. This hold neither invents a maximum supply nor changes independent price, market cap, financial flows or verified dated-supply FDV.
- Coin Metrics supplies a limited verified dated-supply FDV subset. Its issued-supply capitalization is never imported as circulating market cap. Identity, daily supply convention, excluded tokens and source attribution are documented in [the source verification](./DAILY_RAW_FDV_SOURCES_2026-10-19.md).
- Exact parent summaries can extend financial history. An incomplete child sum cannot become a complete parent total. Conflicting source scopes stay unavailable.

## Additive database layout

```text
daily_raw_assets      exact protocol slug + token identity
daily_raw_receipts    deduplicated original URL/hash/observation/archive
daily_raw_sources     metric + scope + definition + measurement basis
daily_raw_days        six independent cells per asset/date
daily_raw_revisions   changed or conflicting observations
daily_raw_runs        immutable per-run write allowance and usage
daily_raw_checkpoints committed stage/import cursors
history_budget        shared monthly guard, also used by legacy history
```

Asset identities, receipts and source keys are immutable. Later observations of the same provider, URL, scope, definition and basis can revise a value while retaining prior evidence. Older receipts cannot replace a newer value. Unresolved meaning changes remain conflicts. Local staging merges inputs before remote import so a date is written once during the initial import.

The existing `history_*` tables are preserved for historical audits and compatibility. They do not automatically read the raw tables. The legacy five-window history writer is paused; it must not run alongside a replacement writer without sharing the budget and concurrency guard.

## Free-limit protection and evidence

The conservative limits remain 8 million estimated monthly writes and 4 GB database size. New raw runs use `raw-table-weights-v1`: day/checkpoint writes count once; asset/receipt/source/audit writes count twice because those tables also maintain a unique index. Each mutating transaction adds four credits for its run/budget bookkeeping and safety margin. Existing `raw-double-v1` runs and legacy run estimates retain their original records. This follows [Turso's index and row accounting](https://turso.tech/pricing?frequency=monthly) while retaining a margin below the free quota.

A fixed October 2026 reconciliation can release 1,000,000 credits from the proven 4,362,244-credit legacy reservation, with eight credits charged for reconciliation bookkeeping. It first rechecks the eight original tables' exact `WITHOUT ROWID` schema, absence of secondary indexes and triggers, supported current-month raw runs, and the shared counter's unchanged legacy basis. The original single-row writer's double weighting proves a committed-write upper bound of 2,181,122; the partial release retains more than 1,181,122 credits of legacy buffer. The adjustment is stored once in immutable `history_budget_reconciliations`, including before/after counters and code, schema and private usage-proof hashes. It does not change run allowances or the 8M/4GB guards. Dry-run is read-only; same-evidence replay writes nothing. An uncertain write outcome requires read-only inspection. Account usage can lag and remains separate from these conservative reservations.

No-op replay does not consume a new data write. A read-only upper-bound preflight rejects a batch before mutations when the run, month or storage allowance is insufficient: [Turso also bills modifications in aborted transactions](https://docs.turso.tech/help/usage-and-billing). The no-audit import path registers required sources with the data page and commits completion with its final page. Each asset with revisions or explicit predecessor sources retains the full audit-copy path.

Local SQLite staging has a separate, explicit file-only unmetered mode. This does not lift any remote quota. A local run still has an immutable caller-supplied ceiling. Remote import requires an explicit bounded allowance and a sealed staging hash; changing that file while resuming is rejected.

Original provider responses stay outside the database and Git working tree. The archive publisher whitelists public keyless provider URLs, verifies body hashes, publishes content-addressed release assets without overwrite, and reads their hashes back before issuing a source manifest. Database import independently checks archived source receipts. Coin Metrics attribution and its CC BY-NC 4.0 terms accompany the archive.

Acquisition persists per-asset progress and provider cooldowns before parsing/importing. HTTP 401/403 pauses the provider for at least 24 hours; HTTP 429 honors Retry-After. Acquisition, parsing, archive verification and cloud import have separate reports. A downloaded file or local staging row is not reported as a completed remote database import.

## Entry points

```text
scripts/acquire-daily-csv.ts              resumable full-history CSV acquisition
scripts/acquire-daily-raw-coinmetrics.ts  verified dated supply acquisition
scripts/archive-daily-raw.ts              original archive preparation/publication/readback
scripts/sync-daily-raw.ts                 local staging and sealed remote import
scripts/continue-daily-raw.ts             fair acquisition, archive marking and committed progress
scripts/daily-raw-queue-state.ts          durable queue release publication/restoration
scripts/apply-daily-raw-fdv-holds.ts       proof-bound corrections; read-only unless --apply
scripts/reconcile-daily-raw-budget.ts     fixed audited reservation correction; read-only unless --apply
scripts/refresh-daily-financials.ts       recent verified financial patch, independent of CSV/MAX; --apply required
```

The replacement `daily-history.yml` runs at 04:30 UTC each day and supports a bounded manual run. It restores a verified `daily-raw-queue-*` release, reads the latest source publication and shared budget, acquires at most 200 CSVs, archives originals, stages selected raw dates and imports within an explicit run allowance. Initial market history uses MAX; established financial history patches 14 days, and market patches include missed gaps. Provider and per-asset cooldowns, pending originals and committed import progress survive runner cache eviction. Only actual sealed-copy checkpoints and exact CSV coverage can mark an initial series imported. A provider or database failure must still publish queue progress. If original archiving fails, the retry-only state retains holds and import progress while declaring the unarchived receipt requires refetching.

The default allowance is 200,000 estimated writes per run, with a 500,000-credit monthly maintenance reserve before new MAX imports. Reaching a provider, time or budget limit leaves resumable work; it never authorizes a paid upgrade. Activation requires a verified initial queue release and a real manual Actions run after the replacement workflow reaches `main`.

Financial MAX completion is independent of CSV completion and registry membership. A local full-financial stage records an explicit attestation only for unbounded, nonempty available financial history. The importer certifies it under `financial-max-copy-v1:<slug>:<identity>` only after the matching asset copy is complete and its sealed-stage hash agrees. A completed 14-day patch, a completed market CSV or an interrupted MAX import cannot establish financial MAX. Older imports without this proof conservatively stage MAX again; unchanged cells remain idempotent until a new complete copy records the proof.

Use `--cache` outside any Git repository. Load `.env.history.local` only for remote writes; `.env.history-reader.local` is sufficient for readback. Credentials never enter source archives, reports, client bundles or commits.

The snapshot and raw-history workflows refresh recent financial cells before preparing daily read models. The patch verifies the pinned snapshot and source archive, uses exact verified investment-token identities and the existing metric/scope parser, and bounds completed dates to the most recent three days. Existing equal observations retain their original source references with zero writes. Actual revisions preserve audit evidence; absent Fees, missing observations, provider zeros, partial groups and conflicts remain distinct. This does not attest financial MAX or advance CSV queue checkpoints. Both phases share one immutable 50,000-credit run. Current-data financial and read-model maintenance can consume the 500,000-credit reserve left by bulk backfill; the shared 8M/4GB and per-run ceilings remain enforced. Reports separate source availability, stored target-day coverage, processed work and pending work; pauses must not be reported as complete.

The manual-only `refresh-read-models.yml` workflow uses the existing hosted writer credentials to restore recent financial cells, complete-history reads and the current table catalog. It retains the shared history-preparation concurrency group, pinned financial/model reference, bounded execution times and failure reports. It does not collect provider data, modify publication selection or grant writer credentials to the browser/local reader.

Validation covers exact identity/source references, same-day storage, timestamp alignment, missing/zero/negative/partial/conflicting data, malformed-market isolation, source revisions, interrupted import/resume, immutable staging, idempotency and no-mutation quota rejection. Remote counts and account usage remain separate from local test evidence.
