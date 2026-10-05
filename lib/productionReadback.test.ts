import { expect, it } from "vitest";
import { inspectApi, inspectFwa, inspectPipelineProof, publicationProofKey } from "../scripts/verify-production.mjs";
import { sample } from "./testFixtures";
import { annotateDataQuality, dataQualitySummary } from "./dataQuality";
import { assembleScreener } from "./screener";
import { queryScreener } from "./screenerQuery";
import { normalizedHash, pipelineOutputHash } from "./pipelineIntegrity";
import type { SourceObservation } from "./types";

it("verifies source amounts while keeping incomplete current FWA windows unavailable", () => {
  const coin = { mcap: 100, revenue30d: 30, fundamentals: { revenue: { kind: "protocol_revenue" } },
    revenueHistory: { periods: { 30: { reportedDays: 15, total: null as number | null } } },
    holderHistory: { periods: { 30: { reportedDays: 15, total: null as number | null } } }, multiples: { pr: null, phr: null } };
  expect(inspectFwa(coin)).toEqual([]);
  expect(inspectFwa({ ...coin, multiples: { pr: 10, phr: null } })).toContain("FWA pr uses incomplete history");
  expect(inspectFwa({ ...coin, mcap: null })).toContain("FWA source/quote regression");
  coin.revenueHistory.periods[30] = { reportedDays: 30, total: 30 };
  expect(inspectFwa(coin)).toContain("FWA pr arithmetic regression");
  expect(inspectFwa({ ...coin, multiples: { pr: 100 / 365, phr: null } })).toEqual([]);
});

function partialPage() {
  const at = "2026-10-04T14:00:00.000Z";
  const sources: SourceObservation[] = [{ url: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=test-token", observedAt: at, status: "error", httpStatus: 503 }];
  const raw = annotateDataQuality([sample({ sourceSlugs: ["sample"], descriptionKo: "검증용 종목", price: null, mcap: null, fdv: null,
    marketSources: { mcap: null, price: null, fdv: null, cmc: null, gecko: { id: "test-token", status: "error", available: [], observedAt: at } } })], sources);
  const data = assembleScreener(raw, at, sources);
  data.pipeline = { schema: 1, asOf: at, rawBundleSha256: "a".repeat(64), normalizedSha256: normalizedHash(raw), outputSha256: pipelineOutputHash(data), replayVerified: true, quality: dataQualitySummary(raw) };
  const base = "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-test-complete/";
  const page = queryScreener(data);
  page.publication = { schema: 1, id: "data-test-complete", createdAt: at, trackingStartedAt: at, previousId: null, previousStateUrl: null, incident: null, recoveredAt: null,
    attempt: { id: "data-test", startedAt: at, completedAt: at, outcome: "published", partial: true, errors: [], sourceFailures: sources, runUrl: "", reportUrl: "", affectedProjects: 1, changeCount: 1, affected: [] },
    published: { id: "data-test-complete", url: base + "data.json.gz", sha256: "b".repeat(64), dataAt: at, validatedAt: at, publishedAt: at, codeCommit: "test", reportUrl: base + "report.json", witnessUrl: base + "witness.json.gz", witnessSha256: "c".repeat(64),
      rawBundleUrl: base + "source-bundle.json.gz", rawBundleSha256: data.pipeline.rawBundleSha256, normalizedSha256: data.pipeline.normalizedSha256, replayVerified: true } };
  return page;
}

it("keeps scoped partial quote accounting visible without applying the legacy zero-failure gate", () => {
  const page = partialPage(), body = JSON.stringify(page);
  expect(inspectApi({ status: 200, bytes: Buffer.byteLength(body), body }).errors).toEqual([]);
  const legacy = { ...page, pipeline: undefined, publication: undefined }, legacyBody = JSON.stringify(legacy);
  expect(inspectApi({ status: 200, bytes: Buffer.byteLength(legacyBody), body: legacyBody }).errors).toContain("collection coverage incomplete");
});

it("binds API pipeline proof to the exact published archive and compares hashes even when IDs match", () => {
  const page = partialPage(); expect(inspectPipelineProof(page)).toEqual([]);
  const changed = structuredClone(page); changed.publication!.published!.rawBundleSha256 = "d".repeat(64);
  expect(inspectPipelineProof(changed)).toContain("pipeline proof differs from published artifact");
  expect(publicationProofKey(changed)).not.toBe(publicationProofKey(page));
  changed.pipeline = undefined;
  expect(inspectPipelineProof(changed)).toContain("API omitted published pipeline proof");
});
