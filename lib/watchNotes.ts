import type { CapitalBasis } from "./valuationMetrics";

export const WATCH_NOTES_KEY = "tovenit-watch-notes-v1";
export const WATCH_STAGES = { watching: "관찰 중", researching: "검토 중", reviewed: "확인 완료" } as const;
export type WatchStage = keyof typeof WATCH_STAGES;
export interface WatchNote {
  name: string; identity: string; note: string; stage: WatchStage; reviewDate: string;
  createdAt: string; updatedAt: string;
  baseline: { pr: number | null; capital: CapitalBasis; dataAt: string } | null;
}
export type WatchNotes = Record<string, WatchNote>;
export interface WatchBackup { schema: 1; app: "TOVENIT"; exportedAt: string; favorites: string[]; notes: WatchNotes }
const slugValid = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_#.-]{1,150}$/.test(v) && !["__proto__", "constructor", "prototype"].includes(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const timestamp = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const date = (v: unknown) => v === "" || typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
function validateNotes(value: unknown): asserts value is WatchNotes {
  if (!record(value) || Object.keys(value).length > 1000) throw Error("메모 형식을 확인해 주세요.");
  for (const [slug, n] of Object.entries(value)) {
    if (!slugValid(slug) || !record(n) || typeof n.name !== "string" || n.name.length > 200 || typeof n.identity !== "string" || n.identity.length > 200
      || typeof n.note !== "string" || n.note.length > 3000 || !Object.hasOwn(WATCH_STAGES, String(n.stage)) || !date(n.reviewDate) || !timestamp(n.createdAt) || !timestamp(n.updatedAt)
      || n.baseline !== null && (!record(n.baseline) || !["mcap", "fdv"].includes(String(n.baseline.capital)) || !timestamp(n.baseline.dataAt)
        || n.baseline.pr !== null && (typeof n.baseline.pr !== "number" || !Number.isFinite(n.baseline.pr) || n.baseline.pr <= 0))) throw Error("메모 형식을 확인해 주세요.");
  }
}
export function parseWatchNotes(raw: string | null): WatchNotes {
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.schema !== 1) throw Error("저장된 메모 버전을 확인하지 못했습니다. 원본을 보존합니다.");
  validateNotes(value.notes); return value.notes;
}
export function parseWatchBackup(raw: string): WatchBackup {
  if (raw.length > 4_000_000) throw Error("백업 파일은 4MB 이하여야 합니다.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw Error("TOVENIT 관심종목 백업 파일을 선택해 주세요."); }
  if (!record(value) || value.schema !== 1 || value.app !== "TOVENIT" || !timestamp(value.exportedAt) || !Array.isArray(value.favorites) || value.favorites.length > 1000 || !value.favorites.every(slugValid)) throw Error("TOVENIT 관심종목 백업 파일을 선택해 주세요.");
  validateNotes(value.notes); return value as unknown as WatchBackup;
}
export function mergeWatchBackup(notes: WatchNotes, favorites: Set<string>, backup: WatchBackup) {
  const merged = { ...notes };
  for (const [slug, item] of Object.entries(backup.notes)) if (!merged[slug] || Date.parse(item.updatedAt) > Date.parse(merged[slug].updatedAt)) merged[slug] = item;
  const saved = new Set([...favorites, ...backup.favorites]);
  if (saved.size > 1000 || Object.keys(merged).length > 1000) throw Error("관심종목과 메모는 각각 1,000개까지 복원할 수 있습니다.");
  return { notes: merged, favorites: saved };
}
export function newWatchNote(name: string, identity: string, baseline: WatchNote["baseline"] = null, now = new Date().toISOString()): WatchNote {
  return { name, identity, note: "", stage: "watching", reviewDate: "", createdAt: now, updatedAt: now, baseline };
}
export function localDay(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
export const isReviewDue = (note: WatchNote | undefined, today = localDay()) => !!note?.reviewDate && note.reviewDate <= today;
