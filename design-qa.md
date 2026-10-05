# TOVENIT interface QA — 2026-10-05

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
