import { assembleScreener } from "./screener";
import { sample } from "./testFixtures";
import type { ScreenerResponse } from "./types";
import type { PublishedSnapshot } from "./publicationTypes";
const at = "2026-10-19T04:43:36.422Z";
export const tableFixture = (count = 151) => assembleScreener(Array.from({ length: count }, (_, i) => sample({ slug: `coin-${String(i).padStart(3, "0")}`, name: `Coin ${i}`, geckoId: `token-${i}`, cmcId: i + 1,
  category: i % 2 ? "Dexs" : "Lending", identityStatus: i % 7 ? "verified" : "review", capitalExclusionReason: i % 13 ? null : "stablecoin", mcap: i % 11 ? (i + 1) * 1000000 : null, fdv: i % 5 ? (i + 1) * 2000000 : null,
  revenue24h: i % 4 ? i * 123 : null, revenue7d: i % 3 ? i * 1000 : null, revenue30d: [null, 0, -500, 100, 10000, 100000][i % 6], revenue1y: i % 3 ? i * 1000000 : null,
  holderHistory: null, holderValue: { rawCurrent30d: i % 3 ? i * 100 : null, rawTtm: i % 4 ? i * 10000 : 0 },
  ...(i % 17 === 0 ? { revenueSource: { url: "https://api.llama.fi/overview/fees", observedAt: at, periods: { 30: { total: 50, reported: 1, expected: 2 } } } } : {}),
})), at, []);
export const tableReference = (data: ScreenerResponse, id = "data-table-test", sha = "a".repeat(64)): PublishedSnapshot => ({ id, sha256: sha, dataAt: data.updatedAt, url: `https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${id}/snapshot.json.gz`, validatedAt: data.updatedAt, publishedAt: data.updatedAt, codeCommit: "test", reportUrl: "", witnessUrl: "", witnessSha256: "b".repeat(64) });

