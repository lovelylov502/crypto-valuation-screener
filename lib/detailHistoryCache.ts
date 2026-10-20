import { DetailHistoryError, detailHistoryBounds, isDetailHistoryPoint, type DetailHistoryData, type DetailRange } from "./detailHistory";
import type { CapitalBasis } from "./valuationMetrics";
import { dailyHistoryVersionValid, decodeCompactHistory, expandCompactHistory, type DailyHistoryVersion } from "./dailyValuationCompact";

export type DetailHistoryVersion = DailyHistoryVersion;
export type DetailHistoryBundle = Record<CapitalBasis, DetailHistoryData>;
export interface CachedDetailHistoryRequest {
  slug: string; identity: string; capital: CapitalBasis; range: DetailRange; signal: AbortSignal;
  now: Date; publicationId?: string; snapshotUpdatedAt?: string; force?: boolean;
}
export interface DetailHistoryTransport {
  version: (signal: AbortSignal) => Promise<unknown>;
  history: (version: DetailHistoryVersion, signal: AbortSignal) => Promise<DetailHistoryBundle>;
}
const DAY = 86_400_000;
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && date(Date.parse(value)) === value;
const invalid = () => new DetailHistoryError(502, "이력 응답을 확인할 수 없습니다.");

export function validateDetailHistoryVersion(value: unknown, request: CachedDetailHistoryRequest): DetailHistoryVersion {
  if (!dailyHistoryVersionValid(value) || !value.asset.snapshotId || value.asOf >= date(Date.now())) throw invalid();
  if (value.asset.slug !== request.slug || value.asset.identity !== request.identity
    || request.publicationId !== undefined && value.asset.snapshotId !== request.publicationId)
    throw new DetailHistoryError(409, "이력 기준이 갱신되었습니다. 다시 불러와 주세요.");
  if (request.snapshotUpdatedAt !== undefined) {
    const captured = Date.parse(request.snapshotUpdatedAt);
    if (!Number.isFinite(captured)) throw invalid();
    const expected = [date(captured - DAY), date(Date.now() - DAY)].sort()[0];
    if (value.asOf !== expected) throw new DetailHistoryError(409, "이력 기준이 갱신되었습니다. 다시 불러와 주세요.");
  }
  return value;
}

export const detailHistoryVersionKey = (version: DetailHistoryVersion) => JSON.stringify([
  version.asset.slug, version.asset.identity, version.asset.snapshotId, version.rawRevision, version.asOf,
  version.calculationVersion, version.revenueDays, version.freshness.status, version.freshness.lagDays, version.freshness.reason, version.convention,
]);

function validateBundle(bundle: DetailHistoryBundle, version: DetailHistoryVersion, request: CachedDetailHistoryRequest) {
  const bounds = detailHistoryBounds("MAX", request.now);
  for (const capital of ["mcap", "fdv"] as const) {
    const data = bundle[capital];
    if (!data || data.schema !== 2 || data.capital !== capital || data.nextCursor !== null || !Array.isArray(data.points)
      || data.points.length > 32_000 || !Array.isArray(data.sources)
      || detailHistoryVersionKey({ ...data, schema: 3 }) !== detailHistoryVersionKey(version)
      || data.points.some((point, index) => !isDetailHistoryPoint(point) || !validDate(point.day) || point.day < bounds.from
        || point.day > version.asOf || index > 0 && point.day <= data.points[index - 1].day)) throw invalid();
    const sources = new Map<string, DetailHistoryData["sources"][number]>();
    for (const source of data.sources) {
      if (!source || typeof source.key !== "string" || !source.key || sources.has(source.key)
        || !["price", "mcap", "fdv", "fees", "revenue", "holders"].includes(source.metric)
        || ![source.provider, source.url, source.sha256, source.observedAt, source.scope, source.definition, source.basis].every(value => typeof value === "string")
        || !Number.isFinite(Date.parse(source.observedAt))) throw invalid();
      sources.set(source.key, source);
    }
    for (const point of data.points) for (const metric of ["price", "mcap", "fdv", "fees", "revenue", "holders"] as const) {
      const cell = point[metric], source = sources.get(cell.source);
      if (cell.source ? !source || source.metric !== metric : cell.state !== "missing") throw invalid();
    }
  }
  if (bundle.mcap.points.length !== bundle.fdv.points.length
    || bundle.mcap.points.some((point, index) => point.day !== bundle.fdv.points[index].day)) throw invalid();
}

interface Entry { scope: string; version: string; bundle: DetailHistoryBundle; expires: number; bytes: number; points: number }
interface Pending {
  controller: AbortController; promise: Promise<DetailHistoryBundle>; subscribers: Set<symbol>; settled: boolean;
  abortTimer?: ReturnType<typeof setTimeout>;
}
export const DETAIL_HISTORY_TIMEOUT_MS = 30_000;

