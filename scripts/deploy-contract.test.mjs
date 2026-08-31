import assert from "node:assert/strict";
import test from "node:test";
import { DEPLOY_CONTRACT, validateDeployFacts } from "./deploy-contract.mjs";
import { redactSensitiveOutput } from "./deploy-output.mjs";

function passingFacts(overrides = {}) {
  return {
    currentRoot: DEPLOY_CONTRACT.canonicalRoot,
    gitRoot: DEPLOY_CONTRACT.canonicalRoot,
    originFetch: DEPLOY_CONTRACT.githubRemote,
    originPush: DEPLOY_CONTRACT.githubRemote,
    currentBranch: DEPLOY_CONTRACT.productionBranch,
    upstream: DEPLOY_CONTRACT.productionUpstream,
    headSha: "a".repeat(40),
    originMainSha: "a".repeat(40),
    worktreeStatus: "",
    vercelLink: {
      projectId: DEPLOY_CONTRACT.vercel.projectId,
      orgId: DEPLOY_CONTRACT.vercel.orgId,
      projectName: DEPLOY_CONTRACT.vercel.projectName,
    },
    ...overrides,
  };
}

test("canonical root with exact remote and Vercel linkage passes", () => {
  assert.deepEqual(validateDeployFacts(passingFacts()), { ok: true, errors: [] });
});

test("the known obsolete checkout fails closed even with copied linkage", () => {
  const legacyRoot = DEPLOY_CONTRACT.blockedLegacyRoots[0];
  const result = validateDeployFacts(
    passingFacts({ currentRoot: legacyRoot, gitRoot: legacyRoot }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "BLOCKED_LEGACY_ROOT"));
  assert.ok(result.errors.some((error) => error.code === "WRONG_WORKING_DIRECTORY"));
});

test("an arbitrary duplicate checkout fails even when remote and linkage match", () => {
  const result = validateDeployFacts(
    passingFacts({
      currentRoot: String.raw`C:\temp\crypto-valuation-screener`,
      gitRoot: String.raw`C:\temp\crypto-valuation-screener`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "WRONG_WORKING_DIRECTORY"));
  assert.ok(result.errors.some((error) => error.code === "WRONG_GIT_ROOT"));
});

test("remote or Vercel identity drift is rejected", () => {
  const result = validateDeployFacts(
    passingFacts({
      originFetch: "https://github.com/example/wrong.git",
      originPush: "https://github.com/example/wrong.git",
      vercelLink: {
        projectId: "prj_wrong",
        orgId: "team_wrong",
        projectName: "wrong-project",
      },
    }),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    new Set(result.errors.map((error) => error.code)),
    new Set([
      "WRONG_ORIGIN_FETCH",
      "WRONG_ORIGIN_PUSH",
      "WRONG_VERCEL_PROJECT",
      "WRONG_VERCEL_TEAM",
      "WRONG_VERCEL_PROJECT_NAME",
    ]),
  );
});

test("deployment output redacts explicit and Vercel-shaped credentials", () => {
  const explicitSecret = "not-a-vercel-token";
  const output = `one=${explicitSecret} two=vcp_exampleCredential123`;
  assert.equal(
    redactSensitiveOutput(output, [explicitSecret]),
    "one=[REDACTED] two=[REDACTED]",
  );
});

test("a non-main branch, dirty tree, or unsynced commit fails closed", () => {
  const result = validateDeployFacts(
    passingFacts({
      currentBranch: "recovery-production",
      upstream: null,
      headSha: "a".repeat(40),
      originMainSha: "b".repeat(40),
      worktreeStatus: " M package.json",
    }),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    new Set(result.errors.map((error) => error.code)),
    new Set([
      "WRONG_BRANCH",
      "WRONG_UPSTREAM",
      "HEAD_NOT_REMOTE_MAIN",
      "WORKTREE_DIRTY",
    ]),
  );
});
