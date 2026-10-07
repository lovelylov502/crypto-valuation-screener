import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const store=vi.hoisted(()=>({journal:vi.fn(),snapshot:vi.fn(),collect:vi.fn()}));
const release=vi.hoisted(()=>({readerRelease:"four-daily-freshness-v2",writerSchema:1,schedule:"legacy",phaseA:null as any}));
vi.mock("./pipeline-release.json",()=>({default:release}));
vi.mock("./snapshotArchive",()=>({readJournal:store.journal,readSnapshot:store.snapshot}));
vi.mock("./sources",()=>({fetchCoins:store.collect}));
const at="2026-09-29T10:00:00Z";
const journal=()=>({schema:1,id:"data-2-complete",createdAt:at,previousId:"data-2-start",published:{id:"data-1-complete",dataAt:"2026-09-28T00:00:00Z",url:"archive",sha256:"a"},attempt:{id:"data-2",startedAt:at,completedAt:at,outcome:"blocked",errors:["HTTP 403"]},incident:{firstFailureObservedAt:at,lastFailureObservedAt:at}});
const data=()=>({updatedAt:"2026-09-28T00:00:00Z",coins:[{slug:"sample",mcap:123}],scoreVersion:"research-v10-source-revenue-recovery"});
beforeEach(()=>{release.writerSchema=1;release.schedule="legacy";release.phaseA=null;vi.resetModules();store.journal.mockReset().mockImplementation(async()=>structuredClone(journal()));store.snapshot.mockReset().mockImplementation(async()=>structuredClone(data()));store.collect.mockReset();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(at));});
afterEach(()=>vi.useRealTimers());
it("serves a persisted verified snapshot across restarts and date changes without collecting",async()=>{
  const first=await(await import("./serverScreener")).getScreener();
  vi.resetModules();vi.setSystemTime(new Date("2026-09-30T00:01:00Z"));
  const next=await(await import("./serverScreener")).getScreener();
  expect(next).toEqual(first);expect(store.collect).not.toHaveBeenCalled();expect(store.snapshot).toHaveBeenCalledTimes(2);
});
it("retains snapshot and real timestamps when the journal store times out",async()=>{
  const server=await import("./serverScreener");const first=await server.getScreener();
  vi.setSystemTime(new Date(Date.parse(at)+61_000));store.journal.mockRejectedValueOnce(new Error("timeout"));
  const next=await server.getScreener();expect(next.coins).toEqual(first.coins);expect(next.updatedAt).toBe(first.updatedAt);expect(next.publication?.storeError).toBeTruthy();
});
it("rejects missing/corrupt archives on a cold start without falling back to a crawler",async()=>{
  store.snapshot.mockRejectedValueOnce(new Error("hash mismatch"));await expect((await import("./serverScreener")).getScreener()).rejects.toThrow("hash mismatch");expect(store.collect).not.toHaveBeenCalled();
});
it("keeps the old publication ID when downloading a newer archive fails",async()=>{
  const server=await import("./serverScreener");const first=await server.getScreener();vi.setSystemTime(new Date(Date.parse(at)+61_000));
  store.journal.mockResolvedValueOnce({...journal(),createdAt:new Date().toISOString(),published:{...journal().published,id:"data-3-complete"}});store.snapshot.mockRejectedValueOnce(new Error("broken new archive"));
  const next=await server.getScreener();expect(next.publication?.published?.id).toBe(first.publication?.published?.id);expect(next.publication?.storeError).toBeTruthy();expect(next.coins).toEqual(first.coins);
});
it("deduplicates concurrent reads and has an explicit no-verified-data state",async()=>{
  const server=await import("./serverScreener");await Promise.all([server.getScreener(),server.getScreener()]);expect(store.journal).toHaveBeenCalledTimes(1);expect(store.snapshot).toHaveBeenCalledTimes(1);
  vi.resetModules();store.journal.mockResolvedValueOnce({...journal(),published:null});await expect((await import("./serverScreener")).getScreener()).rejects.toThrow("공개 자료가 아직 없습니다");
});
it("renders the homepage without importing or awaiting any data network reader",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");expect(page).not.toMatch(/getScreener|fetch\(/);expect(page).toContain("initialData={null}");
});
it("filtered/page refresh with the same archived publication consistently carries live four-daily and paused release metadata",async()=>{
 const server=await import("./serverScreener"),first=await server.getScreener();expect(first.publication!.collectionRelease!.schedule).toBe("legacy");
 release.writerSchema=2;release.schedule="four-daily";release.phaseA={deploymentId:"dpl_reader"};
 const active=await server.getScreener();expect(active.publication!.published!.id).toBe(first.publication!.published!.id);expect(active.publication!.collectionRelease!.schedule).toBe("four-daily");
 release.schedule="paused";const paused=await server.getScreener();expect(paused.publication!.collectionRelease!.schedule).toBe("paused");expect(paused.coins).toEqual(first.coins);expect(store.snapshot).toHaveBeenCalledTimes(1);expect(store.collect).not.toHaveBeenCalled();
});
