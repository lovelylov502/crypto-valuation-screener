import {expect,it} from "vitest";
import artifact from "./economic-policy-v2.json";
import actual from "./fixtures/economic-types-runtime-v2.json";
import {typeSurfaceMatches} from "./economicTypeSurface";
import {gitBlobHash} from "./economicContext";
const old=artifact.context.typeSurface,check=(body:string)=>typeSurfaceMatches(old.body,body,old.additions);
it("accepts the actual additive bridge surface using structure and erased-edge proof, not the current blob as an allowance",()=>{
 expect(gitBlobHash(actual.body)).toBe(actual.blobSha1);expect(check(actual.body)).toBe(true);expect(check(actual.body+'\nexport interface UnrelatedPureType {x?: number}\n')).toBe(true);expect(check(old.body)).toBe(true);
});
it("rejects changed fee routing/old memberships, unknown dimensions, new runtime expressions, constructors, modifiers and shadowing",()=>{
 const bad=[actual.body.replace("FEES = 'fees'","FEES = 'other'"),actual.body.replace("'dailyRevenue',",""),actual.body.replace("new Set([","new Map(["),actual.body.replace("export const ADAPTER_TYPES","export let ADAPTER_TYPES"),actual.body.replace("adapterType !== AdapterType.PROTOCOLS","adapterType !== AdapterType.FEES"),actual.body.replace("BRIDGES = 'bridges'","BRIDGES = 'fees'"),actual.body.replace("BRIDGES = 'bridges'","BRIDGES = compute()"),actual.body.replace("BRIDGES = 'bridges'","UNKNOWN = 'unknown'"),actual.body.replace("'dailyOutgoingVolume', 'dailyIncomingVolume',","...moreKeys,"),actual.body+'\nObject.assign(AdapterType, {FEES:"other"});',actual.body+'\nconst Set = class {};',actual.body+'\nimport "side-effects";'];
 for(const body of bad){let allowed=false;try{allowed=check(body);}catch{}expect(allowed).toBe(false);}
});
