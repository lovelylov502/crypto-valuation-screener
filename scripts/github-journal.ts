import type { PublicationJournal } from "../lib/publicationTypes";
import { JOURNAL_REPOSITORY } from "../lib/publication";
import { parseJournal, sha256 } from "../lib/snapshotArchive";

const api = `https://api.github.com/repos/${JOURNAL_REPOSITORY}`;
function headers() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== JOURNAL_REPOSITORY || process.env.GITHUB_REF !== "refs/heads/main" || !process.env.GITHUB_TOKEN) throw new Error("Publication only runs in the serialized canonical main workflow");
  return { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(api + path, { method, headers: { ...headers(), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (method === "GET" && path === "/releases/latest" && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub journal ${method} ${path}: HTTP ${response.status}`);
  return response.json();
}
export async function latestJournal(): Promise<PublicationJournal | null> {
  const release = await request("/releases/latest");
  return release ? parseJournal(JSON.parse(release.body)) : null;
}
export async function publishJournal(journal: PublicationJournal, files: Record<string, Uint8Array>) {
  const checkParent = async () => {
    const latest = await latestJournal();
    if ((latest?.id ?? null) !== journal.previousId) throw new Error("Journal changed; refusing a stale writer");
  };
  await checkParent();
  // Assets and journal become public together. Never delete/overwrite old assets.
  const release = await request("/releases", "POST", { tag_name: journal.id, target_commitish: process.env.GITHUB_SHA,
    name: `Screener data ${journal.id} (${journal.attempt.outcome})`, draft: true, make_latest: "false", body: JSON.stringify(journal) });
  const upload = new URL(release.upload_url.split("{")[0]);
  if (upload.hostname !== "uploads.github.com") throw new Error("Unexpected upload host");
  for (const [name, bytes] of Object.entries({ ...files, "state.json": Buffer.from(JSON.stringify(journal)) })) {
    upload.searchParams.set("name", name);
    const response = await fetch(upload, { method: "POST", headers: { ...headers(), "content-type": "application/octet-stream" }, body: Buffer.from(bytes), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Archive upload ${name}: HTTP ${response.status}`);
    const asset = await response.json();
    if (asset.digest !== `sha256:${sha256(bytes)}`) throw new Error(`Archive upload hash mismatch: ${name}`);
  }
  await checkParent();
  await request(`/releases/${release.id}`, "PATCH", { draft: false, make_latest: "true" });
  if ((await latestJournal())?.id !== journal.id) throw new Error("Published journal readback mismatch");
  console.log(JSON.stringify({ journal: journal.id, outcome: journal.attempt.outcome, published: journal.published?.id ?? null, errors: journal.attempt.errors.length }));
}
