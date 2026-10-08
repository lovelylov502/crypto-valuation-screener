import {expect,it} from "vitest";
import {jsonResponse,readJsonText,jsonTransportErrors,BUFFERED_JSON_BYTES,STREAMED_JSON_BYTES,JSON_CHUNK_BYTES,STREAMED_JSON} from "./jsonTransport.mjs";
import {queryScreener} from "./screenerQuery";
import {assembleScreener} from "./screener";
import {sample} from "./testFixtures";
import {defaultPreferences} from "./workspacePreferences";

const metadata=(bytes:number)=>({"x-tovenit-json-transport":STREAMED_JSON,"x-tovenit-json-bytes":String(bytes)});
it("preserves complete UTF-8 JSON, rows and pagination on a supported favorites200 page above the buffered limit",async()=>{
  const raw=Array.from({length:200},(_,i)=>sample({slug:`asset-${i}`,name:`한글 종목 ${i}`,descriptionKo:"원천 검토 · 🪙 ".repeat(1400)}));
  const favorites=raw.map(c=>c.slug),data=assembleScreener(raw,"2026-10-07T14:00:00Z",[]),page=queryScreener(data,{...defaultPreferences(),view:"favorites"},favorites,1,200);
  const bytes=Buffer.byteLength(JSON.stringify(page));expect(bytes).toBeGreaterThan(BUFFERED_JSON_BYTES);expect(bytes).toBeLessThan(STREAMED_JSON_BYTES);
  const response=jsonResponse(page);expect(response.headers.get("x-tovenit-json-transport")).toBe(STREAMED_JSON);expect(response.headers.get("content-length")).toBeNull();
  expect(JSON.parse(await readJsonText(response))).toEqual(page);expect(page.pagination).toMatchObject({size:200,filtered:200,total:200});
  expect(JSON.parse(await new Response(JSON.stringify(page)).text())).toEqual(page);
});
it("small pages retain buffered transport and the same decoded body",async()=>{
  const page={coins:[{name:"가나다🪙",price:0}],pagination:{page:1,size:100,total:1}},response=jsonResponse(page);
  expect(response.headers.get("x-tovenit-json-transport")).toBe("buffered-json-v1");expect(JSON.parse(await readJsonText(response))).toEqual(page);
});
it("refuses oversized complete JSON before a Response exists and honors the exact streamed ceiling",async()=>{
  expect(()=>jsonResponse({evidence:"x".repeat(STREAMED_JSON_BYTES)})).toThrow("decoded page budget");
  const text="x".repeat(STREAMED_JSON_BYTES-2),response=jsonResponse(text);expect(response.headers.get("x-tovenit-json-bytes")).toBe(String(STREAMED_JSON_BYTES));
  expect(JSON.parse(await readJsonText(response))).toBe(text);
});
it("pulls bounded chunks on demand and terminates on cancellation or a request abort",async()=>{
  const controller=new AbortController(),response=jsonResponse({evidence:"한글".repeat(800000)},controller.signal),reader=response.body!.getReader();
  expect((await reader.read()).value!.byteLength).toBe(JSON_CHUNK_BYTES);
  controller.abort();await expect(reader.read()).rejects.toThrow("aborted");
  const canceled=jsonResponse({evidence:"x".repeat(5000000)}),other=canceled.body!.getReader();await other.read();await other.cancel();expect((await other.read()).done).toBe(true);
  expect(()=>jsonResponse({},controller.signal)).toThrow("aborted");
});
it("rejects malformed, oversized or falsely streamed length metadata and detects incomplete bodies",async()=>{
  for(const length of ["oops","-1","8e6",String(STREAMED_JSON_BYTES+1)])await expect(readJsonText(new Response("{}",{headers:{...metadata(2),"x-tovenit-json-bytes":length}}))).rejects.toThrow("metadata");
  await expect(readJsonText(new Response("{}",{headers:metadata(3)}))).rejects.toThrow("length mismatch");
  await expect(readJsonText(new Response("{}",{headers:{...metadata(2),"x-tovenit-json-transport":"unknown"}}))).rejects.toThrow("metadata");
  const failed=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"rows":'));c.error(new Error("connection interrupted"));}}),{headers:metadata(20)});
  await expect(readJsonText(failed)).rejects.toThrow("interrupted");
  await expect(readJsonText(new Response("x".repeat(BUFFERED_JSON_BYTES)))).rejects.toThrow("budget");
});
it("verifier accepts only completed bounded streams while retaining the original buffered limit",()=>{
  const bytes=5_772_352;expect(jsonTransportErrors({bytes,transport:STREAMED_JSON,declaredBytes:String(bytes)})).toEqual([]);
  expect(jsonTransportErrors({bytes,transport:null,declaredBytes:null})).toContain(`API payload ${bytes} bytes exceeds fail-closed limit ${BUFFERED_JSON_BYTES}`);
  expect(jsonTransportErrors({bytes,transport:STREAMED_JSON,declaredBytes:String(bytes+1)})).toContain("JSON transport length mismatch");
});
