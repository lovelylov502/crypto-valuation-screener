import { expect, it } from "vitest";
import { planDailyRawQueue, reconcileDailyRawQueue, recordDailyRawAcquired, recordDailyRawArchived, recordDailyRawAttempt, recordDailyRawDeferred, recordDailyRawImported, type DailyRawQueueReceipt, type DailyRawQueueState } from "./dailyRawQueue";

const now = new Date("2026-10-19T12:00:00Z"), targetDay = "2026-10-18";
const coins = ["a", "b", "c", "d"].map(id => ({ slug: id, geckoId: id, identityStatus: "verified", fdv: 100 }));
const initial = () => reconcileDailyRawQueue(null, coins, targetDay, now);
const receipt = (id: string): DailyRawQueueReceipt => ({ url: `https://www.coingecko.com/price_charts/export/${id}/usd.csv`, observedAt: now.toISOString(), sha256: "a".repeat(64), file: `originals/${id}.csv`, firstDay: "2018-01-01", availableThrough: targetDay });
const imported = (state: DailyRawQueueState, id: string) => {
  recordDailyRawAcquired(state, id, receipt(id), now);
  recordDailyRawArchived(state, id, "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/daily-raw-test/originals.json.gz", now);
  recordDailyRawImported(state, id, { throughDay: targetDay, mode: "full" }, now);
};

it("continues beyond the first bounded request batch without resetting completed IDs", () => {
  const state = initial();
  expect(planDailyRawQueue(state, { now, maxRequests: 2 }).map(job => job.geckoId)).toEqual(["a", "b"]);
  imported(state, "a"); imported(state, "b");
  expect(planDailyRawQueue(JSON.parse(JSON.stringify(state)), { now, maxRequests: 2 }).map(job => job.geckoId)).toEqual(["c", "d"]);
  imported(state, "c"); imported(state, "d");
  expect(planDailyRawQueue(state, { now, maxRequests: 200 })).toEqual([]);
});

it("does not confuse acquisition, archival or partial database work with a completed MAX import", () => {
  const state = initial(); recordDailyRawAcquired(state, "a", receipt("a"), now);
  expect(state.entries.a.bindings[0].fullImported).toBe(false);
  expect(() => recordDailyRawImported(state, "a", { throughDay: targetDay, mode: "full" }, now)).toThrow("import_not_proved");
  recordDailyRawArchived(state, "a", "https://github.com/lovelylov502/crypto-valuation-screener/releases/download/daily-raw-test/originals.json.gz", now);
  expect(() => recordDailyRawImported(state, "a", { throughDay: targetDay, mode: "patch" }, now)).toThrow("full_history_not_imported");
  expect(planDailyRawQueue(state, { now, maxRequests: 0 })[0]).toMatchObject({ geckoId: "a", action: "apply_receipt", mode: "full" });
});

it("preserves provider Retry-After across JSON restore while acquired work can proceed", () => {
  const state = initial(); recordDailyRawAcquired(state, "a", receipt("a"), now);
  recordDailyRawDeferred(state, "b", "2026-10-20T12:00:00Z", true, now);
  const restored = JSON.parse(JSON.stringify(state));
  expect(planDailyRawQueue(restored, { now, maxRequests: 200 }).map(job => job.geckoId)).toEqual(["a"]);
  const later = new Date("2026-10-20T12:00:01Z");
  expect(planDailyRawQueue(restored, { now: later, maxRequests: 200 }).filter(job => job.action === "acquire")).toHaveLength(3);
});

it("lets asset failures yield to the rest of the universe and retains the original identity casing", () => {
  const state = reconcileDailyRawQueue(null, [...coins, { slug: "iota", geckoId: "IOTA", identityStatus: "verified", fdv: 1 }], targetDay, now);
  recordDailyRawAttempt(state, "a", now); recordDailyRawDeferred(state, "a", "2026-10-19T13:00:00Z", false, now);
  const jobs = planDailyRawQueue(state, { now, maxRequests: 5 });
  expect(jobs.some(job => job.geckoId === "a")).toBe(false); expect(jobs.some(job => job.geckoId === "IOTA")).toBe(true);
});

