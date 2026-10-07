# Four-daily freshness implementation evidence

Status: local implementation/review work; Phase A remains checked in and inactive for schema-2 writing. No push, production integration, live collection or deployment was performed by the implementation agent. Independent review is coordinated by the root agent. The approved contract is [FRESHNESS_RECOVERY_PLAN_2026-10-07.md](./FRESHNESS_RECOVERY_PLAN_2026-10-07.md).

## Reviewable phases

Phase A contains compatible pipeline/journal readers, unchanged actual schema-1 replay, inactive schema-2 capture capability, public freshness handling, stage/obligation contracts and executable preparation/paused rollback. `lib/pipeline-release.json` selects writer 1/legacy scheduling; existing two Vercel entries stay active. Phase B is a concrete generated diff in the release contract, Vercel stage entries and workflow fallback schedule. `prepare-freshness-release.mjs activate` requires exact current canonical and pinned Phase-A production/deployment proof before generating it. Production guards are unchanged.

## Offline evidence

Preserved originals are read-only under `C:\Users\TAE\Documents\Codex\2026-10-07\tovenit-incident-handoff`. Final QA output is outside Git under `C:\Users\TAE\Documents\Codex\2026-10-07\tovenit-four-daily-qa\sol-final`.

```powershell
npm run snapshot:replay -- C:/Users/TAE/Documents/Codex/2026-10-07/tovenit-incident-handoff/source-bundle.json.gz C:/Users/TAE/Documents/Codex/2026-10-07/tovenit-incident-handoff/data.json.gz
npx tsx scripts/verify-freshness-offline.ts C:/Users/TAE/Documents/Codex/2026-10-07/tovenit-incident-handoff/source-bundle.json.gz C:/Users/TAE/Documents/Codex/2026-10-07/tovenit-incident-handoff/data.json.gz C:/Users/TAE/Documents/Codex/2026-10-07/tovenit-four-daily-qa/sol-final/offline
```

Actual schema-1 replay: 7,211 rows, 1,371 receipts; raw SHA-256 `7a71646d5aa9ce5b3d5a187edde2b7e8d5df82a5c382110f44f8a28c7817910e`, normalized SHA-256 `dd92f0324792e06ac473c09a5cbd3095f894d9e709ab488cb022eec50afd10c3`, output SHA-256 `bbb6e24ef76b9553c51589b31a4cfde1fa0a55b72148e0d4024690300f3f65ee`; zero errors. No provider networking occurred.

The second command additionally interprets a copy of the original bytes under schema 2 and labels the result retrospective. It records full-page payload maxima, obligation metadata size, schema-2 hashes and global dated counts. It does not claim that a real schema-2 capture or scheduled recovery has occurred. The original bundle contains six HTTP 429 receipts even though later retries succeeded; a zero final source-failure count cannot erase those requests.

Final retrospective schema-2 replay has zero errors: 7,211 rows, 2,173 current / 33 pending / 306 insufficient / 38 unknown / 11,787 unsupported / 85 conflict metric scopes. The maximum actual 200-row page is 2,971,203 bytes, below 4.5 MB; the full saved derived snapshot is 53,157,505 bytes before compression and 4,088,271 compressed. Persistent obligation metadata is 25,502 bytes, a derived journal-size fixture is 31,358 bytes and its read-only status projection is 57,599 bytes. The status fixture is labeled retrospective; it is not production readback. Final normalized SHA-256 is `8902230a8bfdf58c50b61a76bc290042d07488ed513389e8bc7346e4550f2e8d`, output SHA-256 `a78663f9f09f931578a088f1776830c4876341c66703c518d0ea2c1d64c27d8d`.

## Regression gates

Fixtures cover HTTP 200 latest-day absence followed by an automatic eligible capture restoring 30/30 and a reviewed multiple; clean 20 UTC primary followed by midnight target acquisition; unchanged archived ID/hash with dynamic status; nonintersecting exact components; zero, negative and unfinished days; economic withholding independent of raw holder freshness; exact-parent raw provenance; stage expiry/setup delay/duplicates; delayed unknown GitHub recovery identity; leases/crash; primary/catch-up/manual allowance separation; persistent 24-hour age/definition trail; sticky missed stage and publication deadline; validation-before-deadline with late promotion; canonical/pinned reader proof; paused older writer fencing; overlapping provider-wide 429 cooldown/deferral; and bounded ledger archival.

Required local gates are `npm test`, `npm run typecheck`, `npm run build`, `npm run test:deploy-preflight`, `git diff --check` and the preserved-source replay. Independent review closure and browser/API readback remain separate evidence. No local result supplies 72 hours, twelve natural regular slots, two UTC transitions, provider arrival guarantees or production acceptance.

The offline configuration matrix passed the full 490-test/48-file suite, typecheck, production build and six deployment-contract tests in Phase B, compatible paused rollback and restored Phase A. `scripts/verify-freshness-release-matrix.mjs` uses clearly synthetic configuration proof only, performs no live activation/dispatch, restores all three config files byte-for-byte and records before/after hashes in `sol-final/release-matrix.json`. Historical schema-1 tests use explicit legacy fixtures; separate schema-2 tests exercise the new acquisition/scheduling contract. The subsequent protected-reader authentication delta has its own missing/revoked/redirect/host/identity regressions and final full-suite/build verification, recorded separately from the earlier matrix.

Final Phase-A gates on October 8 KST passed: 492 tests across 48 files, typecheck, production build, six deployment-contract tests and `git diff --check`. The final preserved-source replay also passed with the original hashes above; both original gzip files retain their initial SHA-256 values. Test/typecheck/build/deployment-contract output is saved as `sol-final/final-*.txt`. The final build is the inactive Phase-A configuration; no local server was started by the implementation agent.

Final Korean copy was compared against the intended facts, dates, scope, conditions and certainty using the taegyu-writing skill and its editing rules; titles, status labels, explanations and detail text were reread together. Browser rendering/function checks remain root-owned verification.

## Root-owned operational prerequisites and acceptance

On 2026-10-07 at 15:35:31 UTC, root securely provisioned the existing selected project automation-bypass value into repository secret `VERCEL_AUTOMATION_BYPASS_SECRET` using stdin. Root verified an authenticated header-only read of an existing protected immutable deployment returned HTTP 200. No new bypass secret or protection setting was created/changed, and no value was printed or saved in this repository/evidence. The implementation agent only added the secret reference and bounded header path. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the credential/proof boundary.

After authorized Phase-B deployment, root records a future full-slot start plus exact revision in a new acceptance manifest. Read-only checks include every expected slot in its fixed 72-hour interval and linked retired ledgers, reconcile due work at check time, and require twelve proven automatic cycles/two UTC transitions. Missing midnight checks or archival evidence fail/unverify acceptance. Old failures stay diagnostic when a new explicitly linked window begins after a correction; obligations are not reset. No manifest was started and no operational acceptance is claimed here.
