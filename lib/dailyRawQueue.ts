import { shiftDay, utcDay } from "./dailyHistory";

export interface DailyRawQueueCoin {
  slug: string; geckoId: string | null; cmcId?: number | null; identityStatus: string; capitalExclusionReason?: string | null;
  fdv?: number | null; revenue24h?: number | null; revenue30d?: number | null;
}
export interface DailyRawQueueBinding { slug: string; identity: string; active: boolean; fullImported: boolean; closedThrough: string | null }
export interface DailyRawQueueReceipt {
  url: string; observedAt: string; sha256: string; file?: string;
  firstDay: string; availableThrough: string; archiveUrl?: string; archiveVerified?: boolean;
}
export interface DailyRawQueueEntry {
  geckoId: string; priority: number; bindings: DailyRawQueueBinding[];
  lastAttemptAt: string | null; retryAt: string | null; pending: DailyRawQueueReceipt | null;
  lastImportedSha256?: string;
}
export interface DailyRawQueueState {
  schema: 1; targetDay: string; updatedAt: string; providerRetryAt: string | null; entries: Record<string, DailyRawQueueEntry>;
  feesProviderRetryAt?: string | null;
}
export interface DailyRawQueueJob {
  geckoId: string; action: "acquire" | "apply_receipt"; mode: "full" | "patch";
  from?: string; to: string; assets: { slug: string; identity: string; full: boolean }[];
}
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && utcDay(Date.parse(value)) === value;
const stamp = (value: string | null) => value === null || Number.isFinite(Date.parse(value));
const positive = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) && value > 0;
const active = (entry: DailyRawQueueEntry) => entry.bindings.filter(binding => binding.active);
const through = (entry: DailyRawQueueEntry) => {
  const bindings = active(entry);
  return bindings.some(binding => !binding.fullImported || !binding.closedThrough) ? "" : bindings.map(binding => binding.closedThrough!).sort()[0] ?? "";
};
export function assertDailyRawQueue(state: DailyRawQueueState) {
  if (state.schema !== 1 || !day(state.targetDay) || typeof state.updatedAt !== "string" || !stamp(state.updatedAt) || !stamp(state.providerRetryAt) || !state.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) throw Error("daily_raw_queue_invalid_state");
  if (state.feesProviderRetryAt !== undefined && !stamp(state.feesProviderRetryAt)) throw Error("daily_raw_queue_invalid_fees_retry");
  for (const [id, entry] of Object.entries(state.entries)) {
    if (id !== entry.geckoId || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(id) || !Array.isArray(entry.bindings) || !stamp(entry.lastAttemptAt) || !stamp(entry.retryAt)) throw Error("daily_raw_queue_invalid_entry");
    if (entry.lastImportedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(entry.lastImportedSha256)) throw Error("daily_raw_queue_invalid_imported_hash");
    for (const binding of entry.bindings) if (!binding.slug || typeof binding.active !== "boolean" || typeof binding.fullImported !== "boolean" || binding.identity !== `gecko:${id}` || binding.closedThrough !== null && !day(binding.closedThrough)) throw Error("daily_raw_queue_invalid_binding");
    if (entry.pending) {
      const receipt = entry.pending;
      if (!/^[a-f0-9]{64}$/.test(receipt.sha256) || typeof receipt.observedAt !== "string" || !stamp(receipt.observedAt) || !day(receipt.firstDay) || !day(receipt.availableThrough) || receipt.firstDay > receipt.availableThrough) throw Error("daily_raw_queue_invalid_receipt");
      if (receipt.url !== `https://www.coingecko.com/price_charts/export/${encodeURIComponent(id)}/usd.csv`) throw Error("daily_raw_queue_receipt_identity_mismatch");
      if (receipt.archiveVerified && !receipt.archiveUrl) throw Error("daily_raw_queue_archive_proof_missing");
    }
  }
}

