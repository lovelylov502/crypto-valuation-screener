import {createHash} from "node:crypto";
import {parseTree,getNodeValue,type Node} from "jsonc-parser";
import {parseDocument,isAlias,isMap,isScalar,isSeq} from "yaml";

export const CONTEXT_PATHS=["package.json","pnpm-lock.yaml","tsconfig.json"] as const;
export const CONTEXT_FILE_LIMIT=1_000_000,CONTEXT_TOTAL_LIMIT=2_000_000;
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const contextHash=(v:unknown)=>createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
export const gitBlobHash=(body:string)=>createHash("sha1").update(`blob ${Buffer.byteLength(body)}\0`).update(body).digest("hex");
function bounded(body:string){if(Buffer.byteLength(body)>CONTEXT_FILE_LIMIT)throw Error("Economic context file too large");}
export function contextJson(body:string):Record<string,any> {
 bounded(body);const errors:any[]=[],root=parseTree(body,errors,{allowTrailingComma:true,disallowComments:false});let nodes=0;
 const walk=(n:Node,depth:number)=>{if(++nodes>60000||depth>32)throw Error("Economic context JSON bound");if(n.type==="object") {const names=n.children?.map(p=>p.children![0].value)??[];if(new Set(names).size!==names.length)throw Error("Economic context duplicate key");}for(const c of n.children??[])walk(c,depth+1);};
 if(errors.length||!root||root.type!=="object")throw Error("Invalid economic context JSON");walk(root,0);return getNodeValue(root);
}
export function contextYaml(body:string):Record<string,any> {
 bounded(body);const doc=parseDocument(body,{uniqueKeys:true,merge:false,schema:"core"});let nodes=0;
 const walk=(n:any,depth:number)=>{if(++nodes>60000||depth>32)throw Error("Economic context YAML bound");if(isAlias(n)||n?.tag)throw Error("Economic context YAML alias/tag unsupported");if(isMap(n))for(const p of n.items){if(!isScalar(p.key)||typeof p.key.value!=="string"||p.key.value==="<<")throw Error("Economic context YAML key unsupported");walk(p.value,depth+1);}else if(isSeq(n))for(const c of n.items)walk(c,depth+1);};
 if(doc.errors.length||!isMap(doc.contents))throw Error("Invalid economic context YAML");walk(doc.contents,0);return doc.toJS({maxAliasCount:0});
}
/** Frozen repository execution contract: no runtime compiler, inference of custom loaders, or dependency crawl. */
export function projectEconomicContext(contents:Record<typeof CONTEXT_PATHS[number],string>,roots:string[]) {
 if(CONTEXT_PATHS.reduce((n,p)=>n+Buffer.byteLength(contents[p]),0)>CONTEXT_TOTAL_LIMIT)throw Error("Economic context total too large");
 const pkg=contextJson(contents["package.json"]),config=contextJson(contents["tsconfig.json"]),lock=contextYaml(contents["pnpm-lock.yaml"]);
 if(Object.keys(config).some(k=>!["compilerOptions","ts-node","include","exclude","files"].includes(k)))throw Error("Unknown economic execution config");
 const ignored=["skipLibCheck","strict","forceConsistentCasingInFileNames","noImplicitThis","noUnusedLocals","noUnusedParameters","lib"],relevant=["target","esModuleInterop","allowSyntheticDefaultImports","module","moduleResolution","resolveJsonModule","noEmit","jsx","allowJs"];
 if(!config.compilerOptions||Object.keys(config.compilerOptions).some(k=>![...ignored,...relevant].includes(k))||Object.keys(config["ts-node"]??{}).some(k=>k!=="compilerOptions")||Object.keys(config["ts-node"]?.compilerOptions??{}).some(k=>k!=="module"))throw Error("Unreviewed compiler/loader option");
 if(lock.lockfileVersion!=="9.0"||!lock.importers?.["."]||!lock.packages||!lock.snapshots||roots.length>24||new Set(roots).size!==roots.length||pkg.pnpm||pkg.overrides||pkg.resolutions)throw Error("Unreviewed package execution context");
 const importer=lock.importers["."],packages:Record<string,unknown>={},resolved:Record<string,string>={};
 const visit=(name:string,version:string)=>{
  if(typeof version!=="string"||!/^[0-9]/.test(version))throw Error("Unresolved runtime dependency");
  const key=`${name}@${version}`,plain=`${name}@${version.split("(")[0]}`;if(packages[key])return;
  const metadata=lock.packages[plain],snapshot=lock.snapshots[key];
  if(!metadata||!snapshot||typeof metadata.resolution?.integrity!=="string"||!/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(metadata.resolution.integrity)||metadata.resolution.tarball||Object.keys(snapshot).some(k=>!["dependencies","optionalDependencies","transitivePeerDependencies","optional"].includes(k)))throw Error("Unproved locked runtime package");
  if(Object.keys(packages).length>=512)throw Error("Runtime dependency graph too large");
  packages[key]={metadata,snapshot};
  for(const [child,v] of Object.entries({...snapshot.dependencies,...snapshot.optionalDependencies}))visit(child,v as string);
 };
 for(const name of [...roots].sort()) {
  const declaration=pkg.dependencies?.[name]??pkg.devDependencies?.[name],r=importer.dependencies?.[name]??importer.devDependencies?.[name];
  if(typeof declaration!=="string"||r?.specifier!==declaration||typeof r.version!=="string")throw Error("Runtime root/lock mismatch");resolved[name]=r.version;visit(name,r.version);
 }
 return {compilerOptions:Object.fromEntries(relevant.map(k=>[k,config.compilerOptions[k]??null])),tsnode:config["ts-node"]??null,
  scripts:Object.fromEntries(["test","pretest","posttest","build","prebuild","postbuild","preinstall","install","postinstall","prepare","prepublish","prepublishOnly","prepack","postpack"].map(k=>[k,pkg.scripts?.[k]??null])),packageMode:{type:pkg.type??null,main:pkg.main??null,exports:pkg.exports??null,imports:pkg.imports??null},lockSettings:lock.settings??null,lockOverrides:lock.overrides??null,resolved,packages};
}
