import {afterEach,expect,it,vi} from "vitest";
const {contract}=vi.hoisted(()=>({contract:{readerRelease:"four-daily-freshness-v2",writerSchema:1,schedule:"legacy",phaseA:null as any}}));
vi.mock("./pipeline-release.json",()=>({default:contract}));
import { verifyWriterActivation,writerPaused } from "./pipelineRelease";
import { collectionTriggerDecision } from "./scheduledCollection";
import {stageSchedulerReceipt,signSchedulerReceipt} from "./schedulerDispatch";
import {GET} from "../app/api/cron/collect/route";
import {readPhaseAProof} from "../scripts/prepare-freshness-release.mjs";
afterEach(()=>{contract.writerSchema=1;contract.schedule="legacy";contract.phaseA=null;vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
const base="https://crypto-valuation-screener.vercel.app";
function activate(){vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET","test-only-protection-bypass");contract.writerSchema=2;contract.schedule="four-daily";contract.phaseA={base,readerRelease:contract.readerRelease,codeCommit:"a".repeat(40),deploymentId:"dpl_phaseA",deploymentUrl:"https://crypto-valuation-screener-reader-a.vercel.app"};}
function live(commit="b".repeat(40)){return {compatibility:{release:contract.readerRelease,pipelineSchemas:[1,2],journalSchemas:[1,2]},collectionRelease:{writerSchema:2,schedule:"four-daily",phaseADeploymentId:contract.phaseA?.deploymentId},deployment:{environment:"production",codeCommit:commit,id:commit.startsWith("a")?"dpl_phaseA":"dpl_phaseB",url:commit.startsWith("a")?contract.phaseA.deploymentUrl:"https://crypto-valuation-screener-reader-b.vercel.app"}};}
it("Phase A accepts recognized legacy readers but live paused/newer writer fences revoke queued schema1 work; premature activation fails closed",async()=>{
 const legacy={schema:1,attempt:{outcome:"published"},published:{id:"data-legacy",sha256:"a".repeat(64),codeCommit:"a".repeat(40),url:"https://github.com/lovelylov502/crypto-valuation-screener/releases/download/data-legacy/data.json.gz",dataAt:"2026-10-07T02:01Z"}};
 const network=vi.fn(async()=>Response.json(legacy));await verifyWriterActivation(network);expect(network).toHaveBeenCalledTimes(1);
 for(const schedule of ["paused","four-daily"])await expect(verifyWriterActivation(vi.fn(async()=>Response.json({...legacy,compatibility:{release:contract.readerRelease,pipelineSchemas:[1,2],journalSchemas:[1,2]},collectionRelease:{writerSchema:2,schedule},deployment:{environment:"production",codeCommit:"a".repeat(40),id:"dpl_paused"}})))).rejects.toThrow("Canonical legacy writer fence");
 contract.writerSchema=2;await expect(verifyWriterActivation(network)).rejects.toThrow("Phase B requires");expect(network).toHaveBeenCalledTimes(1);
});
it("each schema2 writer checks the current canonical reader and exact pinned Phase A identity; rollback to incompatible canonical fails",async()=>{
 activate();const requests:string[]=[];
 const good=vi.fn(async(url:any,options:any)=>{requests.push(url);expect(options.redirect).toBe("error");expect(options.headers).toEqual(url.startsWith(base)?undefined:{"x-vercel-protection-bypass":"test-only-protection-bypass"});return Response.json(live(url.startsWith(base)?"b".repeat(40):"a".repeat(40)));});
 await verifyWriterActivation(good);expect(requests).toEqual([base+"/api/status",contract.phaseA.deploymentUrl+"/api/status"]);
 const incompatible=vi.fn(async(url:any)=>Response.json(url.startsWith(base)?{compatibility:{pipelineSchemas:[1],journalSchemas:[1]}}:live("a".repeat(40))));
 await expect(verifyWriterActivation(incompatible)).rejects.toThrow("unverified");
 const wrongPinned=vi.fn(async()=>Response.json(live()));await expect(verifyWriterActivation(wrongPinned)).rejects.toThrow("unverified");
 const paused=vi.fn(async(url:any)=>Response.json(url.startsWith(base)?{...live(),collectionRelease:{writerSchema:2,schedule:"paused",phaseADeploymentId:contract.phaseA.deploymentId}}:live("a".repeat(40))));
 await expect(verifyWriterActivation(paused)).rejects.toThrow("activation fence");
});
it("reader-compatible pause preserves schema2 readers and refuses writers even when old cron configuration remains active",async()=>{
 activate();contract.schedule="paused";expect(writerPaused()).toBe(true);const network=vi.fn();await expect(verifyWriterActivation(network)).rejects.toThrow("paused");expect(network).not.toHaveBeenCalled();
});
it("protected pinned-reader authentication fails closed for missing/revoked credentials, redirects and mismatched hosts without sending the secret elsewhere",async()=>{
 activate();vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET","");const absent=vi.fn();await expect(verifyWriterActivation(absent)).rejects.toThrow("credential is unavailable");expect(absent).not.toHaveBeenCalled();
 vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET","test-only-protection-bypass");
 for(const status of [401,403,302]) {
  const network=vi.fn(async(url:any,options:any)=>{expect(options.headers).toEqual(url.startsWith(base)?undefined:{"x-vercel-protection-bypass":"test-only-protection-bypass"});expect(options.redirect).toBe("error");return url.startsWith(base)?Response.json(live()):new Response(null,{status});});
  await expect(verifyWriterActivation(network)).rejects.toThrow("unverified");
 }
 const redirect=vi.fn(async(url:any,options:any)=>{if(url.startsWith(base))return Response.json(live());expect(options.redirect).toBe("error");throw new TypeError("redirect mode is set to error");});await expect(verifyWriterActivation(redirect)).rejects.toThrow("redirect");
 contract.phaseA.deploymentUrl="https://unrelated-project.vercel.app";const wrongHost=vi.fn();await expect(verifyWriterActivation(wrongHost)).rejects.toThrow("Phase B requires");expect(wrongHost).not.toHaveBeenCalled();
});
it("activation preparation authenticates only the exact pinned Phase-A URL and rejects missing/revoked/redirected/mismatched proof before writing",async()=>{
 activate();const commit="a".repeat(40),value={...live(commit),collectionRelease:{writerSchema:1,schedule:"legacy",phaseADeploymentId:null}};
 const good=vi.fn(async(url:any,options:any)=>{expect(options.redirect).toBe("error");expect(options.headers).toEqual(url.startsWith(base)?undefined:{"x-vercel-protection-bypass":"test-only-protection-bypass"});return Response.json(value);});
 expect(await readPhaseAProof(commit,good)).toMatchObject({codeCommit:commit,deploymentId:"dpl_phaseA"});expect(good).toHaveBeenCalledTimes(2);
 vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET","");await expect(readPhaseAProof(commit,good)).rejects.toThrow("credential is unavailable");
 vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET","test-only-protection-bypass");
 for(const status of [401,403,302])await expect(readPhaseAProof(commit,vi.fn(async(url:any)=>url.startsWith(base)?Response.json(value):new Response(null,{status})))).rejects.toThrow("proof unavailable");
 await expect(readPhaseAProof(commit,vi.fn(async(url:any)=>{if(url.startsWith(base))return Response.json(value);throw new TypeError("redirect mode is set to error");}))).rejects.toThrow("redirect");
 await expect(readPhaseAProof(commit,vi.fn(async(url:any)=>Response.json(url.startsWith(base)?value:{...value,deployment:{...value.deployment,id:"dpl_other"}})))).rejects.toThrow("identities differ");
 const invalidHost=vi.fn(async()=>Response.json({...value,deployment:{...value.deployment,url:"https://other-project.vercel.app"}}));await expect(readPhaseAProof(commit,invalidHost)).rejects.toThrow("Exact canonical");expect(invalidHost).toHaveBeenCalledTimes(1);
 await expect(readPhaseAProof(commit,vi.fn(async()=>Response.json({...value,collectionRelease:{writerSchema:2,schedule:"four-daily",phaseADeploymentId:"dpl_phaseA"}})))).rejects.toThrow("Exact canonical");
});
it("active stage dispatch verifies live readers and signs the original occurrence; compatible pause disables both retained old and new cron paths",async()=>{
 activate();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-07T04:59Z"));
 const secret="test-only-scheduler-secret-32-characters";vi.stubEnv("CRON_SECRET",secret);vi.stubEnv("VERCEL_ENV","production");vi.stubEnv("SCREENER_DISPATCH_TOKEN","test-dispatch-token");
 const network=vi.fn(async(url:any,init:any)=>url.startsWith("https://api.github.com/")?new Response(null,{status:204}):Response.json(live(url.startsWith(base)?"b".repeat(40):"a".repeat(40))));vi.stubGlobal("fetch",network);
 const request=(stage:string|null)=>new Request(`https://example.test/api/cron/collect${stage?`?stage=${stage}`:""}`,{headers:{authorization:`Bearer ${secret}`,"user-agent":"vercel-cron/1.0","x-vercel-cron-schedule":"0 4 * * *","x-vercel-id":"test-stage-invocation-12345"}});
 const r=await GET(request("catchup1"));expect(r.status).toBe(202);expect(await r.json()).toMatchObject({schema:2,stage:"catchup1",scheduledFor:"2026-10-07T02:00:00.000Z",dispatched:true});
 const dispatch=network.mock.calls.find(([url])=>url.startsWith("https://api.github.com/"));expect(dispatch).toBeDefined();expect(JSON.parse(dispatch![1].body).inputs.scheduler_signature).toMatch(/^[a-f0-9]{64}$/);
 network.mockClear();contract.schedule="paused";for(const stage of [null,"primary","catchup1","catchup2"])expect(await (await GET(request(stage))).json()).toMatchObject({skipped:true,reason:"collection-paused"});expect(network).not.toHaveBeenCalled();
});
it("native ambiguous wakes and expired signed stage receipts retain distinct identities under active scheduling",()=>{
 activate();const now=Date.parse("2026-10-07T09:00Z"),start="2026-10-07T01:00:00.000Z";
 const previous:any={schema:1,id:"data-prior",createdAt:start,trackingStartedAt:start,previousId:null,previousStateUrl:null,published:null,incident:null,recoveredAt:null,attempt:{id:"data-prior",startedAt:start,completedAt:start,outcome:"published",errors:[],sourceFailures:[],affected:[],affectedProjects:0,changeCount:0,runUrl:"",reportUrl:""}};
 const wake=collectionTriggerDecision({event:"schedule",receipt:"",signature:"",secret:"",bootstrap:false,requestId:"delayed-seven-hours",schedule:"0 2,8,14,20 * * *"},previous,now);
 expect(wake).toMatchObject({collect:true,slotAt:"2026-10-07T08:00:00.000Z",trigger:{source:"github-recovery-wake",occurrenceKnown:false,scheduledFor:null}});
 const secret="test-only-secret-at-least-32-characters",receipt=JSON.stringify(stageSchedulerReceipt("0 2 * * *","primary",Date.parse("2026-10-07T02:01Z"),"receipt-seven-hour-delay"));
 expect(collectionTriggerDecision({event:"workflow_dispatch",receipt,signature:signSchedulerReceipt(receipt,secret),secret,bootstrap:false},previous,now)).toMatchObject({collect:false,reason:"expired-stage",slotAt:"2026-10-07T02:00:00.000Z",stage:"primary"});
});