it("uses the latest 14 completed UTC dates for established assets and full history for new ones", () => {
  let state = initial(); imported(state, "a");
  const later = new Date("2026-10-20T12:00:00Z"); state = reconcileDailyRawQueue(state, coins, "2026-10-19", later);
  const jobs = planDailyRawQueue(state, { now: later, maxRequests: 10 });
  expect(jobs.find(job => job.geckoId === "a")).toMatchObject({ mode: "patch", from: "2026-10-06", to: "2026-10-19" });
  expect(jobs.find(job => job.geckoId === "b")).toMatchObject({ mode: "full" });
  expect(jobs.find(job => job.geckoId === "b")?.from).toBeUndefined();
});

it("catches up missed dates older than 14 days instead of leaving a permanent gap", () => {
  let state = initial(); imported(state, "a");
  const later = new Date("2026-11-20T12:00:00Z"); state = reconcileDailyRawQueue(state, coins, "2026-11-19", later);
  expect(planDailyRawQueue(state, { now: later, maxRequests: 10 }).find(job => job.geckoId === "a")).toMatchObject({ mode: "patch", from: "2026-10-19", to: "2026-11-19" });
});

it("keeps a newly linked project or changed token identity on the full-history path", () => {
  let state = initial(); imported(state, "a");
  state = reconcileDailyRawQueue(state, [{ ...coins[0], geckoId: "new-a" }, ...coins.slice(1), { slug: "second-a", geckoId: "a", identityStatus: "verified", fdv: 1 }], targetDay, now);
  const jobs = planDailyRawQueue(state, { now, maxRequests: 20 });
  expect(state.entries.a.bindings.find(binding => binding.slug === "a")?.active).toBe(false);
  expect(jobs.find(job => job.geckoId === "new-a")).toMatchObject({ mode: "full" });
  expect(jobs.find(job => job.geckoId === "a")?.assets).toEqual([{ slug: "second-a", identity: "gecko:a", full: true }]);
});

it("withholds unverified current market identities and refuses receipt/asset mixups", () => {
  const state = reconcileDailyRawQueue(null, [{ ...coins[0], identityStatus: "review" }, ...coins.slice(1)], targetDay, now);
  expect(state.entries.a).toBeUndefined();
  expect(() => recordDailyRawAcquired(state, "b", receipt("c"), now)).toThrow("identity_mismatch");
  expect(state.entries.b.pending).toBeNull();
  expect(() => reconcileDailyRawQueue(null, coins, "2026-10-19", now)).toThrow("completed");
});

it("rotates established stale series ahead of neither unattempted refreshes nor initial MAX work", () => {
  let state = initial();
  for (const id of ["a", "b", "c", "d"]) imported(state, id);
  const later = new Date("2026-10-20T12:00:00Z"); state = reconcileDailyRawQueue(state, coins, "2026-10-19", later);
  for (const id of ["a", "b"]) state.entries[id].bindings[0].closedThrough = "2024-01-01";
  expect(planDailyRawQueue(state, { now: later, maxRequests: 2 }).map(job => job.geckoId)).toEqual(["a", "b"]);
  for (const id of ["a", "b"]) {
    recordDailyRawAttempt(state, id, later);
    recordDailyRawAcquired(state, id, { ...receipt(id), firstDay: "2020-01-01", availableThrough: "2024-01-01" }, later);
    expect(state.entries[id].pending).toBeNull();
    expect(state.entries[id].retryAt).toBe("2026-10-21T12:00:00.000Z");
    expect(state.entries[id].bindings[0].closedThrough).toBe("2024-01-01");
  }
  const wake = new Date("2026-10-21T12:00:01Z");
  expect(planDailyRawQueue(JSON.parse(JSON.stringify(state)), { now: wake, maxRequests: 2 }).map(job => job.geckoId)).toEqual(["c", "d"]);
  state = reconcileDailyRawQueue(state, [...coins, { slug: "new", geckoId: "new", identityStatus: "verified" }], "2026-10-19", wake);
  expect(planDailyRawQueue(state, { now: wake, maxRequests: 1 })[0]).toMatchObject({ geckoId: "new", mode: "full" });
});
