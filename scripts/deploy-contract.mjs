export const DEPLOY_CONTRACT = Object.freeze({
  canonicalRoot: String.raw`C:\Users\TAE\Workspace\projects\hermes\crypto-valuation-screener`,
  blockedLegacyRoots: [
    String.raw`C:\Users\TAE\Workspace\projects\taegyu\holder revenue`,
  ],
  githubRemote: "https://github.com/lovelylov502/crypto-valuation-screener.git",
  productionBranch: "main",
  productionUpstream: "origin/main",
  vercel: Object.freeze({
    projectId: "prj_zOmxeQWmBjp5MAUmmYFALM8AC6Cc",
    orgId: "team_2dxBFycQaaHuXjESEf0kCkFG",
    projectName: "crypto-valuation-screener",
  }),
  liveBaseUrl: "https://crypto-valuation-screener.vercel.app",
  scoreVersion: "research-v8-coverage-and-holder-types",
});

export function normalizeWindowsPath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("/", "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

export function validateDeployIdentityFacts(facts) {
  const errors = [];
  const expectedRoot = normalizeWindowsPath(DEPLOY_CONTRACT.canonicalRoot);
  const currentRoot = normalizeWindowsPath(facts.currentRoot);
  const gitRoot = normalizeWindowsPath(facts.gitRoot);
  const blockedRoots = DEPLOY_CONTRACT.blockedLegacyRoots.map(normalizeWindowsPath);

  if (blockedRoots.includes(currentRoot) || blockedRoots.includes(gitRoot)) {
    errors.push({
      code: "BLOCKED_LEGACY_ROOT",
      message: `Legacy deploy root is blocked: ${facts.currentRoot || facts.gitRoot}`,
    });
  }
  if (currentRoot !== expectedRoot) {
    errors.push({
      code: "WRONG_WORKING_DIRECTORY",
      message: `Expected canonical root ${DEPLOY_CONTRACT.canonicalRoot}; got ${facts.currentRoot}`,
    });
  }
  if (gitRoot !== expectedRoot) {
    errors.push({
      code: "WRONG_GIT_ROOT",
      message: `Expected Git root ${DEPLOY_CONTRACT.canonicalRoot}; got ${facts.gitRoot}`,
    });
  }
  if (facts.originFetch !== DEPLOY_CONTRACT.githubRemote) {
    errors.push({
      code: "WRONG_ORIGIN_FETCH",
      message: `Unexpected origin fetch URL: ${facts.originFetch}`,
    });
  }
  if (facts.originPush !== DEPLOY_CONTRACT.githubRemote) {
    errors.push({
      code: "WRONG_ORIGIN_PUSH",
      message: `Unexpected origin push URL: ${facts.originPush}`,
    });
  }

  const link = facts.vercelLink ?? {};
  if (link.projectId !== DEPLOY_CONTRACT.vercel.projectId) {
    errors.push({
      code: "WRONG_VERCEL_PROJECT",
      message: `Unexpected Vercel projectId: ${link.projectId ?? "missing"}`,
    });
  }
  if (link.orgId !== DEPLOY_CONTRACT.vercel.orgId) {
    errors.push({
      code: "WRONG_VERCEL_TEAM",
      message: `Unexpected Vercel orgId: ${link.orgId ?? "missing"}`,
    });
  }
  if (link.projectName !== DEPLOY_CONTRACT.vercel.projectName) {
    errors.push({
      code: "WRONG_VERCEL_PROJECT_NAME",
      message: `Unexpected Vercel projectName: ${link.projectName ?? "missing"}`,
    });
  }

  return { ok: errors.length === 0, errors };
}

export function validateDeployFacts(facts) {
  const errors = [...validateDeployIdentityFacts(facts).errors];

  if (facts.currentBranch !== DEPLOY_CONTRACT.productionBranch) {
    errors.push({
      code: "WRONG_BRANCH",
      message: `Expected branch ${DEPLOY_CONTRACT.productionBranch}; got ${facts.currentBranch || "detached"}`,
    });
  }
  if (facts.upstream !== DEPLOY_CONTRACT.productionUpstream) {
    errors.push({
      code: "WRONG_UPSTREAM",
      message: `Expected upstream ${DEPLOY_CONTRACT.productionUpstream}; got ${facts.upstream ?? "missing"}`,
    });
  }
  if (!facts.headSha || !facts.originMainSha) {
    errors.push({
      code: "REMOTE_MAIN_MISSING",
      message: "HEAD or origin/main could not be resolved",
    });
  } else if (facts.headSha !== facts.originMainSha) {
    errors.push({
      code: "HEAD_NOT_REMOTE_MAIN",
      message: `HEAD ${facts.headSha} does not equal origin/main ${facts.originMainSha}`,
    });
  }
  if (facts.worktreeStatus !== "") {
    errors.push({
      code: "WORKTREE_DIRTY",
      message: "Tracked or untracked working-tree changes remain",
    });
  }

  return { ok: errors.length === 0, errors };
}
