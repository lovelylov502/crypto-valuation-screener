# TOVENIT interface QA — 2026-10-05

final result: passed

## Available-day historical comparison bars — 2026-10-20 / v0.6.2

Scope: apply the user's confirmed bar mockup to actual DB comparisons with 1–365 available prior daily ratios. Every ready bar shows the number of distinct dates used. Missing dates remain absent. The older 365-day readiness requirement in the historical QA records below is superseded by this section.

Source: `C:/Users/TAE/.codex/generated_images/01a151cf-16bb-7f53-af8d-481d6145e64b/exec-f76647ce-9aa1-4257-923f-1b065bde42ce.png` (1660 × 948).
Evidence: `C:/Users/TAE/.codex/tmp/available-bars-20261020` (outside Git). `reference-implementation-context.png` and `reference-implementation-rails.png` combine the source and final production-build screenshots in the same images; both were reopened and inspected. The full-context reference is proportionally scaled for the contact sheet; the focused rail crops retain native pixels. The implementation is horizontally scrolled to the comparison columns at a 1280 × 720 CSS viewport, document client/scroll width 1265px, reported devicePixelRatio 1.75. The screenshot service returns 1265 × 712 pixels. Different viewport widths and real values are not presented as pixel-identical mockup reproduction.

Five fidelity surfaces: existing Inter/system/Korean font stack and tabular figures; existing fixed table groups, dividers and compact rows; shared dark/light tokens with blue below-median and red above-median segments; unchanged TOVENIT identity, token logos and icons; explicit Korean comparison basis, real date count and unavailable-state copy. No CSS, fonts, images, layout components or financial daily-ratio formula changed in this release. The count beneath every ready bar is the user's requested addition to the reference.

Actual-data checks: Hydrex FDV P/R shows 6.22x against an 8-day median of 5.59x (red), and P/HR shows 9.51x against 9.83x (blue). The median ticks are at 49.4799% and 58.2703%; the segments meet those coordinates, rather than forcing a central tick. Both show `비교에 사용: 8일 / 365일`. `local-hydrex-dark.png`, `local-hydrex-light.png` and `local-dom-proof.json` retain the results. The local read-only QA proxy verified the original publication hash/row identity and selected actual raw DB rows; it did not write data or invent fixture values.

Empty states: Papertrade has an exact latest ratio but no prior FDV ratio, so `local-no-prior.png` shows recent values, `과거 비교 자료 없음` and 0/365 without a rail, min/median/max or fabricated baseline. Snake Finance's zero holders revenue remains unavailable with no P/HR rail. Switching to market cap re-queries that basis and shows its distinct 102-date sample rather than reusing FDV's 12 dates.

Interactions checked in the final production build: search, market-cap/FDV switching, both themes, detail opening from the P/R comparison, Escape, and focus return to that exact trigger. Final warning/error console logs are empty. The document has no horizontal overflow; the comparison table retains its own horizontal scroller. Existing narrow-screen CSS is unchanged; fresh mobile viewport QA was not performed in this release.

Validation: 114 test files / 1262 tests, typecheck, production build and whitespace checks passed. An independent review checked 2920 distributions covering every available count from 1 through 365, including even-sample medians, and compared representative stored raw rows. Tests retain exact latest-day, missing-data, source-definition, staleness and prepared-model revision guards. Reader deployment precedes the bounded prepared-model policy rebuild; production DB/readback evidence is retained outside Git after deployment.

Production readback: the canonical v0.6.2 reader deployment passed the guarded full-universe source/replay audit. `live-full-proof.json` checks six actual assets across both capital bases, including 8/9/12/14/365-date FDV samples, an empty prior baseline and zero holders revenue. The actual Aave compact history retains March 5's FDV 1687920736.48512, Revenue 184635 and P/R 25.046390846436676; its zero holders flow remains unavailable. Older prepared models already lagged the raw asset revision before this migration, so their complete payload hashes are not claimed to remain identical after refreshing those raw revisions. Policy-only payload preservation is separately covered by regression tests. `production-hydrex-light.png` shows both live bars and their 8/365 date counts. Production detail open/Escape/focus return also passed.

No remaining actionable P0/P1/P2 finding. Intentional differences are actual DB dates/amounts, the requested visible date counts, existing page chrome and responsive horizontal scrolling.

final result: passed

## Fixed valuation comparison table — 2026-10-20

