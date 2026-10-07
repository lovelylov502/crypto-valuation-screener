# Data engine architecture

## Reader-first dated freshness migration

The checked-in `lib/pipeline-release.json` selects Phase B (`writerSchema=2`, `schedule=four-daily`) after verified Phase-A deployment. Readers validate pipeline and journal schemas 1 and 2. A source bundle still has its independent schema 1; the optional `pipelineSchema=2` selects the new acquisition/normalization contract. An absent selector runs the original behavior, including historical retry receipt order, normalized shape and hashes. Real preserved schema-1 replay is required; accepting a version enum does not establish compatibility.

Schema-2 histories retain the exact common complete-date set used for their period totals as a 730-day hexadecimal bitmap (183 characters). Current target, latest complete date, recent exact missing dates, component coverage and source identity/definition/provenance are separate. Missing target plus a complete immediately preceding day establishes expected recent reporting. Older holes are insufficient history; missing dates never become zero. Exact-parent aggregate recovery is labeled explicitly and retains its authoritative parent URL and receipt time. Raw holder freshness includes all exact source components independently of economic eligibility; approved holder multiples still use the eligible subset.

`CoinDataQuality` remains collection-only. `freshness` is immutable capture-time evidence; `publicFreshness` reevaluates a new UTC target without changing the archive, proof hashes or published ID. Unknown coverage cannot manufacture an all-current verdict. Whole-snapshot freshness counts survive pagination and filters.

The journal carries only obligation identity/date/provenance/check metadata, never financial values. First-missing age survives slot/target changes. Supplemental eligibility ends at 24 hours with an overdue state; regular captures still examine unresolved dates. Definition/membership changes leave superseded diagnostics, not resolution. Sixteen recent slot ledgers and 128 recent receipt keys, plus the current owned attempt's slot/key when older, bound scheduler metadata. Older ledgers and resolved/superseded metadata move to immutable `recovery-history.json` assets with cumulative failure counts and an archive chain; pending/overdue obligations keep their original ages. Read-only `publicRecovery` reevaluates age and missed due checks without modifying the archived journal; its bounded projection retains total diagnostic counts. Paused scheduling introduces no new expected slots.

Schema-2 transport shares each provider's Retry-After across sibling requests and rechecks later overlapping 429 extensions. Other providers retain their independent pacing. New bundles record `acquisitionRevision=2`: transport timeouts start after cooldown, bounded by local/provider/shared deadlines, and budget deferrals stop that URL's retries. CMC discovery and quotes share a 180-second provider budget. Original 429 receipts remain counted even if later retries succeed. Bundles without this revision retain their original acquisition/normalization/replay behavior, including older schema-2 captures. [MARKET_ACQUISITION_RECOVERY_2026-10-08.md](./MARKET_ACQUISITION_RECOVERY_2026-10-08.md) defines candidate acquisition readiness and serialized append-only correction.

Independent audit fields are `integrityPassed`, `collectionDeadlinePassed`, `freshnessAccountingPassed`, `allApplicableDataCurrent` and `catchupExecutionPassed`. Replay establishes captured integrity; it does not prove dated currency, public availability or scheduler execution. Legacy v1 can pass its integrity gate while schema-2 freshness accounting is unavailable. This permits reader-first deployment without asserting that every upstream source is current.

`captureReplayPassed` describes collection-time/replay checks; the former ambiguous `currentCollectionPassed` field is removed. `safeReaderDeploymentPassed` is the integrity/deployment gate. `currentRecoveryPassed` requires all five independent verdicts. Current deadline health evaluates the latest due slot independently of natural-cycle provenance; historical failures remain archived diagnostics. The browser receives validated live `collectionRelease` on status and screener responses, so existing tabs follow activation/pause without a reload. At midnight, current-target counts become unassessed/unknown while the assessed snapshot date stays explicit.

This is the active data engine contract introduced on October 5, 2026. `pipeline.schema=1` versions evidence independently of `scoreVersion=research-v10-source-revenue-recovery`. [PUBLICATION.md](./PUBLICATION.md) owns scheduling/publication; [DEPLOYMENT.md](./DEPLOYMENT.md) owns production guards. Earlier version/incident documents are historical where they conflict with these contracts.

## Why the boundary changed

The previous writer required a separate explanation for every loss against its last successful snapshot. One WBTC history loss froze the entire universe, including updated Sat Rush revenue. Raw history acquisition depended on economic approval; archives labeled joined inputs as raw. Later source queries could observe a different universe. Failed starts also exhausted slots without retrying.

The new acceptance boundary is reproduction from captured current evidence plus financial, identity and completeness contracts. Baseline changes remain diagnostics; they are neither a source of current amounts nor an expanding exception list.

## Data flow

```text
Public HTTP sources
  -> sourceBundle: original response text, status, receipt times, hashes
  -> acquisition/history helpers: fixed UTC asOf, scoped bounded request plan
  -> serializable CoinInputs
  -> normalizeCoinInputs: pure identity, grouping, economic classification
  -> dataQuality: scope failures and conflicts to rows/metrics
  -> assembleScreener: financial calculations, contracts and coverage
  -> full offline replay; second replay in completion process
  -> immutable GitHub Release assets and atomic latest journal
  -> verified persisted API pagination -> browser table/status
```

