# Verified data publication

## Four-slot release contract

The checked-in configuration is active Phase B, following verified Phase-A readers and the explicit preparation and canonical deployment in [DEPLOYMENT.md](./DEPLOYMENT.md). The older two-slot behavior documented below is retained for legacy schema-1 interpretation; the four-slot contract in this section governs new collection.

Phase B regular UTC slots are 02/08/14/20 (KST 11/17/23/05). Primary `[slot,+2h)` allows three automatic captures; catch-up 1 `[+2h,+4h)` and catch-up 2 `[+4h,next slot)` allow one each. Five automatic full captures per slot, twenty per UTC day is the ceiling. Two manual repairs per slot have a separate reported allowance. Actual Vercel daily entries exist for every stage, and GitHub has primary/+30/+60/catch-up fallback wakes. `queue: max` retains pending writer jobs while cancellation stays disabled.

Signed schema-2 Vercel receipts fix original slot/stage, schedule, receipt ID and request time. Authenticated native GitHub events whose intended occurrence cannot be proven are recovery wakes; the journal independently selects a currently eligible action. An unanchored unknown first primary claim defers until +60m. A signed automatic primary claim durably anchors its cycle; an on-time automatic retry can inherit that anchor while retaining its unknown trigger identity. An unknown-origin success followed by a signed skip gains no retrospective proof. Workflow creation/start, claim, capture asOf, validation completion and public availability are distinct records. Unknown/malformed journal state fails closed. Expired known receipts cannot steal later allowances. Skipped/expired/duplicate decisions retain immutable evidence.

The writer rechecks eligibility after setup/tests at claim time and retains the original stage through its lease. An active 15-minute lease spans stage/slot boundaries. A claim must precede its window end; completion may cross that boundary within its original lease. Missed required claims and incomplete/interrupted checks persist independently of source-date absence. A target advancing at UTC midnight makes an unused catch-up eligible even when the prior capture had zero pending obligations. Ordinary retries preserve the five-minute backoff and provider pacing.

Actual availability deadlines and cycle provenance are separate. Confirmed on-time availability can pass the deadline even with an unknown origin; it receives no unanchored cycle credit. Validation completion is insufficient: after Release promotion/readback, a separate confirmed journal event records availability. Later catch-ups preserve the earliest first-publication time and cannot erase a miss. A confirmation failure leaves availability unproven. Manual repairs and catch-ups cannot supply scheduled regular-slot successes.

Every writer generation and every promotion checks the current canonical live writer fence. Phase-A jobs accept recognized legacy or compatible Phase-A readers, and reject a canonical paused/newer writer mode. Phase-B jobs also verify the exact pinned Phase-A deployment and current canonical compatible active Phase-B capabilities. Queued older code cannot bypass a compatible pause. Last verified data and pending evidence remain readable after pause.

Operational acceptance is a recorded fixed interval of at least 72 hours, including every expected slot, twelve proven automatic regular cycles and two UTC transitions. The manifest records its future full-slot start and exact Phase-B revision before observation; check uses current plus linked immutable retired ledgers and reconciles due work at check time. A skipped green run, manual repair, unanchored unknown success or late recovery does not count. Missing retired evidence is unverified. A correction may start a new linked manifest without deleting the previous window or resetting obligations. Provider currency, acquisition integrity, missed publication deadlines and catch-up execution receive separate verdicts. The evidence checklist is [FRESHNESS_IMPLEMENTATION_ACCEPTANCE_2026-10-08.md](./FRESHNESS_IMPLEMENTATION_ACCEPTANCE_2026-10-08.md).

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

New economic-policy captures bind the allowlisted algorithm, immutable review artifact and actual bounded provenance receipts. Each metric consumes its own coherent decision, including reviewed exclusions, pending execution review and unavailable provenance. A holder subset may exclude a reviewed-unavailable component; an unresolved required component holds the parent ratio. Recipient/funding temporal boundaries can permit a complete multiple while holding an incomparable growth signal. Independent source evidence defines eligibility; successful acquisition alone never supplies approval.

Economic v2 is a separate immutable artifact/evaluator; v1 captures retain their original pending decisions, logical fingerprints and replay hashes even after a type-only refinement is reviewed. V2 permits adapter-local erased-edge continuity only with the pinned importing code/toolchain projection and preserved shared fee runtime surface. Raw changed type targets and supplemental research remain explicit. New provenance must be captured in the actual attempt; later exact-commit content cannot be inserted into an older capture interval. Unavailable bounded evidence holds approvals. Policy migration retains stable component/metric review ages and raw dated obligations. Reader-first deployment remains separate from exact-policy writer activation. [R24/R25 implementation evidence](./R24_R25_IMPLEMENTATION_2026-10-08.md) records scope and external acceptance limits.

