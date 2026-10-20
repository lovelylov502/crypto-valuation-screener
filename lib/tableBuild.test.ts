import { afterEach, beforeEach, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { initializeDailyRaw, openDailyRawRun } from "./dailyRawDatabase";
import { initializeDailyReadModels, readDailyReadModels, decodeDailyReadModel, writeDailyReadModel } from "./dailyReadModelDatabase";
import { prepareTableReadModel } from "./tableBuild";
import { TABLE_CATALOG_NAMESPACE, TABLE_DETAIL_NAMESPACE, buildTableCatalog, type TableCatalog } from "./tableCatalog";
import { tableFixture, tableReference } from "./tableTestFixtures";

let db: Client;
const now = new Date("2026-10-20T12:00:00Z");
beforeEach(async () => { db = createClient({ url: ":memory:" }); await initializeDailyRaw(db); await initializeDailyReadModels(db); await openDailyRawRun(db, { id: "table", maxEstimatedWrites: 10000, now }); });
afterEach(() => db.close());
it("publishes complete shards before their exact catalog, charges shared budget, and skips unchanged writes", async () => {
  const data = tableFixture(101), reference = tableReference(data), before = Number((await db.execute("SELECT reserved FROM history_budget")).rows[0].reserved);
  const result = await prepareTableReadModel(db, { data, reference, runId: "table", now }); expect(result).toMatchObject({ shards: 2, changed: 3, estimatedWrites: 15 });
  expect(Number((await db.execute("SELECT reserved FROM history_budget")).rows[0].reserved) - before).toBe(15);
  const [stored] = await readDailyReadModels(db, { namespace: TABLE_CATALOG_NAMESPACE, keys: [reference.id] }), catalog = decodeDailyReadModel<TableCatalog>(stored);
  expect(catalog.snapshotSha256).toBe(reference.sha256); expect(catalog.entries).toHaveLength(101);
  expect(await prepareTableReadModel(db, { data, reference, runId: "table", now })).toMatchObject({ changed: 0, estimatedWrites: 0 });
});
it("a paused build cannot publish a manifest for incomplete shards or remove the previous generation", async () => {
  const data = tableFixture(1), reference = tableReference(data); await prepareTableReadModel(db, { data, reference, runId: "table", now });
  await openDailyRawRun(db, { id: "tiny", maxEstimatedWrites: 13, now });
  const next = tableFixture(201), nextRef = tableReference(next, "data-second", "c".repeat(64));
  await expect(prepareTableReadModel(db, { data: next, reference: nextRef, runId: "tiny", now })).rejects.toThrow("budget");
  expect(await readDailyReadModels(db, { namespace: TABLE_CATALOG_NAMESPACE, keys: [nextRef.id] })).toEqual([]);
  expect(await readDailyReadModels(db, { namespace: TABLE_CATALOG_NAMESPACE, keys: [reference.id] })).toHaveLength(1);
});
it("retains current and previous catalogs, keeps their shared shards, and removes only old unreferenced prepared data", async () => {
  const old = new Date("2026-10-16T12:00:00Z"), data = tableFixture(1), first = tableReference(data, "data-first");
  const initial = buildTableCatalog(data, first), firstHash = initial.catalog.entries[0].detail.shard;
  await prepareTableReadModel(db, { data, reference: first, runId: "table", now: old });
  await writeDailyReadModel(db, { runId: "table", namespace: TABLE_DETAIL_NAMESPACE, key: "f".repeat(64), revision: "f".repeat(64), json: { unused: true }, metadata: {}, now: old });
  const second = { ...data, updatedAt: "2026-10-20T01:00:00Z" }; await prepareTableReadModel(db, { data: second, reference: tableReference(second, "data-second", "c".repeat(64)), runId: "table", now });
  const third = structuredClone(second); third.updatedAt = "2026-10-20T03:00:00Z"; third.coins[0].name = "New name";
  const result = await prepareTableReadModel(db, { data: third, reference: tableReference(third, "data-third", "d".repeat(64)), runId: "table", now });
  expect(result.deleted).toBe(1); // first catalog; its unchanged shard is still referenced by second
  expect(await readDailyReadModels(db, { namespace: TABLE_DETAIL_NAMESPACE, keys: [firstHash] })).toHaveLength(1);
  expect(await readDailyReadModels(db, { namespace: TABLE_CATALOG_NAMESPACE, keys: ["data-first"] })).toEqual([]);
  expect(await readDailyReadModels(db, { namespace: TABLE_CATALOG_NAMESPACE, keys: ["data-second", "data-third"] })).toHaveLength(2);
  expect(await readDailyReadModels(db, { namespace: TABLE_DETAIL_NAMESPACE, keys: ["f".repeat(64)] })).toEqual([]);
});
it("pins a verified rollback target instead of deleting it for having an older source date", async () => {
  const base = tableFixture(1), snapshots = ["2026-10-17T04:00:00Z", "2026-10-18T04:00:00Z", "2026-10-19T04:00:00Z"].map((updatedAt, i) => { const data = structuredClone(base); data.updatedAt = updatedAt; data.coins[0].name = `Generation ${i}`; return { data, reference: tableReference(data, `data-ref-${i}`, String(i + 1).repeat(64)) }; });
  for (const snapshot of snapshots) await prepareTableReadModel(db, { ...snapshot, runId: "table", now });
  expect(await readDailyReadModels(db, { namespace: TABLE_CATALOG_NAMESPACE, keys: ["data-ref-0"] })).toEqual([]);
  const restored = snapshots[0]; await prepareTableReadModel(db, { ...restored, runId: "table", now });
  const kept = await readDailyReadModels(db, { namespace: TABLE_CATALOG_NAMESPACE, keys: snapshots.map(snapshot => snapshot.reference.id) });
  expect(kept.map(row => row.key).sort()).toEqual(["data-ref-0", "data-ref-2"]);
  const catalog = decodeDailyReadModel<TableCatalog>(kept.find(row => row.key === "data-ref-0")!);
  expect(await readDailyReadModels(db, { namespace: TABLE_DETAIL_NAMESPACE, keys: [catalog.entries[0].detail.shard] })).toHaveLength(1);
});

