# Market acquisition containment and restoration

## Observed failure

Automatic retry `37685154763` published an integrity-valid but degraded schema-2 capture after CoinMarketCap acquisition returned no usable quotes. Its first CMC 429 at 20:51:51 UTC preceded DefiLlama's first 429; CMC was acquired concurrently with the other providers. The default 60-second CMC cooldown consumed the old ten-second request timeouts before transport. This was not exhaustion of the nine-minute shared capture deadline. The original bundle contains six CMC and three DefiLlama 429 responses, including the original failures even when later requests succeeded.

The prior natural primary `37680001753` captured at `2026-10-07T20:11:00.227Z` and confirmed availability at `20:16:03.764Z`. The retry captured at `20:51:50.777Z`; all 2,192 CMC asset requests failed. Both original archives remain valid under their captured contracts. Replay alone did not establish acquisition readiness.

## New candidate boundary

New schema-2 source bundles record `acquisitionRevision=2`. Request transport timeouts begin after the shared host cooldown and remain capped by the provider and shared deadlines. CMC discovery and quote batches share a 180-second budget, at most three actual HTTP attempts per URL and two concurrent quote batches. A budget deferral ends that URL's retry loop. History requests use the same versioned timeout behavior. An absent acquisition revision preserves the exact original acquisition, normalization and replay behavior, including the already-published retry; unknown revisions fail closed. Compatible paused readers retain both replay paths.

`marketAcquisitionReadiness` is a candidate promotion gate, separate from historical archive integrity. It reports exact denominators, numerators and scope:

- For each provider and market field, at least 50% acquisition-caused loss of distinct comparable prior provider-backed asset IDs blocks promotion. Unrelated new assets cannot dilute this denominator.
- A separate ratio evaluates distinct current requested IDs with actual failed, deferred, malformed or mismatched acquisition, or a usable received field. At least 50% uncovered field loss also blocks, including when the prior snapshot is already degraded or absent.
- A provider with at least 50% failed/unusable distinct acquisitions requires verified fresh independent fallback for every affected required field. Zero usable essential-provider evidence also blocks. These guards prevent one successful quote from concealing a system-wide outage even when fallback makes each individual field-loss ratio smaller than half.

The 50% boundary is an explicit engineering majority rule. Local failures below that boundary remain scoped unavailable fields. Explicit successful omissions and `not_returned` do not count as transport failures. A reliable prior successful quote defines its finite provider-selected required fields, preserving legitimate omitted FDV; unknown/degraded prior evidence uses market cap, price and FDV conservatively. A partially malformed current quote requires fallback for its defective fields. Fallback is field-specific and current; finite zero is available. Duplicate projects sharing an asset ID do not increase its weight.

An exact previously verified CMC identity may retain ID, slug and symbol during a current CMC transport failure, with the previous proof date and source group recorded. Fresh provider identity conflicts reject continuity. This retains identity metadata only; current market amounts remain unavailable or come from verified fresh fallback. Transport-caused identity loss is not automatically reviewed as a legitimate remap.

The audit reports `acquisitionReadinessPassed` and the readiness counts independently. A historical degraded capture remains readable and can pass `safeReaderDeploymentPassed`; it cannot pass `currentRecoveryPassed` through acquisition integrity alone. This allows the reader repair to deploy before containment.

## Append-only correction

Only the reviewed maintenance dispatch may commit a correction. It runs in the collector's existing `screener-publication` concurrency group, consumes no collection allowance and makes no source requests. A local preparation creates a review-only plan without promoting it:

```powershell
npx tsx scripts/correct-publication.ts prepare <exact-latest-parent-id> <verified-primary-confirmed-journal-id> <new-local-plan-path>
```

Root executes the approved GitHub `workflow_dispatch` with `publication_correction_parent` and `publication_correction_target` after deploying the reviewed revision. The command rejects local commit execution, a running parent, changed parent/publication, a healthy replacement, missing original proof or a changed canonical active revision. It verifies the canonical revision both before preparation and immediately before promotion. Immutable bad and target snapshots are hash-checked and replayed; the target must exactly match the bad capture's original baseline and pass acquisition readiness against its own baseline.

A completed blocked wrapper may still reference the bad publication. Its original immutable published journal must prove that exact bad reference. The correction preserves the latest actual attempt, recovery ledger, tracking boundary, pending ages, signed anchor and first-publication evidence unchanged. The original bad attempt remains `published` in its immutable history. A new journal and `correction.json` restore the exact prior verified publication reference with its original dates and values, record the from/to references and readiness diagnosis, and expose the correction time and original bad journal in status. No `finishRecoveryJournal` or availability confirmation is called; the correction earns no scheduled cycle credit.

The latest-pointer check alone is not an atomic lock. The maintenance command must run under the shared GitHub writer concurrency group. Root temporarily disabled the old collector workflow at `2026-10-07T21:52Z` while this repair was reviewed. Re-enabling it after reviewed canonical deployment and checking for old runs is an explicit root-owned operational obligation. Root then performs the serialized correction and records a linked new future 72-hour acceptance window, retaining the failed window and all original evidence.

## Offline evidence

Original files remain unchanged outside Git under `C:\Users\TAE\Documents\Codex\2026-10-07\tovenit-four-daily-qa`:

| Capture | Rows / HTTP receipts | Original raw bundle SHA-256 |
| --- | --- | --- |
| Retry `37685154763` | 7,238 / 1,442 | `adfddc72ec8ead98f8add255d7b52e4262aa8974a6e249c926a10e520b7e73f9` |
| Primary `37680001753` | 7,236 / 1,356 | `5c8db52c949fe8a22841d5ee7d0470ec38f8870aab77c10ac04df7240c4f19ed` |

Final local evidence is in `sol-final/r19-final-20261007T220307Z` beneath that QA root. Offline reproduction checks both original hashes and outputs, bad-as-baseline/bootstrap guards, and a clearly labeled synthetic one-success quote copied from the original good capture. The bad capture rejects with 2,192/2,192 CMC acquisition failures and 1,040 uncovered required asset dependencies; the synthetic one-success case still rejects with 2,191/2,192 failures and 1,039 uncovered dependencies. That synthetic case is a regression, not later acquisition evidence. The original bad archive audit has no integrity errors while acquisition readiness fails. The correction plan retains the exact attempt, tracking and recovery objects; the observed recovery ledger is 12,396 bytes. A synthetic completed blocked wrapper also retains those objects and proves its original bad reference.

The full suite passed 542 tests in 54 files; six deployment-contract tests, typecheck, production build and diff check passed. The preserved original schema-1 replay passed with 7,211 rows, 1,371 receipts and exact original hashes. Tests and build establish local readiness only; restoration, new captures and 72-hour acceptance require root's separately recorded live evidence.
