import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { ScreenerResponse } from "./types";
import { validateEconomicPolicy } from "./economicPolicy";
import type { EconomicPolicyIdentity, EconomicProvenance } from "./economicTypes";
import {validateEconomicReview} from "./economicReview";
import {validateEconomicReviewRef} from "./economicReviewArchive";

/** Original public HTTP responses, before any interpretation or aggregation. */
export interface SourceReceipt {
  url: string;
  requestedAt: string;
  observedAt: string;
  status: number | null;
  headers: Record<string, string>;
  body: string;
  sha256: string;
  error?: string;
}
export interface SourceBundle {
  economicReviewBaselineRef?:import("./economicReviewArchive").EconomicReviewRef;
  schema: 1;
  pipelineSchema?: 2;
  acquisitionRevision?: 2;
  economicPolicy?: EconomicPolicyIdentity;
  economicProvenance?: EconomicProvenance;
  economicReviewBaseline?: import("./economicReview").EconomicReviewState;
  asOf: string;
  baseline: ScreenerResponse | null;
  receipts: SourceReceipt[];
  requestStats?: { requests: number; rateLimited: number; deferred: number; elapsedMs: number };
}
interface Session {
  bundle: SourceBundle;
  replay: boolean;
  cursors: Map<string, number>;
  latest: Map<string, SourceReceipt>;
  successful: Map<string, SourceReceipt>;
  pending: Map<string, Promise<SourceReceipt>>;
  signal?: AbortSignal;
  cooldowns?: Map<string, number>;
  deadlineAt?: number;
  provenanceRequests?: number;
}
const sessions = new AsyncLocalStorage<Session>();
export const contentHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const objectHash = (value: unknown) => contentHash(JSON.stringify(canonical(value)));
export const sourceSessionActive = () => !!sessions.getStore();
export const sourceReplayActive = () => sessions.getStore()?.replay === true;
export const sourcePipelineSchema = (): 1 | 2 => sessions.getStore()?.bundle.pipelineSchema ?? 1;
export const sourceAcquisitionRevision = () => sessions.getStore()?.bundle.acquisitionRevision ?? 1;
export const sourceEconomicPolicy = () => sessions.getStore()?.bundle.economicPolicy;
export const sourceEconomicProvenance = () => sessions.getStore()?.bundle.economicProvenance;
export function recordEconomicProvenance(value: EconomicProvenance) { const s=sessions.getStore(); if(s&&!s.replay)s.bundle.economicProvenance=value; }
export const sourceNow = () => sessions.getStore() ? Date.parse(sessions.getStore()!.bundle.asOf) : Date.now();
export const sourceObservedAt = (url: string) => sessions.getStore()?.latest.get(url)?.observedAt ?? new Date(sourceNow()).toISOString();
export const sourceReceipt = (url: string) => sessions.getStore()?.latest.get(url);
export const sourceRequestDeferred = (url:string) => sessions.getStore()?.latest.get(url)?.error==="Recorded source request deferred by provider cooldown";
export function sourceDelay(ms: number,signal?:AbortSignal): Promise<void> {
  const session = sessions.getStore();
  if (session?.replay || session?.signal?.aborted || signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); session?.signal?.removeEventListener("abort", finish); signal?.removeEventListener("abort",finish); resolve(); };
    const timer = setTimeout(finish, ms);
    session?.signal?.addEventListener("abort", finish, { once: true });
    signal?.addEventListener("abort",finish,{once:true});
  });
}

function validateUrl(url: string, economic = false) {
  const u = new URL(url);
  const provenance = economic && u.hostname === "api.github.com" && (u.pathname === "/repos/DefiLlama/dimension-adapters/commits/HEAD" && !u.search || /^\/repos\/DefiLlama\/dimension-adapters\/git\/trees\/[a-f0-9]{40}$/.test(u.pathname) && u.search === "?recursive=1");
  if (u.protocol !== "https:" || !provenance && !["api.llama.fi", "stablecoins.llama.fi", "api.coingecko.com", "pro-api.coinmarketcap.com"].includes(u.hostname)
    || u.username || u.password || [...u.searchParams.keys()].some(k => /token|secret|api.?key|authorization/i.test(k))) throw new Error("Unapproved source URL");
}
function responseOf(receipt: SourceReceipt): Response {
  if (receipt.error || receipt.status === null) throw new Error(receipt.error ?? "Recorded source transport failure");
  return new Response(receipt.status === 204 || receipt.status === 304 ? null : receipt.body, { status: receipt.status, headers: receipt.headers });
}

