import { expect, it } from "vitest";
import { activeCollectionSlot, HOSTED_DATABASE_ENABLED } from "./dataDeliveryPolicy";
import { collectionSchedule } from "./collectionSchedule";
import { connectHistory } from "./historyDatabase";
it("blocks hosted SQL before inspecting credentials and retains the free-only policy", () => {
  expect(HOSTED_DATABASE_ENABLED).toBe(false); expect(() => connectHistory()).toThrow("hosted_database_paused_free_quota");
});
it.each([
  ["2026-10-23T10:00:00Z", "2026-10-23T08:00:00Z"],
  ["2026-10-24T01:59:59Z", "2026-10-23T20:00:00Z"],
  ["2026-10-24T08:00:00Z", "2026-10-24T02:00:00Z"],
  ["2026-10-24T20:00:00Z", "2026-10-24T14:00:00Z"],
  ["2026-10-25T01:59:59Z", "2026-10-24T14:00:00Z"],
])("preserves historical slots and uses twelve hours after the transition: %s", (at, slot) => {
  expect(activeCollectionSlot(Date.parse(at))).toBe(Date.parse(slot));
});
it("shows the next KST23:00 collection and the unchanged ninety-minute publication deadline", () => {
  const result = collectionSchedule(Date.parse("2026-10-24T08:00:00Z"), "four-daily");
  expect(new Date(result.requiredAt).toISOString()).toBe("2026-10-24T02:00:00.000Z");
  expect(new Date(result.nextAt).toISOString()).toBe("2026-10-24T14:00:00.000Z");
  expect(result.deadlineAt - result.requiredAt).toBe(90 * 60_000);
});
