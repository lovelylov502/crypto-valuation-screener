import { afterEach, expect, it, vi } from "vitest";
// Exercise the legacy publication protocol under an explicit Phase-A fixture in both release configurations.
vi.mock("./pipeline-release.json",()=>({default:{readerRelease:"four-daily-freshness-v2",writerSchema:1,schedule:"legacy",phaseA:null}}));
import { publishJournal } from "../scripts/github-journal";
import { startJournal, JOURNAL_REPOSITORY } from "./publication";
import { sha256 } from "./snapshotArchive";
import {ECONOMIC_POLICY_IDENTITY} from "./economicPolicyIdentity";
import {hydrateEconomicReview,archiveEconomicReview} from "./economicReviewArchive";
import {createServer} from "node:http";
function fixture(){return startJournal(null,{id:"data-1",startedAt:"2026-09-29T10:00:00Z",completedAt:null,outcome:"running",runUrl:"https://github.com/run",reportUrl:"https://github.com/report",errors:[],sourceFailures:[],affectedProjects:0,changeCount:0,affected:[]},"data-1-start");}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
function environment(){vi.stubEnv("GITHUB_ACTIONS","true");vi.stubEnv("GITHUB_REPOSITORY",JOURNAL_REPOSITORY);vi.stubEnv("GITHUB_REF","refs/heads/main");vi.stubEnv("GITHUB_TOKEN","fake-test-token");vi.stubEnv("GITHUB_SHA","abc");vi.spyOn(console,"log").mockImplementation(()=>{});}

function archive(options: { loseCreate?:boolean;loseUpload?: boolean; losePublish?: boolean; corruptUpload?: boolean; failUpload?: boolean; starter?: boolean; changeParent?: boolean } = {}) {
  environment();
  let release: any = null, latest: any = null, firstUpload = true, firstPublish = true;
  const assets: any[] = [], events: string[] = [],contents=new Map<string,Uint8Array>();
  vi.stubGlobal("fetch",vi.fn(async(url:URL|string,init:RequestInit={})=>{
    const u = new URL(String(url)), method = init.method ?? "GET";
    if(u.hostname === "crypto-valuation-screener.vercel.app") return Response.json({compatibility:{release:"four-daily-freshness-v2",pipelineSchemas:[1,2],journalSchemas:[1,2]},collectionRelease:{writerSchema:1,schedule:"legacy"},deployment:{environment:"production",codeCommit:"a".repeat(40),id:"dpl_reader"}});
    events.push(`${method} ${u.pathname}${u.search}`);
    if(u.hostname==="github.com"&&["/economic-review.json","/state.json"].some(s=>u.pathname.endsWith(s))) {const name=u.pathname.split("/").at(-1)!;return contents.has(name)?new Response(Buffer.from(contents.get(name)!)):new Response(null,{status:404});}
    if (u.pathname.endsWith("/latest")) return latest ? Response.json({ body: JSON.stringify(latest),tag_name:release.tag_name }) : new Response(null,{status:404});
    if (u.pathname.includes("/releases/tags/")) return release && !release.draft ? Response.json(release) : new Response(null,{status:404});
    if (u.pathname.endsWith("/releases") && method === "GET") return Response.json(release ? [release] : []);
    if (u.pathname.endsWith("/releases") && method === "POST") {
      release = { ...JSON.parse(String(init.body)), id: 1, upload_url: `https://uploads.github.com/repos/${JOURNAL_REPOSITORY}/releases/1/assets{?name}` };
      if(options.loseCreate)throw Error("Draft creation response lost");
      return Response.json(release);
    }
    if (u.hostname === "uploads.github.com") {
      const name = u.searchParams.get("name")!;
      if (options.failUpload) return new Response(null, {status:503});
      const asset = { id: assets.length + 1, name, state:"uploaded", size:(init.body as Uint8Array).byteLength, digest:`sha256:${sha256(init.body as Uint8Array)}` };
      if (options.corruptUpload) asset.digest = "sha256:wrong";
      if (options.starter && firstUpload) { asset.state="starter"; asset.size=0; asset.digest=""; }
      assets.push(asset);
      contents.set(name,new Uint8Array(init.body as Uint8Array));
      if ((options.loseUpload || options.starter) && firstUpload) { firstUpload=false; return new Response(null,{status:502}); }
      firstUpload=false;
      if (options.changeParent && name === "state.json") latest={...fixture(),id:"data-newer"};
      return Response.json(asset);
    }
    if (u.pathname.endsWith("/assets") && method === "GET") return Response.json(assets);
    if (u.pathname.includes("/releases/assets/") && method === "DELETE") {
      const index=assets.findIndex(a=>a.id===Number(u.pathname.split("/").at(-1)));assets.splice(index,1);return new Response(null,{status:204});
    }
    if (u.pathname.endsWith("/releases/1") && method === "PATCH") {
      release.draft=false;latest=JSON.parse(release.body);
      if(options.losePublish && firstPublish){firstPublish=false;throw new Error("response lost");}
      return Response.json(release);
    }
    throw new Error(`Unexpected mocked request ${method} ${u}`);
  }));
  return { events, assets, latest:()=>latest?.format?JSON.parse(Buffer.from(contents.get("state.json")!).toString()):latest };
}

