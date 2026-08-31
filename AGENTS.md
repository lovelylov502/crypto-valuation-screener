# AGENTS.md — crypto-valuation-screener

This is a project folder inside 태규 main desktop Hermes workspace.

Before making changes:
- Read this file plus README.md if present.
- Read CLAUDE.md if present; it may contain legacy project-specific guidance.
- Inspect package/config/test files before running or editing code.
- Keep generated output, credentials, browser profiles, caches, and secrets out of commits and out of Hermes memory.
- Verify with the smallest safe smoke test before claiming completion.

Legacy project guidance:
- CLAUDE.md is a compatibility shim that points back to this file and the canonical project documents. Do not duplicate rules there.

Project role:
- Crypto valuation screener. Use only when evolving the app itself; investment writeups belong in 태규 투자노트/wiki unless explicitly asked.

Production deployment safety:
- The only allowed production root is `C:\Users\TAE\Workspace\projects\hermes\crypto-valuation-screener`.
- Never link or deploy `C:\Users\TAE\Workspace\projects\taegyu\holder revenue`; it is a blocked legacy duplicate.
- The only allowed repository is `https://github.com/lovelylov502/crypto-valuation-screener.git`; both fetch and push URLs must match.
- The expected Vercel binding is project `prj_zOmxeQWmBjp5MAUmmYFALM8AC6Cc`, team `team_2dxBFycQaaHuXjESEf0kCkFG`, project name `crypto-valuation-screener`.
- Pre-deployment proof is a passing `npm run deploy:preflight`: exact resolved root, fetch/push repository URLs, local Vercel linkage, branch `main`, upstream `origin/main`, clean worktree, and `HEAD == origin/main` after a fresh fetch.
- Run production only with `npm run deploy:production`. It enforces the proof, authenticated remote Vercel identity, local gates, pinned CLI deploy, and canonical live readback defined in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).
