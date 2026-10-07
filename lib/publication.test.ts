import { expect, it,vi } from "vitest";
// Archived schema-1 publication fixtures retain their original active schedule.
vi.mock("./pipeline-release.json",()=>({default:{readerRelease:"four-daily-freshness-v2",writerSchema:1,schedule:"legacy",phaseA:null}}));
import { gzipSync } from "node:zlib";
import { assembleScreener } from "./screener";
import { sample } from "./testFixtures";
import { sha256, decodeSnapshot } from "./snapshotArchive";
import { assessCandidate, finishJournal, startJournal, snapshotErrors } from "./publication";
import { collectionCoverage } from "./collectionQuality";
import { collectionHealth, comparisonSummary } from "./collectionHealth";
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
  const retryHealth=collectionHealth({...data(),publication:current},Date.parse(b.startedAt));
  expect(retryHealth.label).toBe("공개 보류");
  expect(retryHealth.summary).toContain("검사가 끝난 뒤");
  expect(retryHealth.summary).not.toContain("0개");
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
  expect(()=>finishJournal(current,{...a,completedAt:a.startedAt,outcome:"published",comparisonCompleted:false},ref(data(a.startedAt)),"data-x")).toThrow();
  expect(()=>finishJournal(current,{...a,completedAt:a.startedAt,outcome:"published"},ref(),"data-x")).toThrow();
});
it("does not report zero changes when collection or comparison never completed", () => {
  const a = { ...attempt("data-2"), startedAt: "2026-10-02T01:05:29Z" };
  const running = startJournal(baseline(), a, "data-2-start");
  const blocked = finishJournal(running, { ...a, outcome: "blocked", completedAt: "2026-10-02T01:09:46Z", errors: ["collector_did_not_complete", "candidate_artifacts_missing"] }, null, "data-2-complete");
  const health = collectionHealth({ ...data(), publication: blocked }, Date.parse(blocked.createdAt));
  expect(health.summary).toContain("수집·검사 미완료");
  expect(health.summary).not.toContain("0개");
  expect(comparisonSummary(blocked.attempt)).toContain("확인하지 못했습니다");
  expect(comparisonSummary({ ...blocked.attempt, comparisonCompleted: true })).toContain("0개 종목");
  expect(comparisonSummary({ ...blocked.attempt, comparisonCompleted: false, collection: data().collection })).not.toContain("0개");
});
it("detects an interrupted durable start and never labels stale snapshots current",()=>{
  const a={...attempt("data-2"),startedAt:"2026-09-29T10:30:00Z"};const running=startJournal(baseline(),a,"data-2-start");
  expect(collectionHealth({...data(),publication:running},Date.parse(a.startedAt)+16*60_000).label).toBe("수집 중단");
  expect(collectionHealth({...data(),publication:baseline()},Date.parse("2026-09-30T00:01:00Z")).state).toBe("stale");
});
it("labels a recent verified publication healthy using its complete source evidence",()=>{
  const d={...data(),publication:baseline()};
  expect(collectionHealth(d,Date.parse(at)+60_000)).toMatchObject({state:"healthy",label:"수집 정상"});
  expect(collectionHealth({...d,sources:[]},Date.parse(at)+60_000).state).toBe("unknown");
});
it("distinguishes a missing scheduled start from a started collection failure and preserves dates",()=>{
  const p=baseline(), d={...data(),publication:p};
  const beforeDeadline=Date.parse("2026-09-29T15:29:59Z"), afterDeadline=beforeDeadline+1000;
  expect(collectionHealth(d,beforeDeadline).state).toBe("healthy");
  expect(collectionHealth(d,afterDeadline)).toMatchObject({label:"예약 실행 미확인",scheduledRunMissing:true,stale:true});
  const a={...attempt("data-late"),startedAt:"2026-09-29T15:48:00Z"};
  const start=startJournal(p,a,"data-late-start");
  const blocked=finishJournal(start,{...a,outcome:"blocked",completedAt:"2026-09-29T15:50:00Z",errors:["timeout"]},null,"data-late-complete");
  expect(collectionHealth({...d,publication:blocked},Date.parse(blocked.createdAt))).toMatchObject({label:"공개 보류",scheduledRunMissing:false});
  expect(blocked.published?.dataAt).toBe(d.updatedAt);
});
it("refuses corrupt bytes and snapshots containing failures despite a matching content hash",()=>{
  const d=data(), bytes=gzipSync(JSON.stringify(d));expect(decodeSnapshot(bytes,ref(d)).coins).toHaveLength(1);
  expect(()=>decodeSnapshot(Buffer.from("corrupt"),ref(d))).toThrow("hash mismatch");
  d.sources[0].status="error";expect(()=>decodeSnapshot(gzipSync(JSON.stringify(d)),ref(d))).toThrow("failed verification");
});

it("records accepted partial publications without a global incident and keeps their slot retryable", () => {
  const good = baseline();
  const a = { ...attempt("data-partial"), startedAt: "2026-09-29T14:00:00Z", scheduledFor: "2026-09-29T14:00:00.000Z", partial: true, failureClass: "transient" as const };
  const running = startJournal(good, a, "data-partial-start");
  const next = data(a.startedAt);
  const partial = finishJournal(running, { ...a, completedAt: a.startedAt, outcome: "published" }, ref(next, "data-partial-complete"), "data-partial-complete");
  expect(partial.published?.id).toBe("data-partial-complete");
  expect(partial.incident).toBeNull();
  expect(partial.schedule).toMatchObject({ attemptCount: 1, manualRepairCount: 0, successfulPublicationId: "data-partial-complete", settled: false, nextRetryAt: "2026-09-29T14:05:00.000Z" });
  const retry = { ...attempt("data-repair"), startedAt: "2026-09-29T14:10:00Z", manualRepair: true };
  const repairing = startJournal(JSON.parse(JSON.stringify(partial)), retry, "data-repair-start");
  expect(repairing.schedule).toMatchObject({ attemptCount: 2, manualRepairCount: 1, successfulPublicationId: "data-partial-complete" });
  const completed = finishJournal(repairing, { ...retry, completedAt: retry.startedAt, outcome: "published" }, ref(data(retry.startedAt), "data-repair-complete"), "data-repair-complete");
  expect(completed.schedule).toMatchObject({ settled: true, nextRetryAt: null, successfulPublicationId: "data-repair-complete" });
});

it("rejects a scheduled attempt that crosses into another slot before its durable start", () => {
  const a = { ...attempt("data-crossed-slot"), startedAt: "2026-09-29T14:00:01Z", scheduledFor: "2026-09-29T02:00:00.000Z" };
  expect(() => startJournal(baseline(), a, "data-crossed-slot-start")).toThrow("planned slot");
});
