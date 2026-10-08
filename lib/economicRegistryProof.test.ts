import {expect,it} from "vitest";
import {registryDecisionProofMatches,REVIEWED_LITERAL_REGISTRY_PROOF} from "./economicRegistryProof";
import {reviewedRegistryProjection} from "./economicProvenanceV3";
import chains from "./fixtures/economic-chains-runtime-v3.json";
import type {EconomicProvenance} from "./economicTypes";

type Proof=NonNullable<NonNullable<EconomicProvenance["runtime"]>["literalRegistry"]>;
const proof=():Proof=>({...REVIEWED_LITERAL_REGISTRY_PROOF,state:"matched",actualBlobSha1:chains.blobSha1,rawSha256:chains.sha256,addedMembers:["DERIVE_V3"]});
it("binds browser expectations to the complete server-derived reviewed projection and closure",()=>{
 expect(REVIEWED_LITERAL_REGISTRY_PROOF).toEqual({path:chains.path,projectionSha256:reviewedRegistryProjection.projectionSha256,consumerClosureSha256:reviewedRegistryProjection.consumerClosureSha256});
 expect(registryDecisionProofMatches(proof())).toBe(true);
 expect(registryDecisionProofMatches({...proof(),addedMembers:[]})).toBe(true);
 expect(registryDecisionProofMatches({...proof(),addedMembers:["ANOTHER_UNUSED_LITERAL"]})).toBe(true);
});
it.each([
 ["path","helpers/other.ts"],
 ["state","changed"],["state","unavailable"],
 ["actualBlobSha1",null],["actualBlobSha1","a".repeat(39)],["actualBlobSha1","A".repeat(40)],
 ["rawSha256",null],["rawSha256","a".repeat(63)],["rawSha256","A".repeat(64)],
 ["projectionSha256",null],["projectionSha256","f".repeat(64)],
 ["consumerClosureSha256",null],["consumerClosureSha256","f".repeat(64)],
 ["addedMembers",null],["addedMembers",{}],
])("rejects invalid %s proof (%s)",(field,value)=>{
 expect(registryDecisionProofMatches({...proof(),[field as string]:value} as Proof)).toBe(false);
});
it("rejects missing registry proof",()=>{expect(registryDecisionProofMatches(undefined)).toBe(false);});