/** Only complete, freshly version-checked MAX bundles are admitted. Nothing persists across browser reloads. */
export class DetailHistoryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Pending>();
  private bytes = 0;
  private points = 0;
  constructor(private readonly limits = { entries: 8, bytes: 24 * 1024 * 1024, points: 64_000, ttl: 5 * 60_000 }) {}

  stats() { this.prune(); return { entries: this.entries.size, bytes: this.bytes, points: this.points, pending: this.pending.size }; }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.bytes -= entry.bytes; this.points -= entry.points;
  }
  private prune() { for (const [key, entry] of this.entries) if (entry.expires <= Date.now()) this.remove(key); }
  private store(scope: string, version: string, bundle: DetailHistoryBundle) {
    const bytes = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
    const points = bundle.mcap.points.length + bundle.fdv.points.length;
    if (bytes > this.limits.bytes || points > this.limits.points || this.limits.entries < 1) return;
    const key = `${scope}:${version}`;
    this.remove(key);
    this.entries.set(key, { scope, version, bundle, bytes, points, expires: Date.now() + this.limits.ttl });
    this.bytes += bytes; this.points += points;
    while (this.entries.size > this.limits.entries || this.bytes > this.limits.bytes || this.points > this.limits.points)
      this.remove(this.entries.keys().next().value!);
  }

  async load(request: CachedDetailHistoryRequest, transport: DetailHistoryTransport): Promise<DetailHistoryData> {
    request.signal.throwIfAborted();
    this.prune();
    const scope = JSON.stringify([request.slug, request.identity, request.publicationId ?? null, request.snapshotUpdatedAt ?? null, "MAX"]);
    let pending = this.pending.get(scope);
    if (!pending || pending.controller.signal.aborted) {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(new DetailHistoryError(408, "조회가 지연되고 있습니다. 다시 시도해 주세요.")), DETAIL_HISTORY_TIMEOUT_MS);
      let task: Pending;
      const work = async () => {
        const version = validateDetailHistoryVersion(await transport.version(controller.signal), request);
        controller.signal.throwIfAborted();
        const key = detailHistoryVersionKey(version), entryKey = `${scope}:${key}`;
        this.prune();
        for (const [cachedKey, entry] of this.entries) if (entry.scope === scope && (entry.version !== key || request.force)) this.remove(cachedKey);
        const cached = this.entries.get(entryKey);
        if (cached) { this.entries.delete(entryKey); this.entries.set(entryKey, cached); return cached.bundle; }
        const bundle = await transport.history(version, controller.signal);
        controller.signal.throwIfAborted();
        validateBundle(bundle, version, request);
        this.store(scope, key, bundle);
        return bundle;
      };
      const settled = () => {
        task.settled = true;
        clearTimeout(task.abortTimer);
        clearTimeout(deadline);
        if (this.pending.get(scope) === task) this.pending.delete(scope);
      };
      task = { controller, subscribers: new Set(), settled: false, promise: work().then(bundle => { settled(); return bundle; }, error => { settled(); throw controller.signal.aborted ? controller.signal.reason : error; }) };
      pending = task; this.pending.set(scope, task);
    }
    const task = pending;
    clearTimeout(task.abortTimer);
    const subscriber = Symbol(); task.subscribers.add(subscriber);
    const bundle = await new Promise<DetailHistoryBundle>((resolve, reject) => {
      let finished = false;
      const finish = (action: () => void) => {
        if (finished) return;
        finished = true;
        request.signal.removeEventListener("abort", abort);
        task.subscribers.delete(subscriber);
        if (!task.subscribers.size && !task.settled) task.abortTimer = setTimeout(() => {
          if (!task.subscribers.size && !task.settled) task.controller.abort();
        }, 0);
        action();
      };
      const abort = () => finish(() => reject(request.signal.reason ?? new DOMException("Aborted", "AbortError")));
      request.signal.addEventListener("abort", abort, { once: true });
      task.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
      if (request.signal.aborted) abort();
    });
    request.signal.throwIfAborted();
    const selected = bundle[request.capital], range = detailHistoryBounds(request.range, request.now);
    const points = selected.points.filter(point => point.day >= range.from && point.day <= range.to);
    const sources = new Set(points.flatMap(point => [point.price.source, point.mcap.source, point.fdv.source, point.fees.source, point.revenue.source, point.holders.source]));
    return { ...selected, points, sources: selected.sources.filter(source => sources.has(source.key)) };
  }
}

const browserHistoryCache = new DetailHistoryCache();

/** Each reuse probes the current stamp; only the compact MAX response carries substantial history. */
export async function loadCachedDetailHistory(options: Omit<CachedDetailHistoryRequest, "now"> & {
  now?: Date; fetcher?: typeof fetch; onPage?: (count: number) => void; cache?: DetailHistoryCache;
}): Promise<DetailHistoryData> {
  const { fetcher = fetch, cache = browserHistoryCache, onPage, ...input } = options;
  const request = { ...input, now: input.now ?? new Date() };
  const url = (format: "version" | "compact", version?: DetailHistoryVersion) => {
    const params = new URLSearchParams({ format, slug: request.slug, expectedIdentity: request.identity });
    if (format === "compact") params.set("expectedRevision", version!.rawRevision);
    return `/api/history?${params}`;
  };
  const read = async (target: string, signal: AbortSignal) => {
    const response = await fetcher(target, { signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw new DetailHistoryError(response.status, response.status === 404 ? "저장된 종목 이력이 없습니다." : response.status === 409 ? "이력 기준이 갱신되었습니다. 다시 불러와 주세요." : "이력을 불러오지 못했습니다.");
    return response.json() as Promise<unknown>;
  };
  const result = await cache.load(request, {
    version: signal => read(url("version"), signal),
    history: async (version, signal) => {
      const body = await read(url("compact", version), signal);
      validateDetailHistoryVersion(body, request);
      try {
        const decoded = await decodeCompactHistory(body);
        if (detailHistoryVersionKey(decoded.version) !== detailHistoryVersionKey(version))
          throw new DetailHistoryError(409, "이력 기준이 갱신되었습니다. 다시 불러와 주세요.");
        if (decoded.data.points.some(point => point[0] < "1900-01-01")) throw invalid();
        signal.throwIfAborted();
        return { mcap: expandCompactHistory(decoded, "mcap"), fdv: expandCompactHistory(decoded, "fdv") };
      } catch (error) {
        if (signal.aborted) signal.throwIfAborted();
        throw error instanceof DetailHistoryError ? error : invalid();
      }
    },
  });
  options.signal.throwIfAborted();
  onPage?.(result.points.length);
  return result;
}
