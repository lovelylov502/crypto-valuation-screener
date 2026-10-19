import {afterEach,expect,it,vi} from "vitest";
import {gzipSync} from "node:zlib";
import {auditCompletionVerdicts,attemptExecutionVerdict,apiArchiveErrors,auditAttemptRetention} from "../scripts/audit-coverage";
import {assembleScreener} from "./screener";
import {sample} from "./testFixtures";
import {queryScreener} from "./screenerQuery";
import {decodeSnapshot,sha256,parseJournal} from "./snapshotArchive";
import {collectionHealth} from "./collectionHealth";
import {COLLECTION_DEADLINE_MS,stateUrl} from "./publication";
import type {PublicationJournal} from "./publicationTypes";

const at="2026-10-08T00:00:00.000Z";
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
function retained() {
 const sources=["/protocols","/config","/overview/fees","/overview/fees?dataType=dailyRevenue","/overview/fees?dataType=dailyHoldersRevenue","/overview/dexs"].map(p=>({url:"https://api.llama.fi"+p,observedAt:at,status:"ok" as const}));
 const data=assembleScreener([sample({sourceSlugs:["sample"],marketSources:{mcap:"CoinGecko",price:"CoinGecko",fdv:"CoinGecko",cmc:null,gecko:{id:"test-token",status:"received",observedAt:at,available:["mcap","price","fdv"],positive:["mcap","price","fdv"]}}})],at,sources),bytes=gzipSync(JSON.stringify(data));
 const pub={id:"data-1-complete",url:stateUrl("data-1-complete").replace("state.json","data.json.gz"),sha256:sha256(bytes),dataAt:at,validatedAt:at,publishedAt:at,codeCommit:"a".repeat(40),reportUrl:stateUrl("data-1-complete").replace("state.json","report.json"),witnessUrl:stateUrl("data-1-complete").replace("state.json","witness.json.gz"),witnessSha256:"b".repeat(64)};
 const j:PublicationJournal={schema:1,id:"data-2-start",createdAt:at,trackingStartedAt:at,previousId:"data-1-complete",previousStateUrl:stateUrl("data-1-complete"),published:pub,attempt:{id:"data-2",startedAt:at,completedAt:null,outcome:"running",runUrl:"https://github.com/example",reportUrl:stateUrl("data-2-complete").replace("state.json","report.json"),errors:[],sourceFailures:[],affectedProjects:0,changeCount:0,affected:[]},incident:null,recoveredAt:null};
 return {data,bytes,pub,j};
}
it("overdue execution remains an explicit failure while hash-verified retained readers can deploy",()=>{
 const {data,bytes,pub,j}=retained(),archived=decodeSnapshot(bytes,pub),errors=apiArchiveErrors(queryScreener(data),data.coins,archived),execution=attemptExecutionVerdict(j,Date.parse(at)+COLLECTION_DEADLINE_MS+1);
 expect(errors).toEqual([]);expect(execution).toEqual({attemptExecutionPassed:false,overdueStart:true,operationalErrors:["collector did not complete within budget"]});
 expect(auditCompletionVerdicts({...execution,captureReplayPassed:false},errors)).toEqual({integrityPassed:true,safeReaderDeploymentPassed:true,currentRecoveryPassed:false});
 expect(sha256(bytes)).toBe(pub.sha256);
});
it("an active bounded collection gets no false execution failure or current-capture credit",()=>{
 const {j}=retained(),execution=attemptExecutionVerdict(j,Date.parse(at)+1000);
 expect(execution).toEqual({attemptExecutionPassed:null,overdueStart:false,operationalErrors:[]});expect(auditCompletionVerdicts({...execution,captureReplayPassed:false},[]).currentRecoveryPassed).toBe(false);
});
it("corrupt retained hashes or changed API fields still prevent a safe-reader pass",()=>{
 const {data,bytes,pub}=retained(),errors:string[]=[];
 try{decodeSnapshot(bytes,{...pub,sha256:"0".repeat(64)});}catch(error){errors.push((error as Error).message);}
 expect(errors).toEqual(["Snapshot hash mismatch"]);expect(auditCompletionVerdicts({captureReplayPassed:false},errors).safeReaderDeploymentPassed).toBe(false);
 const page=structuredClone(queryScreener(data));page.coins[0].mcap=1;const mismatch=apiArchiveErrors(page,page.coins,data);
 expect(mismatch).toContain("published bytes changed:sample");expect(auditCompletionVerdicts({},mismatch).integrityPassed).toBe(false);
});
it("retains historical storage evidence without fetching it against a later published baseline",async()=>{
 const {j,data}=retained();
 j.publicationFailure={schema:1,journalId:"data-old-failed-observation",attemptId:"data-10-1",runId:"10",runAttempt:1,failedAt:at,archivedAt:at,manifestUrl:stateUrl("data-old-failed-observation").replace("state.json","failed-evidence.json"),manifestSha256:"f".repeat(64)};
 j.id="data-2-complete";j.attempt={...j.attempt,outcome:"published",completedAt:at};
 const read=vi.fn(async()=>{throw Error("Historical failure must not be fetched against new baseline");});
 expect(parseJournal(j)).toBe(j);expect(await auditAttemptRetention(j,data,read,read)).toEqual({});expect(read).not.toHaveBeenCalled();
 expect(attemptExecutionVerdict(j,Date.parse(at)).attemptExecutionPassed).toBe(true);
 expect(collectionHealth({...data,publication:j},Date.parse(at)).label).not.toBe("검증 결과 보관 실패");
});
it("an unrelated later blocked attempt validates its own report while keeping historical storage evidence",async()=>{
 const {j,data}=retained();
 j.publicationFailure={schema:1,journalId:"data-old-failed-observation",attemptId:"data-10-1",runId:"10",runAttempt:1,failedAt:at,archivedAt:at,manifestUrl:stateUrl("data-old-failed-observation").replace("state.json","failed-evidence.json"),manifestSha256:"f".repeat(64)};
 j.id="data-2-complete";j.attempt={...j.attempt,outcome:"blocked",completedAt:at,errors:["candidate_not_current"]};j.incident={firstFailureObservedAt:at,lastFailureObservedAt:at,lastGoodDataAt:at};
 const report=vi.fn(async(url:string)=>{expect(url).toBe(j.attempt.reportUrl);return {errors:["candidate_not_current"],baseline:j.published};}),fetcher=vi.fn(async()=>{throw Error("Historical manifest is not this attempt");});
 expect(parseJournal(j)).toBe(j);expect(await auditAttemptRetention(j,data,report,fetcher)).toEqual({});expect(report).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();
 expect(collectionHealth({...data,publication:j},Date.parse(at)).label).toBe("공개 보류");
 await expect(auditAttemptRetention(j,data,async()=>({errors:[],baseline:j.published}),fetcher)).rejects.toThrow("does not prove retention");
});