/** Keep inactive identities as history; only today's verified bindings receive work. */
export function reconcileDailyRawQueue(previous: DailyRawQueueState | null, coins: DailyRawQueueCoin[], targetDay: string, now = new Date()): DailyRawQueueState {
  if (!day(targetDay) || targetDay >= utcDay(now.getTime())) throw Error("daily_raw_queue_target_must_be_completed");
  if (previous) assertDailyRawQueue(previous);
  const state: DailyRawQueueState = previous ? structuredClone(previous) : { schema: 1, targetDay, updatedAt: now.toISOString(), providerRetryAt: null, entries: {} };
  state.targetDay = targetDay; state.updatedAt = now.toISOString();
  for (const entry of Object.values(state.entries)) for (const binding of entry.bindings) binding.active = false;
  for (const coin of coins) {
    if (coin.identityStatus !== "verified" || !coin.geckoId || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(coin.geckoId) || coin.capitalExclusionReason) continue;
    const id = coin.geckoId, old = Object.hasOwn(state.entries, id) ? state.entries[id] : undefined;
    const entry = old ?? { geckoId: id, priority: 0, bindings: [], lastAttemptAt: null, retryAt: null, pending: null };
    entry.priority = Math.max(entry.priority, Number(positive(coin.revenue24h) || positive(coin.revenue30d)) * 2 + Number(positive(coin.fdv)));
    let binding = entry.bindings.find(binding => binding.slug === coin.slug);
    if (!binding) { binding = { slug: coin.slug, identity: `gecko:${id}`, active: true, fullImported: false, closedThrough: null }; entry.bindings.push(binding); }
    binding.active = true; state.entries[id] = entry;
  }
  return state;
}

/** Imported entries stop consuming the request cap. A provider hold still lets
 * already acquired receipts proceed toward archiving and database commits. */