/** Explicit transport injection; no global fetch patch and no network fallback during replay. */
export async function sourceFetch(input: string | URL | Request, init?: RequestInit, transport?: { timeout:number; deadline:number }): Promise<Response> {
  const session = sessions.getStore();
  if (!session) return fetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  validateUrl(url, !!session.bundle.economicPolicy);
  if ((init?.method ?? (input instanceof Request ? input.method : "GET")) !== "GET") throw new Error("Source capture is read-only");
  const reused = session.successful.get(url);
  if (reused) { session.latest.set(url, reused); return responseOf(reused); }
  let receipt: SourceReceipt;
  if (session.replay) {
    let pending = session.pending.get(url);
    if (!pending) {
      const entries = session.bundle.receipts.filter(r => r.url === url);
      const cursor = session.cursors.get(url) ?? 0;
      const next = entries[cursor];
      if (!next) throw new Error(`Replay has no source receipt: ${url}`);
      session.cursors.set(url, cursor + 1);
      pending = Promise.resolve(next);
      session.pending.set(url, pending);
    }
    receipt = await pending;
    session.pending.delete(url);
  } else {
    let pending = session.pending.get(url);
    if (!pending) {
      if(new URL(url).hostname==="api.github.com" && (session.provenanceRequests=(session.provenanceRequests??0)+1)>2)throw new Error("Economic provenance request budget exceeded");
      pending = (async () => {
        let requestedAt = new Date().toISOString();
        let result: SourceReceipt;
        try {
          if (session.bundle.pipelineSchema===2) {
            const host=new URL(url).hostname,requestSignal=init?.signal??(input instanceof Request?input.signal:undefined);
            while ((session.cooldowns?.get(host)??0)>Date.now()) {
              const until=session.cooldowns!.get(host)!;
              if (until >= Math.min(session.deadlineAt??Infinity,transport?.deadline??Infinity)||session.signal?.aborted||requestSignal?.aborted) throw new Error("provider cooldown deferred");
              await sourceDelay(until-Date.now(),requestSignal??undefined);
              if(session.signal?.aborted||requestSignal?.aborted)throw new Error("provider cooldown deferred");
            }
            requestedAt=new Date().toISOString();
          }
          const remaining=Math.min(session.deadlineAt??Infinity,transport?.deadline??Infinity)-Date.now();
          if(transport&&remaining<=0)throw new Error("provider cooldown deferred");
          const signals = [session.signal, init?.signal ?? (input instanceof Request ? input.signal : null),transport?AbortSignal.timeout(Math.max(1,Math.min(transport.timeout,remaining))):null].filter((s): s is AbortSignal => !!s);
          const signal = signals.length ? AbortSignal.any(signals) : undefined;
          const response = await fetch(input, { ...init, signal });
          const body = await response.text();
          const headers: Record<string, string> = {};
          for (const key of ["content-type", "retry-after"]) { const value = response.headers.get(key); if (value) headers[key] = value; }
          result = { url, requestedAt, observedAt: new Date().toISOString(), status: response.status, headers, body, sha256: contentHash(body) };
          if (response.status===429 && session.bundle.pipelineSchema===2) {
            const retry=response.headers.get("retry-after"),seconds=retry===null?NaN:Number(retry);
            const ms=Number.isFinite(seconds)?seconds*1000:Date.parse(retry??"")-Date.now();
            const host=new URL(url).hostname;
            session.cooldowns!.set(host,Math.max(session.cooldowns!.get(host)??0,Date.now()+Math.max(5000,Number.isFinite(ms)?ms+1000:60_000)));
          }
        } catch (error) {
          result = { url, requestedAt, observedAt: new Date().toISOString(), status: null, headers: {}, body: "", sha256: contentHash(""), error: error instanceof Error && error.message==="provider cooldown deferred" ? "Recorded source request deferred by provider cooldown" : "Recorded source transport failure" };
        }
        session.bundle.receipts.push(result);
        return result;
      })();
      session.pending.set(url, pending);
    }
    receipt = await pending;
    session.pending.delete(url);
  }
  session.latest.set(url, receipt);
  if (receipt.status !== null && receipt.status >= 200 && receipt.status < 300) session.successful.set(url, receipt);
  return responseOf(receipt);
}