it("never publishes corrupt bytes or a changed parent",async()=>{
  const corrupt=archive({corruptUpload:true});
  await expect(publishJournal(fixture(),{"data.json.gz":Buffer.from("data")})).rejects.toThrow("hash mismatch");
  expect(corrupt.events.some(e=>e.startsWith("PATCH"))).toBe(false);
  const changed=archive({changeParent:true});
  await expect(publishJournal(fixture(),{"data.json.gz":Buffer.from("data")})).rejects.toThrow("stale writer");
  expect(changed.events.some(e=>e.startsWith("PATCH"))).toBe(false);
});

it("resumes a lost draft-creation and promotion response using the same compact envelope and verified full state",async()=>{
  const store=archive({loseCreate:true,losePublish:true}),j=fixture();j.attempt.errors=["large diagnostic ".repeat(10000)];
  await publishJournal(j,{});expect(store.latest()).toEqual(j);
  expect(store.events.filter(e=>e===`POST /repos/${JOURNAL_REPOSITORY}/releases`)).toHaveLength(1);
  expect(store.assets.filter(a=>a.name==="state.json")).toHaveLength(1);expect(store.assets.find(a=>a.name==="state.json")!.size).toBeGreaterThan(125000);
});

it("resumes an acknowledged upload after its response failed without creating another release",async()=>{
  const store=archive({loseUpload:true});
  await publishJournal(fixture(),{"data.json.gz":Buffer.from("data")});
  expect(store.events.filter(e=>e === `POST /repos/${JOURNAL_REPOSITORY}/releases`)).toHaveLength(1);
  expect(store.assets.map(a=>a.name)).toEqual(["data.json.gz","state.json"]);
  expect(store.latest()?.id).toBe(fixture().id);
});

