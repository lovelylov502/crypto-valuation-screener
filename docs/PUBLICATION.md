# Verified data publication

[ARCHITECTURE.md](./ARCHITECTURE.md) defines the active evidence contract. The homepage/API read persisted data; `.github/workflows/daily-snapshot.yml` is the sole collector/publisher. Generated evidence stays outside Git commits.

## One writer and immutable artifacts

Schedules, signed Vercel dispatches and manual dispatches share one concurrency group with cancellation disabled. Only canonical main can write. Each attempt persists a start journal and then a completion, linked to the previous journal and exact snapshot. Mutation requires the expected parent and writer ownership.

Assets upload to a draft Release. Size and SHA-256 must match before public/latest promotion. Bounded retries resume the same owned draft and identical assets, including ambiguous final responses. Changed bytes, parent or ownership are rejected. This resumes uploads within an execution; a terminated process is recovered by a new capture after its lease expires.

Completion archives contain original `source-bundle.json.gz`, normalized `inputs.json.gz`, candidate `data.json.gz`, same-capture `witness.json.gz`, report, trigger evidence and a checksummed inventory. Failed captures preserve available original responses. Legacy releases remain readable under their historical validation.

Blocked completion retains the entire previous verified ID/hash/date/amounts. Passing partial completion publishes valid current data with explicit row/scope issues, without silently reusing prior amounts. There is no application archive deletion job; administrative deletion and storage outage remain possible.

## Slot, attempt and publication

Slots begin at 02:00/14:00 UTC (11:00/23:00 KST). GitHub primary and +30/+60-minute backup wakes plus two Vercel cron dispatches are best-effort triggers. The original deadline remains 90 minutes; retry never resets it.

Inside the writer lock:

1. An active attempt holds a 15-minute lease, including across slot boundaries.
2. A verified publication without retryable issues settles its slot and suppresses duplicate automatic collection. Nonretryable scope/schema holds stay visible without leaving the whole slot unsettled.
3. Transient failures may retry after five minutes, up to three automatic attempts per slot.
4. Partial publication advances valid data. Only retryable issues allow automatic retries; deterministic holds require review or the next slot.
5. Explicit manual repair has a separate allowance of two attempts per slot, including after a settled publication when a reviewed definition/schema fix needs recollection. It cannot bypass validation or an active lease.
6. A new slot receives a fresh budget. Invalid, unreadable or future journal evidence fails closed.

The five-minute delay is eligibility, not a timer: a later trigger must actually invoke the retry. Backup wakes can recover failed attempts. Skipped/manual runs never count toward naturally scheduled acceptance.

Regression checks serialize settled partial publications, preserve their warnings, reject settled transient failures, and allow exactly two explicit repairs after settlement while signed automatic duplicates remain suppressed. Manual repairs consume only their own budget and never become natural scheduled evidence.

Vercel `/api/cron/collect` verifies production context, secret, provider headers and the original slot window, then signs a dispatch to canonical main. It cannot collect/publish. Its dedicated repository-scoped credential grants Actions write. Signing material and signatures are never archived. Delayed external receipts cannot be relabeled as a new slot.

## Gate

Capture fixes `asOf`, preserves original responses, normalizes/calculates, then replays offline. Completion separately replays saved artifacts. Hashes bind original evidence, normalized rows and complete output.

`snapshotErrors` checks version/time, required census, all quote accounting, original Revenue visibility, scoped failures and row financial invariants. `assessPipelineCandidate` adds ordering, same-capture witness and replay/output integrity. Accounted current absence can remain unavailable; malformed evidence, unexplained omission, unknown failure scope and invented output still block publication.

Baseline changes remain diagnostic. Previous success is not a permanent completeness floor; dated exceptions do not authorize the new writer. Raw recovery cannot renew economic approval. Missing dates remain missing, explicit zero remains zero, and definition/identity/period guards still govern multiples.

Legacy assessment and post-collection review modules remain for historical diagnosis/tests only. Checksum-pinned first bootstrap cannot replace an existing journal and retains its original historical date. It is not fresh-data recovery.

## Reads and visible state

API reads verify compressed hash, date, financial/collection contracts and new normalized/output proof. An unreadable newer archive retains the old snapshot ID and values with an explicit storage error. Cold readers fail clearly when no archive can be verified; they never crawl sources.

Browser status polls every ten minutes while visible, reloads on publication-ID change and checks freshness every 30 seconds. Partial counts cover the whole snapshot; row details identify source/scope/reason. Global holds, stale slots, interrupted collection and browser errors remain distinct. Browser refresh cannot advance original data dates.

Collection has a ten-minute deadline inside a fifteen-minute job, with an always-run completion step. `comparisonCompleted=true` is mandatory. Hard termination may leave a running journal, whose expired lease permits a later attempt and exposes the interruption.

## Migration and acceptance

Reader and writer retain legacy snapshot compatibility during rollout. Every new capture requires the full pipeline proof; historical snapshots are never relabeled. Deploy only through [DEPLOYMENT.md](./DEPLOYMENT.md).

`verify:production` checks canonical UI/API, every row against the exact archive, financial/source accounting and complete offline raw-bundle replay for new releases. A later changing feed cannot redefine a recorded capture. Legacy releases retain their historical witness/live-source paths.

Blocked/running verification explicitly reports `protected-last-verified` and `currentCollectionPassed=false`, proving containment only. Manual shadow/publication proves its execution only. Scheduled acceptance requires 72 hours, six natural collection slots, two UTC transitions and no unresolved overdue slot; verify trigger receipt, run/code and provider origin. Historical incident notes do not override this current contract.
