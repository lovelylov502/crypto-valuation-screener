# Production deployment safety

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
5. independent readback of the canonical `/` and `/api/screener` URLs.

The wrapper captures and redacts Vercel CLI child output. Do not replace that subprocess with inherited terminal output or print command arguments containing credentials.

The preflight refreshes `origin` but does not deploy. It prints the resolved root, Git remote, branch, upstream, `HEAD`, `origin/main`, clean-worktree state, and Vercel IDs as pre-deployment evidence. The local gates also do not deploy:

```powershell
npm run deploy:preflight
npm run test:deploy-preflight
npm run verify:local
```

`npm run test:deploy-preflight` includes a deterministic noncanonical duplicate fact fixture. It proves that copying the repository remote and Vercel linkage to another path still fails closed without running or modifying the blocked legacy checkout.

## Post-deploy readback gate

`npm run verify:production` requires both canonical endpoints to return HTTP 200. The page must contain `DefiLlama 전체 종목`, `열 표시`, `필터`, `연결 토큰`, `배수 분자`, `P/R · 24시간`, `P/HR · 24시간`, `P/R · 30일`, `P/HR · 30일`, `지표 안내`, `최신 자료 확인`, `page-size-top`, `scan-table`, and `수익 정렬 기준`. Main HTML must not contain `저평가 80+`, `고평가 20 이하`, a P/S table heading, or the removed `결과 정렬` dropdown. P/S evidence is still available in client-opened coin details. The API must return `scoreVersion=research-v9-full-universe-and-24h`, valid pagination and universe coverage, row fields including `opportunities` and `peerCounts`, a non-empty result, and a payload below 4.5 MB. At least one row must have usable completed-day revenue history with positive 30-day revenue and 13 weekly observations. The source-root, repository, branch, remote, credential, and Vercel identity guards are unchanged.

The readback requires the `descriptionKo` API field with at least one usable Korean introduction. It rejects legacy `multiples.ps`, unknown/mixed multiples, unreviewed holder shares and non-business growth. A separate paginated search must find the live VVV row and verify that it remains holder-return scoped for both Revenue and Fees, with no business growth or inferred 100% share.

After every production deployment, also retain the Vercel deployment ID and unique URL from CLI output or `vercel inspect`. A successful payload upload alone is not a completed deployment until the canonical alias passes the readback gate.

The gate also checks separate sales evidence identity and amount, P/HR arithmetic and complete 30-day coverage, reviewed protocol/service-receipt P/R, and stablecoin capital exclusions. Pagination must retain the full universe count while returning at most the requested page size.

V9 moves column controls into display settings and details below the selected row. Holder eligibility continues to include reviewed conditional distributions and native burns. Exact methodology, token identity, complete daily windows and numerator guards remain mandatory; see [SCREENER_V9.md](./SCREENER_V9.md) and the underlying [SCREENER_V8.md](./SCREENER_V8.md) rules. After the automated gate, check AERO search, inline details, the CMC link and the 24-hour columns in the live browser.
