# Production deployment safety

## Metric-specific economic reader and writer

The current economic decision rollout uses `metric-economic-decisions-v2` readers in a compatible paused deployment first. Readers retain schema 1/2, acquisition revisions 1/2/3 and the immutable economic-v1 artifact/evaluator, including the frozen b519 definition registry. The b519 and economic-v1 writers cannot authorize the new reader-release identity; the new writer requires its exact v2 algorithm/artifact/hash in the local contract, current selection, pinned paused selection and both supported-policy lists. Historical Phase-A identity remains historical proof; it does not authorize the new economic writer.

Economic v2 proves adapter-local continuity under reviewed import erasure, exact relevant compiler/loader configuration and resolved runtime package integrities, plus the known shared fee runtime surface. It neither attests the provider's deployed code nor proves complete repository-framework equivalence. Changed fixed context content is hash-bound to the captured tree and bounded to four extra reads, 1 MB per file and 2 MB in aggregate. Raw type-target changes remain visible; unknown runtime changes, execution hooks or unproved configuration hold approvals. Acquisition revision 3 serializes CMC requests with at least six seconds between actual starts under the unchanged 180-second provider and nine-minute capture limits. Natural capture is still needed to verify behavior against external rate limits. See [R24/R25 implementation evidence](./R24_R25_IMPLEMENTATION_2026-10-08.md).

After the canonical paused deployment and its immutable protected URL agree on exact production commit, deployment ID, reader contract and economic artifact hash, prepare activation:

```powershell
node scripts/prepare-economic-release.mjs activate <verified-paused-economic-reader-commit>
```

This writes only the explicit release configuration. Review, commit and deploy through the canonical wrapper. Every new writer verifies its executing commit against the current canonical deployment and verifies the active algorithm/artifact plus both immutable reader proofs before claim and promotion. An older queued revision cannot promote after the canonical revision changes. The existing protected-URL automation bypass applies only to the validated pinned hosts.

For a compatible economic pause, run `node scripts/prepare-economic-release.mjs pause`, review/commit, and deploy through the same wrapper. It clears the activation reference while Git preserves the old proof. Reactivation requires a newly verified canonical paused deployment; the previous active proof cannot authorize it. Retained cron invocations return paused results. Never restore an incompatible schema-only reader or weaken the exact revision fence.

Accepted captures store the full economic review ledger in an immutable `economic-review.json` release asset. Wire journals contain its exact URL, byte count, SHA256, state hash and bounded public summary. Writers hydrate and validate the asset before using its baseline; missing or changed evidence fails closed. Public GitHub asset redirects carry no credential. Start/wake/blocked/confirmed journals preserve unchanged asset references. The complete ledger is never embedded in GitHub Release body or paginated API output.

## Reader-first activation and compatible pause

The initial rollout starts with Phase A: pipeline/journal 1/2 readers, writer 1, legacy two-slot schedules. Integrate and deploy that reviewed reader release through the canonical production procedure below. Verify `/api/status` advertises exact reader contracts `[1,2]`, production environment, deployment ID/unique URL and the expected Phase-A code commit. Verify real legacy snapshot reading and preserved source replay. A legacy freshness-accounting verdict remains unavailable; this does not invalidate a safe reader deployment. The freshness rollout completed this ordering; retain its pinned Phase-A proof during subsequent fixes. The current economic rollout uses the separate paused-reader contract above.

Only after that deployment is verified, prepare Phase B in the canonical checkout:

```powershell
node scripts/prepare-freshness-release.mjs activate <verified-phase-a-commit>
```

The preparation tool verifies the current canonical status and matching immutable Phase-A deployment identity, then writes the explicit schema-2 release contract, twelve Vercel stage entries and GitHub fallback wakes. It neither deploys nor collects. Review and commit this concrete second-phase diff, push through the approved integration boundary, then run `npm run deploy:production` from clean synchronized canonical main. Writer 2 fails closed until the current canonical alias also advertises the matching active writer fence. Each claim/collection and immediate pre-promotion check verifies the live fence; both old Phase-A jobs and queued Phase-B jobs honor a later pause.

The project's immutable deployment URLs are protected. Keep deployment protection enabled. Preparation needs the existing selected automation-bypass value in local `VERCEL_AUTOMATION_BYPASS_SECRET`; the same existing value must be provisioned securely to the matching GitHub repository secret before Phase B. Vercel exposes it to deployed functions as a system environment variable. Only the exact validated pinned project URL receives the `x-vercel-protection-bypass` header. Canonical requests receive no credential; all reader requests reject redirects. Missing/revoked credentials or mismatched identity fail closed. Do not put the value in arguments, URLs, config/proof JSON, logs or artifacts. [Official automation-bypass documentation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

Rollback after schema-2 publication must keep compatible readers. Prepare a pause using:

```powershell
node scripts/prepare-freshness-release.mjs pause
```

