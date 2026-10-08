import { expect, it } from "vitest";
import { inspectApi, inspectFwa, inspectPipelineProof, publicationProofKey } from "../scripts/verify-production.mjs";
import { sample } from "./testFixtures";
import { annotateDataQuality, dataQualitySummary } from "./dataQuality";
import { assembleScreener } from "./screener";
import { queryScreener } from "./screenerQuery";
import { normalizedHash, pipelineOutputHash } from "./pipelineIntegrity";
import type { SourceObservation } from "./types";
import {annotateFreshness,freshnessSummary} from "./datedFreshness";
import {jsonResponse,readJsonText} from "./jsonTransport.mjs";

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

it("production readback validates completion of full streamed evidence instead of waiving the size gate",async()=>{
  const page={...partialPage(),testEvidence:"x".repeat(4_600_000)},response=jsonResponse(page),body=await readJsonText(response);
  const readback={status:200,bytes:Buffer.byteLength(body),body,transport:response.headers.get("x-tovenit-json-transport"),declaredBytes:response.headers.get("x-tovenit-json-bytes")};
  expect(inspectApi(readback).errors).toEqual([]);
  expect(inspectApi({...readback,transport:null}).errors.some((e:string)=>e.includes("fail-closed limit"))).toBe(true);
  expect(inspectApi({...readback,declaredBytes:String(readback.bytes+1)}).errors).toContain("JSON transport length mismatch");
});

it("binds API pipeline proof to the exact published archive and compares hashes even when IDs match", () => {
  const page = partialPage(); expect(inspectPipelineProof(page)).toEqual([]);
  const changed = structuredClone(page); changed.publication!.published!.rawBundleSha256 = "d".repeat(64);
  expect(inspectPipelineProof(changed)).toContain("pipeline proof differs from published artifact");
  expect(publicationProofKey(changed)).not.toBe(publicationProofKey(page));
  changed.pipeline = undefined;
  expect(inspectPipelineProof(changed)).toContain("API omitted published pipeline proof");
});

function v2Page() {
 const page=partialPage(),raw=annotateFreshness(page.coins,page.updatedAt);page.coins=raw as typeof page.coins;
 page.pipeline!.schema=2;page.freshness=freshnessSummary(raw,page.updatedAt);
 return page;
}
it("readback accepts precisely pipeline1/2 independently of active writer and rejects missing, zero or future proof versions",()=>{
 const page=v2Page();expect(inspectPipelineProof(page)).toEqual([]);
 for(const schema of [0,3,undefined])expect(inspectPipelineProof({...page,pipeline:{...page.pipeline,schema}})).toContain("invalid pipeline source proof");
 for(const schema of [1,2])expect(inspectPipelineProof({...page,pipeline:{...page.pipeline,schema}})).toEqual([]);
});
it("schema2 readback requires global capture-date freshness and structural per-returned-row metadata while preserving every proof binding",()=>{
 const page=v2Page();expect(inspectPipelineProof(page)).toEqual([]);
 const mutations=[(p:typeof page)=>{p.freshness=undefined;},(p:typeof page)=>{p.freshness!.projects=2;},(p:typeof page)=>{p.freshness!.targetDate="2026-10-05";},(p:typeof page)=>{p.freshness!.unknown=-1;},
  (p:typeof page)=>{delete p.coins[0].freshness;},(p:typeof page)=>{p.coins[0].freshness!.revenue.components=[{id:"x",latestDate:null,targetPresent:true},{id:"x",latestDate:null,targetPresent:false}];},
  (p:typeof page)=>{p.coins[0].freshness!.revenue.coverage={start:"2024-10-01",end:"2026-10-03",bits:"bad"};}];
 for(const mutate of mutations) {const changed=structuredClone(page);mutate(changed);expect(inspectPipelineProof(changed).some(e=>e.includes("v2"))).toBe(true);}
 const changed=structuredClone(page);changed.publication!.published!.rawBundleSha256="d".repeat(64);expect(inspectPipelineProof(changed)).toContain("pipeline proof differs from published artifact");
 changed.pipeline!.replayVerified=false;changed.pipeline!.asOf="2026-10-05T00:00:00Z";expect(inspectPipelineProof(changed)).toContain("invalid pipeline source proof");
});
it("schema2 pending dates and a later wall-clock UTC target retain safe capture readback, and summary bounds use the whole universe instead of the filtered page",()=>{
 const page=v2Page(),f=page.coins[0].freshness!.revenue;page.freshness![f.state]--;f.state="pending";f.latestCompleteDate="2026-10-02";f.missingRecentDates=["2026-10-03"];f.coverage={start:"2024-10-04",end:"2026-10-03",bits:"0".repeat(182)+"1"};
 page.freshness!.pending++;
 page.publicFreshness={...page.freshness!,targetDate:"2026-10-04",unassessed:true,current:0};
 page.freshness!.projects=7211;page.freshness!.unsupported+=2*7210;page.pagination.total=7211;page.universe.projects=7211;
 expect(page.pagination.filtered).toBe(1);expect(inspectPipelineProof(page)).toEqual([]);
});
