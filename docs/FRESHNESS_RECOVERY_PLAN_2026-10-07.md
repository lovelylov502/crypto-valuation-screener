# Four daily collections and dated-source recovery

Status: approved for implementation after two Astra plan-review passes; the four final corrections are incorporated below. Implementation owner: GPT-6.1 Sol, reasoning xhigh. Independent implementation reviewer: GPT-6 Astra. This document records intended behavior, not completed deployment or operational acceptance.

## Evidence and scope

The current pipeline can reproduce an HTTP 200 response that lacks the latest completed UTC date, publish it with no collection errors, and settle the entire slot. Later automatic wakes then skip even after the provider publishes the missing date. An immutable replay proves the captured evidence, not its dated completeness. Earlier repairs also missed delayed triggers, retry eligibility and UTC transitions.

Baseline: commit `56a300bd0cf7f998d314f35fec2b90e24c5d8efb`. Read the canonical `docs/SESSION_HANDOFF_2026-10-07.md` and evidence in `C:\Users\TAE\Documents\Codex\2026-10-07\tovenit-incident-handoff`. Canonical owner documents remain untouched. Do not run the saved reproduction script as a supposedly read-only operation: it writes an evidence file.

Keep financial definitions, identity checks, source accounting, zero/missing/negative distinctions, full raw HTTP archives, replay, the serialized writer, last verified publication protection, browser preferences and production guards. Do not reuse old amounts as current observations. Do not introduce a new vendor, paid service, targeted snapshot patching or per-item collection jobs.

## 1. Fixed schedule and bounded stages

- Four regular slots: UTC 02:00, 08:00, 14:00, 20:00 (KST 11:00, 17:00, 23:00, 05:00). First accepted current publication has a 90-minute deadline measured from its original slot.
- Primary stage: slot through +2h, maximum three automatic attempts, existing minimum retry backoff retained. An attempt after +90m may recover service but cannot erase a missed deadline.
- Catch-up 1: +2h through +4h, maximum one automatic attempt. Catch-up 2: +4h through the next slot, maximum one automatic attempt. Run only for eligible unresolved freshness or transient acquisition work. No duplicate-stage retry after its allowance is consumed.
- Stage eligibility windows are half-open: primary `[slot,+2h)`, catch-up 1 `[+2h,+4h)`, catch-up 2 `[+4h,next slot)`. An eligible stage must claim its attempt before its window ends. An already claimed attempt may finish under its original lease and job deadline after that boundary; it retains its original stage identity. Persist a missed execution when eligible work receives no claim before window end. A later stage can recover data but cannot erase that miss.
- Maximum five automatic full captures per slot, twenty automatic captures per day. The separately bounded manual-repair allowance is additional and reported separately. This is a ceiling, not a quota: completed stages and no eligible pending work skip. Keep provider pacing, shared request deadlines and source-request deduplication. Measure requests, elapsed time, 429s and deferred scopes before activation. Preserve and expose the existing separate manual-repair budget; manual repairs cannot satisfy scheduled acceptance.
- Vercel gets separate daily primary and catch-up entries, with authenticated stage identity in each request/receipt. GitHub supplies fallback wakes. Every due time requires an actual configured wake. A stored `nextRetryAt` alone is insufficient.
- Immutable trigger data includes provider, schedule, original slot, stage, receipt/request ID and time. Keep workflow creation/start, capture `asOf` and finish time separately. Do not recompute original identity from job start.
- Stage-expired receipts remain expired and cannot claim the next stage or slot. Duplicates are idempotent. The writer lock and durable lease apply across stage and slot boundaries. Revalidate eligibility at claim/start, not just before tests/setup. Missing or malformed journal state fails closed.
- Native GitHub events whose intended occurrence cannot be established are wake/recovery evidence. They may perform eligible recovery but cannot impersonate a signed regular occurrence or add a qualifying regular-slot success. Preserve that distinction in reports and acceptance. An occurrence-unknown GitHub wake is explicitly classified as a recovery wake. It may claim only a currently eligible action selected from the authoritative journal, with that action's stage and budget recorded separately from trigger identity. It cannot relabel an expired known receipt, fabricate natural-slot credit, or consume a later-stage allowance for an earlier-stage action.

## 2. Dated freshness and persistent obligations

- Keep acquisition/transport health, dated freshness, integrity and economic approval separate. Economic approval does not gate acquisition or freshness accounting.
- Every capture fixes its target to the latest completed UTC date at its actual `asOf`. The 20:00 UTC slot crosses midnight during its second catch-up: introduce the new target while preserving older unresolved dates. Never relabel an earlier amount with the new target date.
- At claim time, compare the latest accepted capture's target date with the target date at the current time. A newer target creates date-rollover acquisition eligibility for an unused catch-up stage even when the previous capture had no pending items. Do not infer that the new day is absent at the provider until acquisition; expose an unassessed current target meanwhile. The stage remains bounded to its existing allowance.
- Compute freshness from the same normalized daily maps used for period totals. For groups, a complete day requires all exact components under the same identity and definition. Find the latest date in the common complete set, not the maximum or minimum of component latest dates.
- Represent target date, nullable latest complete date, exact missing dates (compact ranges permitted), component coverage, scope/definition identity and provenance. Avoid an unbounded per-component 730-day JSON expansion; respect API payload limits.
- Distinguish complete target, missing expected recent date, insufficient older history, unknown/no dated history, explicitly unsupported/not applicable and identity/definition/value conflict. An observed immediately preceding day supports expected daily reporting; no history alone does not. Old 365-day holes do not justify recurring supplemental jobs.
- Persist obligations by metric + canonical scope/component identity + definition fingerprint + missing UTC date. Retain original first-missing time, last check, attempt/stage links and disposition across slots. Carry metadata/provenance, never old financial values.
- Expected recent missing dates are eligible for the bounded catch-ups for 24 hours after first observation. After 24 hours mark them overdue/attention-required and stop supplemental attempts solely for that obligation; regular captures continue checking and can resolve it from current evidence. This is an operational retry policy, not a provider SLA or a claim of permanent absence. A new slot does not reset age. Identity changes preserve an explicit unresolved/superseded diagnostic trail; they do not count as resolution.
- Budget exhaustion means unresolved with exhausted allowance. Missing source data never becomes complete through timeout, loss of membership, manual action or retry exhaustion. Archive transitions so neither later success nor journal compaction erases deadline misses or unresolved history.

