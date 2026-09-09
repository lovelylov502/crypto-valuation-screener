# Screener v4 — current product and implementation contract

Revision: 2026-09-08. Score/rule version: `research-v4-same-window`.
This document supersedes the v3 discovery-first UX and accounting descriptions in the older product brief, UX specification and methodology. Production source safety remains governed by AGENTS.md and DEPLOYMENT.md.

## Purpose and scope

Keep one web screener for a personal daily review. Discover businesses whose revenue or fees improve, tokens with observed holder-directed flows, and transitions in those flows. Multiple signals can apply to one protocol. A token does not need a high holder-centric composite score to appear in these views.

There is no new account, paid data subscription, database service, investment recommendation, or separate research workspace. The existing dark visual language, table, favorites, column selection and range filters remain.

## Discovery contract

| View | Observation | What it does not establish |
| --- | --- | --- |
| 실적 개선 | Revenue or fees increased against the preceding 30-day window, including a reported zero turning positive | Net profit, organic growth, or undervaluation |
| 홀더 배분 | Positive eligible holder value or positive identified ve/voter/locker distributions in the last 30 days | Unconditional cash entitlement for every liquid token holder |
| 흐름 전환 | Eligible or conditional holder amount changed between a reported zero and a positive value | The date or legal status of a policy launch, resumption or shutdown |

An ambiguous or unverified token identity cannot produce these signals. Other missing inputs and investment risks are presented separately and do not suppress a valid independent observation. Price appreciation above the existing 20%/30% 30-day/60-day thresholds is context, not removal from a signal view.

Selecting several discovery cards uses **OR**. Search, view, sector and advanced filters intersect that selection. Counts on cards and view buttons describe the whole returned universe; the result heading counts the intersection. The default view is the full $1M+ universe, sorted by number of observed signals, then market cap. Users can sort by any individual metric.

## Accounting

- P/HR = circulating market cap / (eligible holder value over 30 days × 365/30).
- P/S and P/F use revenue and fees over the same recent 30-day window, annualized in the same way.
- Eligible holder share uses eligible **30-day amount / 30-day revenue**; it falls back to **30-day fees** only when revenue is not a positive denominator. The denominator is shown in detail. This measured ratio is not a policy allocation rate.
- Ratios above 100% remain visible with a scope/funding/timing warning. Only the contribution to the experimental score is capped.
- Zero and missing are distinct throughout parent-period aggregation. An incomplete component period is not silently summed into an apparently complete period.
- For holder values, the current eligible period must be complete to produce an eligible parent run-rate; the prior eligible period must be complete to produce a comparable growth rate. Observed raw/excluded totals and component amounts remain inspectable.
- Revenue/fee annual supplementary fields use complete parent TTM where available, otherwise complete parent 30-day annualization. Individual components with different windows are not mixed.
- A fee-burn, ve/voter distribution or unclear mechanism remains excluded from general P/HR. Identified conditional distributions are nevertheless discoverable and shown separately, with amounts labeled as conditional 30-day values.
- Amounts come from DefiLlama and its automated classification. The two reviewed reference cards (Pendle and Hyperliquid) supplement the explanation without overwriting measured amounts or applying an assumed policy percentage. Buyback followed by burn or distribution is not added twice.

The four-axis score retains its existing weights and hard score gates. It is explicitly experimental, holder-centric and sensitive to missing inputs. Peer counts are visible; fewer than eight eligible same-sector peers means no relative percentile. No global fallback or missing-data reweighting was added. The A/B/C number describes **field completeness**, not confidence in a return prediction.

## Refresh and recovery

The page and API retain 30-minute ISR. The client checks `/api/screener` on mount, on focus/visibility return after five minutes without a check, and every 30 minutes while visible. Manual refresh uses the same path. In-flight calls are deduplicated and aborted on unmount or after 90 seconds.

Because ISR can serve an old response while regenerating, the client follows a stale response with up to six additional reads, eight seconds apart. It accepts newer snapshots without resetting filters, selection or the current valid page. Errors retain the last usable table and expose a retry. Initial server collection failure also leaves a working client recovery path. Malformed and old-schema responses are rejected.

