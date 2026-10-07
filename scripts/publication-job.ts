import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import type { ScreenerResponse, SourceObservation } from "../lib/types";
import type { CollectionAttempt, PublicationJournal, PublishedSnapshot } from "../lib/publicationTypes";
import { startJournal, finishJournal, JOURNAL_DOWNLOAD, snapshotErrors } from "../lib/publication";
import { checkArchiveUrl, readSnapshot, sha256 } from "../lib/snapshotArchive";
import { witnessErrors } from "../lib/sourceWitness";
import { assessPipelineCandidate, captureDataPipeline, encodeSourceBundle, replayDataPipeline } from "../lib/dataPipeline";
import { normalizedCoin } from "../lib/pipelineIntegrity";
import { objectHash, witnessFromBundle, type SourceBundle } from "../lib/sourceBundle";
import { withDeadline } from "../lib/withDeadline";
import { latestJournal, publishJournal } from "./github-journal";
import { collectionTriggerDecision } from "../lib/scheduledCollection";
import { recoveryDecision, startRecoveryJournal, finishRecoveryJournal, confirmPublicationAvailability, type CollectionTrigger } from "../lib/freshnessRecovery";
import { fourDailyActive, verifyWriterActivation, writerPaused } from "../lib/pipelineRelease";
import { classifyAttemptFailure } from "../lib/scheduledCollection";
import { publicationVerdicts } from "../lib/publicationVerdicts";

const output = resolve("snapshot-output/publication");
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const save = async (name: string, value: Uint8Array) => writeFile(join(output, name), value, { flag: "wx" });
const load = async (name: string) => JSON.parse(await readFile(join(output, name), "utf8"));
const runId = `data-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;

async function due() {
  if (writerPaused()) {
    if (!process.env.GITHUB_OUTPUT) throw new Error("Missing workflow decision output");
    await mkdir(output,{recursive:true});
    await save("decision.json",json({collect:false,reason:"compatible-rollback-paused",at:new Date().toISOString(),requestId:runId}));
    await writeFile(process.env.GITHUB_OUTPUT,"collect=false\n",{flag:"a"}); return;
  }
  await verifyWriterActivation();
  const event = process.env.GITHUB_EVENT_NAME;
  if (!process.env.GITHUB_OUTPUT) throw new Error("Missing workflow decision output");
  const previous = await latestJournal();
  let workflowEvidence:{workflowCreatedAt?:string;workflowStartedAt?:string}={};
  if(fourDailyActive()) {
    const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,{headers:{authorization:`Bearer ${process.env.GITHUB_TOKEN}`,accept:"application/vnd.github+json"},signal:AbortSignal.timeout(10_000)});
    const run=await response.json();
    if(!response.ok||String(run.id)!==process.env.GITHUB_RUN_ID||run.head_sha!==process.env.GITHUB_SHA||![run.created_at,run.run_started_at].every(t=>typeof t==="string"&&Number.isFinite(Date.parse(t))))throw new Error("Workflow creation/start evidence unavailable");
    workflowEvidence={workflowCreatedAt:run.created_at,workflowStartedAt:run.run_started_at};
  }
  const decision = collectionTriggerDecision({ event, receipt: process.env.SCREENER_SCHEDULER_RECEIPT ?? "",
    signature: process.env.SCREENER_SCHEDULER_SIGNATURE ?? "", secret: process.env.SCREENER_SCHEDULER_SECRET ?? "",
    bootstrap: !!process.env.SCREENER_BOOTSTRAP_URL, requestId:`${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
    requestedAt:process.env.SCREENER_WORKFLOW_CREATED_AT, schedule:process.env.SCREENER_GITHUB_SCHEDULE }, previous, Date.now());
  await mkdir(output, { recursive: true });
  await save("trigger.json", json({ ...decision.trigger, ...workflowEvidence, manualRepair: decision.manualRepair, decisionAt:new Date().toISOString() }));
  if (!decision.collect && previous && "recovery" in decision) await recordWake(previous,decision);
  await writeFile(process.env.GITHUB_OUTPUT, `collect=${decision.collect}\nslot_at=${decision.slotAt}\n`, { flag: "a" });
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY,
    `Trigger: ${event}. Slot: ${decision.slotAt || "manual"}. Collect: ${decision.collect}. Previous start: ${decision.previousStartedAt || "not applicable"}.\n`, { flag: "a" });
  console.log(JSON.stringify({ event, ...decision }));
}
async function recordWake(previous: PublicationJournal,decision: ReturnType<typeof recoveryDecision>) {
  const id=`${runId}-wake`;
  const journal={...previous,schema:2 as const,id,createdAt:new Date().toISOString(),previousId:previous.id,previousStateUrl:`${JOURNAL_DOWNLOAD}${previous.id}/state.json`,recovery:decision.recovery,schedule:undefined};
  await publishJournal(journal,{"trigger.json":json(decision.trigger),"decision.json":json({collect:false,reason:decision.reason,action:{slotAt:decision.slotAt,stage:decision.stage},at:journal.createdAt})});
}

