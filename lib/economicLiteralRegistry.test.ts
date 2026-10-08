import {expect,it} from "vitest";
import artifact from "./economic-policy-v3.json";
import actual from "./fixtures/economic-chains-runtime-v3.json";
import {literalRegistryProjection,staticRegistryMembers,type LiteralRegistryContract} from "./economicLiteralRegistry";
import {gitBlobHash} from "./economicContext";
import {contentHash} from "./sourceBundle";
const reviewed=artifact.context.literalRegistry as LiteralRegistryContract;
const simple='export enum CHAIN { ETHEREUM = "ethereum", BASE = "base" }';
const importer='import { CHAIN } from "../helpers/chains"; const selected = [CHAIN.ETHEREUM, CHAIN.BASE];';
const file=(path:string,body:string)=>({path,body,blobSha1:gitBlobHash(body),sha256:contentHash(body)});
const contract=():LiteralRegistryContract=>({...file("helpers/chains.ts",simple),exportName:"CHAIN",closure:[file("fees/test.ts",importer),file("helpers/chains.ts",simple)],consumers:[{path:"fees/test.ts",members:["BASE","ETHEREUM"]}]});
it("binds every retained runtime file and derives all ten consumers from immutable source bodies",()=>{
 expect(reviewed.closure).toHaveLength(19);expect(reviewed.consumers).toHaveLength(10);
 const before=literalRegistryProjection(reviewed,reviewed.body),current=literalRegistryProjection(reviewed,actual.body);
 expect(current).toEqual({...before,addedMembers:["DERIVE_V3"]});
 const arbitrary=actual.body.replace(/}\s*$/, '  FUTURE_UNUSED = "future_unused", NEXT_UNUSED = "next_unused",\n}');
 expect(literalRegistryProjection(reviewed,arbitrary)).toEqual({...before,addedMembers:["DERIVE_V3","FUTURE_UNUSED","NEXT_UNUSED"]});
});
it.each([
 ['consumed value',simple.replace('"ethereum"','"changed"')],
 ['unused old value','export enum CHAIN { ETHEREUM = "ethereum", BASE = "other" }'],
 ['deleted member','export enum CHAIN { ETHEREUM = "ethereum" }'],
 ['old order','export enum CHAIN { BASE = "base", ETHEREUM = "ethereum" }'],
 ['duplicate name',simple.replace(' }',', BASE = "other" }')],
 ['conflicting old value',simple.replace(' }',', NEW = "ethereum" }')],
 ['conflicting added values',simple.replace(' }',', ONE = "same", TWO = "same" }')],
 ['computed initializer',simple.replace(' }',', NEW = String("new") }')],
 ['numeric initializer',simple.replace(' }',', NEW = 1 }')],
 ['implicit initializer',simple.replace(' }',', NEW }')],
 ['const modifier',simple.replace('enum','const enum')],
 ['declare modifier',simple.replace('enum','declare enum')],
 ['changed export',simple.replace('export ','')],
 ['extra export',simple+'\nexport const OTHER = 1;'],
 ['import','import "side-effect";\n'+simple],
 ['side effect',simple+'\nObject.keys(CHAIN);'],
 ['directive','"use strict";\n'+simple],
 ['prototype key',simple.replace(' }',', __proto__ = "new" }')],
])("holds %s changes",(_name,body)=>expect(()=>literalRegistryProjection(contract(),body)).toThrow());
it.each([
 'Object.keys(CHAIN)', 'Object.values(CHAIN)', '({...CHAIN})', 'const alias = CHAIN', 'CHAIN["ETHEREUM"]', 'CHAIN[name]',
 'const { ETHEREUM } = CHAIN', 'CHAIN.ETHEREUM = "changed"', 'CHAIN.ETHEREUM++', 'delete CHAIN.ETHEREUM',
 'for (CHAIN.ETHEREUM in obj) {}', 'function shadow(CHAIN) { return CHAIN.BASE; }', 'CHAIN?.ETHEREUM',
 '[CHAIN.ETHEREUM] = ["changed"]', '({x: CHAIN.ETHEREUM} = {x:"changed"})', 'for ([CHAIN.ETHEREUM] of rows) {}',
 '(CHAIN.ETHEREUM as any) = "changed"', 'delete (CHAIN.ETHEREUM as any)',
 'eval("CHAIN.BASE")', 'new Function("return CHAIN")', 'import("../helpers/chains")', 'require("../helpers/chains")',
])("holds unsupported consumer form %s",body=>expect(()=>staticRegistryMembers('import { CHAIN } from "../helpers/chains"; '+body,"fees/test.ts","helpers/chains.ts","CHAIN")).toThrow());
it.each([
 'import { CHAIN as OTHER } from "../helpers/chains"; OTHER.ETHEREUM;',
 'import * as CHAIN from "../helpers/chains"; CHAIN.ETHEREUM;',
 'import CHAIN from "../helpers/chains"; CHAIN.ETHEREUM;',
 'export { CHAIN } from "../helpers/chains";',
 'import { CHAIN, OTHER } from "../helpers/chains"; CHAIN.ETHEREUM;',
])("holds an unsupported import edge",body=>expect(()=>staticRegistryMembers(body,"fees/test.ts","helpers/chains.ts","CHAIN")).toThrow());
it("rejects omitted consumers, detached bodies, unknown members and bounded parser inputs",()=>{
 const omitted=contract();omitted.consumers=[];expect(()=>literalRegistryProjection(omitted,simple)).toThrow("consumer proof");
 const forged=contract();forged.closure[0].body+='\n// detached';expect(()=>literalRegistryProjection(forged,simple)).toThrow("closure");
 const unknown=contract();unknown.closure[0]=file("fees/test.ts",importer.replace("CHAIN.BASE","CHAIN.UNKNOWN"));unknown.consumers[0].members=["ETHEREUM","UNKNOWN"];expect(()=>literalRegistryProjection(unknown,simple)).toThrow("Unknown consumed");
 expect(()=>staticRegistryMembers(" ".repeat(1_000_001),"fees/test.ts","helpers/chains.ts","CHAIN")).toThrow("too large");
});
