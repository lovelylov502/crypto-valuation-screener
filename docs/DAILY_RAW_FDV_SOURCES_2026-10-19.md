# Free historical FDV source verification — 2026-10-19

The attainable free source is the official [Coin Metrics Community API](https://docs.coinmetrics.io/api/v4/). Its dated ledger supply enables a limited, explicitly verified total-supply valuation. It does not provide a universal history of CoinGecko/CMC maximum-supply or burn-adjusted FDV.

## Acquired evidence and accepted coverage

The acquisition completed without an account, API key, paid plan, or database writes. It retained original response bodies with SHA-256 hashes, HTTP status, request/observation times, URL, and relevant response headers. There are 20 distinct Coin Metrics histories attached to 23 verified current screener assets. All 20 dated supply histories remain available for audit. Only six reviewed token identities produce importable FDV: 12,995 observations, with zero contradictory capitalization observations in that accepted subset.

| Current screener asset | CM asset | Accepted FDV dates | Observations | Full issuance checked against each dated supply |
| --- | --- | --- | ---: | ---: |
| Aave | `aave` | 2020-10-10–2026-10-18 | 2,200 | 16,000,000 |
| Compound Finance | `comp` | 2020-06-18–2026-10-18 | 2,314 | 10,000,000 |
| Chainlink | `link` | 2017-09-29–2026-10-18 | 3,307 | 1,000,000,000 |
| Lido | `ldo` | 2021-09-11–2026-10-18, with the gap below | 1,820 | 1,000,000,000 |
| 1inch | `1inch` | 2020-12-26–2024-06-18 | 1,271 | 1,500,000,000 |
| Perpetual Protocol | `perp` | 2021-02-04–2026-10-18 | 2,083 | 150,000,000 |

Missing or mismatched dates stay absent. In particular:

- Lido's recorded issued supply is 996,308,500 on 2022-03-23–2022-05-05. Those 44 dates do not satisfy the reviewed full-issuance basis and are withheld.
- From 2024-06-19, Coin Metrics records 1,499,999,999.997 1INCH. The 0.003 difference from the reviewed 1.5 billion maximum is retained in the original data; strict FDV compatibility withholds those dates.
- PERP price observations begin later than its supply observations. Supply alone does not create an earlier valuation.
- Current Maker's canonical token is SKY. Historical MKR data is not spliced into that identity.
- UNI, YFI and GNO have issued-supply/burn-adjusted-supply discrepancies. CRV and BAL have issued versus future maximum supply differences. Their acquired issued supply is not imported as ordinary FDV.

The reviewed issuance references include the official [AAVE initialization code](https://github.com/aave/aave-token/blob/master/contracts/token/AaveToken.sol), [COMP token code](https://github.com/compound-finance/compound-protocol/blob/master/contracts/Governance/Comp.sol), [LINK token code](https://github.com/smartcontractkit/LinkToken/blob/master/contracts/v0.4/LinkToken.sol), and [1INCH token code](https://github.com/1inch/1inch-token/blob/master/contracts/OneInch.sol). Lido's [production deployment metadata](https://github.com/lidofinance/lido-dao/blob/master/deployed-mainnet.json) identifies its token, and its [official contributor vesting proposal](https://research.lido.fi/t/enable-a-dedicated-vesting-contract-to-apply-vesting-schedules-to-contributors-ldo-tokens/11017) states the 1 billion supply. Perpetual's [production metadata](https://github.com/perpetual-protocol/perpetual-protocol/blob/master/metadata/production.json) identifies its Ethereum token. The retained CMC originals provide the exact current token ID, chain, total/max supply convention, and contract. Historical supply still comes from each historical Coin Metrics row.

## Metric and timestamp semantics

Official [current-supply documentation](https://gitbook-docs.coinmetrics.io/network-data/network-data-overview/supply/current-supply) defines `SplyCur` as issued ledger supply at the end of an interval. This includes issued units that conventional circulating market cap excludes; it is not a future maximum supply.

Official [price documentation](https://gitbook-docs.coinmetrics.io/network-data/network-data-overview/market/price) defines daily `PriceUSD` as the UTC daily close. A row labeled `2024-01-01T00:00:00Z` describes January 1's close, measured at January 2 00:00 UTC. Import retains day January 1 and records the actual next-midnight instant in `at`. An unfinished close is rejected. `ReferenceRateUSD` uses a different timestamp convention and must not be substituted without an explicit date adjustment.

The [market-capitalization methodology](https://gitbook-docs.coinmetrics.io/network-data/network-data-overview/market/market-capitalization) distinguishes:

- `CapMrktCurUSD = SplyCur × PriceUSD`: issued-supply valuation, including illiquid/treasury supply.
- `CapMrktEstUSD`: reported circulating-supply market capitalization, sourced from third-party APIs.

The importer never treats `CapMrktCurUSD` as circulating market cap. Approved FDV uses each row's positive price and actual dated supply; it requires that supply to match the reviewed full-issuance amount and rejects a disagreement with the provider's capitalization field. Missing dated supply never falls back to a present-day constant. Source basis is `utc_daily_close_verified_total_supply`.

Coin Metrics price/mcap outputs are available to the parser for audit, but manifest import emits only approved FDV. Existing CoinGecko price/mcap observations have their own timestamp convention and provenance.

## Endpoints, entitlement and exact identity

All acquisition requests use `https://community-api.coinmetrics.io/v4`:

```text
GET /catalog/asset-metrics
GET /reference-data/markets?exchange=uniswap_v2_eth&page_size=10000
GET /reference-data/markets?exchange=uniswap_v3_eth&page_size=10000
GET /reference-data/markets?exchange=sushiswap_v1_eth&page_size=10000
GET /timeseries/asset-metrics?assets=aave&metrics=PriceUSD,SplyCur,CapMrktCurUSD,CapMrktEstUSD&frequency=1d&page_size=10000&paging_from=start&end_time=2026-10-18
```

Omitting `start_time` requests all available history. Follow the provider's `next_page_url` on the same public origin, preserving the exact asset. An actual AAVE response contained 2,208 rows, of which 2,200 contained an approved price/supply pair. The collector requests at most once per second and stops on HTTP 401/403/429; it persists a 24-hour permission cooldown or the provider's Retry-After. It does not try another endpoint to evade a denial.

The live free catalog contained 139 assets with daily `SplyCur`; 135 also had daily `PriceUSD`. `/catalog-all/asset-metrics` includes premium coverage and cannot establish free entitlement. For example, JUP's Solana supply appeared in the all-catalog but a public supply request returned HTTP 403. SOL's free response contains price/circulating market cap, without supply. INDEX, AERO, GMX, HYPE and VVV did not have a free dated issued-supply route in this catalog.

Identity does not depend on ticker/name matching. The official [DEX metadata documentation](https://gitbook-docs.coinmetrics.io/network-data/defi-data-overview/decentralized-exchange-data) defines `base_address`/`quote_address` as ERC-20 token contracts. A Coin Metrics asset must map uniquely through an Ethereum DEX token contract to the retained CMC record's exact ID, Ethereum platform and contract, then agree with the current verified screener identity/address. Native ETH/BTC use explicit chain identities and CMC IDs; their issued supply is acquired for audit, without approving it as maximum-supply FDV. The loader rebuilds these bindings from hash-verified proof originals, rather than trusting stored approval flags.

## Reproduction and original archive

```text
npx --no-install tsx scripts/acquire-daily-raw-coinmetrics.ts --cache <outside-Git-directory>/coinmetrics --snapshot <verified-snapshot.json.gz> --bundle <verified-source-bundle.json.gz>
```

`manifest.json` is resumable and tied to the input publication hashes. Its `originals/` directory contains complete responses; `requests/` retains request checkpoints. The current acquisition used snapshot SHA-256 `2f0a6d9e4a2ee1337b3fcfd63ec18a6683c41d7d448567a91281196044a23278` and source-bundle SHA-256 `046b4ff29a3ee1cdcf46c8eb42acd7e59a134091f168908d1a9defd146d8d9bd`.

`loadCoinMetricsManifest(manifestPath, dirname(manifestPath), currentCoins)` verifies original hashes, cache confinement, official proof endpoints, identity, daily measurement times, duplicates, and the approved supply convention. Its output matches the daily raw store's asset/source/point contract. It does not write to the database.

The official [GitHub CSV archive](https://github.com/coinmetrics/data) is useful for independent inspection, but its sampled files stopped in May 2026 while the live public API reached October 18. The acquisition uses the live API rather than assuming that repository is current.

## Other checked free surfaces and use terms

- CoinGecko's public historical website export provides full price/circulating-market-cap/volume history. The tested INDEX export had 2,204 rows from 2020-10-07 to 2026-10-19, without FDV. Its free API market chart is limited to 365 days and likewise lacks FDV. See [CoinGecko market chart](https://docs.coingecko.com/demo/reference/coins-id-market-chart).
- CoinPaprika's [free daily history](https://coinpaprika.com/api/pricing/) covers one year for 2,000 assets and returns price, volume and market cap. It does not supply the dated total/max supply needed here.
- CoinMarketCap's documented [keyless routes](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api) include current token supply/FDV. Historical per-token quote/listing routes are outside that keyless set; a new account was not created.
- DefiLlama's public protocol page can display an FDV chart, but the inspected CSV action requires Pro and its historical supply methodology was not established. No gated export or undocumented paid route was used. Its [free API inventory](https://github.com/DefiLlama/api-docs/blob/main/llms-free.txt) provides dated token prices, without a general dated total/max supply series.

Coin Metrics Community data is [CC BY-NC 4.0](https://gitbook-docs.coinmetrics.io/packages/coin-metrics-community-data). Attribution and the noncommercial restriction apply; this verification does not establish commercial redistribution permission. That limitation is part of the source decision, separately from technical availability.

Local verification: nine provider tests, TypeScript typecheck, and a full offline manifest replay against the actual verified snapshot. Accepted results cover the six identities above. Database import, remote archive publication and production readback are separate operations.

## Rejection of contradictory captured FDV

A captured provider response can contain an internally inconsistent positive FDV. The daily raw rejection gate checks the selected asset ID, provider, original HTTP receipt observation time, provider quote timestamp and reported FDV before comparing any amounts. Price and maximum supply must come from that same provider record. It never combines a CoinGecko FDV with a CMC price or maximum.

For a positive finite recorded maximum, the gate rejects FDV above `price * max_supply + max(1 USD, 1% of price * max_supply)`. The allowance covers independently rounded provider quote fields. The product is an upper-bound check and is never stored as replacement FDV. A missing, zero or unlimited maximum makes the anomaly bound unavailable; an exactly verified provider-reported FDV remains eligible. Total supply is retained for audit and never substituted for a maximum. Claims without an exact original quote have a separate primary-evidence hold policy below.

For example, the [2026-10-11 original source bundle](https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-38181139846-1-complete/source-bundle.json.gz) has SHA-256 `228724bdf2d546c0c81d9077b8bdb29ee72c5b722b2c4887b1498fd31a0bc645`. Its selected CoinGecko LINQ receipt has SHA-256 `05a33a3ceffc71ba059150ce2be2a1fdf13c7512929ac6533cfb628bb3f143f0`, observed at `2026-10-11T22:40:20.574Z`. The same record reports price `0.01329411`, maximum supply `1,000,000,000`, and FDV `1.3291053084725983e25`. That FDV exceeds the same-record bound by about 10^18 times and is withheld. The raw response remains preserved.

```text
npx --no-install tsx --use-system-ca scripts/validate-daily-raw-fdv.ts --cache <outside-Git-directory>
```

The audit reads the 28 hash-pinned legacy snapshots, their pinned original source bundles and the current reference. It writes a separate `fdv-validation-manifest.json`; it does not edit the legacy manifest or a sealed database. Each rejection identifies the asset, UTC day and original source, with the original snapshot, bundle and receipt hashes. `loadVerifiedFdvValidationManifest` re-verifies those cached originals and regenerates the claimed contradictions before collection applies them. Rejecting an FDV preserves independent price, market cap and financial observations, including any independently verified valid FDV alternative.

The completed audit found original bundle pins for 24 snapshots. Among 20,598 legacy observations with accessible originals, 15,789 passed the bound, 4,654 had an unavailable price/maximum bound, 70 lacked an exact matching quote timestamp, and 85 proved contradictions. Those 85 observations span 18 screener entries and 17 token identities. The current reference contributes eight rejected observations. All 85 rejections were independently regenerated from the originals before freezing the correction input. LINQ loses its nine contradictory observations from October 11–19. Its earlier CMC amounts have no bound contradiction, but four older captures are subject to the separate primary-evidence holds.

## Primary-evidence holds and explicit retraction

An additional explicit quality review holds CoinGecko captured FDV for `gecko:snowbank` pending a supply-basis review. The [committed review record](../lib/dailyRawFdvReview.ts) pins all nine snapshots, original bundles and nested receipts from October 11–19. October 11's reported FDV is about one billion times the same record's price multiplied by total supply. From October 12 onward the reported total supply is exactly one billion times circulating supply, and FDV follows that scaled total. All nine records have `max_supply:null`; this is a separate quality hold, not a positive-maximum rejection. No replacement FDV is calculated. Current and future captured CoinGecko FDV for that exact identity stays null/conflict until the review is explicitly cleared. Existing positive cells are retracted through the same proof-matched, predecessor-checked correction path below. Other metrics, other providers and independently verified dated-supply closes retain their existing rules.

`fdv-holds-initial-manifest.json` holds 4,550 legacy claims independently of the 85 numerical contradictions. Four pre-pipeline snapshot releases contain no original provider bundle: their 4,480 FDVs are confirmed only in normalized snapshots and are withheld pending primary evidence. The releases' optional `inputs.json.gz` contains normalized coins; their `witness.json.gz` covers DefiLlama universe/financial records, without original market quotes.

The remaining 70 holds cover 13 screener entries on October 5–10. All 70 FDV amounts match their original provider records, but the normalized snapshot assigned a different quote timestamp. In 49 cases the actual quote remains on the same UTC day; these could support a separately reviewed timestamp repair. In 21 cases the actual quote belongs to another day and can be about 70 days old. This pass withholds all 70 and never moves their dates. The old capture dates also include a few quotes from the preceding UTC day; each hold retains the exact original asset/day/value/source tuple.

The current reference has one additional mixed-provider timestamp claim: Overnight Finance FDV comes from a CMC quote at `2026-10-19T10:50:00Z`, while the preferred Gecko price has timestamp `2026-10-19T10:53:58Z`. Fresh snapshot collection already excludes that FDV through its provider-time guard. The correction scan also checks whether an existing imported cell contains that exact claim.

```text
npx --no-install tsx scripts/validate-daily-raw-fdv-holds.ts --cache <outside-Git-directory>
npx --no-install tsx scripts/apply-daily-raw-fdv-holds.ts --cache <outside-Git-directory> --run-id <stable-correction-id> --max-estimated-writes <8-to-50000>
```

The correction command defaults to a read-only plan and verifies both proof manifests against their original hashes before connecting to the database. Writing requires `--apply`. A nonempty apply runs the existing additive schema migration so older pilot tables receive the accounting column before a new weighted run opens. Dry runs and completed zero-candidate reruns do not migrate tables. Only positive captured FDV with the exact proof-matched source, provider, observation time, amount and quote time is eligible. An atomic predecessor check prevents a concurrent replacement from being changed. The command writes an explicit null/conflict revision, with `revisionOf` pointing to the old immutable source and the proof hash in its basis. Original values and sources remain in the revision log; price, market cap, financial cells and verified Coin Metrics closes remain intact. A completed rerun finds no positive candidates and writes zero days. The old sealed staging database is never edited.