export function validateSourceBundle(bundle: SourceBundle): void {
  if (bundle?.schema !== 1 || (bundle.pipelineSchema !== undefined && bundle.pipelineSchema !== 2) || (bundle.acquisitionRevision!==undefined&&(bundle.pipelineSchema!==2||bundle.acquisitionRevision!==2)) || !Number.isFinite(Date.parse(bundle.asOf)) || !Array.isArray(bundle.receipts) || !bundle.receipts.length) throw new Error("Invalid source bundle");
  if(bundle.economicPolicy) { validateEconomicPolicy(bundle.economicPolicy); if(bundle.pipelineSchema!==2)throw new Error("Economic policy requires pipeline schema 2"); }
  else if(bundle.economicProvenance)throw new Error("Economic provenance has no bound policy");
  if(bundle.economicReviewBaseline||bundle.economicReviewBaselineRef) {
    if(!bundle.economicPolicy||!bundle.economicReviewBaseline||!bundle.economicReviewBaselineRef)throw Error("Incomplete economic review baseline");
    validateEconomicReview(bundle.economicReviewBaseline);validateEconomicReviewRef(bundle.economicReviewBaselineRef);
    if(objectHash(bundle.economicReviewBaseline)!==bundle.economicReviewBaselineRef.stateSha256||contentHash(JSON.stringify(bundle.economicReviewBaseline))!==bundle.economicReviewBaselineRef.sha256||Buffer.byteLength(JSON.stringify(bundle.economicReviewBaseline))!==bundle.economicReviewBaselineRef.bytes)throw Error("Economic review baseline reference mismatch");
  }
  if(bundle.receipts.filter(r=>new URL(r.url).hostname==="api.github.com").length>2)throw new Error("Economic provenance request budget exceeded");
  for (const receipt of bundle.receipts) {
    validateUrl(receipt.url, !!bundle.economicPolicy);
    if (typeof receipt.body !== "string" || contentHash(receipt.body) !== receipt.sha256 || !Number.isFinite(Date.parse(receipt.requestedAt))
      || !Number.isFinite(Date.parse(receipt.observedAt)) || Date.parse(receipt.observedAt) < Date.parse(receipt.requestedAt)
      || (receipt.status !== null && (!Number.isInteger(receipt.status) || receipt.status < 200 || receipt.status > 599))) throw new Error("Invalid source receipt integrity");
  }
}

export async function captureSourceBundle<T>(asOf: string, baseline: ScreenerResponse | null, task: () => Promise<T>, signal = AbortSignal.timeout(9 * 60_000), pipelineSchema: 1 | 2 = 1, acquisitionRevision?:2, economicPolicy?: EconomicPolicyIdentity,economicReviewBaseline?:import("./economicReview").EconomicReviewState,economicReviewBaselineRef?:import("./economicReviewArchive").EconomicReviewRef) {
  if(economicPolicy)validateEconomicPolicy(economicPolicy);
  const bundle: SourceBundle = { schema: 1, ...(pipelineSchema === 2 ? { pipelineSchema } : {}), ...(acquisitionRevision?{acquisitionRevision}:{}), ...(economicPolicy?{economicPolicy,...(economicReviewBaseline?{economicReviewBaseline}:{}),...(economicReviewBaselineRef?{economicReviewBaselineRef}:{})}:{}), asOf, baseline, receipts: [] };
  const started=Date.now();
  const session: Session = { bundle, replay: false, cursors: new Map(), latest: new Map(), successful: new Map(), pending: new Map(), signal, cooldowns:new Map(),deadlineAt:started+9*60_000 };
  let value: T | undefined, error: unknown;
  try { value = await sessions.run(session, task); } catch (caught) { error = caught; }
  // Preserve in-flight receipts even if a caller fails before its sibling requests finish.
  while (session.pending.size) await Promise.allSettled([...session.pending.values()]);
  if (pipelineSchema===2) bundle.requestStats={requests:bundle.receipts.length,rateLimited:bundle.receipts.filter(r=>r.status===429).length,deferred:bundle.receipts.filter(r=>r.error==="Recorded source request deferred by provider cooldown").length,elapsedMs:Date.now()-started};
  return { bundle, value, error };
}

export async function replaySourceBundle<T>(bundle: SourceBundle, task: () => Promise<T>): Promise<T> {
  validateSourceBundle(bundle);
  const session: Session = { bundle, replay: true, cursors: new Map(), latest: new Map(), successful: new Map(), pending: new Map() };
  const value = await sessions.run(session, task);
  // Every captured request must have participated in the replay; truncated/changed plans fail closed.
  for (const url of new Set(bundle.receipts.map(r => r.url))) {
    if ((session.cursors.get(url) ?? 0) !== bundle.receipts.filter(r => r.url === url).length) throw new Error(`Replay left unused source receipts: ${url}`);
  }
  return value;
}

/** The universe witness belongs to the same captured responses, not a later changing feed. */
export function witnessFromBundle(bundle: SourceBundle): unknown[] {
  return ["/protocols", "/config", "/overview/fees", "/overview/fees?dataType=dailyRevenue", "/overview/fees?dataType=dailyHoldersRevenue", "/overview/dexs"].map(path => {
    const wanted = new URL("https://api.llama.fi" + path);
    const receipt = bundle.receipts.find(r => {
      const u = new URL(r.url);
      return r.status === 200 && u.hostname === wanted.hostname && u.pathname === wanted.pathname && u.searchParams.get("dataType") === wanted.searchParams.get("dataType")
        && (wanted.pathname.startsWith("/overview/") ? u.searchParams.get("excludeTotalDataChartBreakdown") === "true" : true);
    });
    if (!receipt) throw new Error(`Source universe receipt missing: ${path}`);
    return JSON.parse(receipt.body);
  });
}
