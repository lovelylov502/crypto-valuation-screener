import {expect,it} from "vitest";
import {mergePublicationResponse,type PublicationRequest,type PublicationResponseState} from "../components/useScreenerPage";
import type {PublicationJournal} from "./publicationTypes";

function journal(schedule:"legacy"|"four-daily"|"paused",id="data-same"):PublicationJournal {
 return {schema:1,id:"data-journal",createdAt:"2026-10-07T14:10:00.000Z",published:{id},attempt:{outcome:"published"},
  collectionRelease:{writerSchema:schedule==="legacy"?1:2,schedule,phaseADeploymentId:schedule==="legacy"?null:"dpl_reader"}} as PublicationJournal;
}
function initial():PublicationResponseState {return {publication:journal("legacy"),nextRequest:0,lastRequest:0,statusVersion:0};}
function begin(state:PublicationResponseState,source:PublicationRequest["source"]):PublicationRequest {
 return {source,sequence:++state.nextRequest,statusVersion:state.statusVersion};
}
it("manual data refresh on the same publication ID immediately follows legacy ->four-daily ->paused live mode",()=>{
 let state=initial(),id=state.publication!.published!.id;
 for(const schedule of ["four-daily","paused"] as const) {
  const request=begin(state,"data");state=mergePublicationResponse(state,journal(schedule),request);
  expect(state.publication!.collectionRelease!.schedule).toBe(schedule);expect(state.publication!.published!.id).toBe(id);
 }
});
it("falls back to prior live mode only when the incoming data field is absent, preserving newer incoming journal evidence",()=>{
 let state=initial();state=mergePublicationResponse(state,journal("paused"),begin(state,"status"));
 const incoming={...journal("four-daily"),createdAt:"2026-10-07T14:20:00.000Z"};delete incoming.collectionRelease;
 state=mergePublicationResponse(state,incoming,begin(state,"data"));
 expect(state.publication).toMatchObject({createdAt:incoming.createdAt,collectionRelease:{schedule:"paused"}});expect(incoming.collectionRelease).toBeUndefined();
});
it("a status response accepted after data request start survives its later stale data response, including newer publication/attempt evidence",()=>{
 let state=initial();const dataRequest=begin(state,"data"),statusRequest=begin(state,"status");
 const status=journal("paused","data-new");status.createdAt="2026-10-07T14:20:00.000Z";
 state=mergePublicationResponse(state,status,statusRequest);const newest=state;
 state=mergePublicationResponse(state,journal("four-daily"),dataRequest);
 expect(state).toBe(newest);expect(state.publication).toMatchObject({published:{id:"data-new"},createdAt:status.createdAt,collectionRelease:{schedule:"paused"}});
});
it("an older status request arriving after a newer data response cannot roll live mode or publication backwards",()=>{
 let state=initial();const statusRequest=begin(state,"status"),dataRequest=begin(state,"data");
 state=mergePublicationResponse(state,journal("four-daily","data-new"),dataRequest);const newest=state;
 state=mergePublicationResponse(state,journal("legacy"),statusRequest);
 expect(state).toBe(newest);expect(state.publication).toMatchObject({published:{id:"data-new"},collectionRelease:{schedule:"four-daily"}});
});
it("a status response received during a later-started pending data request stays authoritative; a subsequent refresh can then adopt the new server mode",()=>{
 let state=initial();const statusRequest=begin(state,"status"),dataRequest=begin(state,"data");
 state=mergePublicationResponse(state,journal("paused"),statusRequest);const newest=state;
 expect(mergePublicationResponse(state,journal("four-daily"),dataRequest)).toBe(newest);
 state=mergePublicationResponse(state,journal("four-daily"),begin(state,"data"));expect(state.publication!.collectionRelease!.schedule).toBe("four-daily");
});
it("rejects malformed present metadata before replacing current data/status, while an absent whole journal retains the previous state",()=>{
 const state=initial(),bad={...journal("legacy"),collectionRelease:{writerSchema:1,schedule:"paused",phaseADeploymentId:null}} as PublicationJournal;
 for(const source of ["data","status"] as const)expect(()=>mergePublicationResponse(state,bad,begin(state,source))).toThrow("Invalid live collection release");
 expect(state.publication!.collectionRelease!.schedule).toBe("legacy");expect(mergePublicationResponse(state,undefined,begin(state,"data"))).toBe(state);
});