async function start() {
  await mkdir(output, { recursive: true });
  const previous = await latestJournal();
  if (!previous && !process.env.SCREENER_BOOTSTRAP_URL) throw new Error("Initial publication requires a preserved independently audited snapshot");
  if (previous && process.env.SCREENER_BOOTSTRAP_URL) throw new Error("Bootstrap cannot replace an existing publication");
  const trigger = await load("trigger.json");
  await verifyWriterActivation();
  const claimedAt=Date.now();
  const decision=fourDailyActive()?recoveryDecision(previous,claimedAt,trigger as CollectionTrigger,trigger.manualRepair===true):null;
  // Tests/setup may cross a stage boundary after due. The original known receipt stays expired.
  if (decision && !decision.collect) {
    await recordWake(previous!,decision);
    if(process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT,"claimed=false\n",{flag:"a"});
    return;
  }
  const attempt: CollectionAttempt = { id: runId, startedAt: new Date().toISOString(), completedAt: null, outcome: "running",
    scheduledFor: decision?.slotAt ?? trigger.scheduledFor ?? null, manualRepair: trigger.manualRepair === true,
    ...(decision?{trigger,action:{slotAt:decision.slotAt,stage:decision.stage,receiptKey:decision.receiptKey,natural:decision.naturalCycle}}:{}),
    runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    reportUrl: `${JOURNAL_DOWNLOAD}${runId}-complete/report.json`, errors: [], sourceFailures: [], comparisonCompleted: false, affectedProjects: 0, changeCount: 0, affected: [] };
  const journal = decision ? startRecoveryJournal(previous!,attempt,`${runId}-start`,decision) : startJournal(previous, attempt, `${runId}-start`);
  await publishJournal(journal, {});
  await save("start.json", json(journal));
  if(process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT,"claimed=true\n",{flag:"a"});
}

