# Inline valuation screener — 2026-09-26

final result: passed

## Target, viewport and state

Source visual truth: `C:/Users/TAE/.codex/generated_images/01a0da35-e9ce-7852-99bb-df3acfdf526b/exec-b0bf647e-58cf-4e4a-b502-ef1c2f87220b.png` (1536×1024). This is the user's selected navy table with AERO expanded below its row. It supersedes the earlier right-panel design.

Implementation: the existing application, production build at `http://127.0.0.1:3000/`. Evidence root outside Git: `C:/Users/TAE/Documents/Codex/2026-09-26/crypto-screener-v9-qa/`.

Desktop CSS viewport 1536×1024. Final screenshot `desktop-final.png` exports at 1521×1014 because of provider scrollbar/export scaling. The comparison normalizes it to 1536×1024 (about 1.01×); this is not a pixel-difference score. Responsive CSS viewports are 390×844 and 1024×768; `mobile-final.png` exports at 375×811. Layout assertions use CSS client dimensions, not screenshot pixels. There is no device frame or browser chrome in the comparison.

State: default 16 columns, MCap, ascending 30-day P/R, AERO search and expanded detail. The mock has five synthetic rows with AERO third; the real filtered list has three rows with AERO first. Row position, dollar amounts, chains, missing periods and timestamps intentionally differ. The implementation does not copy synthetic financial values. Full and focused comparisons preserve this declared content difference.

## Evidence and comparison history

- Full view: `comparison-final.png` combines source and browser capture in one 3072×1024 input. Both were actually reviewed together.
- Focused detail: `comparison-detail-final.png` stacks the source and implementation's market/growth/holder bands at native width. This is necessary because the full side-by-side image reduces dense table text.
- Responsive evidence: `mobile-final.png`, `mobile-lower-final.png`, `tablet-final.png`. The lower mobile capture shows the fixed header, readable holder conditions, formula and evidence disclosure.
- Early `desktop-initial.png` / `comparison-initial.png` were captured before the expanded state painted and while the source refresh failed. They are not treated as a valid fidelity comparison or a design iteration.

1. **P2 — small table/detail type and loose detail rhythm.** `comparison-revised.png` showed smaller numeric and supporting type than the source. Primary table values were raised to 14 px, growth text to 12 px, detail labels to 14 px, explanatory text to 13 px and title to 18 px. Market/holder padding was reduced while retaining the three horizontal bands. Rechecked in the final full and focused comparisons.
2. **P2 — coverage icon wrapped onto its own line.** The first rendered coverage summary broke its inline control. It now uses an explicit inline flex row; final desktop/mobile captures show counts and the information icon together.
3. **P2 — document-level mobile horizontal overflow.** After keyboard scrolling to detail, the root overflowed by 877 CSS px even though the body appeared contained. `mobile-lower-before-fix.png` and geometry measurements exposed the transformed table header escaping its static ancestor. The table scroller now establishes its containing/paint boundary. Post-fix root overflow is zero; ArrowRight scrolls the table by 80 px while document scrollX stays zero and identity/detail left edges stay fixed. `mobile-lower-final.png` is the post-fix capture.
4. **P2 — mobile freshness omitted.** A desktop-only status would hide source failures on phones. The final mobile layout has a dedicated visible collection-time/status line. This preserves the earlier product's useful data-health disclosure.
5. **P2 — small favorite hit area and redundant keyboard stops.** Favorite controls now have a 24×44 px mobile target. Numeric-cell duplicate actions leave the tab sequence; the named row button remains the keyboard disclosure control. Inline close returns focus to that row. Settings retain their focus trap and Escape return.

## Required fidelity surfaces

- **Typography:** Inter/system/Segoe UI/Malgun Gothic stack, numeric tabular figures, distinct large market values, medium growth totals and smaller explanatory labels. Native Korean wrapping is preserved. The source's exact raster font is unspecified; this is a hierarchy/layout implementation, not a claim of identical glyph rendering.
- **Spacing/layout:** full-width table, grouped period headers, sticky identity/header, inline detail with market → growth → holder bands. Wider real holder conditions and an evidence disclosure add detail height relative to the mock. Coverage counts are an intentional additional metadata line. No chart or right drawer appears in the active flow. Mobile detail becomes a two-column market grid; the table alone scrolls horizontally.
- **Color/tokens:** navy page `#0d1421`, table heading `#122238`, selected row `#142d4e`, detail `#0f2035`, blue border `#478ff0`, mint `#42e1c3` and coral `#ff8592`. Signed colors describe movement, not investment quality. Focus outlines remain visible.
- **Images/icons:** actual provider token logos are used, including the AERO logo seen in the source; they render cleanly at desktop/mobile sizes. The existing typographic V brand and Lucide control family remain. No dashboard screenshot is used as a page background.
- **Copy/content:** P/R/P/HR periods, numerator and source state are explicit. The real AERO missing-period state replaces the mock's invented complete data. Conditional lock/voter return, provider references and completed UTC dates remain visible. “0 유지”, zero-to-positive and missing comparison are distinct. Current-price time and revenue-day end are separate. CMC is the verified market link and DefiLlama the fallback.

## Interaction and runtime verification

- Search covers the full 7,123-row directory. UI page 2 shows 101–200; a subsequent AERO search resets to 1–3. Full server replay covered every row exactly once.
- Both growth and holder filters at 7 days return 23 rows in the observation. Revenue delta sorting selects the expected period/direction; fixtures independently verify percent-vs-dollar order.
- Favorites and keyboard-reordered columns survive reload. Default column reset preserves favorites; the temporary QA favorite was removed afterward. Existing storage keys are unchanged.
- CMC link resolves to `https://coinmarketcap.com/currencies/aerodrome-finance/`. Unit tests cover the DefiLlama fallback and absence of symbol-only URLs.
- FDV selection changes the numerator and its coverage (148 distinct FDV rows in the browser observation); missing FDV never substitutes market cap. MCap was restored after testing.
- Empty search shows the explicit no-results state and recovers on a valid search. Loading retains the previous result with a busy state; collection failure retains data with a retry notice.
- Keyboard reorder, dialog Escape/focus return, inline disclosure and scroll confinement were exercised. The window-following header measures at y=0 after scrolling. Desktop and responsive root horizontal overflow measure zero.
- Browser warning/error logs are empty in the production-preview tab. Earlier dev-cache errors were resolved by bounded chunks and returning a fresh build directly; cold-process/no-cache readback and cache eviction tests pass.
- 214 application tests, six deployment-contract probes, TypeScript and production build passed. Final HTML/default API/targeted VVV API pass the production readback inspector against localhost; no live deployment or field-validation claim is made.

## Checklist and acceptable differences

- [x] Table and inline detail match the selected structural direction.
- [x] Real missing-data states preserve the financial contract.
- [x] Combined filters, page/search flow, saved preferences and links work.
- [x] Mobile/tablet/desktop layout and keyboard behavior verified.
- [x] Final post-typography capture compared and mobile freshness confirmed.

Accepted differences: live content vs synthetic mock numbers; provider collection status and coverage metadata; evidence disclosure; native page controls for thousands of rows. The source contains no mobile specification, so responsive arrangements are implementation choices. No P3 follow-up is required for handoff.