The UI distinguishes calculation time, last server check, CMC's source timestamp range and per-endpoint response observations. A response observation may be from an upstream cache and is not a claim about generation time. DefiLlama has no uniform source-generation timestamp in these endpoints. Optional source failure is visible. A snapshot older than 12 hours is prominently marked old.

The existing >2MB upstream Next data-cache warnings can still occur. The small route response is cached independently. Do not switch those large requests to `no-store` without checking whether the page/API cease to be static ISR. Never remove the shared $1M payload boundary to hide missing microcaps.

## History and daily collection

The browser stores one latest observation per KST day for up to 60 days. The previous-view baseline is frozen during an open session, so periodic updates do not erase the comparison. Corrupt or blocked storage is handled without breaking the table. An older server response never replaces a newer saved observation, and comparisons against future baselines are suppressed.

Comparisons require the same score version and token identity. The change view includes new rows, signal entries/exits, at least three score points, or a revenue/holder amount change of at least both 5% and $100. Exact comparable deltas, including P/HR, are in the detail. These are changes in reported observations, which may include backfills and source revisions. They are not automatically new economic events. “현재 자료까지 확인함” advances the in-session baseline.

`npm run snapshot:capture -- <output-directory>` separately captures an immutable observation receipt: compressed joined inputs, the scored response, a compact snapshot and a SHA-256 manifest with source observations, source timestamps where available, rule-file hashes, Git revision and dirty-worktree status. These are joined scoring inputs, not copies of every original provider response. Existing observations are not overwritten. Credentials, local storage favorites and environment variables are never included.

`.github/workflows/daily-snapshot.yml` runs once daily at 00:17 UTC (09:17 KST) after the workflow reaches the default branch and Actions is enabled. The user chose one daily run on 2026-09-09. It uses a standard Ubuntu runner, read-only repository permission and no vendor/API secrets. Artifacts are retained for 60 days. It then warms the canonical website's page and API caches and verifies a fresh matching-version API response. A local successful run does not prove the hosted schedule has run.

The initial workflow push was rejected because the OAuth credential lacked `workflow` scope. The user authorized that scope on 2026-09-09. Current activation and hosted-run evidence are recorded in HANDOFF.md. Website request-based refresh and manual refresh work independently of the scheduled archive.

The repository was verified public on 2026-09-08. Standard public-repository Actions minutes are free; artifacts use GitHub's shared storage allowance. The sampled archive was approximately 1.25MB per run, about 75MB at one daily run for 60 days. Account-wide storage use still determines allowance headroom. Scheduled jobs can be delayed, and public schedules can be disabled after repository inactivity. No exact-time delivery is promised. [GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Browser history powers the on-screen previous-view comparison. GitHub artifacts preserve observations while the browser is closed for later research; they are not automatically imported into browser history. Pending governance proposals and planned fee switches still require separately reviewed evidence. This release does not claim complete automated policy-event coverage or a validated trading edge.

## UI and accessibility

The three discovery cards replace the scoring explanation as the primary entry point. One table remains below view filters, search and collapsible advanced/column settings. Desktop uses a fixed header and coin column within the table scroll region. Mobile keeps discovery cards compact, wraps view controls, and restricts horizontal scrolling to the table. Coin names open a native modal detail panel with keyboard focus containment, Escape close and focus restoration. Small tooltips are supplemented by readable detail content. Favorite icons have accessible names and pressed states. Missing values, risks and loading states are expressed in text as well as color. Reduced-motion preference is respected.

Validation includes same-window calculations, partial component history, zero transitions, conditional-holder visibility, identity safeguards, price/dilution independence, history corruption/version/identity checks, and bounded ISR retry/failure handling. Test actual desktop/mobile interactions and production build output before deployment. Screenshots alone do not establish full accessibility compliance.

## Primary mechanism references

- [DefiLlama dimensions definitions](https://docs.llama.fi/list-your-project/other-dashboards/dimensions)
- [DefiLlama token rights taxonomy](https://docs.llama.fi/list-your-project/token-rights)
- [Pendle sPENDLE conditions](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/sPENDLE)
- [Hyperliquid fee routing](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)
