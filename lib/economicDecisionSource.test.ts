import {afterEach,expect,it,vi} from "vitest";
import {captureSourceBundle,replaySourceBundle} from "./sourceBundle";
import {ECONOMIC_POLICY_V1 as ECONOMIC_POLICY,economicArtifactV1 as economicArtifact} from "./economicPolicy";
import {acquireEconomicProvenance,PROVENANCE_COMMIT_URL,economicDecision} from "./economicDecisionSource";
import {aggregateDefinitions,combineFundamentals} from "./fundamentalSource";
import {aggregateHolderValueByGroup} from "./holderValue";
import {metricDecisionHeld} from "./fundamentals";
import {physicalSeriesFingerprint} from "./fundamentalSource";
import legacy from "./fundamentalDefinitions.legacy-b519.json";

const at="2026-10-08T00:00:00.000Z",commit="1".repeat(40),tree="2".repeat(40),contract=economicArtifact.contracts[0];
const row=()=>({slug:contract.slug,module:contract.expectedModule,defillamaId:contract.providerId,name:contract.expectedName,parentProtocol:contract.expectedParent,
  methodology:{...contract.expectedDefinitions,ProtocolRevenue:"Revenue minus HoldersRevenue."} as Record<string,string|null>,total30d:20,total60dto30d:10,total1y:30});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function upstream(change?:string,fail?:"commit"|"tree"|"truncated") {
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(at));
  const fetcher=vi.fn(async(input:unknown)=>{
    const url=String(input);
    if(url===PROVENANCE_COMMIT_URL)return new Response(JSON.stringify({sha:commit,commit:{tree:{sha:tree},committer:{date:"2026-10-07T23:00:00Z"}}}),{status:fail==="commit"?503:200});
    return new Response(JSON.stringify({sha:tree,url:`https://api.github.com/repos/DefiLlama/dimension-adapters/git/trees/${tree}`,truncated:fail==="truncated",
      tree:[...new Map(economicArtifact.contracts.flatMap(c=>c.sourceClosure).map(f=>[f.path,f])).values()].map(f=>({path:f.path,type:"blob",sha:f.path===change?"9".repeat(40):f.blobSha1}))}),{status:fail==="tree"?503:200});
  });vi.stubGlobal("fetch",fetcher);return fetcher;
}
async function assess(r=row()) {
  return captureSourceBundle(at,null,async()=>{await acquireEconomicProvenance();return ["Revenue","Fees","HoldersRevenue"].map(m=>economicDecision(r,m as "Revenue"));},undefined,2,2,ECONOMIC_POLICY);
}
it("approves only independently reviewed current Revenue and Fees despite residual text change, and holds required parent holders",async()=>{
  const fetcher=upstream();const result=await assess();
  expect(fetcher).toHaveBeenCalledTimes(2);expect(result.bundle.economicProvenance?.state).toBe("verified");
  expect(result.value?.map(d=>[d!.metric,d!.kind,d!.disposition])).toEqual([["Revenue","protocol_revenue","approved"],["Fees","user_fees","approved"],["HoldersRevenue","unknown","pending"]]);
  const grouped=await captureSourceBundle(at,null,async()=>{await acquireEconomicProvenance();const defs=aggregateDefinitions([row()],()=>"parent","Revenue");
    return combineFundamentals(defs.get("parent") as any,undefined,[row()]);},undefined,2,2,ECONOMIC_POLICY);
  expect(metricDecisionHeld({fundamentals:grouped.value},"Revenue")).toBe(false);
  expect(metricDecisionHeld({fundamentals:grouped.value},"HoldersRevenue")).toBe(true);
  expect(grouped.value?.holderShareReviewed).toBe(false);
  vi.stubGlobal("fetch",()=>{throw new Error("Replay network prohibited");});
  const replay=await replaySourceBundle(result.bundle,async()=>{await acquireEconomicProvenance();return ["Revenue","Fees","HoldersRevenue"].map(m=>economicDecision(row(),m as "Revenue"));});
  expect(replay).toEqual(result.value);
});
it.each(["fees/fwa/index.ts","adapters/types.ts","helpers/chains.ts","package.json","pnpm-lock.yaml"])("same wording with changed %s cannot renew code-backed decisions",async path=>{
  upstream(path);const result=await assess();expect(result.bundle.economicProvenance?.state).toBe("changed");
  expect(result.value?.every(d=>d!.disposition==="pending")).toBe(true);
});
it.each(["commit","tree","truncated"] as const)("missing or invalid %s evidence does not fall back to legacy approval",async fail=>{
  upstream(undefined,fail);const result=await assess({...row(),methodology:{...contract.expectedDefinitions}});
  expect(result.value?.every(d=>d!.disposition==="evidence-unavailable")).toBe(true);
});
it("invalidates only the reviewed metric's dependent definition; a current Fees contract remains independent",async()=>{
  upstream();const r=row();r.methodology.Revenue="Recipients and funding changed";
  const result=await assess(r);expect(result.value?.[0]?.disposition).toBe("pending");expect(result.value?.[1]?.disposition).toBe("approved");
});
it("irrelevant residual wording, unrelated adapter revisions and newer receipt observations leave Revenue and raw date identity stable",async()=>{
  upstream();const first=await captureSourceBundle(at,null,async()=>{await acquireEconomicProvenance();return aggregateDefinitions([row()],()=>"parent","Revenue").get("parent");},undefined,2,2,ECONOMIC_POLICY);
  const changed={...row(),methodology:{...row().methodology,ProtocolRevenue:"A new residual description"}};
  upstream("fees/geodnet.ts");
  const next=await captureSourceBundle(at,null,async()=>{await acquireEconomicProvenance();return aggregateDefinitions([changed],()=>"parent","Revenue").get("parent");},undefined,2,2,ECONOMIC_POLICY);
  expect(next.value?.components[0].decision?.disposition).toBe("approved");
  expect(next.value?.fingerprint).toBe(first.value?.fingerprint);
  expect(physicalSeriesFingerprint([changed],"Revenue")).toBe(physicalSeriesFingerprint([row()],"Revenue"));
  expect(next.value?.legacyPhysicalFingerprint).not.toBe(first.value?.legacyPhysicalFingerprint);
});
it("legacy reviewed exclusions have one decision in the fundamentals and holder eligibility consumers",async()=>{
  const slug="minswap-aggregator",r={slug,name:"Minswap Aggregator",methodology:legacy[slug].methodology,total30d:100};
  const result=await captureSourceBundle(at,null,async()=>({fund:combineFundamentals(undefined,undefined,[r]),holder:aggregateHolderValueByGroup([r],s=>s).get(slug)}),undefined,2,2,ECONOMIC_POLICY);
  expect(result.value?.fund.holders[0].decision).toMatchObject({disposition:"reviewed-unavailable",holderEligible:false});
  expect(result.value?.holder?.components[0].decision).toEqual(result.value?.fund.holders[0].decision);
});
it("rejects identity reuse, parent scope changes and unproved rename",async()=>{
  upstream();for(const r of [{...row(),module:"unreviewed-module"},{...row(),name:"New Name"},{...row(),parentProtocol:"parent#other"},{...row(),defillamaId:"new-id"}]) {
    expect((await assess(r)).value?.[0]?.disposition).toBe("pending");
  }
});
it("a known Lido contract cannot downgrade to its weaker legacy approval after ID reuse or an unproved alias",async()=>{
  upstream();const c=economicArtifact.contracts.find(c=>c.slug==="lido")!;
  for(const r of [{slug:"lido",defillamaId:"wrong-id",methodology:legacy.lido.methodology},{slug:"new-alias",defillamaId:c.providerId,methodology:legacy.lido.methodology}]) {
    const result=await captureSourceBundle(at,null,async()=>economicDecision(r,"Revenue"),undefined,2,2,ECONOMIC_POLICY);
    expect(result.value).toMatchObject({basis:"reviewed-code-contract",disposition:"evidence-unavailable",kind:"unknown"});
  }
});
it("legacy approvals retain all six fields and do not acquire scoped continuity",async()=>{
  upstream();const r={slug:"fake-world-assets-v2",defillamaId:"8767",name:"Fake World Assets V2",methodology:{...legacy["fake-world-assets-v2"].methodology,ProtocolRevenue:"changed"}};
  const result=await captureSourceBundle(at,null,async()=>economicDecision(r,"Fees"),undefined,2,2,ECONOMIC_POLICY);
  expect(result.value).toMatchObject({basis:"legacy-definition-only",disposition:"pending",kind:"unknown",changedFields:["ProtocolRevenue"]});
});
it("does not silently treat unresolved holders as a reviewed exclusion",async()=>{
  upstream();const result=await captureSourceBundle(at,null,async()=>{await acquireEconomicProvenance();return aggregateHolderValueByGroup([row()],()=>"parent",()=>false).get("parent");},undefined,2,2,ECONOMIC_POLICY);
  expect(result.value?.components[0]).toMatchObject({eligible:false,current30d:20,decision:{disposition:"pending"}});
});
it("rejects forged policy and provenance, unknown URL and more than two provenance receipts",async()=>{
  upstream();await expect(captureSourceBundle(at,null,async()=>null,undefined,2,2,{...ECONOMIC_POLICY,sha256:"a".repeat(64)})).rejects.toThrow("policy artifact");
  const result=await assess();result.bundle.economicProvenance!.commit="f".repeat(40);
  await expect(replaySourceBundle(result.bundle,acquireEconomicProvenance)).rejects.toThrow("provenance replay mismatch");
  result.bundle.receipts.push(result.bundle.receipts[0]);
  await expect(replaySourceBundle(result.bundle,async()=>null)).rejects.toThrow("budget exceeded");
});