async function collect() {
  await verifyWriterActivation();
  const current = await load("start.json") as PublicationJournal;
  const sources: SourceObservation[] = [];
  let data: ScreenerResponse | undefined, witness: unknown[] = [], assessment: ReturnType<typeof assessPipelineCandidate> | undefined;
  const errors: string[] = [];
  let bootstrapReceipt: unknown;
  let requestStats:SourceBundle["requestStats"];
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
      const archived = await readSnapshot(current.published);
      const baseline = current.schema===2?{...archived,publication:current}:archived;
      progress("sources");
      const result = await captureDataPipeline(baseline, new Date().toISOString(), async bundle => {
        await save("source-bundle.json.gz", encodeSourceBundle(bundle));
        progress("offline-replay");
      }, sources);
      data = result.data; witness = result.witness;
      requestStats=result.bundle.requestStats;
      await save("inputs.json.gz", gzipSync(json(data.coins.map(normalizedCoin))));
      progress("assessment");
      assessment = assessPipelineCandidate(data, result.bundle, baseline, current.attempt.startedAt, new Date().toISOString(), result.data);
      errors.push(...assessment.errors);
    }
    errors.push(...witnessErrors(data!, witness));
    }, 10 * 60_000);
  } catch (error) { errors.push(error instanceof Error ? error.message : "Collector failed"); }
  if (data) await save("data.json.gz", gzipSync(json(data)));
  if (witness.length) await save("witness.json.gz", gzipSync(json(witness)));
  const trigger = await load("trigger.json");
  const report = { schema: 1, codeCommit: process.env.GITHUB_SHA, scheduledFor: trigger.scheduledFor, trigger,
    startedAt: current.attempt.startedAt, completedAt: new Date().toISOString(), stage,
    comparisonCompleted: !!assessment || !!bootstrapReceipt,
    baseline: current.published, dataAt: data?.updatedAt ?? null, freshness:data?.freshness,requestStats,sources: data?.sources ?? sources, collection: data?.collection, pipeline: data?.pipeline,
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
  catch { const trigger = await load("trigger.json"); report = { codeCommit: process.env.GITHUB_SHA, scheduledFor: trigger.scheduledFor, trigger,
    startedAt: current.attempt.startedAt, baseline: current.published, completedAt: new Date().toISOString(), comparisonCompleted: false,
    errors: ["collector_did_not_complete"], sources: [], affected: [], changes: [] }; await save("report.json", json(report)); }
  const files: Record<string, Uint8Array> = {};
  for (const name of await readdir(output)) if (name !== "start.json") files[name] = await readFile(join(output, name));
  const errors = [...report.errors];
  if (!files["data.json.gz"] || !files["witness.json.gz"]) errors.push("candidate_artifacts_missing");
  if (!report.comparisonCompleted) errors.push("comparison_not_completed");
  // A separate process verifies the saved candidate against the original bytes before promotion.
  // A forged result/hash or a collector cache cannot stand in for source replay.
  if (!report.bootstrapReceipt && !errors.length) {
    try {
      if (!files["source-bundle.json.gz"]) throw new Error("Raw source bundle missing");
      const bundle = JSON.parse(gunzipSync(files["source-bundle.json.gz"]).toString()) as SourceBundle;
      const candidate = JSON.parse(gunzipSync(files["data.json.gz"]).toString()) as ScreenerResponse;
      if (report.dataAt !== candidate.updatedAt || objectHash(report.pipeline) !== objectHash(candidate.pipeline) ||
        objectHash(report.collection) !== objectHash(candidate.collection) || objectHash(report.sources) !== objectHash(candidate.sources)) throw new Error("Candidate report differs from saved snapshot");
      if (objectHash(report.baseline) !== objectHash(current.published)) throw new Error("Candidate report baseline mismatch");
      const savedWitness = JSON.parse(gunzipSync(files["witness.json.gz"]).toString());
      if (objectHash(savedWitness) !== objectHash(witnessFromBundle(bundle))) throw new Error("Saved witness differs from original source bundle");
      const archivedBaseline = current.published ? await readSnapshot(current.published) : null;
      const baseline = archivedBaseline && current.schema===2?{...archivedBaseline,publication:current}:archivedBaseline;
      const replayed = await replayDataPipeline(bundle, sha256(files["source-bundle.json.gz"]));
      errors.push(...assessPipelineCandidate(candidate, bundle, baseline, current.attempt.startedAt, new Date().toISOString(), replayed, files["source-bundle.json.gz"]).errors);
    } catch (error) { errors.push(error instanceof Error ? error.message : "Offline replay failed"); }
  }
  // The permanent report must describe the final promotion decision, including
  // failures found by this separate verification process.
  report = { ...report, collectorCompletedAt: report.completedAt, completedAt: new Date().toISOString(), errors: [...new Set(errors)] };
  files["report.json"] = json(report);
  await writeFile(join(output, "report.json"), files["report.json"]);
  const accepted = errors.length === 0;
  const partial = accepted && (report.pipeline?.quality?.affectedProjects ?? 0) > 0;
  const hasRetryableIssue = accepted && files["data.json.gz"] && (JSON.parse(gunzipSync(files["data.json.gz"]).toString()) as ScreenerResponse).coins.some(c => c.dataQuality?.issues.some(i => i.retryable));
  const attempt: CollectionAttempt = { ...current.attempt, completedAt: report.completedAt, outcome: accepted ? "published" : "blocked",
    partial, ...(partial ? { failureClass: hasRetryableIssue ? "transient" as const : "validation" as const } : {}),
    errors, sourceFailures: report.sources.filter((s: SourceObservation) => s.status === "error"), collection: report.collection, comparisonCompleted: report.comparisonCompleted === true,
    affectedProjects: report.affected.length, changeCount: report.changes.length,
    affected: report.affected.slice(0, 20).map(({slug,name,issues}: {slug:string;name:string;issues:string[]}) => ({slug,name,issues})) };
  if (!accepted) attempt.failureClass=classifyAttemptFailure(attempt);
  const id = `${runId}-complete`;
  const published: PublishedSnapshot | null = accepted ? { id, url: `${JOURNAL_DOWNLOAD}${id}/data.json.gz`, sha256: sha256(files["data.json.gz"]),
    dataAt: report.dataAt, validatedAt: report.completedAt, publishedAt: new Date().toISOString(), codeCommit: process.env.GITHUB_SHA!,
    reportUrl: `${JOURNAL_DOWNLOAD}${id}/report.json`, witnessUrl: `${JOURNAL_DOWNLOAD}${id}/witness.json.gz`, witnessSha256: sha256(files["witness.json.gz"]),
    ...(report.pipeline ? { rawBundleUrl: `${JOURNAL_DOWNLOAD}${id}/source-bundle.json.gz`, rawBundleSha256: sha256(files["source-bundle.json.gz"]), normalizedSha256: report.pipeline.normalizedSha256, replayVerified: true } : {}) } : null;
  // Re-read/revalidate the exact bytes immediately before making their pointer public.
  if (published) { const { decodeSnapshot } = await import("../lib/snapshotArchive"); decodeSnapshot(files["data.json.gz"], published); }
  const acceptedData=accepted?JSON.parse(gunzipSync(files["data.json.gz"]).toString()) as ScreenerResponse:undefined;
  const journal = current.schema===2?finishRecoveryJournal(current,attempt,published,id,acceptedData):finishJournal(current, attempt, published, id);
  if(acceptedData) {
    report.verdicts=publicationVerdicts({...acceptedData,publication:journal},Date.now(),errors);
    files["report.json"]=json(report);await writeFile(join(output,"report.json"),files["report.json"]);
  }
  await publishJournal(journal, files);
  if(accepted&&journal.schema===2) {
    const confirmedAt=new Date().toISOString(),confirmed=confirmPublicationAvailability(journal,confirmedAt,`${runId}-confirmed`);
    await publishJournal(confirmed,{"confirmation.json":json({schema:1,publicationId:published!.id,sha256:published!.sha256,availabilityConfirmedAt:confirmedAt,verdicts:publicationVerdicts({...acceptedData!,publication:confirmed},Date.now(),errors)})});
  }
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY,
    `Outcome: ${attempt.outcome}. Published data: ${journal.published?.dataAt ?? "none"}. Affected projects: ${attempt.affectedProjects}. Errors: ${errors.length}.\n\n[Permanent report](${attempt.reportUrl})\n`, { flag: "a" });
  if (!accepted) process.exitCode = 1;
}

const phase = process.argv[2];
(phase === "due" ? due() : phase === "start" ? start() : phase === "collect" ? collect() : phase === "finish" ? finish() : Promise.reject(new Error("Expected due, start, collect or finish")))
  .catch(error => { console.error(error instanceof Error ? error.message : "Publication failed"); process.exitCode = 1; });
