# V6 economic scope and regression contract

Version: `research-v6-fundamental-scope`. This supersedes the v3/v4/v5 numerical and history assumptions wherever they conflict. V5 production receipts remain historical evidence, not current requirements.

## Incident and correction

Venice's DefiLlama Revenue and Fees both measure VVV buy-and-burn, excluding off-chain subscription, API and credit/DIEM sales. The previous generic P/S label, business-growth signals and inferred 100% holder/revenue share misrepresented this denominator. Arithmetic was not the root error. See the [Venice methodology](https://defillama.com/protocol/venice), [adapter](https://github.com/DefiLlama/dimension-adapters/blob/master/fees/venice/index.ts), and [provider definitions](https://docs.llama.fi/analysts/data-definitions).

## Definitions travel with amounts

`CoinRaw.fundamentals` contains source definitions, component slugs, source links, review date/status, economic kinds, denominator-scope review and fingerprints. The registry in `lib/fundamentalDefinitions.json` records exact reviewed Revenue, Fees, HoldersRevenue, ProtocolRevenue, SupplySideRevenue and UserFees strings. Whitespace is normalized; new, missing or changed definitions receive no automatic classification. The reviewed set initially covers 302 source components, including explicitly unresolved kinds. Review is a source-methodology assessment, not financial audit or transaction-by-transaction verification.

Revenue kinds are `protocol_revenue`, `service_sales`, `holder_return`, `trading_pnl`, `mixed`, and `unknown`. Fees separately distinguish user fees, asset yield, holder return, mixed and unknown amounts. Never substitute Fees for sales or infer meaning from numerical equality. A protocol-retained fee is not automatically whole-company sales or net profit. A token's market capitalization/FDV is not company equity value.

Every non-doublecounted child participates in parent scope, including zero and missing contributors. Duplicate children or an unknown constituent quarantine the parent; different economic kinds produce mixed scope. Signed finite amounts are retained. A missing component makes the corresponding period incomplete; it is never silently zero-filled or dropped from the holder component list.

## Multiples, signals and scores

- `researchMultiple` / `multiples.revenueMultiple` replaces generic P/S. Formula: current circulating token capitalization / (typed amount × 365 / days). Positive amounts and verified token identity are required. FDV stays separate.
- Dated history is used when present. Its source-definition fingerprint must match the independently fetched current definitions. A mismatch withholds multiples and period growth. Overview-only fallback is labeled provider rolling; records and ranking groups distinguish it from completed UTC periods.
- Unknown and mixed definitions have no multiple. Amount sorting groups by kind and window basis; numeric reference highlighting and range filtering require one selected kind. The default reference value is a user convenience, not a validated investment threshold.
- Business growth uses only reviewed protocol revenue/service sales or reviewed user fees. Holder-return amounts and estimated PnL do not become business-revenue growth. Holder signals remain separately observable.
- Experimental scoring receives a separate sanitized input: non-business Revenue, non-user Fees and incompatible history do not earn business points, yield points or activity credit. Revenue peer comparisons use the same sector, kind and window basis. Known holder-return flows retain their own holder points without being counted again as sales or user fees.
- Holder-share ratios require explicit denominator-scope review, matching component sets, and the same provider rolling 30-day window. No fallback to Fees. Numerical equality alone is never a 100% distribution claim. Overtime is a reviewed full-fee-distribution regression fixture; Venice is a buyback/burn-alias exclusion fixture. Unreviewed coverage removes only the share bonus, preserving known holder-flow evidence.
- Cashflow attention ranking uses eligible holder amounts only, with market-cap and flow ranks taken from the same universe. The former arbitrary 25% of fees fallback is removed.

## Annual coverage and observations

Provider `total1y` can contain fewer than 365 reported days. Raw one-year fields remain available as unverified-coverage provider amounts, never automatically as TTM or a persistence-score denominator. Annual run rates use the same 30-day period for all children. Only complete dated 365/365 history supports a one-year multiple and persistence comparison; the 30-day comparison uses 365/30, not an assumed 12 equal months. Holder `currentVsEligibleTtmRatio` remains null until a dated complete holder series exists.

Browser snapshot schema 2 records economic-definition and window-basis fingerprints. Old records are retained, but numerical comparison requires schema 2, identical rule version, token identity, definition and basis. This guard applies both to acknowledged-baseline deltas and the historical detail table. Browser exports include the full current definition evidence; routine local history keeps compact fingerprints. The acknowledged baseline is preserved until the user explicitly moves it.

## Enforcement and maintenance

`fundamentalErrors` validates server-generated snapshots and browser refresh responses. The release gate checks all rows for unreviewed comparisons and specifically checks VVV. Snapshot receipts hash the classification registry, source assembly, historical windows and calculation rules. The response remains below Vercel's 4.5 MB limit; definition evidence must not be silently discarded to regain coverage or payload size.

When a definition is new/changed, inspect source methodology and adapter, determine recipient, gross/net boundary, payment/burn timing and component coverage, then update the exact registry entry and add a representative regression. Never approve a definition merely to restore a ratio. Update rule version when formula/meaning changes, and retain original snapshots for reproducibility.

The registry detects published methodology changes. An upstream implementation change that leaves all published definitions unchanged, or incorrect source amounts, still requires an adapter/source audit. The application does not independently attest all provider transactions. This limitation must remain explicit in future reports.
