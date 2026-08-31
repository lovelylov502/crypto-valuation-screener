import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEPLOY_CONTRACT,
  normalizeWindowsPath,
  validateDeployFacts,
  validateDeployIdentityFacts,
} from "./deploy-contract.mjs";

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function optionalGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

export function collectDeployFacts(cwd = process.cwd()) {
  const currentRoot = realpathSync.native(cwd);
  const gitRoot = realpathSync.native(git(currentRoot, ["rev-parse", "--show-toplevel"]));
  const vercelLinkPath = path.join(currentRoot, ".vercel", "project.json");
  const vercelLink = existsSync(vercelLinkPath)
    ? JSON.parse(readFileSync(vercelLinkPath, "utf8"))
    : null;

  return {
    currentRoot,
    gitRoot,
    originFetch: git(currentRoot, ["remote", "get-url", "origin"]),
    originPush: git(currentRoot, ["remote", "get-url", "--push", "origin"]),
    currentBranch: git(currentRoot, ["branch", "--show-current"]),
    upstream: optionalGit(currentRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]),
    headSha: optionalGit(currentRoot, ["rev-parse", "HEAD"]),
    originMainSha: optionalGit(currentRoot, [
      "rev-parse",
      `refs/remotes/origin/${DEPLOY_CONTRACT.productionBranch}`,
    ]),
    worktreeStatus: git(currentRoot, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
    vercelLink,
  };
}

export function runDeployPreflight({
  cwd = process.cwd(),
  print = true,
  refreshRemote = true,
} = {}) {
  try {
    let facts = collectDeployFacts(cwd);
    const identity = validateDeployIdentityFacts(facts);
    if (!identity.ok) {
      if (print) printResult(identity);
      return { ...identity, facts };
    }
    if (refreshRemote) {
      git(facts.currentRoot, ["fetch", "--quiet", "origin"]);
      facts = collectDeployFacts(cwd);
    }
    const result = validateDeployFacts(facts);
    if (print) {
      if (result.ok) {
        console.log("[deploy-preflight] PASS");
        console.log(`canonical_root=${facts.currentRoot}`);
        console.log(`origin=${facts.originFetch}`);
        console.log(`branch=${facts.currentBranch}`);
        console.log(`upstream=${facts.upstream}`);
        console.log(`head=${facts.headSha}`);
        console.log(`origin_main=${facts.originMainSha}`);
        console.log("worktree=clean");
        console.log(`vercel_project=${facts.vercelLink.projectId}`);
        console.log(`vercel_team=${facts.vercelLink.orgId}`);
      } else {
        printResult(result);
      }
    }
    return { ...result, facts };
  } catch (error) {
    const result = {
      ok: false,
      errors: [
        {
          code: "PREFLIGHT_COLLECTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
    if (print) {
      console.error("[deploy-preflight] FAIL");
      console.error(`[${result.errors[0].code}] ${result.errors[0].message}`);
    }
    return result;
  }
}

function printResult(result) {
  console.error("[deploy-preflight] FAIL");
  for (const error of result.errors) {
    console.error(`[${error.code}] ${error.message}`);
  }
}

const invokedPath = process.argv[1] ? normalizeWindowsPath(path.resolve(process.argv[1])) : "";
const modulePath = normalizeWindowsPath(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  const result = runDeployPreflight();
  if (!result.ok) process.exitCode = 1;
}

export { DEPLOY_CONTRACT };