export function planDailyRawQueue(state: DailyRawQueueState, options: { now?: Date; maxRequests: number; maxJobs?: number; allowFull?: boolean }): DailyRawQueueJob[] {
  assertDailyRawQueue(state);
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 0 || options.maxJobs !== undefined && (!Number.isSafeInteger(options.maxJobs) || options.maxJobs < 0)) throw Error("daily_raw_queue_invalid_budget");
  const now = (options.now ?? new Date()).getTime(), held = !!state.providerRetryAt && Date.parse(state.providerRetryAt) > now;
  const entries = Object.values(state.entries).filter(entry => active(entry).length && (entry.pending || through(entry) < state.targetDay))
    .sort((a, b) => Number(!!b.pending) - Number(!!a.pending)
      || Number(active(b).some(binding => !binding.fullImported)) - Number(active(a).some(binding => !binding.fullImported))
      || (a.lastAttemptAt ?? "").localeCompare(b.lastAttemptAt ?? "") || through(a).localeCompare(through(b)) || b.priority - a.priority || a.geckoId.localeCompare(b.geckoId));
  const jobs: DailyRawQueueJob[] = []; let requests = 0;
  for (const entry of entries) {
    if (jobs.length >= (options.maxJobs ?? Number.MAX_SAFE_INTEGER)) break;
    if (!entry.pending && (held || entry.retryAt && Date.parse(entry.retryAt) > now || requests >= options.maxRequests)) continue;
    const assets = active(entry).filter(binding => entry.pending || !binding.fullImported || !binding.closedThrough || binding.closedThrough < state.targetDay)
      .map(binding => ({ slug: binding.slug, identity: binding.identity, full: !binding.fullImported }));
    if (!assets.length) continue;
    const mode = assets.some(asset => asset.full) ? "full" : "patch", old = through(entry), to = entry.pending?.availableThrough ?? state.targetDay;
    if (mode === "full" && options.allowFull === false) continue;
    const from = mode === "full" ? undefined : [shiftDay(to, -13), shiftDay(old, 1)].sort()[0];
    jobs.push({ geckoId: entry.geckoId, action: entry.pending ? "apply_receipt" : "acquire", mode, ...(from ? { from } : {}), to, assets });
    if (!entry.pending) requests++;
  }
  return jobs;
}
export function recordDailyRawAttempt(state: DailyRawQueueState, geckoId: string, now = new Date()) {
  const entry = state.entries[geckoId]; if (!entry) throw Error("daily_raw_queue_unknown_asset");
  entry.lastAttemptAt = now.toISOString(); state.updatedAt = now.toISOString();
}
export function recordDailyRawAcquired(state: DailyRawQueueState, geckoId: string, receipt: DailyRawQueueReceipt, now = new Date()) {
  const entry = state.entries[geckoId]; if (!entry) throw Error("daily_raw_queue_unknown_asset");
  if (entry.pending && (entry.pending.sha256 !== receipt.sha256 || entry.pending.observedAt !== receipt.observedAt)) throw Error("daily_raw_queue_unapplied_receipt");
  if (receipt.availableThrough > state.targetDay) throw Error("daily_raw_queue_receipt_has_future_close");
  const previous = entry.pending, previousRetry = entry.retryAt; entry.pending = { ...receipt }; entry.retryAt = null;
  try { assertDailyRawQueue(state); } catch (error) { entry.pending = previous; entry.retryAt = previousRetry; throw error; }
  if (!previous && entry.lastImportedSha256 === receipt.sha256 && active(entry).every(binding => binding.fullImported && binding.closedThrough! >= receipt.availableThrough)) {
    entry.pending = null;
    if (receipt.availableThrough < state.targetDay) entry.retryAt = new Date(now.getTime() + 86400_000).toISOString();
  }
  state.updatedAt = now.toISOString();
}
/** Caller invokes this only after immutable public readback verifies the receipt. */
export function recordDailyRawArchived(state: DailyRawQueueState, geckoId: string, archiveUrl: string, now = new Date()) {
  const pending = state.entries[geckoId]?.pending;
  if (!pending || !/^https:\/\/github\.com\/lovelylov502\/crypto-valuation-screener\/releases\/download\/[^/]+\/[^/?#]+$/.test(archiveUrl)) throw Error("daily_raw_queue_archive_not_verified");
  pending.archiveUrl = archiveUrl; pending.archiveVerified = true; state.updatedAt = now.toISOString();
}
/** Caller invokes this only after the database's atomic asset checkpoint is read
 * back. A failed/paused import cannot claim initial MAX or the latest UTC close. */
export function recordDailyRawImported(state: DailyRawQueueState, geckoId: string, options: { throughDay: string; mode: "full" | "patch"; slugs?: string[] }, now = new Date()) {
  const entry = state.entries[geckoId], pending = entry?.pending;
  if (!pending?.archiveVerified || !day(options.throughDay) || options.throughDay !== pending.availableThrough || options.throughDay > state.targetDay) throw Error("daily_raw_queue_import_not_proved");
  const bindings = active(entry).filter(binding => !options.slugs || options.slugs.includes(binding.slug));
  if (!bindings.length || bindings.some(binding => !binding.fullImported && options.mode !== "full")) throw Error("daily_raw_queue_full_history_not_imported");
  for (const binding of bindings) { binding.fullImported = true; binding.closedThrough = [binding.closedThrough ?? "", options.throughDay].sort().at(-1)!; }
  if (active(entry).every(binding => binding.fullImported && binding.closedThrough! >= pending.availableThrough)) {
    entry.lastImportedSha256 = pending.sha256; entry.pending = null;
    if (options.throughDay < state.targetDay) entry.retryAt = new Date(now.getTime() + 86400_000).toISOString();
  }
  state.updatedAt = now.toISOString();
}
export function recordDailyRawDeferred(state: DailyRawQueueState, geckoId: string, retryAt: string, providerWide = false, now = new Date()) {
  const entry = state.entries[geckoId]; if (!entry || !stamp(retryAt) || Date.parse(retryAt) <= now.getTime()) throw Error("daily_raw_queue_invalid_retry");
  entry.retryAt = [entry.retryAt ?? "", retryAt].sort().at(-1)!;
  if (providerWide) state.providerRetryAt = [state.providerRetryAt ?? "", retryAt].sort().at(-1)!;
  state.updatedAt = now.toISOString();
}
