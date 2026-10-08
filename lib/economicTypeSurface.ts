import {parse} from "@babel/parser";
import {contextHash,CONTEXT_FILE_LIMIT} from "./economicContext";
export interface ReviewedDimensionAddition {name:string;value:string;resultType:string;keys:string[]}
function ast(body:string):any[] {
 if(Buffer.byteLength(body)>CONTEXT_FILE_LIMIT)throw Error("Economic type surface too large");
 const tree=parse(body,{sourceType:"module",plugins:["typescript"],attachComment:false,errorRecovery:false});let nodes=0;
 const clean=(v:any,depth:number):any=>{if(depth>64||++nodes>60000)throw Error("Economic type AST bound");if(Array.isArray(v))return v.map(x=>clean(x,depth+1));if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).filter(([k])=>!["start","end","loc","extra","leadingComments","trailingComments","innerComments"].includes(k)).map(([k,x])=>[k,clean(x,depth+1)]));return v;};
 return clean(tree.program.body,0);
}
const declaration=(n:any)=>n.type==="ExportNamedDeclaration"?n.declaration:n;
const erased=(n:any)=>["TSTypeAliasDeclaration","TSInterfaceDeclaration"].includes(declaration(n)?.type);
function enumEntries(n:any):[string,string][] {
 if(n.type!=="TSEnumDeclaration"||n.id.name!=="AdapterType"||n.const||n.declare)throw Error("Unreviewed AdapterType declaration");
 const result=n.body.members.map((m:any)=>{if(m.id.type!=="Identifier"||m.initializer?.type!=="StringLiteral")throw Error("Nonliteral adapter dimension");return [m.id.name,m.initializer.value] as [string,string];});
 if(new Set(result.map((x:any)=>x[0])).size!==result.length||new Set(result.map((x:any)=>x[1])).size!==result.length)throw Error("Duplicate adapter dimension");return result;
}
/** Adapter-local erasure plus a reviewed additive runtime surface; no execution or global framework equivalence. */
export function typeSurfaceMatches(previous:string,current:string,additions:ReviewedDimensionAddition[]):boolean {
 const before=ast(previous),after=ast(current),oldEnum=before.map(declaration).find(n=>n?.type==="TSEnumDeclaration"&&n.id.name==="AdapterType"),nextEnum=after.map(declaration).find(n=>n?.type==="TSEnumDeclaration"&&n.id.name==="AdapterType");
 const oldEntries=enumEntries(oldEnum),nextEntries=enumEntries(nextEnum),oldNames=new Set(oldEntries.map(([n])=>n));
 for(const [name,value] of nextEntries.filter(([n])=>!oldNames.has(n)))if(!additions.some(a=>a.name===name&&a.value===value))return false;
 nextEnum.body.members=nextEnum.body.members.filter((m:any)=>oldNames.has(m.id.name));
 const oldSet=before.map(declaration).find(n=>n?.type==="VariableDeclaration"&&n.declarations.some((d:any)=>d.id.name==="whitelistedDimensionKeys")),nextSet=after.map(declaration).find(n=>n?.type==="VariableDeclaration"&&n.declarations.some((d:any)=>d.id.name==="whitelistedDimensionKeys"));
 const array=(n:any)=>{const init=n?.declarations?.find((d:any)=>d.id.name==="whitelistedDimensionKeys")?.init;if(init?.type!=="NewExpression"||init.callee.type!=="Identifier"||init.callee.name!=="Set"||init.arguments.length!==1||init.arguments[0].type!=="ArrayExpression"||init.arguments[0].elements.some((e:any)=>e&&e.type!=="StringLiteral"))throw Error("Unreviewed dimension whitelist");return init.arguments[0];};
 const oldArray=array(oldSet),nextArray=array(nextSet),oldKeys=new Set(oldArray.elements.filter(Boolean).map((e:any)=>e.value));
 const extra=nextArray.elements.filter((e:any)=>e&&!oldKeys.has(e.value));if(new Set(extra.map((e:any)=>e.value)).size!==extra.length)return false;
 for(const e of extra) {
  const addition=additions.find(a=>a.keys.includes(e.value));if(!addition||!nextEntries.some(([n,v])=>n===addition.name&&v===addition.value))return false;
  const type=after.map(declaration).find(n=>n?.type==="TSTypeAliasDeclaration"&&n.id.name===addition.resultType),intersection=type?.typeAnnotation;
  if(intersection?.type!=="TSIntersectionType"||intersection.types.length!==2||intersection.types[0].type!=="TSTypeReference"||intersection.types[0].typeName.name!=="FetchResultBase"||intersection.types[1].type!=="TSTypeLiteral")return false;
  const keys=intersection.types[1].members.map((m:any)=>m.type==="TSPropertySignature"&&m.optional===true&&m.key.type==="Identifier"&&m.typeAnnotation?.typeAnnotation?.type==="TSTypeReference"&&m.typeAnnotation.typeAnnotation.typeName.name==="FetchResponseValue"?m.key.name:null);
  if(keys.includes(null)||contextHash([...keys].sort())!==contextHash([...addition.keys].sort()))return false;
 }
 nextArray.elements=nextArray.elements.filter((e:any)=>!e||oldKeys.has(e.value));
 return contextHash(before.filter(n=>!erased(n)))===contextHash(after.filter(n=>!erased(n)));
}
