import { expect, it } from "vitest";
import { isReviewDue, mergeWatchBackup, newWatchNote, parseWatchBackup, parseWatchNotes, type WatchBackup } from "./watchNotes";

const old = newWatchNote("Alpha", "gecko:alpha", { pr: 12, capital: "fdv", dataAt: "2026-10-20T12:00:00Z" }, "2026-10-20T13:00:00Z");
const backup = (notes = { alpha: old }): WatchBackup => ({ schema: 1, app: "TOVENIT", exportedAt: "2026-10-22T12:00:00Z", favorites: ["alpha"], notes });
it("keeps legacy favorites independent from the new notebook", () => {
  expect(parseWatchNotes(null)).toEqual({});
  expect(parseWatchNotes(JSON.stringify({ schema: 1, notes: { alpha: old } }))).toEqual({ alpha: old });
  expect(() => parseWatchNotes('{"schema":2,"notes":{}}')).toThrow();
});
it("merges favorites and keeps the newest record without resetting existing research", () => {
  const newer = { ...old, note: "Check the source definition", updatedAt: "2026-10-22T14:00:00Z", stage: "researching" as const };
  const merged = mergeWatchBackup({ alpha: newer }, new Set(["beta"]), parseWatchBackup(JSON.stringify(backup())));
  expect([...merged.favorites]).toEqual(["beta", "alpha"]); expect(merged.notes.alpha).toEqual(newer);
  expect(mergeWatchBackup({ alpha: old }, new Set(), backup({ alpha: newer })).notes.alpha).toEqual(newer);
});
it("rejects corrupt or oversized imports and unsafe record keys", () => {
  for (const bad of [{ ...backup(), app: "other" }, backup({ alpha: { ...old, reviewDate: "2026-02-30" } }), backup({ alpha: { ...old, note: "a".repeat(3001) } }), { ...backup(), favorites: ["__proto__"] }, { ...backup(), notes: JSON.parse('{"__proto__":{}}') }]) expect(() => parseWatchBackup(JSON.stringify(bad))).toThrow();
  expect(() => parseWatchBackup("a".repeat(4_000_001))).toThrow();
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
});
it("counts overdue and today dates using the user's local calendar", () => {
  expect(isReviewDue({ ...old, reviewDate: "2026-10-22" }, "2026-10-22")).toBe(true);
  expect(isReviewDue({ ...old, reviewDate: "2026-10-21" }, "2026-10-22")).toBe(true);
  expect(isReviewDue({ ...old, reviewDate: "2026-10-23" }, "2026-10-22")).toBe(false);
  expect(isReviewDue(old, "2026-10-22")).toBe(false);
});
