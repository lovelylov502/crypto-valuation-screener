import { describe, expect, it } from "vitest";
import { buildTableCatalog, queryTableCatalog, tableHash } from "./tableCatalog";
import { assertTablePage, TABLE_METRICS } from "./tableDto";
import { tableFixture, tableReference } from "./tableTestFixtures";
import { queryScreener } from "./screenerQuery";
import { defaultPreferences, parseWorkspace } from "./workspacePreferences";
import { SCREENER_COLUMNS } from "./screenerColumns";
import { referenceMultiple, referenceReading, referenceReason } from "./referenceMetrics";
import { METRIC_COLUMN_DAYS, METRIC_WINDOWS } from "./metricCoverage";
import type { PublishedSnapshot, PublicationJournal } from "./publicationTypes";
import { validateTableDetail } from "./tableDetail";

const journal = (published: PublishedSnapshot) => ({ published } as PublicationJournal);

describe("explicit prepared table catalog", () => {
  it("preserves global filtering, all existing sort semantics, pagination, favorite counts and coverage", () => {
    const data = tableFixture(), { catalog } = buildTableCatalog(data, tableReference(data)), favorites = ["coin-003", "coin-099", "absent"];
    const filters = [{}, { search: "coin 1" }, { view: "favorites" }, { view: "issues" }, { growingOnly: true }, { holderOnly: true }, { category: "Lending", verifiedOnly: true, hideDilution: true }, { minMcap: 50000000, maxMcap: 100000000 }, { maxPr: 100, maxPhr: 200 }, { minSourceAmount: 0, sourceMetric: "holders" }, ...["any", "revenue", "holder", "review", "missing"].map(available => ({ available }))];
    for (const capital of ["mcap", "fdv"] as const) for (const window of ["any", ...METRIC_WINDOWS] as const) for (const filter of filters) {
      const prefs = parseWorkspace(JSON.stringify({ ...defaultPreferences(), capital, coverageWindow: window, ...filter }));
      const expected = queryScreener(data, prefs, favorites, 3, 50), actual = queryTableCatalog(catalog, prefs, favorites, 3, 50);
      expect(actual.rows.map(row => row.slug)).toEqual(expected.coins.map(coin => coin.slug));
      for (const field of ["pagination", "coverage", "visibleCoverage", "universe"] as const) expect(actual[field]).toEqual(expected[field]);
    }
    for (const capital of ["mcap", "fdv"] as const) for (const sortKey of ["name", ...SCREENER_COLUMNS.map(column => column.key)] as const) for (const sortDir of ["asc", "desc"] as const) for (const revenueSort of ["amount", "percent", "delta"] as const) {
      const prefs = { ...defaultPreferences(), capital, sortKey, sortDir, revenueSort };
      expect(queryTableCatalog(catalog, prefs, [], 2, 50).rows.map(row => row.slug)).toEqual(queryScreener(data, prefs, [], 2, 50).coins.map(coin => coin.slug));
    }
  });
  it("preserves each of the ten source-reference amounts/reasons and never replaces missing FDV with market cap", () => {
    const data = tableFixture(8), reference = tableReference(data), { catalog } = buildTableCatalog(data, reference);
    for (const capital of ["mcap", "fdv"] as const) {
      const page = queryTableCatalog(catalog, { ...defaultPreferences(), capital }, [], 1, 100, journal(reference)); assertTablePage(page, capital);
      for (const row of page.rows) for (const key of TABLE_METRICS) {
        const coin = data.coins.find(coin => coin.slug === row.slug)!, metric = key.startsWith("phr") ? "holders" : "revenue", days = METRIC_COLUMN_DAYS[key]!;
        expect(row.cells[key]).toEqual({ value: referenceMultiple(coin, metric, days, capital), basis: referenceReading(coin, metric, days).basis, reason: referenceReason(coin, metric, days, capital) });
      }
      expect(page.rows.find(row => row.slug === "coin-005")!.cells.pr.value === null).toBe(capital === "fdv");
      expect(page.rows.find(row => row.slug === "coin-001")!.cells.pr).toMatchObject({ value: null, reason: "원천 금액 0 이하" });
    }
  });
  it("retains real full evidence in content-addressed shards while keeping heavy evidence out of the 100-row DTO", () => {
    const data = tableFixture(101); for (const coin of data.coins) coin.description = "original evidence ".repeat(1200);
    const ref = tableReference(data), built = buildTableCatalog(data, ref), page = queryTableCatalog(built.catalog, defaultPreferences(), [], 1, 100, journal(ref));
    expect(Buffer.byteLength(JSON.stringify(queryScreener(data, defaultPreferences())))).toBeGreaterThan(2_000_000);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(700_000); expect("coins" in page).toBe(false); expect(JSON.stringify(page)).not.toContain("original evidence");
    for (const entry of built.catalog.entries) { const shard = built.shards.get(entry.detail.shard)!; expect(tableHash(shard)).toBe(entry.detail.shard); expect(shard.coins.find(coin => coin.slug === entry.row.slug)).toEqual(data.coins.find(coin => coin.slug === entry.row.slug)); }
    const next = buildTableCatalog({ ...data, updatedAt: "2026-10-20T04:43:36.422Z" }, { ...ref, id: "data-next", dataAt: "2026-10-20T04:43:36.422Z", sha256: "c".repeat(64) });
    expect([...next.shards.keys()]).toEqual([...built.shards.keys()]);
    const changed = structuredClone(data); changed.coins[0].description += " confirmed change";
    expect([...buildTableCatalog(changed, ref).shards.keys()].filter(key => !built.shards.has(key))).toHaveLength(1);
  });
  it("rejects mixed publication/capital/identity details and validates the actual full coin before opening it", () => {
    const data = tableFixture(1), ref = tableReference(data), { catalog } = buildTableCatalog(data, ref), page = queryTableCatalog(catalog, defaultPreferences(), [], 1, 100, journal(ref));
    expect(() => assertTablePage({ ...page, capital: "fdv" }, "mcap")).toThrow(); expect(() => assertTablePage({ ...page, snapshotSha256: "d".repeat(64) }, "mcap")).toThrow();
    const expected = { slug: data.coins[0].slug, identity: catalog.entries[0].row.identity, publicationId: ref.id, snapshotSha256: ref.sha256, updatedAt: data.updatedAt }, detail = { schema: 1 as const, ...expected, coin: data.coins[0], readModel: "prepared" as const };
    expect(validateTableDetail(detail, expected).coin).toEqual(data.coins[0]);
    for (const change of [{ publicationId: "data-other" }, { identity: "gecko:other" }, { updatedAt: "2020-01-01" }, { coin: { slug: expected.slug } }]) expect(() => validateTableDetail({ ...detail, ...change }, expected)).toThrow();
  });
});

