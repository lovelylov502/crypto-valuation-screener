# Prepared file reads and free-quota containment

Effective 2026-10-24. The hosted Turso database is preserved, but `connectHistory()` is disabled by the checked-in delivery policy. No browser/API path, regular preparation job, or daily history job needs hosted SQL. Do not remove this guard or upgrade billing to recover a failed read.

## Production flow

1. The existing validated collection journal remains authoritative for upstream observations and economic definitions. Regular starts are 11:00 and 23:00 KST. Conditional recovery remains bounded to two and four hours after those starts. Historical six-hour receipts and ledgers remain readable; inactive slots after the transition create no new obligations.
2. Only a newly published collection starts preparation. Concurrent snapshot, daily-history and manual preparation share `screener-read-model-writer`. An identical publication/input version exits before downloading or processing the history database.
3. Restore the hash-verified local SQLite archive. Capture actual current price, market cap and FDV, and patch recent daily financial observations from the same pinned original sources. The ordinary financial patch covers three days. The initial recovery used fourteen days to cover the previous outage. Missing values, held FDV, exact token identities and scope checks retain their existing rules. Market capture fills empty cells only and retains each provider's original quote date.
4. Build the table catalog/detail shards, both map capital bases and all six comparison periods, comparison summaries, and full compact history shards locally. This uses the existing calculation functions, without hosted database requests.
5. Seal a local SQLite backup and publish an immutable `screener-read-*` release. Verify every uploaded asset digest before making the release public. These releases always use `--latest=false`; GitHub Latest continues to belong to the collection journal.
6. Atomically update the small `read-model-index/current.json` branch pointer using the previous file SHA. Never overwrite another writer's pointer. The pointer includes the immutable manifest URL and SHA-256; the manifest binds every asset to the same publication.
7. Server readers verify asset hashes, share concurrent loads, cache immutable files, and check the pointer every ten minutes. Filtering and paging use the prepared catalog/map. Details fetch only the relevant shard, with the existing browser compact-history cache. Missing artifacts never trigger raw SQL. A warm instance retains its last verified complete version; a cold instance also has a pinned verified fallback in `lib/read-artifact-source.json`.

The 13:30 KST history job restores the same local archive, imports a bounded source batch, publishes the updated archive/read files, and only then acknowledges queue progress. Original source archives and the existing remote database are retained. Acquisition and failed preparation do not mark uncommitted history as complete.

## Operations

- Manual, idempotent recovery: run the **Refresh verified publication reads** workflow. Reports state `remoteDatabase: { reads: 0, writes: 0 }` because these jobs only open file clients; those numbers are not inferred from returned SQL rows.
- A failed builder stops before pointer promotion. Inspect `*report.json`; fix the input or code, then resume. Do not turn on a raw-history fallback.
- The default is twelve hours while the account has exhausted its current allowance. Six hours needs a new reviewed policy change and verified usage headroom; no automatic paid upgrade or automatic quota reset is configured.
- For an offline bootstrap, `restore-local-history.ts` copies explicitly named sealed staging files into a separate local database and records source hashes. Replay the reviewed FDV holds/recovery manifests and the already-imported durable queue receipts before publishing. `restore-queue-history.ts` never fetches new provider data.
- `publish-read-artifacts.ts --cache <outside-Git> --database <verified-local.sqlite>` builds locally. Add `--publish` only after verification. Production application deployment still uses the canonical root and `npm run deploy:production`.
- The backup contains public source observations, lineage, and local processing checkpoints. Credentials, browser profiles and unrelated user files are never included.

## Remaining acceptance boundary

Unit/integration checks and manual workflow execution do not establish future natural scheduler reliability. The next scheduled cycles must still be observed. The original missing historical FDV and provider gaps remain missing; this migration does not estimate past supply or fill absent periods with current values.