Scope: the approved second corrected table mockup. Current P/R and P/HR retain their five revenue windows on the left; same-date daily historical comparisons sit on the right. Revenue amount columns and column customization are removed. This is UI verification with an explicit DB handoff, not production or remote-data verification.

Source: `C:/Users/TAE/.codex/generated_images/01a151cf-16bb-7f53-af8d-481d6145e64b/exec-f76647ce-9aa1-4257-923f-1b065bde42ce.png` (1660 × 948).
Evidence directory: `C:/Users/TAE/.codex/worktrees/valuation-table-ui/crypto-valuation-screener/.hermes/ui-qa` (Git-ignored).

- Desktop viewport: 1660 × 948 CSS pixels, device scale approximately 1. The full-page capture is 1645px wide because the browser scrollbar occupies 15px. The existing TOVENIT page header is retained, so the table regions, rather than the different page headers, are compared. Source crop: (17, 54)–(1643, 904), 1626 × 850. Implementation crop: (28, 304)–(1632, 1195), 1604 × 891. The 22px width difference follows existing page gutters; neither crop is stretched to claim pixel equality.
- `comparison-final.jpg` places both complete table regions together. `comparison-rails.jpg` compares the first three historical rows in detail. Both were reopened and visually inspected after the final code changes. `desktop-final-dark.png` records the final production build; `desktop-final-light.png` records the same desktop layout in light mode.
- Responsive evidence: `tablet-final.png` (1024 × 768), `mobile-final-light-history.png` (390px), `mobile-320-final-top.png` and `mobile-320-final-history.png` (320px). Document client/scroll widths match at 1009, 375 and 305px respectively. The table scrolls horizontally inside its own region. At 320px each 243px history rail is fully visible within the 277px table viewport, with the coin name repeated above it.
- State evidence: `unconnected-final.png` and `invalid-final.png`. Omitting the optional history payload or supplying the wrong denominator produces 18 explicit state cells and no rails. QA fixtures are served only by the ignored local proxy. The user-facing preview at `/__qa__` explicitly labels all figures as fictional UI test data.

Resolved findings and iterations:

1. P2: excessive initial table height and undersized range labels. Header height reduced from 206px to 152px; rows from 98px to 82px; range labels increased to 11px and current multiples to 14px.
2. P1: the sticky coin column obscured most of a history rail on phones. At narrow widths the coin column now scrolls with the table, comparison cells fit the viewport, and their coin names repeat locally. Full rails remain visible at 320px.
3. P2: the existing hover rule replaced blue/red multiple colors with green. Scoped hover rules now preserve the below/above-median meaning.
4. P2: export wrapped alone onto a third toolbar row at 320px. The narrow toolbar now uses two deliberate rows without page overflow.
5. P2: closing a detail opened from the right could return focus to the left coin button. It now returns to the exact triggering control, verified with Escape.

Fidelity surfaces: (1) existing Korean/system sans typography, tabular numbers and clearer numerical hierarchy; (2) fixed coin/current/history groups, fine dividers and compact rows; (3) shared light/dark tokens, blue below-median and red above-median lines; (4) existing TOVENIT identity, Lucide icons and available token logos, with stable spacing for missing logos; (5) explicit Korean labels for period-based current multiples, same-date daily historical multiples, and valid calculation days. The mockup's illustrative values and generated glyphs are not production assets.

Rail verification: one linear min–max track, a median tick at its actual position, and a segment starting at that same coordinate. Browser measurements across 14 rails found less than 0.009 CSS px of endpoint rounding. The small BendDAO difference remains small rather than being exaggerated to match an illustrative mockup. Tests cover equal values, a flat historical range, and values outside the historical range. No dot, percentage ruler or forced midpoint is used.

Verified interactions: five-period sorting; FDV/market-cap switching across both groups; search; favorites and persistence; existing source-amount filtering and reset; theme persistence; detail opening, Escape and focus return; export invocation for the nine fixture results. Pagination remains covered by the existing tests, but a multi-page live DB dataset and the downloaded export bytes were not inspected. Final local warning/error logs were empty.

Validation: all 82 test files / 890 tests passed, typecheck passed, and the final production build passed after the narrow-toolbar change. Financial input guards reject mixed bases/windows, unfinished UTC dates, mismatched comparison dates, invalid numbers and malformed ranges. Existing financial calculations remain unchanged.

