# TOVENIT interface QA — 2026-10-05

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
