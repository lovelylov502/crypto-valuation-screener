import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { fetchCoins } from "../lib/sources";
import { assembleScreener } from "../lib/screener";
import type { ScreenerResponse, SourceObservation } from "../lib/types";
import type { CollectionAttempt, PublicationJournal, PublishedSnapshot } from "../lib/publicationTypes";
import { assessCandidate, startJournal, finishJournal, JOURNAL_DOWNLOAD, snapshotErrors } from "../lib/publication";
import { checkArchiveUrl, readSnapshot, sha256 } from "../lib/snapshotArchive";
import { collectWitness, witnessErrors } from "../lib/sourceWitness";
import { reviewedSourceChanges } from "../lib/reviewedSourceChanges";
import { reviewPendingHistory } from "../lib/pendingHistoryReview";
import { reviewUpstreamChanges } from "../lib/upstreamChangeReview";
import { withDeadline } from "../lib/withDeadline";
import { latestJournal, publishJournal } from "./github-journal";
import { scheduledCollectionDecision } from "../lib/scheduledCollection";

const output = resolve("snapshot-output/publication");
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const save = async (name: string, value: Uint8Array) => writeFile(join(output, name), value, { flag: "wx" });
const load = async (name: string) => JSON.parse(await readFile(join(output, name), "utf8"));
const runId = `data-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;

async function due() {
  const event = process.env.GITHUB_EVENT_NAME;
  if (event !== "schedule" && event !== "workflow_dispatch") throw new Error("Unexpected collection trigger");
  if (!process.env.GITHUB_OUTPUT) throw new Error("Missing workflow decision output");
  const decision = event === "workflow_dispatch"
    ? { collect: true, slotAt: "", previousStartedAt: null }
    : scheduledCollectionDecision((await latestJournal())?.attempt.startedAt ?? null, Date.now());
  await writeFile(process.env.GITHUB_OUTPUT, `collect=${decision.collect}\nslot_at=${decision.slotAt}\n`, { flag: "a" });
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY,
    `Trigger: ${event}. Slot: ${decision.slotAt || "manual"}. Collect: ${decision.collect}. Previous start: ${decision.previousStartedAt || "not applicable"}.\n`, { flag: "a" });
  console.log(JSON.stringify({ event, ...decision }));
}

async function start() {
  await mkdir(output, { recursive: true });
  const previous = await latestJournal();
  if (!previous && !process.env.SCREENER_BOOTSTRAP_URL) throw new Error("Initial publication requires a preserved independently audited snapshot");
  if (previous && process.env.SCREENER_BOOTSTRAP_URL) throw new Error("Bootstrap cannot replace an existing publication");
  const attempt: CollectionAttempt = { id: runId, startedAt: new Date().toISOString(), completedAt: null, outcome: "running",
    runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    reportUrl: `${JOURNAL_DOWNLOAD}${runId}-complete/report.json`, errors: [], sourceFailures: [], comparisonCompleted: false, affectedProjects: 0, changeCount: 0, affected: [] };
  const journal = startJournal(previous, attempt, `${runId}-start`);
  await publishJournal(journal, {});
  await save("start.json", json(journal));
}

async function collect() {
  const current = await load("start.json") as PublicationJournal;
  const sources: SourceObservation[] = [];
  let data: ScreenerResponse | undefined, witness: unknown[] = [], assessment: ReturnType<typeof assessCandidate> | undefined;
  const errors: string[] = [];
  let bootstrapReceipt: unknown;
  let stage = "baseline";
  const progress = (next: string) => { stage = next; console.log(JSON.stringify({ stage, at: new Date().toISOString(), sourceRequests: sources.length })); };
  try {
    await withDeadline(async () => {
    if (process.env.SCREENER_BOOTSTRAP_URL) {
      checkArchiveUrl(process.env.SCREENER_BOOTSTRAP_URL);
      const response = await fetch(process.env.SCREENER_BOOTSTRAP_URL, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Bootstrap HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (sha256(bytes) !== process.env.SCREENER_BOOTSTRAP_SHA256) throw new Error("Bootstrap hash mismatch");
      const seed = JSON.parse(gunzipSync(bytes).toString("utf8"));
      data = seed.data; witness = seed.witness; bootstrapReceipt = seed.receipt;
      if (seed.receipt.updatedAt !== data!.updatedAt || seed.receipt.errors?.length !== 0 || seed.receipt.sourceFailures?.length !== 0 || seed.receipt.directory?.missing?.length !== 0 || !(seed.receipt.independentQuoteChecks > 0)) throw new Error("Bootstrap lacks passing independent audit");
      errors.push(...snapshotErrors(data!));
      // Historical recovery keeps the original date. No current-data assertion is made.
    } else {
      if (!current.published) throw new Error("Missing verified baseline; bootstrap must be reviewed");
      const baseline = await readSnapshot(current.published);
      progress("sources");
      const raw = await fetchCoins(sources, baseline);
      progress("snapshot");
      await save("inputs.json.gz", gzipSync(json(raw)));
      data = assembleScreener(raw, new Date().toISOString(), sources);
      progress("witness");
      witness = await collectWitness();
      progress("source-change-review");
      const pendingReview = await reviewPendingHistory(data, baseline, witness);
      if (pendingReview.proofs.length) await save("pending-history-review.json.gz", gzipSync(json(pendingReview.proofs)));
      const reviews = reviewedSourceChanges(data, baseline);
      if (reviews.length) await save("source-change-review.json", json(reviews));
      const reviewed = new Set([...pendingReview.keys, ...reviews.map(r => `${r.slug}:${r.issue}`)]);
      const upstream = await reviewUpstreamChanges(data, baseline, witness, reviewed);
      if (upstream.proofs.length || Object.keys(upstream.evidence).length) await save("upstream-change-review.json.gz", gzipSync(json({ proofs: upstream.proofs, evidence: upstream.evidence })));
      progress("assessment");
      assessment = assessCandidate(data, baseline, current.attempt.startedAt, new Date().toISOString(), new Set([...reviewed, ...upstream.keys]));
      errors.push(...assessment.errors);
    }
    errors.push(...witnessErrors(data!, witness));
    }, 10 * 60_000);
  } catch (error) { errors.push(error instanceof Error ? error.message : "Collector failed"); }
  if (data) await save("data.json.gz", gzipSync(json(data)));
  if (witness.length) await save("witness.json.gz", gzipSync(json(witness)));
  const report = { schema: 1, codeCommit: process.env.GITHUB_SHA, scheduledFor: process.env.SCREENER_SCHEDULED_FOR || null,
    startedAt: current.attempt.startedAt, completedAt: new Date().toISOString(), stage,
    comparisonCompleted: !!assessment || !!bootstrapReceipt,
    baseline: current.published, dataAt: data?.updatedAt ?? null, sources: data?.sources ?? sources, collection: data?.collection,
    errors: [...new Set(errors)], changes: assessment?.changes ?? [], reviewedChanges: assessment?.reviewedChanges ?? [], unreviewedChanges: assessment?.unreviewedChanges ?? [], affected: assessment?.affected ?? [], bootstrapReceipt,
    artifacts: await Promise.all((await readdir(output)).filter(n => n.endsWith(".gz")).map(async name => { const bytes = await readFile(join(output, name)); return { name, bytes: bytes.length, sha256: sha256(bytes) }; })) };
  await save("report.json", json(report));
  if (errors.length) throw new Error(`Candidate blocked: ${errors.length} validation errors; diagnostic report retained`);
}

async function finish() {
  const current = await load("start.json") as PublicationJournal;
  const latest = await latestJournal();
  if (latest?.id !== current.id) throw new Error("A newer job owns publication; refusing to finish");
  let report;
  try { report = await load("report.json"); }
  catch { report = { baseline: current.published, completedAt: new Date().toISOString(), comparisonCompleted: false, errors: ["collector_did_not_complete"], sources: [], affected: [], changes: [] }; await save("report.json", json(report)); }
  const files: Record<string, Uint8Array> = {};
  for (const name of await readdir(output)) if (name !== "start.json") files[name] = await readFile(join(output, name));
  const errors = [...report.errors];
  if (!files["data.json.gz"] || !files["witness.json.gz"]) errors.push("candidate_artifacts_missing");
  if (!report.comparisonCompleted) errors.push("comparison_not_completed");
  const accepted = errors.length === 0;
  const attempt: CollectionAttempt = { ...current.attempt, completedAt: report.completedAt, outcome: accepted ? "published" : "blocked",
    errors, sourceFailures: report.sources.filter((s: SourceObservation) => s.status === "error"), collection: report.collection, comparisonCompleted: report.comparisonCompleted === true,
    affectedProjects: report.affected.length, changeCount: report.changes.length,
    affected: report.affected.slice(0, 20).map(({slug,name,issues}: {slug:string;name:string;issues:string[]}) => ({slug,name,issues})) };
  const id = `${runId}-complete`;
  const published: PublishedSnapshot | null = accepted ? { id, url: `${JOURNAL_DOWNLOAD}${id}/data.json.gz`, sha256: sha256(files["data.json.gz"]),
    dataAt: report.dataAt, validatedAt: report.completedAt, publishedAt: new Date().toISOString(), codeCommit: process.env.GITHUB_SHA!,
    reportUrl: `${JOURNAL_DOWNLOAD}${id}/report.json`, witnessUrl: `${JOURNAL_DOWNLOAD}${id}/witness.json.gz`, witnessSha256: sha256(files["witness.json.gz"]) } : null;
  // Re-read/revalidate the exact bytes immediately before making their pointer public.
  if (published) { const { decodeSnapshot } = await import("../lib/snapshotArchive"); decodeSnapshot(files["data.json.gz"], published); }
  const journal = finishJournal(current, attempt, published, id);
  await publishJournal(journal, files);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY,
    `Outcome: ${attempt.outcome}. Published data: ${journal.published?.dataAt ?? "none"}. Affected projects: ${attempt.affectedProjects}. Errors: ${errors.length}.\n\n[Permanent report](${attempt.reportUrl})\n`, { flag: "a" });
  if (!accepted) process.exitCode = 1;
}

const phase = process.argv[2];
(phase === "due" ? due() : phase === "start" ? start() : phase === "collect" ? collect() : phase === "finish" ? finish() : Promise.reject(new Error("Expected due, start, collect or finish")))
  .catch(error => { console.error(error instanceof Error ? error.message : "Publication failed"); process.exitCode = 1; });