Remaining integration boundary: the DB-backed batch summary is not implemented in this branch. The real API shows an unconnected state until that adapter is attached. Remote history coverage, readiness/staleness policies and live arithmetic require DB-side verification described in `docs/UI_DB_HANDOFF.md`. Existing detail history is unavailable in this credential-free UI checkout. No DB collection files, credentials, schedules or deployment were changed.

No remaining actionable P0/P1/P2 UI finding. Intentional differences are the existing page header/theme, production qualifications, mathematically accurate rail lengths and responsive horizontal scrolling.

final result: passed (UI scope; DB integration pending)

## Dated valuation overview — 2026-10-18 / v0.3.0

Scope: implement the approved left-hand introduction/metrics and two stacked charts, add 7D, the three external links and a package-derived version. The complete existing research view remains available.

Reference: `C:/Users/TAE/.codex/generated_images/01a14e50-576c-7392-ab5f-eb85132dff82/exec-947962cb-cbb5-487e-b3b5-77c5beb05b1e.png` (1584 × 993).
Evidence directory: `C:/Users/TAE/.codex/visualizations/2026/10/18/01a14e50-576c-7392-ab5f-eb85132dff82/release-0.3.0` (outside Git).

- Source and implementation screenshots were reopened together. The reference-sized iframe uses a genuine 1584 × 993 CSS viewport and a 0.64 outer scale to fit the 1280 × 720 IAB capture; it is not a resized CSS viewport. `local-reference-viewport.png` records that comparison state. Native 1280 × 720 evidence is `local-desktop-final.png`.
- At 1280 × 720 the dialog is 1240 × 680, its body and sidebar are 584px high with equal scroll height, the research button ends at 662px and the footer starts at 673px. Neither chart nor sidebar overlaps the footer. The reference-sized dialog is 1544 × 953 with equal scroll/client dimensions.
- `local-mobile-top.png`, `local-mobile-charts.png` and `local-tablet.png` exercise 390 × 844 and 960 × 720. Their surfaces have equal scroll/client widths (355px and 925px respectively). Small screens retain vertical scrolling and the sticky identity/close header instead of shrinking the full desktop into unreadable text. Two chart cursors and exact-value tooltips remain usable.
- Light and dark theme screenshots were inspected. The final production build, rather than stale development CSS, is the release verification source.

Resolved findings: increased small chart/control copy to 11–12px and footnotes to 10px; corrected the resulting compact-height grid/min-content overflow; adjusted spacing without hiding research content or cutting footer controls. Large-desktop type scale follows the reference more closely. Long introductions retain an explicit full-description action.

Fidelity surfaces: existing system/Korean sans typography and tabular numbers; the approved split rail/two-chart geometry and restrained dividers; shared dark/light tokens with blue price, mint market cap/P/R, amber dashed FDV and purple P/HR; existing token logos and Lucide icons; Korean labels retaining source, observation time, annualization, missing-data and classification qualifications. No example chart paths or invented historical values ship.

Verified interactions: ordered 7D / 1M / 3M / YTD / 1Y / MAX; inclusive UTC 7D and January-1 YTD bounds; independent capital and denominator selectors; shared keyboard/date cursors; full monetary tooltips with source observation times and completed revenue dates; explicit missing-price/history states; original-English disclosure opens and receives focus; complete research view; modal focus loop, Escape and return focus; favorite toggle restored to its original state; persisted search and existing table controls. Link inspection confirms official site / DefiLlama / CoinGecko order; deterministic tests cover CoinMarketCap fallback and unsafe/missing official URLs.

Financial validation: all 886 tests passed, plus production build/typecheck. Independent arithmetic checks covered 8,000 cases, 15,600 stored-row incremental/full comparisons (including committed-write interruption), and 13,140 local/live representative valuation fields. Missing historical FDV remains missing. These checks establish implementation and data integrity, not completion of the historical backlog or long-term natural-schedule acceptance.

No remaining actionable P0/P1/P2 finding after fresh-build verification. Intentional differences from the concept: live data and dates, 7D, the approved third link, package version, complete research access, and compact-screen responsive behavior.

final result: passed
## Coin-detail modal — 2026-10-14

Scope: implement the user's selected centered detail popup in the existing app. Existing detail content, financial calculations, source qualifications, preferences and favorites are retained.

