import type { PublicationJournal } from "../lib/publicationTypes";
import { JOURNAL_REPOSITORY } from "../lib/publication";
import { parseJournal, sha256,readArchivedJournal } from "../lib/snapshotArchive";
import { compactRecoveryJournal,withMigrationEvidence } from "../lib/freshnessRecovery";
import {verifyWriterActivation} from "../lib/pipelineRelease";

const api = `https://api.github.com/repos/${JOURNAL_REPOSITORY}`;
class RetryableArchiveError extends Error {}
function headers() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== JOURNAL_REPOSITORY || process.env.GITHUB_REF !== "refs/heads/main" || !process.env.GITHUB_TOKEN) throw new Error("Publication only runs in the serialized canonical main workflow");
  return { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}
async function request(path: string, method = "GET", body?: unknown) {
  const auth = headers();
  let response: Response;
  try { response = await fetch(api + path, { method, headers: { ...auth, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) }); }
  catch { throw new RetryableArchiveError(`GitHub journal ${method} ${path}: response unconfirmed`); }
  if (method === "GET" && (path === "/releases/latest" || path.startsWith("/releases/tags/")) && response.status === 404) return null;
  if (!response.ok) {
    const ErrorType = response.status === 408 || response.status === 429 || response.status >= 500 || (method === "POST" && response.status === 422) ? RetryableArchiveError : Error;
    throw new ErrorType(`GitHub journal ${method} ${path}: HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}
export async function latestJournal(): Promise<PublicationJournal | null> {
  const release = await request("/releases/latest");
  return release ? withMigrationEvidence(parseJournal(JSON.parse(release.body)),readArchivedJournal) : null;
}
export async function publishJournal(journal: PublicationJournal, files: Record<string, Uint8Array>) {
  headers();
  const compact=compactRecoveryJournal(journal);
  journal=compact.journal;
  if(compact.history)files={...files,"recovery-history.json":compact.history};
  const body = JSON.stringify(journal);
  const expected = { ...files, "state.json": Buffer.from(body) };
  const checkParent = async () => {
    const latest = await latestJournal();
    if (latest?.id === journal.id) {
      if (JSON.stringify(latest) !== body) throw new Error("Existing journal identity has different content");
      return true;
    }
    if ((latest?.id ?? null) !== journal.previousId) throw new Error("Journal changed; refusing a stale writer");
    return false;
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const alreadyPublished = await checkParent();
      let release = await request(`/releases/tags/${encodeURIComponent(journal.id)}`);
      // The tag endpoint only promises published releases. Authorized listings also
      // expose drafts, including a creation whose response was lost in transit.
      if (!release) release = (await request("/releases?per_page=100")).find((r: { tag_name: string }) => r.tag_name === journal.id);
      if (!release) {
        if (alreadyPublished) throw new Error("Published journal release is missing");
        release = await request("/releases", "POST", { tag_name: journal.id, target_commitish: process.env.GITHUB_SHA,
          name: `Screener data ${journal.id} (${journal.attempt.outcome})`, draft: true, make_latest: "false", body });
      }
      if (release.tag_name !== journal.id || release.body !== body) throw new Error("Existing archive identity has different content");
      const upload = new URL(release.upload_url.split("{")[0]);
      if (upload.hostname !== "uploads.github.com") throw new Error("Unexpected upload host");
      const assets: { id: number; name: string; state: string; size: number; digest: string }[] = [];
      for (let page = 1; ; page++) {
        const batch = await request(`/releases/${release.id}/assets?per_page=100&page=${page}`);
        assets.push(...batch);
        if (batch.length < 100) break;
      }
      for (const [name, bytes] of Object.entries(expected)) {
        const digest = `sha256:${sha256(bytes)}`;
        const existing = assets.find(a => a.name === name);
        if (existing && existing.digest === digest && existing.size === bytes.byteLength && existing.state === "uploaded") continue;
        if (!release.draft) throw new Error(`Published archive asset mismatch: ${name}`);
        if (existing) {
          // GitHub documents empty starter assets after a failed upload. Only this
          // attempt's empty draft placeholder can be removed; verified bytes never are.
          if (existing.state !== "starter" || existing.size !== 0) throw new Error(`Archive upload hash mismatch: ${name}`);
          await request(`/releases/assets/${existing.id}`, "DELETE");
        }
        upload.searchParams.set("name", name);
        let response: Response;
        try { response = await fetch(upload, { method: "POST", headers: { ...headers(), "content-type": "application/octet-stream" }, body: Buffer.from(bytes), signal: AbortSignal.timeout(120_000) }); }
        catch { throw new RetryableArchiveError(`Archive upload ${name}: response unconfirmed`); }
        if (!response.ok) {
          const ErrorType = [408, 422, 429].includes(response.status) || response.status >= 500 ? RetryableArchiveError : Error;
          throw new ErrorType(`Archive upload ${name}: HTTP ${response.status}`);
        }
        const asset = await response.json();
        if (asset.digest !== digest || asset.size !== bytes.byteLength || asset.state !== "uploaded") throw new Error(`Archive upload hash mismatch: ${name}`);
      }
      if (!await checkParent()) {
        // Queued old binaries must honor a compatible canonical pause immediately before promotion.
        await verifyWriterActivation();
        await request(`/releases/${release.id}`, "PATCH", { draft: false, make_latest: "true" });
      }
      if ((await latestJournal())?.id !== journal.id) throw new RetryableArchiveError("Published journal readback mismatch");
      console.log(JSON.stringify({ journal: journal.id, outcome: journal.attempt.outcome, published: journal.published?.id ?? null, errors: journal.attempt.errors.length }));
      return;
    } catch (error) {
      if (!(error instanceof RetryableArchiveError) || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}
