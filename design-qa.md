# CoinMarketCap-informed table refresh — 2026-09-21

final result: passed

## Visual target and scope

The user selected CoinMarketCap's dark interface as a reference while retaining the screener's own requirements. This is an adaptation of its table hierarchy, navy/blue palette and nearby filter/display controls, not a pixel clone. CoinMarketCap's ads, promotional cards, AI entry points, presets and branding are intentionally absent. The existing V brand and token logos remain; no reference imagery was replaced with fabricated art.

Reference URL: https://coinmarketcap.com/ (dark mode, captured this session). Implementation: the existing app at http://127.0.0.1:3021/, verified with a production build.

Evidence root, outside Git: `C:/Users/TAE/Documents/Codex/2026-09-19/dot-plugin-browser-openai-bundled-mention/outputs/cmc-ui-v9/`.

- Source visual truth: `reference-table.png` (1274×717), `reference-columns.png` (1280×720), `reference-main.png`.
- Rendered implementation: `implementation-main.png` (1265×712), `implementation-columns.png` (1280×720), `implementation-mobile.png` (375×811), `implementation-mobile-columns.png`, `implementation-mobile-filter.png` (390×843), `implementation-coverage.png`, `implementation-wide.png`.
- Desktop CSS viewport: 1280×720; responsive checks: 390×844 and 1920×1080. The browser exports JPEG bytes under these screenshot filenames. Minor provider scaling/scrollbar differences are recorded in the pixel sizes; screenshots were viewed at proportional scale without image editing. No device frame or browser chrome was included. This is a qualitative product comparison, not a pixel-difference score.
- States: all rows, default and personally reordered columns, ascending/descending revenue sort, selected FDV, range-filtered results, display and filter dialogs, coverage overview, VVV evidence. Live data timestamps differ; market figures are not compared for visual fidelity.

## Comparison history and fixes

The source and implementation were supplied together in the same image-review call, both for the table and the columns dialog. The final pair was reviewed again after fixes. Text and controls are readable at native scale in the dialog captures; separate focused crops were not needed.

1. [P2, fixed] A completed refresh left an empty colored strip above the table because an empty error string masked the status text. Successful completion is now announced accessibly without retaining an empty banner; active loading/errors remain visible. Evidence: `implementation-migrated.png` versus final `implementation-main.png`.
2. [P2, fixed] A legacy flex rule spread column numbers across half of each selected row. The number now occupies a fixed 17px slot beside the drag handle and metric name. Evidence: `implementation-columns-1.png` versus final `implementation-columns.png`; computed flex is `0 0 17px`.
3. [P2, fixed] Generic popup input styling made the upper range input opaque, hiding the lower handle and track. Range inputs are now excluded from that background rule; both handles and the blue track are visible. Minimum/maximum unit labels also stay on one line. Final evidence: `implementation-mobile-filter.png`; both range backgrounds are transparent, and ArrowRight on the minimum updates the numeric input.
4. [P2, fixed] A legacy responsive rule hid the data-quality status on mobile. The status remains visible with the timestamp. Evidence: final `implementation-mobile.png`.
5. [P2, fixed] The read-only coverage overview inherited an automatic-save footer. It now explicitly says that inspecting coverage does not alter table settings. With no metric columns, it asks the user to add a metric instead of claiming that zero coins have usable data. Evidence: final `implementation-coverage.png` and source inspection of the empty-metric branch.

## Required fidelity surfaces

- **Fonts and typography:** system sans-serif with Inter/Segoe UI/Malgun Gothic fallbacks; Korean labels remain readable. Table numbers use tabular numerals, 14–15px primary values and 12px contextual labels. Active sorting has a visible arrow. The reference's compact numeric hierarchy is retained; Korean source/holder conditions require a second line and modestly taller rows.
- **Spacing and layout:** full-width table; single compact toolbar on wide screens; wrapped controls on narrow screens. The selected-column list is vertical, followed by addable columns. Header reset and footer completion remain outside the scrolling body. Mobile horizontal overflow is confined to the table, with the identity column retained. At 1920px the table is about 1849px wide and the document has zero horizontal overflow.
- **Colors and tokens:** navy page `#0d1421`, dialog `#202535`, blue selection/action accents, muted blue-gray supporting text, green/red signed price changes and amber data-quality status. No large repeated explanation panels dominate the table. Focus rings remain visible.
- **Images and icons:** original token logos render sharply on desktop; existing mobile logo reduction is retained to preserve name space. Lucide controls use one consistent stroke family. CoinMarketCap's logo and marketing assets are intentionally not copied.
- **Copy and content:** P/R and P/HR are the table's primary metrics. Periods and the chosen numerator are explicit; unavailable values keep short reasons. Sales P/S remains in the relevant coin detail with its separate source and estimate caveat. The visible-column coverage count does not sum overlapping populations or imply every row has a calculated multiple.

## Interaction and data checks

- Header-click P/R sorting verified ascending (1.05x, 1.10x, 1.37x…) and descending (603.1Kx, 159.0Kx, 37.3Kx…) in the observed snapshot. No sort dropdown or separate direction control remains.
- Hiding the active P/R sort column falls back to visible market cap descending. Missing values are tested last in both directions.
- Selected-column pointer dragging and keyboard arrows both change order; exact order and 90-day P/R/P-HR filters survive reload. Restoring defaults preserves existing filters and numerator and does not restore P/S.
- Adding all holder periods produces 1 year / 90 / 30 / 7 days together without disrupting unrelated columns.
- Dialog Tab/Shift+Tab wrap internally; Escape closes and returns focus to the initiating display button. The minimum market-cap range slider responds to keyboard input.
- Current-table coverage counts only selected metric periods; the expandable whole-universe overview uses an independent inspection period. FDV-unavailable market-cap references remain excluded from FDV counts, sorts and filters (regression test).
- VVV detail retains separate estimated sales P/S and buy/burn P/HR denominators, four return windows, conditions and linked calculation evidence. No valuation-source or eligibility formula changed in this UI release.
- Desktop, mobile 390×844 and wide 1920×1080 layouts inspected. No document horizontal overflow; popups fit the viewport. Browser warning/error log inspection returned no entries.
- 202 application tests passed; TypeScript and the production build passed. Eight targeted regression cases cover migration, ordering, filter preservation, numeric sorting and period/numerator coverage. Production deployment gates are recorded separately in the handoff receipt.

## Remaining limits and checklist

- No actionable P0/P1/P2 findings remain in the inspected states. All visual fixes above were recaptured and reviewed.
- Market-data coverage continues to depend on upstream availability and the selected period/numerator. This release does not claim new revenue sources or a full financial audit.
- Physical-device touch testing and a formal accessibility/contrast audit were not performed. Mobile browser layout and keyboard behavior were checked.
- [x] Reference comparison, including typography, spacing, tokens, images and copy.
- [x] Responsive and primary interaction checks.
- [x] Regression tests and production build.
- [ ] Canonical deployed readback: see the subsequent deployment receipt in `docs/HANDOFF.md`.
