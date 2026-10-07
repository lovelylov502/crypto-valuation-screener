import type { ScreenerResponse } from "./types";
import type { PublicationJournal } from "./publicationTypes";
import { readJournal, readSnapshot } from "./snapshotArchive";
import { publicFreshness } from "./datedFreshness";
import { collectionReleaseState } from "./pipelineRelease";

// Request handlers only read persisted publications. They never import a collector.
let journal: PublicationJournal | undefined;
let checkedAt = 0;
let pendingJournal: Promise<PublicationJournal> | undefined;
let snapshot: { id: string; data: ScreenerResponse; publication: PublicationJournal } | undefined;
let pendingSnapshot: { id: string; value: Promise<ScreenerResponse> } | undefined;

export async function getPublication(): Promise<PublicationJournal> {
  if (journal && Date.now() - checkedAt < 60_000) return {...journal,collectionRelease:collectionReleaseState()};
  pendingJournal ??= readJournal().then(next => {
    if (journal && Date.parse(next.createdAt) < Date.parse(journal.createdAt)) throw new Error("Publication journal moved backwards");
    journal = next; checkedAt = Date.now(); return next;
  }).catch(error => {
    if (!journal) throw error;
    checkedAt = Date.now();
    journal = { ...journal, storeError: "보관소 상태 확인 실패 · 마지막 확인 기록을 표시합니다." };
    return journal;
  }).finally(() => { pendingJournal = undefined; });
  return {...await pendingJournal,collectionRelease:collectionReleaseState()};
}

export async function getScreener(): Promise<ScreenerResponse> {
  const publication = await getPublication(), ref = publication.published;
  if (!ref) throw new Error("검증을 통과한 공개 자료가 아직 없습니다. 수집 상태에서 사유를 확인해 주세요.");
  try {
    if (snapshot?.id !== ref.id) {
      if (pendingSnapshot?.id !== ref.id) pendingSnapshot = { id: ref.id, value: readSnapshot(ref) };
      const data = await pendingSnapshot.value;
      snapshot = { id: ref.id, data, publication }; pendingSnapshot = undefined;
    }
    snapshot!.publication = publication;
    return { ...snapshot!.data, publication, ...(snapshot!.data.freshness?{publicFreshness:publicFreshness(snapshot!.data.freshness,Date.now())}:{}) };
  } catch (error) {
    pendingSnapshot = undefined;
    // Never attach a new snapshot identity to old data after a failed/corrupt read.
    if (snapshot) return { ...snapshot.data, ...(snapshot.data.freshness?{publicFreshness:publicFreshness(snapshot.data.freshness,Date.now())}:{}), publication: { ...snapshot.publication,collectionRelease:publication.collectionRelease, storeError: "새 검증본 읽기 실패 · 직전 검증본 유지" } };
    throw error;
  }
}
