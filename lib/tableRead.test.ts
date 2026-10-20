import { beforeEach, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { buildTableCatalog, TABLE_CATALOG_NAMESPACE, TABLE_DETAIL_NAMESPACE, tableHash } from "./tableCatalog";
import { tableFixture, tableReference } from "./tableTestFixtures";
import { canonicalReadModelJSON, type DailyReadModel } from "./dailyReadModelDatabase";
import { defaultPreferences } from "./workspacePreferences";
import type { PublicationJournal } from "./publicationTypes";

const mocks = vi.hoisted(() => ({ publication: vi.fn(), screener: vi.fn(), read: vi.fn(), comparison: vi.fn(), close: vi.fn() }));
vi.mock("./serverScreener", () => ({ getPublication: mocks.publication, getScreener: mocks.screener, publicPublication: (value: unknown) => value }));
vi.mock("./historyDatabase", async original => ({ ...await original<typeof import("./historyDatabase")>(), connectHistory: () => ({ close: mocks.close }) }));
vi.mock("./dailyReadModelDatabase", async original => ({ ...await original<typeof import("./dailyReadModelDatabase")>(), readDailyReadModels: mocks.read }));
vi.mock("./dailyValuationPrepared", () => ({ readPreparedDailyComparisonBatch: mocks.comparison }));
const row = (key: string, revision: string, json: unknown): DailyReadModel => ({ key, revision, sha256: tableHash(json), payload: gzipSync(canonicalReadModelJSON(json)), metadata: {}, builtAt: "2026-10-20T10:00:00Z" });
let data: ReturnType<typeof tableFixture>, publication: PublicationJournal, models: Map<string, DailyReadModel>;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); data = tableFixture(3); const reference = tableReference(data);
  publication = { published: reference } as PublicationJournal; const built = buildTableCatalog(data, reference);
  models = new Map([[`${TABLE_CATALOG_NAMESPACE}:${reference.id}`, row(reference.id, reference.sha256, built.catalog)], ...[...built.shards].map(([hash, shard]) => [`${TABLE_DETAIL_NAMESPACE}:${hash}`, row(hash, hash, shard)] as const)]);
  mocks.publication.mockImplementation(async () => publication); mocks.screener.mockImplementation(async () => ({ ...data, publication }));
  mocks.read.mockImplementation(async (_db: unknown, options: { namespace: string; keys: string[] }) => options.keys.flatMap(key => models.get(`${options.namespace}:${key}`) ? [models.get(`${options.namespace}:${key}`)!] : []));
  mocks.comparison.mockResolvedValue({ schema: 1, capital: "mcap", revenueDays: 1, asOf: "2026-10-18", baseline: { from: "2025-10-18", to: "2026-10-17", expectedDays: 365 }, rows: {} });
});
it("reads a verified prepared catalog once for table and cheap history identity, without a full snapshot/shard fetch", async () => {
  const { readTablePage, getTableCoinContext } = await import("./tableRead"), page = await readTablePage(defaultPreferences(), [], 1, 100);
  expect(page.readModel).toBe("prepared"); expect(page.rows).toHaveLength(3); expect(mocks.screener).not.toHaveBeenCalled();
  expect(mocks.read).toHaveBeenCalledTimes(1); expect(mocks.read.mock.calls[0][1]).toEqual({ namespace: TABLE_CATALOG_NAMESPACE, keys: [publication.published!.id] });
  const context = await getTableCoinContext("coin-001"); expect(context).toEqual({ coin: { slug: "coin-001", geckoId: "token-1", cmcId: 2, identityStatus: "verified", capitalExclusionReason: null }, snapshot: { updatedAt: data.updatedAt, publication } });
  expect(await getTableCoinContext("unknown")).toBeNull(); expect(mocks.read).toHaveBeenCalledTimes(1); expect(mocks.screener).not.toHaveBeenCalled();
  expect(mocks.comparison).toHaveBeenCalledTimes(1); expect(mocks.comparison.mock.calls[0][0].coins.every((coin: object) => !("fundamentals" in coin))).toBe(true);
});
it("fetches only the selected fullcoin shard and retains every original evidence field", async () => {
  const { readTableDetail } = await import("./tableRead"), expected = data.coins.find(coin => coin.slug === "coin-001")!;
  const detail = await readTableDetail(expected.slug, publication.published!.id, "gecko:token-1");
  expect(detail).toMatchObject({ readModel: "prepared", publicationId: publication.published!.id, snapshotSha256: publication.published!.sha256, updatedAt: data.updatedAt, coin: expected });
  expect(mocks.read.mock.calls.map(call => call[1].namespace)).toEqual([TABLE_CATALOG_NAMESPACE, TABLE_DETAIL_NAMESPACE]); expect(mocks.screener).not.toHaveBeenCalled();
});
it("uses the verified original fallback when the catalog is unavailable and marks that transport explicitly", async () => {
  models.clear(); const { readTablePage, getTableCoinContext } = await import("./tableRead");
  expect(await readTablePage(defaultPreferences(), [], 1, 100)).toMatchObject({ readModel: "snapshot-fallback", publicationId: publication.published!.id }); expect(mocks.screener).toHaveBeenCalledTimes(1);
  expect((await getTableCoinContext("coin-001"))!.coin.slug).toBe("coin-001"); expect(mocks.screener).toHaveBeenCalledTimes(2);
});
it("fails closed on a foreign publication/hash catalog and never serves a stale detail under a new publication", async () => {
  const { readTablePage, readTableDetail, TablePublicationChanged } = await import("./tableRead");
  const key = `${TABLE_CATALOG_NAMESPACE}:${publication.published!.id}`, original = models.get(key)!; models.set(key, { ...original, sha256: "f".repeat(64) });
  expect((await readTablePage(defaultPreferences(), [], 1, 100)).readModel).toBe("snapshot-fallback");
  const previous = { ...publication }, oldId = publication.published!.id; publication = { ...publication, published: { ...publication.published!, id: "data-new", sha256: "d".repeat(64) } };
  mocks.screener.mockResolvedValue({ ...data, publication: previous });
  await expect(readTableDetail("coin-001", oldId, "gecko:token-1")).rejects.toBeInstanceOf(TablePublicationChanged);
});
it("rejects a changed coin identity and a corrupt fullcoin shard instead of filling evidence with placeholders", async () => {
  const { readTableDetail, TablePublicationChanged } = await import("./tableRead");
  await expect(readTableDetail("coin-001", publication.published!.id, "gecko:other")).rejects.toBeInstanceOf(TablePublicationChanged);
  const key = [...models.keys()].find(key => key.startsWith(`${TABLE_DETAIL_NAMESPACE}:`))!, stored = models.get(key)!; models.set(key, { ...stored, sha256: "f".repeat(64) });
  await expect(readTableDetail("coin-001", publication.published!.id, "gecko:token-1")).rejects.toThrow("hash_mismatch"); expect(mocks.screener).not.toHaveBeenCalled();
});