This preserves writer/schema-2 capability and reader compatibility, changes the release mode to paused, removes checked-in Vercel/GitHub schedules, and leaves immutable data, metadata obligations and history archives accessible. Review/commit/deploy the compatible pause through `npm run deploy:production`. Current canonical pause capabilities revoke queued/running older writers before promotion. Never revert to a reader that cannot understand the published pipeline/journal versions.

Vercel Instant Rollback does not update active cron configuration; failed cron invocations are not automatically retried. A paused compatible route therefore returns an explicit collection-paused result for retained old/new cron paths, and the live fence blocks queued old collectors. Removing crons is effective through the normal guarded deployment, not an assumed side effect of Instant Rollback. See [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs) and [GitHub writer queue semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

After verified Phase-B deployment, record the observation window outside Git before a future full UTC slot:

```powershell
npx tsx scripts/audit-scheduled-acceptance.ts start <future-UTC-slot> <phase-b-commit> C:/outside-repository/window.json
npx tsx scripts/audit-scheduled-acceptance.ts check C:/outside-repository/window.json C:/outside-repository/check-001.json
```

The start command creates a new file and refuses retrospective starts/overwrite. Checks are read-only archive queries, with no source collection. After a correction, pass the prior manifest path as the fourth start argument to preserve its identity/hash while starting a new documented window. A failed/missing check stays unverified; no local test supplies the future observation.

## Source contract

- The only production source is `C:\Users\TAE\Workspace\projects\hermes\crypto-valuation-screener`.
- `C:\Users\TAE\Workspace\projects\taegyu\holder revenue` is an obsolete duplicate and is blocked for every Vercel link, preview, and production action.
- `origin` fetch and push must both equal `https://github.com/lovelylov502/crypto-valuation-screener.git`.
- `.vercel/project.json` must equal project `prj_zOmxeQWmBjp5MAUmmYFALM8AC6Cc`, team `team_2dxBFycQaaHuXjESEf0kCkFG`, project name `crypto-valuation-screener`.
- Review and commit the entire intended current diff before deployment. The checked-out branch must be `main`, its upstream must be `origin/main`, the worktree must be clean, and `HEAD` must equal freshly fetched `origin/main`.

These values are executable policy in `scripts/deploy-contract.mjs`. A copied checkout with the same remote and `.vercel` file still fails because its resolved root is not the canonical path.

## Normal production route

Load `VERCEL_TOKEN` from the approved local Codex environment, then run this command from the canonical root:

```powershell
npm run deploy:production
```

This is the only documented normal production command. It runs, in order:

1. resolved root, Git fetch/push remote, local Vercel linkage, clean synchronized `main`, and authenticated remote project/team preflight;
2. deterministic pass, duplicate-root, legacy-root, branch/worktree/sync, remote-drift, Vercel-drift, and credential-output-redaction probes;
3. all Vitest tests, TypeScript, production build, and `git diff --check`;
4. an authenticated pinned-CLI `--dry` check followed by production deployment through the verified local project/team link;
5. independent readback of the canonical `/` and `/api/screener` URLs, followed by a full-universe source and quote audit.

The wrapper captures and redacts Vercel CLI child output. Do not replace that subprocess with inherited terminal output or print command arguments containing credentials.

The preflight refreshes `origin` but does not deploy. It prints the resolved root, Git remote, branch, upstream, `HEAD`, `origin/main`, clean-worktree state, and Vercel IDs as pre-deployment evidence. The local gates also do not deploy:

```powershell
npm run deploy:preflight
npm run test:deploy-preflight
npm run verify:local
```

`npm run test:deploy-preflight` includes a deterministic noncanonical duplicate fact fixture. It proves that copying the repository remote and Vercel linkage to another path still fails closed without running or modifying the blocked legacy checkout.

## Post-deploy readback gate

`npm run verify:production` requires both canonical endpoints to return HTTP 200. The page must contain `화면 모드`, `tovenit-theme`, `밝게`, `어둡게`, `DefiLlama 전체 종목`, `열 표시`, `필터`, `연결 토큰`, `배수 분자`, `P/R · 24시간`, `P/HR · 24시간`, `P/R · 30일`, `P/HR · 30일`, `지표 안내`, `최신 자료 확인`, `page-size-top`, `scan-table`, and `수익 정렬 기준`. Main HTML must not contain `저평가 80+`, `고평가 20 이하`, a P/S table heading, or the removed `결과 정렬` dropdown. P/S evidence is still available in client-opened coin details. The API must return `scoreVersion=research-v10-source-revenue-recovery`, valid pagination and universe coverage, row fields including `opportunities` and `peerCounts`, a non-empty result, and a buffered payload below 4.5 MB. Larger pages use a bounded streamed JSON response with the identical rows, evidence and pagination, an exact decoded byte count and an 8 MB decoded ceiling. Browser and audit readers reject missing/invalid transport metadata, interrupted/incomplete bodies or exceeded budgets. The response is serialized and measured before headers, so exceeding the ceiling yields an explicit error without partial JSON or reduced page size. At least one row must have usable completed-day revenue history with positive 30-day revenue and 13 weekly observations. The source-root, repository, branch, remote, credential, and Vercel identity guards are unchanged.

The readback requires the `descriptionKo` API field with at least one usable Korean introduction. It rejects legacy `multiples.ps`, unknown/mixed multiples, unreviewed holder shares and non-business growth. A separate paginated search must find the live VVV row and verify that it remains holder-return scoped for both Revenue and Fees, with no business growth or inferred 100% share.

Current pipeline verification requires source membership, complete quote accounting and field provenance, exact API/archive equality, financial contracts and offline reproduction from the hashed original HTTP bundle. Precisely accounted local source failures can publish with explicit partial state; unknown/global failures remain blocking. Legacy snapshots retain their prior strict witness/live-source checks. A protected-last-verified result proves containment only and cannot satisfy current recovery. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [PUBLICATION.md](./PUBLICATION.md) for the active evidence and retry contracts. Keep audit artifacts outside Git via SCREENER_AUDIT_DIR.

The homepage is now a static shell with no snapshot payload or upstream collection. The API only reads a persisted, hash-verified publication and has a 30-second limit. Canonical queries must share the same persisted snapshot ID and original collection date. The single scheduled collector has a 15-minute job budget, a 12-minute collection step, a durable start event and an always-run completion/archive step. CoinGecko has an eight-minute paced request budget with encoded URLs bounded to 1,800 characters and batches to 150 IDs. It compares against the actual published snapshot, never the latest failed candidate. See [PUBLICATION.md](./PUBLICATION.md).

After every production deployment, also retain the Vercel deployment ID and unique URL from CLI output or `vercel inspect`. A successful payload upload alone is not a completed deployment until the canonical alias passes the readback gate.

A reader repair may deploy while the existing archive fails candidate acquisition readiness: `safeReaderDeploymentPassed` remains an integrity gate, while acquisition and recovery verdicts stay separate. Market-provider containment then uses the reviewed maintenance dispatch under the collector's shared writer lock, with exact canonical revision and expected-parent checks. Compatible paused readers must retain both acquisition replay revisions. See [MARKET_ACQUISITION_RECOVERY_2026-10-08.md](./MARKET_ACQUISITION_RECOVERY_2026-10-08.md); production deployment still uses this canonical wrapper only.

The gate also checks separate sales evidence identity and amount, P/HR arithmetic and complete 30-day coverage, reviewed protocol/service-receipt P/R, and stablecoin capital exclusions. Pagination must retain the full universe count while returning at most the requested page size.

V9 moves column controls into display settings and details below the selected row. Holder eligibility continues to include reviewed conditional distributions and native burns. Exact methodology, token identity, complete daily windows and numerator guards remain mandatory; see [SCREENER_V9.md](./SCREENER_V9.md) and the underlying [SCREENER_V8.md](./SCREENER_V8.md) rules. After the automated gate, check AERO search, inline details, the CMC link and the 24-hour columns in the live browser.

The largest supported conditional favorites-200 response measured 5,772,352 decoded bytes, compared with 3,860,038 for the same previous snapshot selection. Streaming preserves full evidence beyond the buffered platform limit; gzip alone is not treated as proof. See [Vercel body-limit guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions) and [streaming documentation](https://vercel.com/docs/functions/streaming-functions). Local byte-equivalence/completion tests do not attest production transport; retain canonical large-page HTTP/browser readback after a natural new-policy publication.

Publication storage uses a compact Release-body envelope and the existing complete immutable `state.json`; all dated obligations remain in that state. Latest-reader hydration validates exact same-release URL/ID/hash/bytes with a separate 30 MB state budget. A protected overdue start can pass the safe-reader deployment gate only when the retained archive, API equality and original source replay remain valid; its execution/recovery verdicts remain failed. Storage repair never promotes an unpublished candidate.

To review preservation of an interrupted archive, use the bounded read-only helper with a transient `GITHUB_TOKEN` that can read the approved repository's Actions artifacts. The helper verifies the actual ZIP digest, extracts only seven named members with `unzip`, and compares original replay and retained baseline. Git for Windows supplies `unzip.exe` under `C:/Program Files/Git/usr/bin` when local review needs a transient PATH addition. Signed download URLs and credentials are never persisted.

```powershell
npx tsx scripts/preserve-failed-observation.ts prepare <expected-start-journal> <failed-run-id> <failed-attempt> C:/outside-repository/review.json
```

After independent review and exact canonical active-revision deployment, dispatch the existing daily workflow with only `failed_observation_parent`, `failed_observation_run` and `failed_observation_attempt`. This is maintenance without collection, under its existing sole-writer concurrency group. It permanently archives original failure evidence, preserves the published pointer and imports only verified missing-date ages. Local commit mode is rejected. Preparation is review evidence only; actual immutable release/readback remains an operational gate. If the parent advances, stop and re-prepare rather than overwrite its later attempt. Keep any temporarily disabled workflow visible in operating evidence, and re-enable only the reviewed exact writer; skipped cycles earn no success credit.