Source visual truth: `C:/Users/TAE/.codex/generated_images/01a12fea-786e-7291-af88-2d4adbc3b540/exec-a182e9d5-1afd-4dd4-9cc3-54beb0799cad.png`.
Evidence directory: `C:/Users/TAE/Documents/Codex/2026-10-14/coin-detail-modal-6130` (outside Git).

- Source: 1487 × 1058. Requested desktop CSS viewport: 1487 × 1058; native screenshot: 1486 × 1058. The one-pixel host rounding difference is retained without stretching. Full-view `comparison-full-final.png` and aligned 1040 × 610 detail crops in `comparison-detail-final.png` compare both artifacts in the same image.
- State: Quickswap, FDV, light theme, open modal, introduction visible. The reference uses October 13 example values; the implementation uses the current verified archive. Amount differences are intentional live-data differences.
- `local-desktop-final.png` shows the final overview. `local-desktop-scrolled.png` verifies the complete five-period table and holder/source sections with the identity and close control still visible.
- `local-mobile-light.png` verifies 390 × 844. `local-mobile-dark-320-final.png` verifies 320 × 740 after the narrow-screen fix. Page widths equal scroll widths; popup content stays inside its surface. The comparison region retains its own 650px table and horizontal overflow (323px viewport at 390px).

Comparison history and fixes:

- Resolved P1: initial native Tab boundaries could leave the dialog. The explicit focus loop now excludes links within closed disclosures. Browser verification confirms the calculation summary wraps forward to DefiLlama, and DefiLlama wraps backward to the calculation summary.
- Resolved P2: the first backdrop was lighter than the selected mockup and gave the small white dismissal hint insufficient contrast. The final neutral backdrop uses 60% opacity; the close icon is unboxed to match the reference. Both final comparison images were reopened after the change.
- Resolved P2: the 320px two-column summary broke a price across lines. Below 360px the summaries use one column. The post-fix narrow screenshot shows the full price on one line.

Fidelity surfaces: existing Korean/system sans fonts and numeric hierarchy remain; the 1040px centered surface, fine dividers, four desktop summary groups, internal scroll and sticky identity header match the selected direction. Theme colors remain shared tokens, with green/red values and amber qualifications. Existing TOVENIT and source token images are retained, and the existing Lucide X replaces the old fold control. Korean captions, dismissal guidance and release copy were checked against their intended meaning.

Intentional production differences: full issue links, classification explanations, freshness dates and holder conditions remain in their existing order instead of reproducing the concept's abbreviated content. They require more internal scrolling before the comparison table. No source evidence was hidden to fit the example frame. Mobile has two summary columns at 390px and one at 320px. Generated letterforms and historical example amounts are not treated as production assets or fixed values.

Primary interactions: row whitespace and existing detail/metric controls open the modal; favorites remain independent. Content clicks retain it. Outside click, X and Escape close it, restore body scrolling and return focus to the original row button. The background is inert while open. Header/close controls stay reachable during internal scrolling. Final local warning/error logs are empty. Focused regressions (17 tests), typecheck and whitespace checks passed; the guarded production wrapper owns the complete release checks.

No remaining actionable P0/P1/P2 finding. P3: native font rasterization and the complete production disclosure density differ from the image concept.

final result: passed

## Source-amount filter option 1 — 2026-10-11

Scope: apply the user's selected common-period filter mockup to the existing screener. The source metric and USD threshold share the existing ratio/growth/holder window. No new raster assets, fonts or icon libraries are needed; existing theme tokens and Lucide controls are retained.

Reference: `C:/Users/TAE/.codex/generated_images/01a1294f-97c6-74a2-acb9-008a184d9307/exec-7b45924c-3eff-40d3-bc39-23b5302fc607.png`.
Evidence directory: `C:/Users/TAE/AppData/Local/Temp/tovenit-source-amount-filter-20261011` (outside Git).

- `13-reference-comparison-final.jpg` compares the approved reference and the actual production build at equal panel widths, with 30 days, Revenue, USD 100,000 and maximum P/R 10 selected.
- `10-desktop-dark-compact-final.jpg` shows the full filter at 1280 × 1080. The body fits without scrolling at that height; smaller viewports retain the existing fixed header/footer and scrolling body.
- `11-mobile-light-compact-final.jpg` and `12-narrow-light-compact-final.jpg` verify 390 × 844 and 320 × 740. Long holder labels and guidance wrap; period labels stay on one line. Dialog/body scroll widths equal their client widths.

