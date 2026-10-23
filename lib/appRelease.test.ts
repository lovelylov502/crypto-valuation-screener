import { expect, it, vi } from "vitest";
import { releaseApp, verifyReleasePublication } from "../scripts/release-app";
import { journalBody } from "./journalBody";
import { JOURNAL_LATEST, JOURNAL_REPOSITORY, startJournal, stateUrl } from "./publication";

function fixture(options: { appLatestBefore?: boolean; appLatestAfter?: boolean; direct404?: boolean; wrongCommit?: boolean; table502?: boolean; corruptState?: boolean; advance?: boolean; lostCreate?: boolean } = {}) {
  const journal = startJournal(null, { id: "data-1", startedAt: "2026-10-23T05:00:00Z", completedAt: null, outcome: "running", runUrl: "https://github.com/run", reportUrl: "https://github.com/report", errors: [], sourceFailures: [], affectedProjects: 0, changeCount: 0, affected: [] }, "data-1-start");
  journal.published = { id: "data-0-complete", url: stateUrl("data-0-complete").replace("state.json", "data.json.gz"), reportUrl: stateUrl("data-0-complete").replace("state.json", "report.json"), witnessUrl: stateUrl("data-0-complete").replace("state.json", "witness.json.gz"), sha256: "a".repeat(64), witnessSha256: "b".repeat(64), dataAt: journal.createdAt, publishedAt: journal.createdAt, validatedAt: journal.createdAt, codeCommit: "c".repeat(40) };
  let created = false;
  const current = () => options.advance && created ? { ...journal, id: "data-2-start", createdAt: "2026-10-23T06:00:00Z" } : journal;
  const run = vi.fn((args: string[]) => {
    if (args[0] === "release") { created = true; if (options.lostCreate) throw Error("Creation response lost"); return "created"; }
    if (args[1].endsWith("/commits/v0.8.4")) return JSON.stringify({ sha: (options.wrongCommit ? "d" : "c").repeat(40) });
    if (options.appLatestBefore || created && options.appLatestAfter) return JSON.stringify({ tag_name: "v0.8.4", body: "Application release" });
    return JSON.stringify({ tag_name: current().id, body: journalBody(current()).body, draft: false, prerelease: false });
  });
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u === JOURNAL_LATEST) return options.direct404 ? new Response(null, { status: 404 }) : Response.json(current());
    if (u === stateUrl(current().id)) return new Response(options.corruptState ? "corrupt" : journalBody(current()).state.toString());
    if (u.endsWith("/api/status")) return Response.json({ appVersion: "0.8.4", deployment: { codeCommit: "c".repeat(40) }, published: journal.published });
    if (u.includes("/api/screener?")) return options.table502 ? new Response(null, { status: 502 }) : Response.json({ rows: [{ slug: "aave" }] });
    throw Error(`Unexpected request ${u}`);
  }) as unknown as typeof fetch;
  return { run, fetcher };
}
const input = { version: "0.8.4", notesFile: "notes.txt", assets: ["proof.json"] };

it("creates application releases without taking the data Latest pointer, then verifies live reads", async () => {
  const f = fixture();
  expect(await releaseApp(input, f.run, f.fetcher)).toMatchObject({ tag: "v0.8.4", journal: "data-1-start", rows: 1 });
  const writes = f.run.mock.calls.filter(([args]) => args[0] === "release");
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toEqual(expect.arrayContaining(["--latest=false", "--verify-tag", "--repo", JOURNAL_REPOSITORY, "--notes-file"]));
});
it.each([{ appLatestBefore: true }, { direct404: true }, { wrongCommit: true }, { table502: true }, { corruptState: true }])("blocks creation when existing publication/deployment validation fails: %j", async options => {
  const f = fixture(options);
  await expect(releaseApp(input, f.run, f.fetcher)).rejects.toThrow();
  expect(f.run.mock.calls.some(([args]) => args[0] === "release")).toBe(false);
});
it("detects a stolen pointer even if the live function would still serve cached data", async () => {
  const f = fixture({ appLatestAfter: true });
  await expect(releaseApp(input, f.run, f.fetcher)).rejects.toThrow("Latest must remain");
  expect(f.run.mock.calls.filter(([args]) => args[0] === "release")).toHaveLength(1);
});
it("allows a valid data journal to advance during release without restoring an older pointer", async () => {
  const f = fixture({ advance: true });
  expect(await releaseApp(input, f.run, f.fetcher)).toMatchObject({ journal: "data-2-start" });
});
it("does not blindly repeat an ambiguously acknowledged release creation", async () => {
  const f = fixture({ lostCreate: true });
  await expect(releaseApp(input, f.run, f.fetcher)).rejects.toThrow("Creation response lost");
  expect(f.run.mock.calls.filter(([args]) => args[0] === "release")).toHaveLength(1);
});
it("supports read-only publication verification", async () => {
  const f = fixture();
  expect((await verifyReleasePublication(f.run, f.fetcher)).rows).toBe(1);
  expect(f.run.mock.calls.every(([args]) => args[0] === "api")).toBe(true);
});
