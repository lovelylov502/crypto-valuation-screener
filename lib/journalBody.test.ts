import {expect,it,vi} from "vitest";
import {journalBody,journalFromRelease,MAX_JOURNAL_STATE_BYTES} from "./journalBody";
import {startJournal} from "./publication";
import {sha256} from "./snapshotArchive";
function fixture(){return startJournal(null,{id:"data-body",startedAt:"2026-10-08T02:00:00Z",completedAt:null,outcome:"running",runUrl:"",reportUrl:"",errors:[],sourceFailures:[],affectedProjects:0,changeCount:0,affected:[]},"data-body-start");}
it("supports actual legacy inline release bodies without an asset request",async()=>{
  const j=fixture(),fetcher=vi.fn();expect(await journalFromRelease({body:JSON.stringify(j)},fetcher)).toEqual(j);expect(fetcher).not.toHaveBeenCalled();
});
it("moves large complete wire state to the existing immutable asset without trimming observations",async()=>{
  const j=fixture();j.attempt.affected=Array.from({length:233},(_,i)=>({slug:`source-${i}`,name:`Source ${i}`,issues:["証拠".repeat(400)]}));
  const {body,state}=journalBody(j);expect(body.length).toBeLessThan(1000);expect(state.byteLength).toBeGreaterThan(125000);
  const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{expect(String(input)).toBe(JSON.parse(body).state.url);expect(init?.headers).toBeUndefined();expect(init?.redirect).toBe("follow");return new Response(Buffer.from(state));});
  expect(await journalFromRelease({body,tag_name:j.id},fetcher)).toEqual(j);expect(JSON.parse(Buffer.from(state).toString()).attempt.affected).toHaveLength(233);
});
it("rejects foreign, mutable, cross-tag, unknown-version or oversized references before fetching",async()=>{
  const j=fixture(),{body}=journalBody(j),original=JSON.parse(body);
  for(const mutate of [(e:any)=>{e.schema=2;},(e:any)=>{e.state.url=e.state.url.replace(j.id,"data-other");},(e:any)=>{e.state.url="https://example.test/state.json";},(e:any)=>{e.state.url="https://github.com/lovelylov502/crypto-valuation-screener/releases/latest/download/state.json";},(e:any)=>{e.state.bytes=MAX_JOURNAL_STATE_BYTES+1;},(e:any)=>{e.state.sha256="wrong";}]) {
    const envelope=structuredClone(original);mutate(envelope);const fetcher=vi.fn();await expect(journalFromRelease({body:JSON.stringify(envelope),tag_name:j.id},fetcher)).rejects.toThrow("envelope");expect(fetcher).not.toHaveBeenCalled();
  }
  await expect(journalFromRelease({body,tag_name:"data-other"},vi.fn())).rejects.toThrow("envelope");
});
it("fails closed for unavailable, truncated, changed or nested states and wrong internal identity",async()=>{
  const j=fixture(),{body,state}=journalBody(j),release={body,tag_name:j.id};
  await expect(journalFromRelease(release,vi.fn(async()=>new Response(null,{status:404})))).rejects.toThrow("unavailable");
  await expect(journalFromRelease(release,vi.fn(async()=>new Response(Buffer.from(state.subarray(0,20)))))).rejects.toThrow("hash or length");
  const changed=Buffer.from(state);changed[15]^=1;await expect(journalFromRelease(release,vi.fn(async()=>new Response(changed)))).rejects.toThrow("hash");
  for(const value of [{...j,id:"data-other"},JSON.parse(body)]) {
    const bytes=Buffer.from(JSON.stringify(value)),e={...JSON.parse(body),state:{...JSON.parse(body).state,bytes:bytes.byteLength,sha256:sha256(bytes)}};
    await expect(journalFromRelease({...release,body:JSON.stringify(e)},vi.fn(async()=>new Response(bytes)))).rejects.toThrow(value.id?"identity":"Nested");
  }
});
it("enforces a separately bounded full-state budget before preparing the release body",()=>{
  const j=fixture();j.attempt.errors=["x".repeat(MAX_JOURNAL_STATE_BYTES)];expect(()=>journalBody(j)).toThrow("metadata budget");
});