it("reconciles an ambiguous final publish and makes repeated identical publication idempotent",async()=>{
  const store=archive({losePublish:true});const files={"data.json.gz":Buffer.from("data")};
  await publishJournal(fixture(),files);
  await publishJournal(fixture(),files);
  expect(store.events.filter(e=>e.startsWith("PATCH"))).toHaveLength(1);
  expect(store.assets).toHaveLength(2);
  await expect(publishJournal(fixture(),{"data.json.gz":Buffer.from("changed")})).rejects.toThrow("Published archive asset mismatch");
});
it("archives the review ledger separately, hydrates exact state on writer reads and resumes lost promotion without a second asset",async()=>{
  const store=archive({losePublish:true}),j=fixture();
  j.economicReview={schema:1,policy:ECONOMIC_POLICY_IDENTITY,trackingStartedAt:j.createdAt,entries:[],retired:{count:0,archives:[]}};
  await publishJournal(j,{});await publishJournal(j,{});
  expect(store.latest().economicReview).toBeUndefined();expect(store.latest().economicReviewRef.url).toContain(j.id);
  expect(store.events.filter(e=>e.startsWith("PATCH"))).toHaveLength(1);
  expect(store.assets.map(a=>a.name)).toEqual(["economic-review.json","state.json"]);
  expect((await hydrateEconomicReview(store.latest())).economicReview).toEqual(j.economicReview);
  const confirmed=archiveEconomicReview({...j,id:"data-1-confirmed"});expect(confirmed.files).toEqual({});expect(confirmed.journal.economicReviewRef).toEqual(j.economicReviewRef);
});
it("missing, changed or malformed ledger assets fail closed rather than seeding an empty history",async()=>{
  const j=fixture();j.economicReview={schema:1,policy:ECONOMIC_POLICY_IDENTITY,trackingStartedAt:j.createdAt,entries:[],retired:{count:0,archives:[]}};
  const compact=archiveEconomicReview(j),bytes=compact.files["economic-review.json"];
  await expect(hydrateEconomicReview(compact.journal,vi.fn(async()=>new Response(null,{status:404})))).rejects.toThrow("unavailable");
  await expect(hydrateEconomicReview(compact.journal,vi.fn(async()=>Response.json({schema:1})))).rejects.toThrow("hash mismatch");
  const forged=structuredClone(compact.journal);forged.publicEconomicReview!.summary.pending=1;
  await expect(hydrateEconomicReview(forged,vi.fn(async()=>new Response(Buffer.from(bytes))))).rejects.toThrow("accounting mismatch");
  const foreign=structuredClone(compact.journal);foreign.economicReviewRef!.url="https://example.test/economic-review.json";const fetcher=vi.fn();
  await expect(hydrateEconomicReview(foreign,fetcher)).rejects.toThrow("reference");expect(fetcher).not.toHaveBeenCalled();
});
it("uses credential-free native redirect transport for immutable GitHub assets without retaining the signed download URL",async()=>{
  const j=fixture();j.economicReview={schema:1,policy:ECONOMIC_POLICY_IDENTITY,trackingStartedAt:j.createdAt,entries:[],retired:{count:0,archives:[]}};
  const compact=archiveEconomicReview(j),bytes=compact.files["economic-review.json"],paths:string[]=[];
  const server=createServer((request,response)=>{paths.push(request.url!);if(request.url==="/initial"){response.writeHead(302,{location:"/asset?signature=transient-test"});response.end();}else {response.writeHead(200);response.end(bytes);}});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {const port=(server.address() as {port:number}).port;
    const hydrated=await hydrateEconomicReview(compact.journal,async(input,init)=>{expect(String(input)).toBe(compact.journal.economicReviewRef!.url);expect(init?.headers).toBeUndefined();return fetch(`http://127.0.0.1:${port}/initial`,init);});
    expect(hydrated.economicReview).toEqual(j.economicReview);expect(paths).toEqual(["/initial","/asset?signature=transient-test"]);expect(JSON.stringify(hydrated)).not.toContain("signature=");
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it("repairs only the empty starter placeholder in this attempt's unpublished draft",async()=>{
  const store=archive({starter:true});await publishJournal(fixture(),{"data.json.gz":Buffer.from("data")});
  expect(store.events.filter(e=>e.startsWith("DELETE"))).toHaveLength(1);
  expect(store.assets.every(a=>a.state === "uploaded")).toBe(true);
});

it("bounds upload retries while retaining the original unpublished draft",async()=>{
  const store=archive({failUpload:true});
  await expect(publishJournal(fixture(),{"data.json.gz":Buffer.from("data")})).rejects.toThrow("HTTP 503");
  expect(store.events.filter(e=>e.includes("?name=data.json.gz"))).toHaveLength(3);
  expect(store.events.filter(e=>e === `POST /repos/${JOURNAL_REPOSITORY}/releases`)).toHaveLength(1);
  expect(store.latest()).toBeNull();
});

it("refuses all local/manual non-workflow writers",async()=>{
  vi.stubEnv("GITHUB_ACTIONS","false");const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(publishJournal(fixture(),{})).rejects.toThrow("serialized canonical main workflow");expect(fetch).not.toHaveBeenCalled();
});
