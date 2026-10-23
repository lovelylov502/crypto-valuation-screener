# Discovery workspace

The October 22 product decision adds three connected views: the unchanged screener table, a P/R movement map, and a personal watchlist. It supersedes the older single-view product brief. A fourth tab is unnecessary for this release.

## Delivery and review loop

1. Preserve table filters, pagination, numerator and existing favorites. Reuse its verified publication and coin detail contracts.
2. Implement the approved map: all computable current positions, all verifiable past-to-present arrows, six historical dates, region selection, individual detail. Missing history remains explicit.
3. Add a watchlist with notes, review status, next review date, local persistence, backup/restore and removal undo. Existing favorite slugs migrate without invented history.
4. Review desktop and narrow screens in both themes; exercise discovery → detail → save → revisit → restore. Fix observed issues and repeat the affected checks.
5. Run arithmetic/storage/API regression tests, typecheck and build. Preserve owner files in the canonical checkout before its clean-main deployment gate, then restore them after deployment. Verify canonical production and real browser flows.

## October 23 comparison availability and maintenance (v0.8.3)

P/R decline remains unknown without an exact historical capital observation and a positive complete Revenue denominator. The map now distinguishes a failed history query from unavailable history and explains how many rows passing the other conditions cannot be judged. Switching FDV to circulating cap is explicit and changes the ratio basis; no historical FDV is inferred. A disconnected read gets one bounded retry, while integrity failures remain unavailable.

The original reported publication had three eligible FDV comparisons and 110 circulating-cap results satisfying both Revenue growth and declining P/R. Read-only endpoint queries confirmed that the missing FDV was absent in storage, rather than dropped by the map. These counts are publication-specific. The audit also caught a new publication's recent financial refresh and table preparation stopping at the 500,000-credit reserve. Current-data maintenance can now consume that reserved allowance under unchanged monthly/storage and per-run ceilings; bulk backfill still retains it. The manual `refresh-read-models.yml` workflow restores verified current reads without source collection or exposing writer credentials locally.

Stable page scrollbar space preserves chart width, area selection, list page and focus when opening detail. A discovery view that receives a newer publication notifies the parent reader so the shared header and table follow the same publication.

## October 23 Revenue comparison fix (v0.8.2)

Revenue growth uses an independently verified rolling Revenue window at the historical endpoint. It does not require the historical capital needed for a P/R coordinate. Both 30-day windows must contain every completed UTC date, retain the same financial definition, and reproduce the current published Revenue total. A verified zero historical total remains a valid Revenue comparison, with no past P/R. Missing financial observations, changed definitions and snapshot mismatches remain unavailable.

The map reports Revenue and P/R comparison coverage separately within the selected current-cap and P/R-ceiling range. Unknown comparisons are not counted as declines. Falling P/R and all arrows still require the exact historical capital and a positive historical Revenue denominator. The API adds optional `revenue` and `revenueReason` fields to each history entry; older point-only responses retain their existing verified comparison fallback. No collector, source, storage or table filter policy changes.

## October 23 map units (v0.8.1)

Map cap inputs use $M (millions of USD), matching the table's unit. Their stored values and filtering remain in USD: 0.1 means $100,000 and 100 means $100,000,000. The map's default and lowest selectable minimum is 0.1M; the existing logarithmic USD slider is mapped from that floor to its upper endpoint. A blank maximum retains the unbounded sentinel. Restoring older saved conditions or importing table filters clamps sub-0.1M minima and any lower positive maximum to this floor, without changing the table preferences or other saved dollar amounts. This supersedes the Korean-unit display described in v0.8.0 below.

## October 23 refinement (v0.8.0)

The approved Quiet Research Desk mockup replaces map search/playback with a current circulating-cap range bar and optional Revenue growth, falling P/R and P/R ceiling conditions. These combine with AND. Growth compares rolling 30-day Revenue at the selected historical endpoint with the current 30-day amount; falling P/R uses the same two endpoints. The v0.8.2 correction above separates Revenue availability from historical P/R availability. The cap range always uses the latest circulating market cap, including when P/R uses FDV. Dollar inputs retain exact numeric values; only their blurred Korean-unit presentation is rounded.

Map filters and named conditions live in `tovenit-map-workspace-v1`, independently of the table preferences. An explicit table-to-map action imports table filters. A table P/R threshold is mapped into the map's 30-day control only when its original window is 30 days; other windows retain their original server-side filter. All other inherited conditions stay visible through the import banner and can be cleared. Favorites still share the existing key. No notes are copied or transmitted.

Hover prioritizes nearby current points over crossing arrow segments, enlarges the active point and places only its name beside it. A small proximity tolerance avoids flicker. Favorite points use violet; arrows retain their P/R direction colors. Region selection keeps all arrows and opens the matching list below the plot. The list is collapsed initially. Keyboard arrows move between coins, Enter opens detail, and closing detail restores focus to a visible control. The plot domains stay fixed while changing local filters or historical dates. No zoom/pan or adjacent list is introduced.

Coin introductions no longer have a 50-character preview. The full source-matched translation or available source text is rendered. Desktop summary panels scroll independently without shrinking their sections, and compact layouts use the existing single scrollable dialog. English originals and research evidence remain accessible.

## Data contract

Current map positions use the same 30-day source-reference P/R and Revenue as the table. Historical endpoints require the exact date's verified capital and all 30 completed UTC revenue dates. Definitions must agree across both windows, and the current raw-window total must reproduce the published amount. No carry-forward, current-supply backfill, partial sums or fabricated zeroes. All available arrows are visible; unavailable endpoints retain their current point and a reason.

The map reads bounded batches independently of the table. It never writes source records or changes collection scheduling. The watchlist uses the existing favorite key plus a separate versioned local record; no account, notification service or paid infrastructure is introduced. Personal notes are never sent in API requests.

## Review evidence before production

On October 23, local browser checks used the October 22 23:28 KST verified publication. The circulating-cap map displayed 465 current points, 343 available 30-day arrows and 243 available one-year arrows. Changing the period preserved all current screen coordinates. Dragging an area selected 221 points while retaining all 465 dots and 343 arrows. Clicking the Aave dot opened the existing individual detail with daily charts.

The loop caught and corrected an extra detail-header row that reduced chart space, a narrow-screen grid placement for the table-to-map button, small positive axis values formatted as zero, and unsaved note loss when closing an editor. No table metric, filter predicate or collector policy was changed.

Verified workflows: table search plus FDV import; independent map numerator with table state retained; shared favorites; desktop and 390px note/date saving; backup download and actual file restore; local note and tab restoration after reload; unsaved draft retention across tabs; light/dark layouts. At the 390px frame, the rendered document and viewport both measured 375 CSS pixels with the scrollbar, without horizontal overflow. The source publication hold remained visible.

116 Vitest files / 1,274 tests passed, including complete rolling windows, gaps, zero days, missing dated capital, identity changes, excluded capital, backup validation, merge order and bounded discovery requests. Typecheck and the production build passed locally. Production identity and live readback are verified separately by the guarded deployment wrapper; this section is local evidence only.