function blockedReportFixture() {
 const value=retained();
 value.j.attempt={...value.j.attempt,outcome:"blocked",completedAt:at,errors:["candidate_not_current"]};
 value.j.incident={firstFailureObservedAt:at,lastFailureObservedAt:at,lastGoodDataAt:at};
 return {...value,report:{errors:["candidate_not_current"],baseline:value.j.published}};
}
const socketFailure=()=>new TypeError("fetch failed",{cause:Object.assign(new Error("other side closed"),{code:"UND_ERR_SOCKET"})});

it("retries one rejected public report transport and still verifies the retained baseline",async()=>{
 vi.useFakeTimers();const {j,data,report}=blockedReportFixture();
 const fetcher=vi.spyOn(globalThis,"fetch").mockRejectedValueOnce(socketFailure()).mockResolvedValueOnce(new Response(JSON.stringify(report)));
 const checked=expect(auditAttemptRetention(j,data)).resolves.toEqual({});
 await vi.runAllTimersAsync();await checked;
 expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls.map(call=>call[0])).toEqual([j.attempt.reportUrl,j.attempt.reportUrl]);
});

it("surfaces a second public report transport failure",async()=>{
 vi.useFakeTimers();const {j,data}=blockedReportFixture();
 const fetcher=vi.spyOn(globalThis,"fetch").mockRejectedValue(socketFailure());
 const checked=expect(auditAttemptRetention(j,data)).rejects.toThrow("fetch failed");
 await vi.runAllTimersAsync();await checked;expect(fetcher).toHaveBeenCalledTimes(2);
});

it("retries an interrupted report body with a new complete GET",async()=>{
 vi.useFakeTimers();const {j,data,report}=blockedReportFixture();
 const body=new ReadableStream({start(controller){controller.error(socketFailure());}});
 const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(body)).mockResolvedValueOnce(new Response(JSON.stringify(report)));
 const checked=expect(auditAttemptRetention(j,data)).resolves.toEqual({});
 await vi.runAllTimersAsync();await checked;expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
 ["malformed JSON","{broken","JSON"],
 ["invalid retention evidence",JSON.stringify({errors:[],baseline:{id:"other"}}),"does not prove retention"],
])("does not hide %s behind a transport retry",async(_label,body,message)=>{
 const {j,data}=blockedReportFixture(),fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(body));
 await expect(auditAttemptRetention(j,data)).rejects.toThrow(message);expect(fetcher).toHaveBeenCalledOnce();
});

it("keeps a public report HTTP 404 as a single final failure",async()=>{
 const {j,data}=blockedReportFixture(),fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("missing",{status:404}));
 await expect(auditAttemptRetention(j,data)).rejects.toThrow("HTTP 404");expect(fetcher).toHaveBeenCalledOnce();
});

it.each([429,503])("preserves the existing three-attempt HTTP %s budget after one transport failure",async status=>{
 vi.useFakeTimers();const {j,data}=blockedReportFixture();
 const fetcher=vi.spyOn(globalThis,"fetch").mockRejectedValueOnce(socketFailure()).mockImplementation(async()=>new Response("unavailable",{status}));
 const checked=expect(auditAttemptRetention(j,data)).rejects.toThrow(`HTTP ${status}`);
 await vi.runAllTimersAsync();await checked;expect(fetcher).toHaveBeenCalledTimes(4);
});

it("rejects a foreign report URL before any request",async()=>{
 const {j,data}=blockedReportFixture();j.attempt.reportUrl="https://github.com/other/repo/releases/download/data-2-complete/report.json";
 const fetcher=vi.spyOn(globalThis,"fetch");await expect(auditAttemptRetention(j,data)).rejects.toThrow("Invalid archive URL");expect(fetcher).not.toHaveBeenCalled();
});
