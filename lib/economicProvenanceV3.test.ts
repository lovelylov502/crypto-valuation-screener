import {afterEach,expect,it,vi} from "vitest";
import artifact from "./economic-policy-v3.json";
import actualTypes from "./fixtures/economic-types-runtime-v2.json";
import actualChains from "./fixtures/economic-chains-runtime-v3.json";
import {ECONOMIC_POLICY_V3 as ECONOMIC_POLICY,ECONOMIC_POLICY as ECONOMIC_POLICY_V2,economicArtifactV3 as economicArtifact} from "./economicPolicy";
import {captureSourceBundle,replaySourceBundle,sourceFetch,objectHash} from "./sourceBundle";
import {acquireEconomicProvenance,economicDecision,PROVENANCE_COMMIT_URL} from "./economicDecisionSource";
import {provenanceBlobUrl} from "./economicProvenanceV3";
import {gitBlobHash} from "./economicContext";
import {aggregateDefinitions} from "./fundamentalSource";

const at="2026-10-08T08:09:46.483Z",commit="1".repeat(40),tree="2".repeat(40),contract=artifact.contracts[0];
const row=()=>({slug:contract.slug,defillamaId:contract.providerId,module:contract.expectedModule,name:contract.expectedName,parentProtocol:contract.expectedParent,methodology:{...contract.expectedDefinitions}});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
function upstream(changes:Record<string,string>={},mutate?:(v:any,path:string)=>any) {
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(at);vi.stubEnv("GITHUB_TOKEN","never-store-this-token");
 const files=[...new Map([...economicArtifact.contracts.flatMap(c=>c.sourceClosure),...artifact.context.files].map(f=>[f.path,f])).values()];
 const changed=new Map(Object.entries(changes).map(([path,body])=>[gitBlobHash(body),{path,body}]));
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);expect(init?.redirect).toBe("error");expect(init?.headers).toMatchObject({authorization:"Bearer never-store-this-token"});
  let value:any,path:string;
  if(url===PROVENANCE_COMMIT_URL){path="commit";value={sha:commit,commit:{tree:{sha:tree},committer:{date:at}}};}
  else if(url.includes("/git/trees/")){path="tree";value={sha:tree,url:`https://api.github.com/repos/DefiLlama/dimension-adapters/git/trees/${tree}`,truncated:false,tree:files.map(f=>({path:f.path,type:"blob",sha:changes[f.path]===undefined?f.blobSha1:gitBlobHash(changes[f.path])}))};}
  else {const item=changed.get(url.split("/").at(-1)!)!;path=item.path;value={sha:gitBlobHash(item.body),url,encoding:"base64",size:Buffer.byteLength(item.body),content:Buffer.from(item.body).toString("base64")};}
  return Response.json(mutate?mutate(value,path):value);
 });vi.stubGlobal("fetch",fetcher);return fetcher;
}
const assess=(policy=ECONOMIC_POLICY)=>captureSourceBundle(at,null,async()=>{await acquireEconomicProvenance();return aggregateDefinitions([row()],()=>"group","Revenue").get("group");},undefined,2,3,policy);
const contextBody=(path:string)=>artifact.context.files.find(f=>f.path===path)!.body;
it("accepts the reviewed additive types surface with raw changed-file proof, stable metric identity and no replay network",async()=>{
 upstream();const original=await assess();
 const fetcher=upstream({"adapters/types.ts":actualTypes.body});const current=await assess();
 expect(current.value!.components[0].decision).toMatchObject({disposition:"approved",evidence:{scope:"adapter-local-with-reviewed-shared-fee-and-literal-registry-surfaces"}});
 expect(current.bundle.economicProvenance).toMatchObject({state:"verified",runtime:{typeSurface:"matched",rawChangedPaths:["adapters/types.ts"]}});
 expect(current.bundle.economicProvenance!.files.find(f=>f.path==="adapters/types.ts")!.actual).toBe(actualTypes.blobSha1);
 expect(fetcher).toHaveBeenCalledTimes(3);expect(JSON.stringify(current.bundle)).not.toContain("never-store-this-token");
 expect(current.value!.fingerprint).toBe(original.value!.fingerprint);
 vi.stubGlobal("fetch",()=>{throw Error("No later evidence in replay");});
 expect(await replaySourceBundle(current.bundle,async()=>{await acquireEconomicProvenance();return aggregateDefinitions([row()],()=>"group","Revenue").get("group");})).toEqual(current.value);
 upstream({"helpers/chains.ts":actualChains.body});const legacy=await assess(ECONOMIC_POLICY_V2);expect(legacy.value!.components[0].decision).toMatchObject({disposition:"pending"});expect(legacy.bundle.receipts).toHaveLength(2);
});
it("reads only five changed fixed files at the exact tree blobs, preserving unrelated context changes",async()=>{
 const pkg=JSON.parse(contextBody("package.json"));pkg.scripts.unrelated="echo harmless";
 const changes={"package.json":JSON.stringify(pkg),"pnpm-lock.yaml":contextBody("pnpm-lock.yaml")+'\n# unrelated comment\n',"tsconfig.json":contextBody("tsconfig.json")+'\n// harmless JSONC comment\n',"adapters/types.ts":actualTypes.body,"helpers/chains.ts":actualChains.body};
 const fetcher=upstream(changes);const current=await assess();expect(current.value!.components[0].decision!.disposition).toBe("approved");expect(fetcher).toHaveBeenCalledTimes(7);
 expect(current.bundle.economicProvenance!.receiptHashes).toEqual(current.bundle.receipts.map(r=>r.sha256));expect(current.bundle.economicProvenance!.runtime!.rawChangedPaths.sort()).toEqual(Object.keys(changes).sort());
});
it.each(["pretest","prebuild","postinstall","prepare"])("a newly introduced %s hook cannot renew a scoped approval",async hook=>{
 const pkg=JSON.parse(contextBody("package.json"));pkg.scripts[hook]="node mutate-adapter.js";upstream({"package.json":JSON.stringify(pkg)});
 const result=await assess();expect(result.value!.components[0].decision!.disposition).toBe("pending");
});
it("keeps a changed runtime importer and fee routing pending despite erased local type edges",async()=>{
 for(const changes of [{"fees/fwa/index.ts":"new runtime body"},{"adapters/types.ts":actualTypes.body.replace("FEES = 'fees'","FEES = 'other'")}] as Record<string,string>[]) {
  upstream(changes);const result=await assess();expect(result.value!.components[0].decision!.disposition).toBe("pending");
 }
});
it.each(["missing","truncated","hash","utf8","length","url","encoding","oversized"])("%s fixed evidence fails closed without a weaker approval or arbitrary URL",async failure=>{
 upstream({"adapters/types.ts":actualTypes.body},(v,path)=>path==="tree"?(failure==="missing"?{...v,tree:v.tree.filter((f:any)=>f.path!=="adapters/types.ts")}:failure==="truncated"?{...v,truncated:true}:v):path==="adapters/types.ts"?failure==="hash"?{...v,content:Buffer.from(actualTypes.body.replace("FEES = 'fees'","FEES = 'feed'"),"utf8").toString("base64")}:failure==="utf8"?{...v,size:1,content:"/w=="}:
 failure==="length"?{...v,size:v.size+1}:failure==="url"?{...v,url:"https://example.com/other"}:failure==="encoding"?{...v,encoding:"utf8"}:failure==="oversized"?{...v,size:1_000_001}:v:v);
 const result=await assess();expect(result.error).toBeUndefined();expect(result.bundle.economicProvenance!.state).toBe("unavailable");expect(result.value!.components[0].decision!.disposition).toBe("evidence-unavailable");
});
it("bounds raw response bytes and rejects an eighth provenance request before HTTP",async()=>{
 let canceled=false;upstream({"adapters/types.ts":actualTypes.body});const normal=global.fetch;
 vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>String(input)===provenanceBlobUrl(actualTypes.blobSha1)?new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1_500_001));},cancel(){canceled=true;}})):normal(input,init));
 const result=await assess();expect(canceled).toBe(true);expect(result.value!.components[0].decision!.disposition).toBe("evidence-unavailable");expect(result.bundle.receipts.at(-1)?.error).toBe("Recorded source response exceeds byte limit");
 const transport=vi.fn(async()=>Response.json({}));vi.stubGlobal("fetch",transport);
 const bounded=await captureSourceBundle(at,null,async()=>{for(let i=0;i<8;i++)await sourceFetch(provenanceBlobUrl(String(i).repeat(40)));},undefined,2,3,ECONOMIC_POLICY);
 expect(transport).toHaveBeenCalledTimes(7);expect(String(bounded.error)).toContain("budget exceeded");
});
it("replay rejects a detached projected decision result rather than trusting a stored approval",async()=>{
 upstream({"adapters/types.ts":actualTypes.body});const result=await assess(),changed=structuredClone(result.bundle);
 changed.economicProvenance!.runtime!.contexts[0].sha256="f".repeat(64);expect(objectHash(changed.economicProvenance)).not.toBe(objectHash(result.bundle.economicProvenance));
 vi.stubGlobal("fetch",()=>{throw Error("offline");});await expect(replaySourceBundle(changed,async()=>{await acquireEconomicProvenance();})).rejects.toThrow("provenance replay mismatch");
});
it("restores the ten intended decisions with actual unused registry addition while eight economic holds remain",async()=>{
 const fetcher=upstream({"adapters/types.ts":actualTypes.body,"helpers/chains.ts":actualChains.body});
 const result=await captureSourceBundle(at,null,async()=>{await acquireEconomicProvenance();return artifact.contracts.flatMap(c=>["Revenue","Fees","HoldersRevenue"].map(metric=>economicDecision({slug:c.slug,defillamaId:c.providerId,name:c.expectedName,module:c.expectedModule,parentProtocol:c.expectedParent,methodology:c.expectedDefinitions},metric as "Revenue")));},undefined,2,3,ECONOMIC_POLICY);
 expect(result.error).toBeUndefined();expect(fetcher).toHaveBeenCalledTimes(4);
 expect(result.value!.filter(d=>d?.disposition==="approved")).toHaveLength(10);expect(result.value!.filter(d=>d?.disposition==="pending")).toHaveLength(8);
 expect(result.bundle.economicProvenance!.runtime!.literalRegistry).toMatchObject({state:"matched",actualBlobSha1:actualChains.blobSha1,rawSha256:actualChains.sha256,addedMembers:["DERIVE_V3"]});
 vi.stubGlobal("fetch",()=>{throw Error("No replay network");});
 await replaySourceBundle(result.bundle,async()=>{await acquireEconomicProvenance();});
 const detached=structuredClone(result.bundle);detached.economicProvenance!.runtime!.literalRegistry!.projectionSha256="f".repeat(64);
 await expect(replaySourceBundle(detached,async()=>{await acquireEconomicProvenance();})).rejects.toThrow("provenance replay mismatch");
});
it("a changed FWA importer holds FWA approval despite safe registry additions",async()=>{
 const path="fees/fwa/index.ts";
 upstream({"helpers/chains.ts":actualChains.body,[path]:"export const changed = 1;"});const result=await assess();
 expect(result.value!.components[0].decision!.disposition).toBe("pending");expect(result.bundle.economicProvenance!.runtime!.literalRegistry!.state).toBe("matched");
});
it.each(["helpers/token.ts","fees/geodnet.ts"])("unrelated %s change preserves FWA and holds its affected contract",async path=>{
 upstream({"helpers/chains.ts":actualChains.body,[path]:"export const changed = 1;"});const result=await assess();
 expect(result.value!.components[0].decision!.disposition).toBe("approved");
 const lido=artifact.contracts.find(c=>c.slug===(path==="helpers/token.ts"?"lido":"geodnet"))!;
 upstream({"helpers/chains.ts":actualChains.body,[path]:"export const changed = 1;"});
 const affected=await captureSourceBundle(at,null,async()=>{await acquireEconomicProvenance();return economicDecision({slug:lido.slug,defillamaId:lido.providerId,name:lido.expectedName,module:lido.expectedModule,parentProtocol:lido.expectedParent,methodology:lido.expectedDefinitions},"Revenue");},undefined,2,3,ECONOMIC_POLICY);
 expect(affected.value!.disposition).toBe("pending");expect(affected.value!.reason).toBe("원천 계산 근거 미확인·변경");
});
it.each(["missing","truncated","hash","utf8","length","url","encoding","oversized"])("%s registry content cannot renew approvals",async failure=>{
 upstream({"helpers/chains.ts":actualChains.body},(v,path)=>path==="tree"?(failure==="missing"?{...v,tree:v.tree.filter((f:any)=>f.path!=="helpers/chains.ts")}:failure==="truncated"?{...v,truncated:true}:v):path==="helpers/chains.ts"?failure==="hash"?{...v,content:Buffer.from(actualChains.body+'// detached').toString("base64")}:failure==="utf8"?{...v,size:1,content:"/w=="}:failure==="length"?{...v,size:v.size+1}:failure==="url"?{...v,url:"https://example.com/other"}:failure==="encoding"?{...v,encoding:"utf8"}:failure==="oversized"?{...v,size:1_000_001}:v:v);
 const result=await assess();expect(result.value!.components[0].decision!.disposition).toBe("evidence-unavailable");
});
