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

`npm run verify:production` requires both canonical endpoints to return HTTP 200. The page must contain `표시 설정`, `필터`, `배수 산출`, `배수 분자`, `P/S · 사업 매출`, `P/R · 30일`, `P/HR · 30일`, `계산법`, and `최신 자료 확인`, and must not contain `저평가 80+` or `고평가 20 이하`. The API must return `scoreVersion=research-v8-coverage-and-holder-types`, row fields including `opportunities` and `peerCounts`, a non-empty result, and a payload below 4.5 MB. At least one row must have usable completed-day revenue history with positive 30-day revenue and 13 weekly observations. The source-root, repository, branch, remote, credential, and Vercel identity guards are unchanged.

The v5.1 usability readback also requires both page-size selectors in the page and the `descriptionKo` API field with at least one usable Korean introduction. V6 also rejects legacy `multiples.ps`, unknown/mixed multiples, unreviewed holder shares and non-business growth. The live VVV row must remain holder-return scoped for both Revenue and Fees, with no business growth or inferred 100% share.

After every production deployment, also retain the Vercel deployment ID and unique URL from CLI output or `vercel inspect`. A successful payload upload alone is not a completed deployment until the canonical alias passes the readback gate.

The gate also checks separate sales evidence identity and amount, P/HR arithmetic and complete 30-day coverage, reviewed protocol/service-receipt P/R, and stablecoin capital exclusions. UI page-size IDs remain required.

V8 additionally requires table column-move controls and explicit popup/coverage UI markers. Its holder eligibility includes reviewed conditional distributions and native burns. Exact methodology, token identity, complete daily windows and numerator guards remain mandatory; see [SCREENER_V8.md](./SCREENER_V8.md).
