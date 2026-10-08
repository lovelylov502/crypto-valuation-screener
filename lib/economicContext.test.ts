import {expect,it} from "vitest";
import {contextHash,contextJson,contextYaml,projectEconomicContext} from "./economicContext";
const pkg={scripts:{test:"ts-node --transpile-only cli/testAdapter.ts",build:"ts-node --transpile-only cli/buildModules.ts"},dependencies:{sdk:"1.0.0"},devDependencies:{typescript:"5.9.3","ts-node":"10.9.2"}};
const config={"ts-node":{compilerOptions:{module:"commonjs"}},compilerOptions:{target:"ES2020",module:"esnext",strict:true}};
const lock=`lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      sdk: {specifier: 1.0.0, version: 1.0.0}
    devDependencies:
      typescript: {specifier: 5.9.3, version: 5.9.3}
      ts-node: {specifier: 10.9.2, version: 10.9.2}
packages:
  sdk@1.0.0: {resolution: {integrity: sha512-YQ==}}
  dependency@2.0.0: {resolution: {integrity: sha512-Yg==}}
  typescript@5.9.3: {resolution: {integrity: sha512-Yw==}}
  ts-node@10.9.2: {resolution: {integrity: sha512-ZA==}}
snapshots:
  sdk@1.0.0: {dependencies: {dependency: 2.0.0}}
  dependency@2.0.0: {}
  typescript@5.9.3: {}
  ts-node@10.9.2: {}
`;
const contents=()=>({"package.json":JSON.stringify(pkg),"tsconfig.json":JSON.stringify(config),"pnpm-lock.yaml":lock});
const roots=["sdk","typescript","ts-node"];
it("binds exact resolved transitive integrities while unrelated scripts/dependencies/lock entries and type-check options stay independent",()=>{
 const a=contents(),b=contents();b["package.json"]=JSON.stringify({...pkg,scripts:{...pkg.scripts,unrelated:"new task"},dependencies:{...pkg.dependencies,unrelated:"3.0.0"}});b["pnpm-lock.yaml"]=lock.replace("    dependencies:\n", "    dependencies:\n      unrelated: {specifier: 3.0.0, version: 3.0.0}\n").replace("packages:\n","packages:\n  unrelated@3.0.0: {resolution: {integrity: sha512-Zg==}}\n").replace("snapshots:\n","snapshots:\n  unrelated@3.0.0: {}\n");b["tsconfig.json"]=JSON.stringify({...config,compilerOptions:{...config.compilerOptions,strict:false,skipLibCheck:true}});
 expect(contextHash(projectEconomicContext(b,roots))).toBe(contextHash(projectEconomicContext(a,roots)));
 for(const hook of ["pretest","prebuild","postinstall","prepare"]){const changed={...a,"package.json":JSON.stringify({...pkg,scripts:{...pkg.scripts,[hook]:"node mutate-runtime.js"}})};expect(contextHash(projectEconomicContext(changed,roots))).not.toBe(contextHash(projectEconomicContext(a,roots)));}
 b["pnpm-lock.yaml"]=lock.replace("dependency@2.0.0: {resolution: {integrity: sha512-Yg==}}","dependency@2.0.0: {resolution: {integrity: sha512-ZQ==}}");expect(contextHash(projectEconomicContext(b,roots))).not.toBe(contextHash(projectEconomicContext(a,roots)));
});
it("holds unproved emission preservation, custom loaders, inheritance, references, unresolved roots and changed locked packages",()=>{
 for(const change of [{...config,extends:"./other.json"},{...config,references:[]},{...config,compilerOptions:{...config.compilerOptions,verbatimModuleSyntax:true}},{...config,"ts-node":{...config["ts-node"],compiler:"other"}},{...config,"ts-node":{...config["ts-node"],require:["hook"]}}])expect(()=>projectEconomicContext({...contents(),"tsconfig.json":JSON.stringify(change)},roots)).toThrow();
 expect(()=>projectEconomicContext(contents(),["missing"])).toThrow("root/lock");expect(()=>projectEconomicContext({...contents(),"pnpm-lock.yaml":lock.replace("sha512-Yg==","unproved")},roots)).toThrow("runtime package");
 const other={...config,compilerOptions:{...config.compilerOptions,module:"commonjs"}};expect(contextHash(projectEconomicContext({...contents(),"tsconfig.json":JSON.stringify(other)},roots))).not.toBe(contextHash(projectEconomicContext(contents(),roots)));
});
it("accepts official JSONC syntax but rejects duplicate keys, aliases, merges, tags, oversized or deeply nested data",()=>{
 expect(contextJson('{/* official */"compilerOptions":{"target":"ES2020",},}')).toEqual({compilerOptions:{target:"ES2020"}});
 expect(()=>contextJson('{"same":1,"same":2}')).toThrow("duplicate");expect(()=>contextYaml('a: 1\na: 2')).toThrow();
 for(const text of ['a: &x {v: 1}\nb: *x','a: {"<<": {v: 1}}','a: !custom 1'])expect(()=>contextYaml(text)).toThrow();
 expect(()=>contextJson(' '.repeat(1_000_001))).toThrow("too large");expect(()=>contextJson('{"x":'+('['.repeat(35))+'0'+(']'.repeat(35))+'}')).toThrow("bound");
});
