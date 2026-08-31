# CLAUDE.md — compatibility entrypoint

The canonical project instructions are [`AGENTS.md`](./AGENTS.md). Read that file before any code, test, documentation, or deployment work.

Project context is maintained in these files:

- [`README.md`](./README.md): product scope and local development
- [`docs/METHODOLOGY.md`](./docs/METHODOLOGY.md): scoring and holder-value invariants
- [`docs/HANDOFF.md`](./docs/HANDOFF.md): current operational state
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md): mandatory production procedure

Do not duplicate project rules here. Update the canonical document that owns the rule.

Production is allowed only from `C:\Users\TAE\Workspace\projects\hermes\crypto-valuation-screener`, on a clean and synchronized `main`, through:

```powershell
npm run deploy:production
```