Fidelity review: the common period row precedes the joined Revenue/Holders Revenue selector, amount label, dollar input with USD suffix, dynamic explanation and source-sum note. The divider precedes the existing two multiple limits. Growth/holder/favorite conditions, sector and three collapsed advanced sections follow. Circulating-cap bounds automatically expand their section while active. Spacing was reduced after the first reference comparison. The new numeric input uses 16 px text and a visible mint focus outline.

Production differences: the native numeric input accepts ungrouped editable numbers and decimals; the explanation formats the value with grouping. Copy explicitly limits missing-amount exclusion to an active amount condition. Existing fonts, flat theme surfaces, modal sizing and native controls are retained instead of reproducing generated letterforms or highlights. The complete interface preserves every existing filter and saved comparison setting.

Interaction and calculation checks:

- Revenue/Holders Revenue and period changes update the explanation and actual results. USD 100,000 is a strict threshold: equal amounts are excluded. Source period sums are compared before pagination without annualization or classification approval requirements.
- Current 7,267-row archive: 20 combinations (two source metrics, five periods, thresholds zero/USD 100,000) have no omitted or extra rows. Local API pagination matches the archive for 30-day Revenue/USD 100,000 (235 rows, two 200-row pages), 7-day holders/USD 100,000 (31 rows), and 30-day Revenue/zero (1,112 rows, six pages).
- A blank input disables the amount condition and restores all 7,267 rows with other conditions cleared. Zero remains an active condition and keeps positive source amounts. Missing amounts stay excluded only while the condition is active.
- New fields persist after reload. Reset clears the amount, restores Revenue and 30 days, and preserves the FDV selection. Legacy preference/custom-column preservation, invalid values, decimals, combined multiple limits and filtering before pagination are covered by meaningful regression cases.
- Circulating-cap inputs remain usable after moving them into their accordion; an active bound stays expanded across period changes and resets normally.
- Escape closes the dialog and restores focus to the filter button. Final local production-build warning/error logs are empty. Temporary viewport overrides were reset.
- Focused regressions: 29 tests in three files passed. Typecheck, production build and `git diff --check` passed. The guarded production wrapper performs the full suite and independent canonical/source readback.

Korean copy was checked for meaning, units, periods, strict comparison and inactive/missing states under the active writing rules. No remaining actionable P0/P1/P2 finding.

final result: passed

## Visual truth and evidence

Approved source directory: `C:/Users/TAE/.codex/visualizations/2026/10/05/01a10a20-3b43-7af0-b088-97364e06cdae/tovenit-mockups/`

Sources: `01-list-light.png`, `02-list-dark.png`, `03-detail-overview-light.png`, `04-detail-overview-dark.png`, `05-detail-comparison-light.png`, `06-detail-comparison-dark.png`.

Implementation directory: `C:/Users/TAE/.codex/visualizations/2026/10/05/01a10a20-3b43-7af0-b088-97364e06cdae/tovenit-implementation/`

Evidence: `01-list-light.png`, `02-list-dark.png`, `12-detail-overview-final-light.png`, `14-production-build-comparison-dark.png`, `07-mobile-detail-light.png`, `09-mobile-detail-dark.png`, `10-mobile-filter-dark.png`.

URLs: development at `http://localhost:3100`; final production build at `http://localhost:3101`.

Desktop source: 1536 × 1024 pixels. Browser CSS viewport: 1536 × 1024; screenshot output: 1536 × 1024, one image pixel per CSS pixel. Content width is 1521 because of the browser scrollbar. No density scaling. Mobile CSS viewport and output: 390 × 844. Compare application content only; the development indicator is absent from the production build.

State: light/dark list; Sat Rush inline detail, FDV selected, original and calculation disclosures initially closed; overview and scrolled comparison/holder sections. The final dark comparison capture uses the production build. All six references and corresponding implementation views were visually inspected; reference and implementation images were supplied together for comparisons, including the final overview and comparison passes. The detail overview and lower-section captures are the focused evidence for typography, values, sources and missing states; the initial full-list captures establish overall composition.

## Findings and iteration history