The economic ledger is an immutable hash-bound asset rather than release-body state. Accepted completion writes the changed asset before promotion and verifies its exact reference/summary on readback. Unchanged stages inherit its existing reference. Missing/corrupt assets cannot seed a new empty ledger. Absent entries retain first-known observations. Legacy schemas and acquisition revisions continue to replay their original registry/algorithms; conditional reinterpretations without new provenance receipts are explicitly separate from original replay.

Every new Release body is a versioned compact envelope for its own immutable `state.json`, binding exact tag/journal ID, fixed repository URL, SHA256 and byte count. Full wire state retains all current dated obligations and economic asset references; its separate 30 MB bound fails without truncation. Authenticated latest reads support old inline bodies and the new envelope, then perform ordinary journal validation and economic hydration. State assets are uploaded and digest-verified before promotion. Lost POST/PATCH responses compare the envelope and canonical full wire state separately, and reuse verified existing assets. Public readers continue to read `state.json` directly.

An interrupted archive can be preserved by the maintenance-only failed-observation workflow under the same `screener-publication` lock. It requires the exact current running start, original failed run attempt/commit/archive-step evidence, digest-verified artifact, immutable retained baseline and offline source replay. It permanently stores the seven original files plus a hash-bound manifest, preserves the public snapshot, imports only unresolved date observations with original minimum ages, and records the actual archive failure as blocked/interrupted. Existing resolved/superseded entries are retained. It imports no candidate resolutions, financial values, availability or cycle credit. A changed parent, completed stage or changed active deployment aborts the write. Later attempts retain the marker historically and use their own outcome/report.

Capture fixes `asOf`, preserves original responses, normalizes/calculates, then replays offline. Completion separately replays saved artifacts. Hashes bind original evidence, normalized rows and complete output.

`snapshotErrors` checks version/time, required census, all quote accounting, original Revenue visibility, scoped failures and row financial invariants. `assessPipelineCandidate` adds ordering, same-capture witness and replay/output integrity. Accounted current absence can remain unavailable; malformed evidence, unexplained omission, unknown failure scope and invented output still block publication.

Candidate acquisition readiness additionally rejects systemic market-provider loss using separate prior-dependency, current-request and essential-provider checks. The explicit 50% boundary, current field-specific fallback and legitimate-omission rules are defined in [MARKET_ACQUISITION_RECOVERY_2026-10-08.md](./MARKET_ACQUISITION_RECOVERY_2026-10-08.md). Historical archive readers remain independent of that promotion policy. A reviewed pointer correction runs under the same writer concurrency group, verifies the exact parent and active canonical revision, and retains the latest actual attempt and recovery ledger without earning availability or cycle credit.

Baseline changes remain diagnostic. Previous success is not a permanent completeness floor; dated exceptions do not authorize the new writer. Raw recovery cannot renew economic approval. Missing dates remain missing, explicit zero remains zero, and definition/identity/period guards still govern multiples.

Legacy assessment and post-collection review modules remain for historical diagnosis/tests only. Checksum-pinned first bootstrap cannot replace an existing journal and retains its original historical date. It is not fresh-data recovery.

## Reads and visible state

API reads verify compressed hash, date, financial/collection contracts and new normalized/output proof. An unreadable newer archive retains the old snapshot ID and values with an explicit storage error. Cold readers fail clearly when no archive can be verified; they never crawl sources.

Browser status polls every ten minutes while visible, reloads on publication-ID change and checks freshness every 30 seconds. Partial counts cover the whole snapshot; row details identify source/scope/reason. Global holds, stale slots, interrupted collection and browser errors remain distinct. Browser refresh cannot advance original data dates.

Collection has a ten-minute deadline inside a fifteen-minute job, with an always-run completion step. `comparisonCompleted=true` is mandatory. Hard termination may leave a running journal, whose expired lease permits a later attempt and exposes the interruption.

## Migration and acceptance

Reader and writer retain legacy snapshot compatibility during rollout. Every new capture requires the full pipeline proof; historical snapshots are never relabeled. Deploy only through [DEPLOYMENT.md](./DEPLOYMENT.md).

`verify:production` checks canonical UI/API, every row against the exact archive, financial/source accounting and complete offline raw-bundle replay for new releases. A later changing feed cannot redefine a recorded capture. Legacy releases retain their historical witness/live-source paths.

Blocked/running verification explicitly reports `protected-last-verified` and `captureReplayPassed=false`, proving containment only. Safe reader deployment uses the independent integrity gate; `currentRecoveryPassed` requires integrity, deadline, freshness accounting, source currency and catch-up execution. Manual shadow/publication proves its execution only. Phase-B scheduled acceptance follows the fixed-window contract above; historical incident notes do not override it.

An overdue running attempt is an operational execution failure (`attemptExecutionPassed=false`, `overdueStart=true`, explicit `operationalErrors`), while correctly retained archive/API/hash/replay integrity remains independently assessable. This permits reader-first storage repair without calling the interrupted capture successful. Storage-failure blocked records validate the dedicated immutable failed-evidence manifest and original successful candidate report rather than inventing report validation errors. Corrupt or missing retained/evidence assets still fail the safe-reader gate.
