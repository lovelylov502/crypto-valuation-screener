import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { assembleScreener } from "./screener";
import { sample } from "./testFixtures";
import { sha256, decodeSnapshot } from "./snapshotArchive";
import { assessCandidate, finishJournal, startJournal, snapshotErrors } from "./publication";
import { collectionCoverage } from "./collectionQuality";
import { collectionHealth } from "./collectionHealth";
import type { CollectionAttempt, PublishedSnapshot } from "./publicationTypes";
const at="2026-09-29T10:00:00Z";
const paths=["/protocols","/config","/overview/fees","/overview/fees?dataType=dailyRevenue","/overview/fees?dataType=dailyHoldersRevenue","/overview/dexs"];
function data(time=at) {
  return assembleScreener([sample({sourceSlugs:["sample"],marketSources:{mcap:"CoinGecko",price:"CoinGecko",fdv:"CoinGecko",cmc:null,gecko:{id:"test-token",status:"received",observedAt:time,available:["mcap","price","fdv"],positive:["mcap","price","fdv"]}}})],time,paths.map(p=>({url:"https://api.llama.fi"+p,observedAt:time,status:"ok"})));
}
function attempt(id="data-1"):CollectionAttempt { return {id,startedAt:at,completedAt:null,outcome:"running",runUrl:"https://github.com/example",reportUrl:"https://github.com/report",errors:[],sourceFailures:[],affectedProjects:0,changeCount:0,affected:[]}; }
function ref(d=data(), id="data-1-complete"):PublishedSnapshot {return{id,url:`https://github.com/lovelylov502/crypto-valuation-screener/releases/download/${id}/data.json.gz`,sha256:sha256(gzipSync(JSON.stringify(d))),dataAt:d.updatedAt,validatedAt:at,publishedAt:at,codeCommit:"abc",reportUrl:"https://github.com/report",witnessUrl:"https://github.com/witness",witnessSha256:"a".repeat(64)};}
function baseline(){const a=attempt();const start=startJournal(null,a,"data-1-start");return finishJournal(start,{...a,outcome:"published",completedAt:at},ref(),"data-1-complete");}

it.each([403,429,504,undefined])("blocks HTTP/network failure %s without replacing the last verified snapshot",status=>{
  const old=data(), bad=data("2026-09-29T10:30:00Z");
  bad.sources.push({url:"https://api.coingecko.com/api/v3/coins/markets",observedAt:bad.updatedAt,status:"error",httpStatus:status});
  bad.coins[0].marketSources!.gecko!.status="error";
  bad.collection=collectionCoverage(bad.coins);
  const gate=assessCandidate(bad,old,bad.updatedAt,bad.updatedAt);
  expect(gate.errors.length).toBeGreaterThan(0);
  const a={...attempt("data-2"),startedAt:bad.updatedAt};
  const running=startJournal(baseline(),a,"data-2-start");
  const blocked=finishJournal(running,{...a,outcome:"blocked",completedAt:bad.updatedAt,errors:gate.errors,sourceFailures:bad.sources.filter(s=>s.status==="error")},null,"data-2-complete");
  expect(blocked.published).toEqual(baseline().published);
  expect(blocked.incident?.firstFailureObservedAt).toBe(bad.updatedAt);
  expect(collectionHealth({...old,publication:blocked},Date.parse(bad.updatedAt)).label).toBe("공개 보류");
});
it("blocks empty quote responses and silent losses even when HTTP requests passed",()=>{
  const before=data(), after=data("2026-09-29T10:30:00Z");
  after.coins[0].marketSources!.gecko!.status="not_returned";
  after.coins[0].mcap=null;after.coins[0].marketSources!.mcap=null;
  after.collection=collectionCoverage(after.coins);
  const gate=assessCandidate(after,before,after.updatedAt,after.updatedAt);
  expect(gate.errors).toContain("gecko_empty_response");
  expect(gate.changes).toContainEqual({slug:"sample",issue:"mcap_lost"});
  expect(gate.affected[0].before?.mcap).toBe(100000000);
  expect(gate.affected[0].after?.mcap).toBeNull();
});
it("blocks missing source evidence and UTC-crossing candidates",()=>{
  const d=data();d.sources=[];expect(snapshotErrors(d)).toContain("missing_source_observations");
  expect(assessCandidate(data(),null,"2026-09-28T23:59:00Z",at).errors).toContain("collection_crossed_utc_day");
});
it("survives process-independent serialization; only a passing newer completion recovers",()=>{
  const good=baseline(), a={...attempt("data-2"),startedAt:"2026-09-29T10:30:00Z"};
  const start=startJournal(good,a,"data-2-start");
  const blocked=finishJournal(start,{...a,outcome:"blocked",completedAt:a.startedAt,errors:["timeout"]},null,"data-2-complete");
  const restored=JSON.parse(JSON.stringify(blocked));
  const b={...attempt("data-3"),startedAt:"2026-09-30T00:01:00Z"};
  const current=startJournal(restored,b,"data-3-start");
  expect(current.published).toEqual(good.published);
  expect(current.incident).toEqual(blocked.incident);
  const next=data(b.startedAt);expect(assessCandidate(next,data(),b.startedAt,b.startedAt).errors).toEqual([]);
  const recovered=finishJournal(current,{...b,outcome:"published",completedAt:b.startedAt},ref(next,"data-3-complete"),"data-3-complete");
  expect(recovered.incident).toBeNull();expect(recovered.recoveredAt).toBe(b.startedAt);
  expect(()=>finishJournal(recovered,{...b,outcome:"published",completedAt:b.startedAt},ref(next),"data-duplicate")).toThrow();
});
it("rejects late writers, failed candidates supplied as published, and rollback",()=>{
  const good=baseline();expect(()=>startJournal(good,attempt(),"data-old")).toThrow();
  const a={...attempt("data-2"),startedAt:"2026-09-29T10:30:00Z"};const current=startJournal(good,a,"data-2-start");
  expect(()=>finishJournal(current,{...a,id:"data-other",completedAt:a.startedAt,outcome:"published"},ref(),"data-x")).toThrow();
  expect(()=>finishJournal(current,{...a,completedAt:a.startedAt,outcome:"published",errors:["403"]},ref(),"data-x")).toThrow();
  expect(()=>finishJournal(current,{...a,completedAt:a.startedAt,outcome:"published"},ref(),"data-x")).toThrow();
});
it("detects an interrupted durable start and never labels stale snapshots current",()=>{
  const a={...attempt("data-2"),startedAt:"2026-09-29T10:30:00Z"};const running=startJournal(baseline(),a,"data-2-start");
  expect(collectionHealth({...data(),publication:running},Date.parse(a.startedAt)+16*60_000).label).toBe("수집 중단");
  expect(collectionHealth({...data(),publication:baseline()},Date.parse("2026-09-30T00:01:00Z")).state).toBe("stale");
});
it("refuses corrupt bytes and snapshots containing failures despite a matching content hash",()=>{
  const d=data(), bytes=gzipSync(JSON.stringify(d));expect(decodeSnapshot(bytes,ref(d)).coins).toHaveLength(1);
  expect(()=>decodeSnapshot(Buffer.from("corrupt"),ref(d))).toThrow("hash mismatch");
  d.sources[0].status="error";expect(()=>decodeSnapshot(gzipSync(JSON.stringify(d)),ref(d))).toThrow("failed verification");
});

