import { afterEach, expect, it, vi } from "vitest";
import { publishJournal } from "../scripts/github-journal";
import { startJournal, JOURNAL_REPOSITORY } from "./publication";
import { sha256 } from "./snapshotArchive";
function fixture(){return startJournal(null,{id:"data-1",startedAt:"2026-09-29T10:00:00Z",completedAt:null,outcome:"running",runUrl:"https://github.com/run",reportUrl:"https://github.com/report",errors:[],sourceFailures:[],affectedProjects:0,changeCount:0,affected:[]},"data-1-start");}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
function environment(){vi.stubEnv("GITHUB_ACTIONS","true");vi.stubEnv("GITHUB_REPOSITORY",JOURNAL_REPOSITORY);vi.stubEnv("GITHUB_REF","refs/heads/main");vi.stubEnv("GITHUB_TOKEN","fake-test-token");vi.stubEnv("GITHUB_SHA","abc");}
it("never publishes a partial upload or a digest mismatch",async()=>{
  environment();const events:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:URL|string,init:RequestInit={})=>{
    const u=String(url);events.push(`${init.method??"GET"} ${u}`);
    if(u.endsWith("/latest"))return new Response("",{status:404});
    if(u.includes("uploads.github.com"))return Response.json({digest:"sha256:wrong"});
    return Response.json({id:1,upload_url:`https://uploads.github.com/repos/${JOURNAL_REPOSITORY}/releases/1/assets{?name}`});
  }));
  await expect(publishJournal(fixture(),{"data.json.gz":Buffer.from("data")})).rejects.toThrow("hash mismatch");
  expect(events.some(e=>e.startsWith("PATCH"))).toBe(false);
});
it("publishes only after every asset matches its hash and rejects a changed parent",async()=>{
  environment();let latestReads=0;const events:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:URL|string,init:RequestInit={})=>{
    const u=String(url);events.push(`${init.method??"GET"} ${u}`);
    if(u.endsWith("/latest")){latestReads++;return latestReads===1?new Response("",{status:404}):Response.json({body:JSON.stringify({...fixture(),id:"data-newer"})});}
    if(u.includes("uploads.github.com"))return Response.json({digest:`sha256:${sha256(init.body as Uint8Array)}`});
    return Response.json({id:1,upload_url:`https://uploads.github.com/repos/${JOURNAL_REPOSITORY}/releases/1/assets{?name}`});
  }));
  await expect(publishJournal(fixture(),{"data.json.gz":Buffer.from("data")})).rejects.toThrow("stale writer");
  expect(events.filter(e=>e.startsWith("POST https://uploads")).length).toBe(2);
  expect(events.some(e=>e.startsWith("PATCH"))).toBe(false);
});
it("refuses all local/manual non-workflow writers",async()=>{
  vi.stubEnv("GITHUB_ACTIONS","false");const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(publishJournal(fixture(),{})).rejects.toThrow("serialized canonical main workflow");expect(fetch).not.toHaveBeenCalled();
});
