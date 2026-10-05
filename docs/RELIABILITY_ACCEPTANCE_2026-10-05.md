# Data engine redesign acceptance — 2026-10-05

## Decision and failure mechanism

The active writer now accepts reproducible current source evidence under identity, financial and completeness contracts. It no longer requires a growing list of dated loss exceptions against the last successful snapshot. Before migration, one unreviewed WBTC daily-history loss blocked the entire universe while Sat Rush had newer source data; an already-started failed slot could also suppress subsequent collection.

The existing economic classification, identity rules, financial formulas, table and preference storage were retained. Transport/evidence capture, candidate acceptance, local failure accounting, publication verification and retry state were replaced or separated. The current contracts are [ARCHITECTURE.md](./ARCHITECTURE.md), [PUBLICATION.md](./PUBLICATION.md) and [DEPLOYMENT.md](./DEPLOYMENT.md).

## Executed verification

- Implementation commit: `78a6298f5f54a5d881efc1c543b9dee8d16f7b13`.
- 453 tests in 43 files, six deployment guard tests, TypeScript and production build passed from canonical main.
- Full-worklist shadow: 7,194 rows, 1,574 original response receipts, 260.49 seconds, peak resident memory approximately 2.45 GB, 33,831,854 compressed raw bytes. No fixed request-count quota remains.
- The shadow's raw bundle SHA-256 was `0fb073603c2a781dbf966537c261dc3ff7e422211c843742bc1ecb3acc5dc530`. Separate-process offline replay reproduced normalized/output hashes exactly. Subsequent bounded 429 backoff changes also passed the full test suite.
- Independent adversarial review covered missing alternative quote IDs, malformed numeric values, malformed/duplicate census identities, conflicting daily values, arbitrary worklist truncation, replay tampering, lost required-source 503 evidence, final report/witness binding, and compressed artifact hash stability. Findings were corrected and covered by regression tests.
- The reviewer found no remaining reason to replace the architecture. This is a scoped review conclusion, not a guarantee about future provider or infrastructure failures.

## Source conflicts remain explicit

All 47 value-conflict observations in the full-worklist shadow concerned October 4, 2026. AERO's parent reported 151,001 USD while its three components summed to 141,790 USD. The responses did not provide trustworthy generation timestamps that could resolve the 9,211 USD difference. Current periods all included that disputed day, so affected calculations remained withheld. Other rows advanced normally.

The current conservative implementation also withholds unaffected historical comparison periods when that metric has a conflict. Preserving those periods by carrying exact conflict dates is a possible incremental improvement; it does not supply a valid current AERO value. No arbitrary tolerance or unproven source preference was introduced.

## Operational proof

Production deployment: `dpl_FxyVjEpkkyPyPTm4tsUFwuVVmRqP`, [immutable deployment](https://crypto-valuation-screener-l1zy1yo7t-bodycation.vercel.app). The guarded deployment passed and the canonical alias served the new reader while preserving the old verified archive during migration.

Manual recovery [run 37258630562](https://github.com/lovelylov502/crypto-valuation-screener/actions/runs/37258630562) completed successfully. Source collection ran from 03:14:58 to 03:19:42 UTC; archive publication completed at 03:20:19 UTC. Public snapshot `data-37258630562-1-complete` has data time `2026-10-05T03:14:59.728Z` (12:14 KST). Its [permanent report](https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-37258630562-1-complete/report.json) and [state](https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-37258630562-1-complete/state.json) retain the provenance.

The final canonical audit completed at 03:23:46 UTC with `currentCollectionPassed=true`, `mode=current-publication-and-source-replay`, `stale=false`, `errors=[]` and `sourceFailures=[]`. It compared all 7,194 API rows with the published archive and independently replayed 1,381 original receipts on Windows from the Linux collector's exact compressed artifact.

| Proof | SHA-256 |
| --- | --- |
| Published data | `dec6c4a8ba408a52c001b1da55369d95be756748c1237bec50f4d6509aa109d9` |
| Original response bundle | `6ad643bcf6eb0072536f9a1de6af30024426065810ec0a2208e3ff5067c0fe21` |
| Normalized rows | `ef6056cf67958203bac72582c661bf542f264b940a78bea8f4fb63a68c914c37` |
| Output | `3ab03df658a9599d8bff870a16fbaf8a4e1efb3c81025ce0437473959776bcb7` |

All 1,614 source rows with 30-day Revenue were displayed. Quote coverage accounted for every requested CoinGecko/CMC ID, with zero failed quote requests. The 58 affected projects / 83 remaining issues were nonretryable supplementary scope mismatches. The earlier shadow's date conflicts did not persist in this new capture; no tolerance or exception was added to make them pass.

Sat Rush now shows completed October 4 Revenue of 5,044 USD, rather than the previous October 2 observation. WBTC's explicit October 4 zero is retained with its unapproved P/R still unavailable. AERO's current completed-day revenue is 151,001 USD with complete quality and eligible P/R restored from consistent captured evidence.

The final journal settled the 02:00 UTC slot, recorded one manual repair separately, cleared the prior global incident and retained the previous journal chain. Automatic duplicates are suppressed; a remaining explicit repair remains possible. This execution contributes **zero** natural scheduled acceptance runs.

Browser verification used the canonical alias's existing refresh action: the old October 4 collection changed to October 5 12:14 KST, universe counts updated, and the Sat Rush detail showed October 4 UTC amounts. The existing market-cap numerator, 100-row page size and selected columns were preserved. Final browser checks and owner-file preservation were recorded locally.

## Scheduled acceptance

Long-term acceptance remains pending until at least 72 hours of the new implementation include six successful naturally triggered collection slots, two UTC date transitions and no unresolved overdue slot. Verify actual signed/scheduled trigger evidence and the run's code commit; skipped workflows and manual repairs never count. Legitimate, nonretryable row-level source holds remain disclosed and do not invalidate otherwise verified current publication.

The existing Codex observation automation was paused before this work and was not resumed. Application schedules and durable publication journals continue independently. Original response bundles and reports remain in immutable release assets; local shadow/deployment evidence is stored outside Git under `C:\Users\TAE\Documents\Codex\2026-10-05\tovenit-data-engine`.