- Resolved P2: inherited table hover rules colored nested detail cells and hid the comparison header/30-day emphasis. Scoped list rules to direct children. Development CSS caching retained the earlier rule even after reload, so final verification used the production build. `14-production-build-comparison-dark.png` shows the repaired header and selected row; computed colors are `#282d28` and `#2d3930`.
- Resolved P2: sticky list headings covered the detail while scrolling, especially on mobile. Suspend their translation while the inline detail is being read. `09-mobile-detail-dark.png` and the production comparison capture show unobstructed content.
- Resolved P2: mobile toolbar created an isolated extra control row. Reduced narrow-screen spacing while retaining named controls. `08-mobile-top-dark.png` and `10-mobile-filter-dark.png` show the revised arrangement.
- Resolved P2: the initial detail hierarchy was too small and dense. Increased section headings, introduction, key values and comparison figures; separated four summary groups, five periods and holder routes. Final overview/lower captures show the correction.
- No remaining actionable P0/P1/P2 findings.

## Required fidelity surfaces

- Typography: system sans stack with Malgun Gothic Korean fallback and tabular figures. Generated reference letterforms are approximated using existing installed fonts. Clear title/section/value/note hierarchy; long source states wrap without covering values. Dense list typography remains smaller than detail typography.
- Spacing: neutral page surface, generous detail sections, four desktop summary groups and three holder columns; mobile summary uses two columns and holder routes stack. Tables scroll within their own regions. Document width is 1521/1536 desktop and 375/390 mobile, with no page overflow.
- Color: warm off-white `#f6f7f3`, white panels, charcoal text; dark `#181a19` page and `#202320` panels. Green selection/positive values, rose negatives, amber source totals. Theme tokens extend to dialogs, status and evidence, removing the old navy treatment.
- Assets: supplied TOVENIT raster logo and source token logos retained. Lucide icons continue the established icon set. No placeholder illustrations, handmade logos or new decorative assets.
- Copy: Korean introduction precedes numbers; price, capital, revenue and holder amounts retain their units and periods. Provider aggregates, unavailable history and non-applicable metrics remain distinct. Korean wording was reviewed against source meaning, including conditional rewards and unverified payouts. Existing finance calculations and source provenance remain intact.

## Intentional production differences

The mockups show five example rows and a compact three-period context strip. Production retains the complete universe, user-selected five-period columns, pagination, filters and favorites. There is no new sidebar or chart. Collection status and detailed source qualifications remain available. Lower-page content scrolls naturally rather than reproducing the mockup's repeated fixed identity/header. No pixel-perfect claim is made for generated type or screenshot framing.

Unknown or changed English descriptions show an explicit translation-pending state and their original text. CoinMarketCap has priority when its verified slug exists; CoinGecko is the fallback. If neither market identity exists, the interface states that the market page is unlinked rather than fabricating a URL.

Sat Rush's newly reviewed translation is applied by `koreanDetailDescription` at display time. The first production audit caught a change to the archived snapshot's replay hash when that entry was placed in the collector catalog. The catalog was restored; the new display helper still requires exact English source text. Regression coverage verifies both the Korean UI result and the unchanged collector result. No audit guard or hash comparison was weakened.

## Interaction and technical verification

- Light/dark toggle, saved theme after reload, and selected button state.
- Sat Rush Korean introduction, original disclosure, DefiLlama + CoinGecko links.
- Aerodrome DefiLlama + CoinMarketCap links.
- FDV and market-cap switches update existing calculations (Sat Rush 30-day P/R 1.23/0.94 and P/HR 5.50/4.19 for the verified snapshot).
- Favorite and favorites-only state persisted after reload, then restored.
- Price column add/remove, page size 50/100, next/previous result page, filter empty state and recovery.
- Inline close and Escape restore the row; mobile filter dialog fits the viewport.
- Browser warning/error logs empty in the final local production-build check.
- Baseline full suite: 453 tests in 43 files. Added link/translation tests: focused run 6 tests in 2 files. Typecheck and production build passed. Deployment wrapper will run the full final suite and independent production readback.

## Follow-up polish

P3: generated mockup typography and fixed repeated headers are not reproduced exactly; current responsive structure preserves the existing product behavior. OS browser-chrome theme color follows the system media query, while page color follows the explicit user choice.

## Implementation checklist

- [x] Compare references, overview and lower detail states.
- [x] Fix nested table styles, mobile toolbar and sticky header overlap.
- [x] Verify real interactions, responsive layout and console.
- [x] Preserve saved settings and financial definitions.
- [x] Keep screenshots and generated deployment artifacts outside Git.

final result: passed
