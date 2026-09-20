# V8: source coverage, holder types and popup settings

Rule version: `research-v8-coverage-and-holder-types`. This supersedes V7 where stated. Market identity, parent grouping, stablecoin exclusions, sales-source expiry and complete UTC-day arithmetic retain their existing guards.

## What the counts mean

The old P/R 101 and P/HR 34 counts were positive, computable FDV multiples over 30 completed days. They were neither all projects with revenue nor disjoint lists: their union, including the one P/S row, was 116 in the fixed comparison. Zero amounts, other available periods, missing FDV, incomplete days and unreviewed definitions were obscured by the old presentation.

The UI now selects 7/30/90/365 days or any supported period for availability. The any-period option is the default and does not change displayed column periods. P/S always uses its individual source period. Three exclusive states sum to the screened universe: at least one computable multiple, source data present but multiples withheld, and no relevant source data collected. Source presence includes zero, negative and partial history. P/S, P/R and P/HR counts can overlap. Counts refer to screened project rows, not a guarantee of unique token issuers or audited businesses.

FDV and circulating-cap multiples remain separate. Missing FDV is blank with a clearly labeled circulating-cap reference when available. The reference never participates in FDV sorting, maximum filters or coverage.

## Economic definitions and source review

- P/S is reserved here for separately evidenced business sales; scope, estimate basis, date, source and expiry are visible. The one current record is VVV's separately sourced annualized sales estimate. This does not establish that all other businesses lack sales. It is not audited TTM, and VVV token ownership does not establish equity rights to Venice sales.
- P/R uses reviewed protocol revenue or clearly attributable service receipts. Gross supplier payments, estimated trading PnL, prepaid credit sales without recognition evidence, bookings, mixed token taxes/treasury flows and unclear definitions stay withheld.
- P/HR accepts reviewed direct distributions, market buybacks, buy-and-burn, native fee burn, staking/lock/voter distributions and explicit mixtures of holder-only mechanisms. Recipients and conditions are shown. A buy-and-burn amount is counted once. Native burn is not cash paid to holders or a claim about net supply after issuance.
- Mixed flows including suppliers, validators or other asset holders remain excluded when the screener token's share cannot be separated. Convex's mixed recipient scope, for example, cannot all be assigned to CVX.

The reviewed definition registry grew from 302 to 382 components. The audit reviewed 130 relevant existing/new records and retains explicit unknown/mixed outcomes. Six-field methodology matching remains exact; no ticker-only or amount-equality inference can upgrade a definition. Orca's reviewed exception explicitly identifies xORCA staking conditions; it only applies when the exact source definition still matches. Parent/component boundaries and partial confirmed-holder subsets remain disclosed.

Terminology is a local presentation policy, not a universal industry convention: some platforms call protocol net-revenue multiples P/S. The economic denominator and numerator shown beside the number determine its meaning.

Primary references: [DefiLlama definitions](https://docs.llama.fi/analysts/data-definitions), [Token Terminal metric conventions](https://tokenterminal.com/resources/articles/token-terminal-key-metrics-faq), [Orca council fee-funded xORCA update](https://forums.orca.so/t/council-update-increased-xorca-buyback-rewards-fueled-by-protocol-fee-revenue-20-to-40-and-r-d-grant/1129), [Sacra Venice sales estimate](https://sacra.com/c/venice-ai/).

## Recovering actual daily observations

DefiLlama overview responses include some protocol rows, notably chains, without their daily breakdown series. For reviewed eligible components missing observations in the latest 30 days, the collector requests the matching `summary/fees/{slug}` series using the same data type. It verifies slug, name, DefiLlama ID, parent, double-counting status and reviewed methodology. Conflicting overlaps reject the supplementary series. Only finite, explicit numeric observations from completed UTC dates are merged; missing days never become zero.

Requests use six workers, an eight-second per-request limit and a twenty-second shared time budget for each source collector. Source status and URLs are retained. The existing 30-minute joined cache bounds normal refresh work. A failed supplement leaves the original incomplete history visible and cannot create a multiple. Some genuine gaps remain: the fixed input has only 27/30 common days for Uniswap, 25/30 for PancakeSwap and 19/30 for Euler. Provider rolling totals cannot prove those missing observations.

## Reproducible comparison

Frozen comparison: 2026-09-20 17:05:46.845 UTC (2026-09-21 02:05:46 KST), baseline commit `5db1d949859033c215ad0b9858f0ccc9a2044c20`. Both versions use the same original market/overview responses and date; added component histories are archived with hashes. 6,192 joined raw rows and all 581 screened rows passed the contract. No screened rows or market numerators were added, removed or changed by the comparison. The replay verifies receipt hashes and refuses missing receipts instead of fetching replacement live data.

| Basis / available period | P/S before → after | P/R before → after | P/HR before → after | Distinct rows before → after |
|---|---:|---:|---:|---:|
| FDV / 30 days | 1 → 1 | 101 → 108 | 34 → 54 | 116 → 135 |
| FDV / any period | 1 → 1 | 101 → 114 | 40 → 64 | 117 → 142 |
| Circulating cap / 30 days | 1 → 1 | 117 → 128 | 36 → 62 | 132 → 156 |
| Circulating cap / any period | 1 → 1 | 117 → 134 | 42 → 72 | 133 → 163 |

41 rows changed a displayed P/R or P/HR value/availability in at least one numerator/window. Broader metadata changed on 238 rows; 33 experimental scores changed because holder eligibility expanded. These are different measures. At FDV/any period, 142 computable + 134 source-present withheld + 305 missing = 581. The API is 3,450,745 bytes. All 48 archived sources succeeded and all source-scope/formula checks passed. Counts are dated observations, not fixed product limits.

Evidence is outside Git under `C:/Users/TAE/Documents/Codex/2026-09-19/dot-plugin-browser-openai-bundled-mention/outputs/coverage-v8/final-audit`: `audit.json`, `source-manifest.json`, source response bodies, before/after payloads and `review-queue.json`. All screened rows were checked by code; this does not assert an independent financial or on-chain audit of all projects.

## Workspace and ongoing checks

The permanent sidebar is replaced by separate filter/display dialogs and a full-width neutral dark table. Common list and numerator choices stay visible. Display settings retain selected-column drag, keyboard arrows, move buttons and adjacent period grouping. The existing V7 browser key preserves order, filters, watchlist and numerator; dialog-open state does not persist. Dialogs support Escape, keyboard focus containment, focus return and mobile scrolling with a fixed completion button.

The existing daily workflow retains its 09:17 KST schedule. `quality.json` now records each numerator/window's coverage and an explicit review queue, including new/changed/unknown/mixed definitions and expired sales. Calculation-source hashes include the new history and coverage modules; the workflow summary links the coverage problem to its artifact. The queue is a maintenance input, not an automated semantic review. No additional monitor or notification service is introduced.

Definition text drift, expiry, incomplete dates, mismatched source identity and incorrect arithmetic fail closed or enter the review queue. Silent upstream implementation errors and unreported off-chain income still need source investigation; these checks cannot guarantee every provider amount is correct. Deployment and live validation receipts are in [HANDOFF.md](./HANDOFF.md).
