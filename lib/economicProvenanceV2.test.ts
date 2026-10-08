import {afterEach,expect,it,vi} from "vitest";
import artifact from "./economic-policy-v2.json";
import actualTypes from "./fixtures/economic-types-runtime-v2.json";
import {ECONOMIC_POLICY,ECONOMIC_POLICY_V1,economicArtifact} from "./economicPolicy";
import {captureSourceBundle,replaySourceBundle,sourceFetch,objectHash} from "./sourceBundle";
import {acquireEconomicProvenance,economicDecision,PROVENANCE_COMMIT_URL} from "./economicDecisionSource";
import {provenanceBlobUrl} from "./economicProvenanceV2";
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
 expect(current.value!.components[0].decision).toMatchObject({disposition:"approved",evidence:{scope:"adapter-local-with-reviewed-shared-fee-surface"}});
 expect(current.bundle.economicProvenance).toMatchObject({state:"verified",runtime:{typeSurface:"matched",rawChangedPaths:["adapters/types.ts"]}});
 expect(current.bundle.economicProvenance!.files.find(f=>f.path==="adapters/types.ts")!.actual).toBe(actualTypes.blobSha1);
 expect(fetcher).toHaveBeenCalledTimes(3);expect(JSON.stringify(current.bundle)).not.toContain("never-store-this-token");
 expect(current.value!.fingerprint).toBe(original.value!.fingerprint);
 vi.stubGlobal("fetch",()=>{throw Error("No later evidence in replay");});
 expect(await replaySourceBundle(current.bundle,async()=>{await acquireEconomicProvenance();return aggregateDefinitions([row()],()=>"group","Revenue").get("group");})).toEqual(current.value);
 upstream({"adapters/types.ts":actualTypes.body});const legacy=await assess(ECONOMIC_POLICY_V1);expect(legacy.value!.components[0].decision).toMatchObject({disposition:"pending"});expect(legacy.bundle.receipts).toHaveLength(2);
});
it("reads only four changed fixed files at the exact tree blobs, preserving unrelated context changes",async()=>{
 const pkg=JSON.parse(contextBody("package.json"));pkg.scripts.unrelated="echo harmless";
 const changes={"package.json":JSON.stringify(pkg),"pnpm-lock.yaml":contextBody("pnpm-lock.yaml")+'\n# unrelated comment\n',"tsconfig.json":contextBody("tsconfig.json")+'\n// harmless JSONC comment\n',"adapters/types.ts":actualTypes.body};
 const fetcher=upstream(changes);const current=await assess();expect(current.value!.components[0].decision!.disposition).toBe("approved");expect(fetcher).toHaveBeenCalledTimes(6);
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
it("bounds raw response bytes and rejects a seventh provenance request before HTTP",async()=>{
 let canceled=false;upstream({"adapters/types.ts":actualTypes.body});const normal=global.fetch;
 vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>String(input)===provenanceBlobUrl(actualTypes.blobSha1)?new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1_500_001));},cancel(){canceled=true;}})):normal(input,init));
 const result=await assess();expect(canceled).toBe(true);expect(result.value!.components[0].decision!.disposition).toBe("evidence-unavailable");expect(result.bundle.receipts.at(-1)?.error).toBe("Recorded source response exceeds byte limit");
 const transport=vi.fn(async()=>Response.json({}));vi.stubGlobal("fetch",transport);
 const bounded=await captureSourceBundle(at,null,async()=>{for(let i=0;i<7;i++)await sourceFetch(provenanceBlobUrl(String(i).repeat(40)));},undefined,2,3,ECONOMIC_POLICY);
 expect(transport).toHaveBeenCalledTimes(6);expect(String(bounded.error)).toContain("budget exceeded");
});
it("replay rejects a detached projected decision result rather than trusting a stored approval",async()=>{
 upstream({"adapters/types.ts":actualTypes.body});const result=await assess(),changed=structuredClone(result.bundle);
 changed.economicProvenance!.runtime!.contexts[0].sha256="f".repeat(64);expect(objectHash(changed.economicProvenance)).not.toBe(objectHash(result.bundle.economicProvenance));
 vi.stubGlobal("fetch",()=>{throw Error("offline");});await expect(replaySourceBundle(changed,async()=>{await acquireEconomicProvenance();})).rejects.toThrow("provenance replay mismatch");
});