## 3. Public behavior and independent verdicts

- Valid current rows may publish while affected fields remain unavailable. Required/global identity, source-integrity or financial failures retain the prior verified publication.
- Show collection time, target UTC date, latest complete observed date, missing-date reason and next eligible check where known. Do not claim unknown provider generation time. Whole-snapshot counts survive search, filtering and pagination. Preserve settings and favorites.
- Status/API/UI reevaluate the public target when UTC changes even if the publication ID stays the same; immutable archived data remains unchanged. Do not present the old target's complete state as current freshness.
- Separate audit verdicts: `integrityPassed`, `collectionDeadlinePassed`, `freshnessAccountingPassed`, `allApplicableDataCurrent`, `catchupExecutionPassed`. Explicit unknown coverage must not manufacture an all-current result. A partial publication can pass integrity and accurate accounting while failing source currency. A successful replay never supplies the other verdicts.
- Deadline evaluation uses durable original occurrence/attempt evidence and explicit deadlines. Later recovery does not rewrite a failed deadline. Due supplemental work that did not run, exhausted work and unresolved provider data remain visible under their respective verdicts.
- `catchupExecutionPassed` evaluates whether required stage attempts were claimed and completed under these bounds. The 24-hour attention threshold separately evaluates unresolved source-date age. Provider absence after a valid check is not a scheduler execution failure, while a missing or interrupted required check cannot pass because the provider outcome is unknown.

## 4. Compatibility and rollout

- Version changed pipeline semantics as schema 2; journal/trigger/source-bundle schema changes are independent. Accept only supported, validated versions. Preserve real schema-1 reading and replay semantics, including original hashes. Do not mutate archived artifacts or simply accept a new enum while recomputing old output with new normalization.
- Prepare two reviewable release phases. Phase A deploys compatible readers, legacy replay and inactive new writer capability while existing schema-1 production remains readable. Phase B activates schema-2 collection and the four-slot schedule only after the canonical Phase A deployment is verified. Test this ordering and fail closed on premature activation.
- Rollback preserves readers for already-published schema 2 and can disable the new scheduling/writer path safely. Reverting to an incompatible old binary is prohibited. Document how the last verified snapshot and pending evidence remain accessible.
- Implementation and review happen in the existing isolated worktree. Do not push, collect, or deploy from an implementation/review agent. Production integration must preserve unrelated canonical owner work and satisfy clean synchronized `main`; resolve that boundary before deployment without weakening preflight. Production only via `npm run deploy:production` from the canonical root.

## 5. Evidence gates and review loop

Sol implements this contract, supplies targeted regressions and verifies the smallest relevant checks, then the full required gates. Astra reviews the diff and adversarial evidence independently. Every substantive finding goes back to Sol; Astra reviews corrections until no unresolved material findings remain. Do not change acceptance criteria to make tests pass. Root coordinates and may update this plan; application implementation remains with Sol.

Required adversarial cases:

1. HTTP 200 missing latest day -> accepted partial publication -> late source arrival -> automatically eligible catch-up -> complete history and restored multiple.
2. UTC rollover inside the 20:00 slot; old obligations survive while a new target appears, including status rollover without a new snapshot. Include a fully complete primary with zero pending items whose midnight catch-up still executes because the target advanced.
3. A GitHub wake delayed 5-7 hours, expired primary/catch-up receipts, setup delay after eligibility, duplicate dispatch and ambiguous receipts; none steal future-stage budgets or regular acceptance.
4. Active lease spanning stage/slot, crash before finish, expired lease recovery, malformed/missing journal and explicit manual accounting.
5. Nonintersecting parent dates; changed component sets/definitions; conflicting values; exact missing date explains 29/30.
6. Explicit zero, negative, unfinished current day, insufficient historical coverage, unsupported and unknown history; economic approval remains separate.
7. 429/deadline deferral, primary budget exhaustion, independent catch-up allowance, overdue obligation retention and original deadline preservation.
8. Actual archived schema-1 replay/read with original hashes and schema-2 capture/replay/read; supported rollback after v2 publication and premature activation rejection.
9. API/UI/status/audit agreement and global counters under filtering; unchanged preferences; bounded payload and request volume.

Local acceptance requires regression tests, full suite, typecheck, production build, deployment-contract tests, diff checks, review closure and archived-source replay. Use preserved evidence outside Git. Do not collect current public sources just to turn a local test green.

Operational acceptance is separate: after authorized canonical deployment, observe at least 72 hours, twelve distinct proven natural regular slots and two UTC transitions. Each qualifying regular slot needs accepted current publication by its original deadline. Manual runs, skipped green jobs, catch-ups and late recovery do not add successes. Report missed deadlines and provider freshness independently, preserve failures, and extend a new observation window after a correction; do not declare total recovery merely because retries ended. Retain canonical API/archive hashes, relevant source dates, browser checks and scheduler receipts. Do not claim future observation has already passed.
