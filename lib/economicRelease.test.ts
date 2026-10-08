import {afterEach,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const {contract}=vi.hoisted(()=>({contract:{readerRelease:"metric-economic-decisions-v2",writerSchema:2,schedule:"paused",phaseA:{base:"https://crypto-valuation-screener.vercel.app",readerRelease:"four-daily-freshness-v2",codeCommit:"a".repeat(40),deploymentId:"dpl_original",deploymentUrl:"https://crypto-valuation-screener-original.vercel.app"},economic:{active:false,policy:null as any,reader:null as any}}}));
vi.mock("./pipeline-release.json",()=>({default:contract}));
import {verifyWriterActivation,collectionReleaseState,READER_COMPATIBILITY} from "./pipelineRelease";
import {ECONOMIC_POLICY_IDENTITY as policy,ECONOMIC_POLICY_V1_IDENTITY as previousPolicy} from "./economicPolicyIdentity";
import {verifyWriterActivation as actualB519Writer} from "./fixtures/legacy-b519-writer/pipelineRelease";
import b519Contract from "./fixtures/legacy-b519-writer/pipeline-release.json";
import {readEconomicReaderProof,economicActivationFile,economicPauseFile} from "../scripts/prepare-economic-release.mjs";
const reader={base:contract.phaseA.base,readerRelease:contract.readerRelease,codeCommit:"b".repeat(40),deploymentId:"dpl_economicReader",deploymentUrl:"https://crypto-valuation-screener-economic-reader.vercel.app"};
const executing="c".repeat(40);contract.economic.policy=policy;
afterEach(()=>{contract.schedule="paused";contract.economic.active=false;contract.economic.reader=null;contract.economic.policy=policy;vi.unstubAllEnvs();});
function current(){return {compatibility:READER_COMPATIBILITY,collectionRelease:collectionReleaseState(),deployment:{environment:"production",codeCommit:executing,id:"dpl_active",url:"https://crypto-valuation-screener-active.vercel.app"}};}
function pinned(){return {...current(),collectionRelease:{writerSchema:2,schedule:"paused",phaseADeploymentId:contract.phaseA.deploymentId,economic:{policy,active:false,readerDeploymentId:null}},deployment:{environment:"production",codeCommit:reader.codeCommit,id:reader.deploymentId,url:reader.deploymentUrl}};}
function old(){return {compatibility:{release:"four-daily-freshness-v2",pipelineSchemas:[1,2],journalSchemas:[1,2]},deployment:{environment:"production",codeCommit:contract.phaseA.codeCommit,id:contract.phaseA.deploymentId,url:contract.phaseA.deploymentUrl}};}
function activate(){contract.schedule="four-daily";contract.economic.active=true;contract.economic.reader=reader;vi.stubEnv("GITHUB_SHA",executing);vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET","test-only-bypass");}
function network(mutate?:(value:any,url:string)=>any){return vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);expect(init!.redirect).toBe("error");expect(init!.headers).toEqual(url===contract.phaseA.base+"/api/status"?undefined:{"x-vercel-protection-bypass":"test-only-bypass"});const v=url.startsWith(reader.deploymentUrl)?pinned():url.startsWith(contract.phaseA.deploymentUrl)?old():current();return Response.json(mutate?mutate(v,url):v);});}
it("freezes the actual b519 writer, which rejects the new reader rather than testing a replacement old guard",async()=>{
  for(const [file,sha] of [["pipelineRelease.ts","57a568e0050c2748d4c9cc346c4e77a8da468e444cd32ed29f1ac181d329e925"],["pipeline-release.json","6a192c5e3ded288246af6f2c671556d17fabe2e8f19a999a2180e8874b8e537e"]])expect(createHash("sha256").update(readFileSync(new URL(`./fixtures/legacy-b519-writer/${file}`,import.meta.url))).digest("hex")).toBe(sha);
  vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET","test-only-bypass");
  const legacyPinned={compatibility:{release:b519Contract.readerRelease,pipelineSchemas:[1,2],journalSchemas:[1,2]},deployment:{environment:"production",codeCommit:b519Contract.phaseA.codeCommit,id:b519Contract.phaseA.deploymentId,url:b519Contract.phaseA.deploymentUrl}};
  const legacyCurrent={...legacyPinned,collectionRelease:{writerSchema:2,schedule:"four-daily",phaseADeploymentId:b519Contract.phaseA.deploymentId}};
  const fetcher=(live:unknown)=>vi.fn(async(input:RequestInfo|URL)=>Response.json(String(input)===contract.phaseA.base+"/api/status"?live:legacyPinned));
  await actualB519Writer(fetcher(legacyCurrent));
  await expect(actualB519Writer(fetcher(current()))).rejects.toThrow("unverified");
  activate();await expect(actualB519Writer(fetcher(current()))).rejects.toThrow("unverified");
});
it("new inactive reader refuses collection and preserves historical Phase A proof as a distinct role",async()=>{
  const fetcher=vi.fn();await expect(verifyWriterActivation(fetcher)).rejects.toThrow("paused");expect(fetcher).not.toHaveBeenCalled();
  activate();await verifyWriterActivation(network());expect(contract.phaseA.readerRelease).not.toBe(contract.readerRelease);
});
it("rechecks exact executing commit, algorithm/artifact, activation and both pinned identities on every invocation",async()=>{
  activate();await verifyWriterActivation(network());
  for(const mutate of [(v:any)=>({...v,deployment:{...v.deployment,codeCommit:"d".repeat(40)}}),(v:any)=>({...v,compatibility:{...v.compatibility,release:"four-daily-freshness-v2"}}),
    (v:any)=>({...v,collectionRelease:{...v.collectionRelease,schedule:"paused"}}),(v:any)=>({...v,collectionRelease:{...v.collectionRelease,economic:{...v.collectionRelease.economic,policy:{...policy,sha256:"f".repeat(64)}}}})]) {
    await expect(verifyWriterActivation(network((v,u)=>u===contract.phaseA.base+"/api/status"?mutate(v):v))).rejects.toThrow();
  }
  const before=network();await verifyWriterActivation(before);
  await expect(verifyWriterActivation(network((v,u)=>u===contract.phaseA.base+"/api/status"?{...v,deployment:{...v.deployment,codeCommit:"d".repeat(40)}}:v))).rejects.toThrow("revision");
});
it("prepares activation only after exact paused canonical and protected immutable economic readers agree",async()=>{
  vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET","test-only-bypass");
  const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);expect(init!.redirect).toBe("error");expect(init!.headers).toEqual(url===contract.phaseA.base+"/api/status"?undefined:{"x-vercel-protection-bypass":"test-only-bypass"});return Response.json(pinned());});
  const proof=await readEconomicReaderProof(reader.codeCommit,fetcher);expect(proof).toEqual(reader);
  expect(economicActivationFile(contract,proof)).toMatchObject({schedule:"four-daily",economic:{active:true,reader}});
  await expect(readEconomicReaderProof(reader.codeCommit,vi.fn(async()=>Response.json({...pinned(),collectionRelease:{...pinned().collectionRelease,schedule:"four-daily"}})))).rejects.toThrow("paused");
  await expect(readEconomicReaderProof(reader.codeCommit,vi.fn(async(url:RequestInfo|URL)=>String(url).startsWith(reader.deploymentUrl)?new Response(null,{status:302}):Response.json(pinned())))).rejects.toThrow("unavailable");
});
it("requires the executing v2 policy in the local contract and each current/pinned selection and support list",async()=>{
  activate();await verifyWriterActivation(network());
  contract.economic.policy=previousPolicy;
  const untouched=network();await expect(verifyWriterActivation(untouched)).rejects.toThrow("separate activation");expect(untouched).not.toHaveBeenCalled();
  contract.economic.policy=policy;
  for(const base of [contract.phaseA.base,reader.deploymentUrl])for(const supportOnly of [false,true]) {
    await expect(verifyWriterActivation(network((v,url)=>url!==`${base}/api/status`?v:supportOnly?{...v,compatibility:{...v.compatibility,economicPolicies:["legacy",previousPolicy]}}:{...v,collectionRelease:{...v.collectionRelease,economic:{...v.collectionRelease.economic,policy:previousPolicy}}}))).rejects.toThrow();
  }
  await verifyWriterActivation(network());
});
it("requires a newly verified canonical paused deployment to reactivate after compatible pause",async()=>{
  const active=economicActivationFile(contract,reader),paused=economicPauseFile(active);
  expect(paused).toMatchObject({schedule:"paused",economic:{active:false,reader:null}});expect(active.economic.reader).toEqual(reader);
  vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET","test-only-bypass");
  await expect(readEconomicReaderProof(reader.codeCommit,vi.fn(async()=>Response.json({...pinned(),collectionRelease:{...pinned().collectionRelease,schedule:"four-daily",economic:{policy,active:true,readerDeploymentId:reader.deploymentId}}})))).rejects.toThrow("paused");
  const newReader={...reader,codeCommit:"d".repeat(40),deploymentId:"dpl_repaused",deploymentUrl:"https://crypto-valuation-screener-repaused.vercel.app"};
  const verified=await readEconomicReaderProof(newReader.codeCommit,vi.fn(async()=>Response.json({...pinned(),deployment:{...pinned().deployment,codeCommit:newReader.codeCommit,id:newReader.deploymentId,url:newReader.deploymentUrl}})));
  expect(economicActivationFile(paused,verified).economic.reader).toEqual(newReader);
});