The static homepage/API never collect upstream data. Browser preference keys, favorite IDs and existing valuation semantics remain intact.

## Original evidence and replay

`sourceBundle.ts` injects transport through an async-local session; it never patches global fetch. It captures response text before interpretation, including HTTP failures and sanitized transport failures. Only approved public hosts and GET requests are allowed. Request headers and credential-bearing query strings cannot enter an archive.

Fixed `asOf` determines completed UTC dates and history windows. Actual receipt times remain separately recorded. Successful repeated URLs reuse one response within a capture; failed retries retain separate receipts. Replay has no network fallback and rejects missing, altered or unused receipts. Failed capture drains in-flight requests before preservation.

`collectCoinInputs` produces a serializable intermediate, and `normalizeCoinInputs` performs its pure join/classification stage. Existing acquisition helpers still summarize history; the whole HTTP-to-history-to-output path is reproduced through archived transport. Replay is not a second independent implementation of financial formulas. Financial contracts and adversarial fixtures separately test shared-code errors.

The bundle embeds the previous published snapshot for identity and previously complete history-window selection, never current amounts. SHA-256 binds the exact compressed bundle, normalized rows and output. The universe witness derives from the same captured census, without a later source query. A separate process can reproduce the stored snapshot with provider networking disabled.

## Identity, histories and economic approval

Canonical IDs, component membership, methodology and overlapping values constrain recovery. Explicit zero is a reported value; absent dates are not zero. Conflicting duplicates or sources withhold affected calculations. Incomplete periods preserve actual observed-day counts and separate original provider aggregates.

Raw history collection is independent of economic approval. Unknown or changed definitions remain visible but cannot produce an approved P/R or P/HR. Existing restrictions for ambiguous identities, mixed denominators, stablecoin capital and incomplete periods remain mandatory.

Every eligible raw-history gap is considered each run, with bounded parallel workers and a shared nine-minute transport deadline. No fixed first-N or rotating quota can leave a stable worklist perpetually incomplete. The outer ten-minute collection deadline reserves time to save failed evidence and produce a diagnostic report. Aborted or failed requests remain explicit local failures; no historical amount is silently reused.

Incomplete CMC discovery cannot prove uniqueness for name/symbol matching. Canonical explicit IDs remain usable. Failed direct quotes cannot retain discarded current financial fields from that vendor. Other successfully captured provider values retain their provenance.

## Failure boundaries

| Evidence | Result |
| --- | --- |
| Valid current row and approved complete metric | Publish values and eligible calculations |
| Precisely accounted token summary/quote failure | Publish unaffected current data; annotate affected scope |
| History conflict or changed source scope | Preserve evidence and withhold affected derived amounts |
| Supplementary request budget exhausted | Disclose withheld coverage and continue other rows |
| Optional CMC discovery failure | Disclose discovery coverage; retain other current sources |
| Required census/schema failure or unknown failure scope | Block complete candidate |
| Missing quote-ID accounting or invalid financial contract | Block complete candidate |
| Source, replay or output hash mismatch | Block complete candidate |

Local classification requires exact endpoint and row/component or quote-ID accounting. Unrecognized errors cannot be waived. Whole-snapshot quality counts survive pagination. Global, stale, browser and storage errors retain display priority over partial coverage.

## Responsibilities

| Modules | Responsibility |
| --- | --- |
| `sourceBundle` | Original evidence and offline transport |
| `sources`, history sources, `overviewRecovery` | Acquisition, identity, histories and normalization |
| `dataQuality` | Scope accounting and calculation holds |
| `screener`, valuation modules, `fundamentalContract` | Financial computation and invariants |
| `dataPipeline`, `pipelineIntegrity` | Replay and candidate evidence proof |
| `publication`, `scheduledCollection` | Journal transitions and bounded attempts |
| `scripts/github-journal` | Resumable immutable upload and atomic publication |
| `snapshotArchive`, persisted reader | Verified archive/cache reads |
| `collectionHealth`, status/detail UI | Global/partial user-visible state |

Old `assessCandidate` and dated review helpers support legacy fixtures and historical evidence. The active writer uses `assessPipelineCandidate`, without post-assembly source re-query or dated loss waivers.

## Verification and limits

```powershell
$env:SCREENER_SHADOW_DIR='C:\outside-repository\shadow'
npm run snapshot:shadow
npm run snapshot:replay -- C:\outside-repository\shadow\source-bundle.json.gz C:\outside-repository\shadow\data.json.gz
```

Shadow collection has no publication side effect. Replay verifies a candidate in a separate process. Production audit compares every API row with its stored archive and reproduces the original bundle. Evidence consistency cannot prove that a provider's own economic assertions are true.

Manual recovery proves only that execution. Phase-B reliability acceptance requires a recorded fixed window of at least 72 hours, every expected slot, twelve proven automatic regular cycles and two UTC transitions. Missing archival evidence is unverified; a new explicitly linked window can follow a correction while all older failures and obligations remain. Source currency is evaluated separately. GitHub/Vercel availability and administrative retention remain external dependencies.

Replay must run the publisher commit recorded in the journal when normalization changes. Any incompatible evidence or output change requires a new pipeline schema and an explicit reader/migration path; a new implementation cannot silently reinterpret older archives. Financial rule changes separately version scoreVersion. Hash canonicalization uses ordinal text order, independent of host locale.
