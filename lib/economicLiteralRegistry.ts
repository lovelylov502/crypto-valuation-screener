import {parse} from "@babel/parser";
import {posix} from "node:path";
import {contextHash,gitBlobHash,CONTEXT_FILE_LIMIT} from "./economicContext";
import {contentHash} from "./sourceBundle";

export interface RegistryClosureFile {path:string;blobSha1:string;sha256:string;body:string}
export interface LiteralRegistryContract extends RegistryClosureFile {
 exportName:string;closure:RegistryClosureFile[];consumers:{path:string;members:string[]}[];
}
function ast(body:string):any {
 if(Buffer.byteLength(body)>CONTEXT_FILE_LIMIT)throw Error("Economic registry file too large");
 const parsed=parse(body,{sourceType:"module",plugins:["typescript"],attachComment:false,errorRecovery:false});let nodes=0;
 const clean=(v:any,depth:number):any=>{if(depth>64||++nodes>60000)throw Error("Economic registry AST bound");if(Array.isArray(v))return v.map(x=>clean(x,depth+1));if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).filter(([k])=>!["start","end","loc","extra","leadingComments","trailingComments","innerComments"].includes(k)).map(([k,x])=>[k,clean(x,depth+1)]));return v;};
 return clean(parsed.program,0);
}
function registry(body:string,name:string) {
 const program=ast(body),statement=program.body[0],declaration=statement?.declaration;
 if(program.directives.length||program.body.length!==1||statement.type!=="ExportNamedDeclaration"||statement.source||statement.specifiers.length||declaration?.type!=="TSEnumDeclaration"||declaration.id.type!=="Identifier"||declaration.id.name!==name||declaration.const||declaration.declare)throw Error("Unsupported literal registry structure");
 const entries:[string,string][]=declaration.body.members.map((m:any)=>{if(m.id.type!=="Identifier"||m.initializer?.type!=="StringLiteral"||["__proto__","prototype","constructor"].includes(m.id.name))throw Error("Unsupported literal registry member");return [m.id.name,m.initializer.value];});
 if(new Set(entries.map(([n])=>n)).size!==entries.length)throw Error("Conflicting literal registry member");
 return {program,declaration,entries};
}
const modulePath=(file:string,source:string)=>source.startsWith(".")?posix.normalize(posix.join(posix.dirname(file),source)).replace(/\.ts$/,""):source;
/** Only direct named imports and noncomputed member reads are supported. No upstream code is executed. */
export function staticRegistryMembers(body:string,path:string,registryPath:string,name:string):string[] {
 const program=ast(body),target=registryPath.replace(/\.ts$/,""),imports:any[]=[];
 for(const n of program.body) {
  if(n.source?.type==="StringLiteral"&&modulePath(path,n.source.value)===target) {
   if(n.type!=="ImportDeclaration"||n.importKind==="type"||n.specifiers.length!==1)throw Error("Unsupported registry import edge");
   const s=n.specifiers[0];if(s.type!=="ImportSpecifier"||s.importKind==="type"||s.imported.type!=="Identifier"||s.imported.name!==name||s.local.name!==name)throw Error("Registry import alias unsupported");imports.push(s);
  }
 }
 if(imports.length>1)throw Error("Duplicate registry import");
 const members=new Set<string>();
 const walk=(n:any,parent:any,key:string,ancestors:any[])=>{
  if(!n||typeof n!=="object")return;
  if(n.type==="ImportExpression"||n.type==="TSImportEqualsDeclaration"||n.type==="CallExpression"&&n.callee?.type==="Identifier"&&["eval","require","Function"].includes(n.callee.name)||n.type==="NewExpression"&&n.callee?.name==="Function")throw Error("Dynamic registry closure unsupported");
  if(n.type==="Identifier"&&n.name===name) {
   if(imports.includes(parent)&&(key==="imported"||key==="local"))return;
   if(imports.length!==1||parent?.type!=="MemberExpression"||key!=="object"||parent.computed||parent.optional||parent.property.type!=="Identifier")throw Error("Nonstatic registry consumption");
   let target=parent;
   for(let i=ancestors.length-2;i>=0;i--) {
    const owner=ancestors[i];
    if(owner.type==="AssignmentExpression"&&owner.left===target||owner.type==="UpdateExpression"||owner.type==="UnaryExpression"&&owner.operator==="delete"||["ForInStatement","ForOfStatement"].includes(owner.type)&&owner.left===target)throw Error("Registry mutation unsupported");
    const wrapper=["TSAsExpression","TSTypeAssertion","TSNonNullExpression","ParenthesizedExpression"].includes(owner.type)&&owner.expression===target||["ArrayPattern","ArrayExpression"].includes(owner.type)&&owner.elements.includes(target)||["ObjectPattern","ObjectExpression"].includes(owner.type)&&owner.properties.includes(target)||owner.type==="ObjectProperty"&&owner.value===target||owner.type==="AssignmentPattern"&&owner.left===target||owner.type==="RestElement"&&owner.argument===target||owner.type==="MemberExpression"&&owner.object===target;
    if(!wrapper)break;target=owner;
   }
   members.add(parent.property.name);
  }
  for(const [k,v] of Object.entries(n))if(Array.isArray(v)){for(const child of v)walk(child,n,k,[...ancestors,n]);}else if(v&&typeof v==="object")walk(v,n,k,[...ancestors,n]);
 };
 walk(program,null,"",[]);if(imports.length&&!members.size)throw Error("Unproved registry consumption");return [...members].sort();
}
/** The complete retained closure is frozen; additions can change neither old enum structure nor its consumed projection. */
export function literalRegistryProjection(contract:LiteralRegistryContract,current:string) {
 if(gitBlobHash(contract.body)!==contract.blobSha1||contentHash(contract.body)!==contract.sha256||contract.closure.length>64||new Set(contract.closure.map(f=>f.path)).size!==contract.closure.length)throw Error("Unbound registry contract");
 if(contract.closure.some(f=>gitBlobHash(f.body)!==f.blobSha1||contentHash(f.body)!==f.sha256))throw Error("Unbound registry closure");
 const before=registry(contract.body,contract.exportName),after=registry(current,contract.exportName),names=new Set(before.entries.map(([n])=>n));
 const additions=after.entries.filter(([n])=>!names.has(n)),oldValues=new Set(before.entries.map(([,v])=>v));
 if(additions.some(([,v])=>oldValues.has(v))||new Set(additions.map(([,v])=>v)).size!==additions.length)throw Error("Conflicting added registry value");
 after.declaration.body.members=after.declaration.body.members.filter((m:any)=>names.has(m.id.name));
 if(contextHash(before.program)!==contextHash(after.program))throw Error("Existing literal registry changed");
 const consumers=contract.closure.filter(f=>f.path!==contract.path&&f.path.endsWith(".ts")).map(f=>{
  return {path:f.path,members:staticRegistryMembers(f.body,f.path,contract.path,contract.exportName)};
 }).filter(f=>f.members.length);
 if(contextHash(consumers)!==contextHash(contract.consumers))throw Error("Incomplete registry consumer proof");
 const values=new Map(before.entries);if(consumers.some(c=>c.members.some(n=>!values.has(n))))throw Error("Unknown consumed registry member");
 return {projectionSha256:contextHash(consumers.map(c=>({path:c.path,members:c.members.map(n=>[n,values.get(n)])}))),consumerClosureSha256:contextHash(contract.closure.map(f=>[f.path,f.blobSha1,f.sha256])),addedMembers:additions.map(([n])=>n)};
}
