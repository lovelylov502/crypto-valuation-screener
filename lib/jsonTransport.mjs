// Transport changes no JSON fields or pagination. Public pages have an explicit decoded byte ceiling.
export const BUFFERED_JSON_BYTES = 4_500_000;
export const STREAMED_JSON_BYTES = 8_000_000;
export const JSON_CHUNK_BYTES = 32_768;
export const STREAMED_JSON = "streamed-json-v1";
export const BUFFERED_JSON = "buffered-json-v1";

export function jsonTransportErrors({bytes,transport,declaredBytes}) {
  const streamed=transport===STREAMED_JSON,limit=streamed?STREAMED_JSON_BYTES:BUFFERED_JSON_BYTES;
  const errors=[];
  if(transport&&![STREAMED_JSON,BUFFERED_JSON].includes(transport))errors.push("invalid JSON transport");
  if(bytes>limit||!streamed&&bytes===limit)errors.push(`API payload ${bytes} bytes exceeds fail-closed limit ${limit}`);
  if(transport&&(!/^\d+$/.test(declaredBytes??"")||Number(declaredBytes)!==bytes))errors.push("JSON transport length mismatch");
  return errors;
}

/** Serialize and check the complete response before returning headers. @param {AbortSignal} [signal] */
export function jsonResponse(value,signal) {
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  if(bytes.byteLength>STREAMED_JSON_BYTES)throw new Error("JSON response exceeds the decoded page budget");
  if(signal?.aborted)throw new DOMException("Request aborted","AbortError");
  const streamed=bytes.byteLength>=BUFFERED_JSON_BYTES;
  const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-tovenit-json-transport":streamed?STREAMED_JSON:BUFFERED_JSON,"x-tovenit-json-bytes":String(bytes.byteLength)};
  if(!streamed)return new Response(bytes,{headers});
  let offset=0;
  const cleanup=()=>signal?.removeEventListener("abort",abort);
  let abort=()=>{};
  const body=new ReadableStream({
    start(controller){abort=()=>{cleanup();controller.error(new DOMException("Request aborted","AbortError"));};signal?.addEventListener("abort",abort,{once:true});},
    pull(controller){const end=Math.min(offset+JSON_CHUNK_BYTES,bytes.byteLength);controller.enqueue(bytes.subarray(offset,end));offset=end;if(offset===bytes.byteLength){cleanup();controller.close();}},
    cancel(){cleanup();},
  },{highWaterMark:0});
  return new Response(body,{headers});
}

/** Bounded decoded read shared by the browser and production verification. @param {Response} response */
export async function readJsonText(response) {
  const transport=response.headers.get("x-tovenit-json-transport"),declaredBytes=response.headers.get("x-tovenit-json-bytes");
  const limit=transport===STREAMED_JSON?STREAMED_JSON_BYTES:BUFFERED_JSON_BYTES;
  if(transport&&(![STREAMED_JSON,BUFFERED_JSON].includes(transport)||!/^\d+$/.test(declaredBytes??"")||Number(declaredBytes)>limit||transport!==STREAMED_JSON&&Number(declaredBytes)===limit)) {
    await response.body?.cancel();throw new Error("Invalid JSON transport metadata");
  }
  if(!response.body)throw new Error("JSON response body missing");
  const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});
  let bytes=0,text="";
  try {
    for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>limit||transport!==STREAMED_JSON&&bytes===limit)throw new Error("JSON response exceeds decoded byte budget");text+=decoder.decode(part.value,{stream:true});}
    text+=decoder.decode();
    const errors=jsonTransportErrors({bytes,transport,declaredBytes});if(errors.length)throw new Error(errors.join("; "));
    return text;
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
