import { spawnSync } from "node:child_process";
import { DEPLOY_CONTRACT, runDeployPreflight } from "./deploy-preflight.mjs";
import { redactSensitiveOutput } from "./deploy-output.mjs";

const VERCEL_CLI_PACKAGE = "vercel@59.10.0";
const npmCli = process.env.npm_execpath;

function run(label, executable, args, env) {
  console.log(`[deploy-production] ${label}`);
  const result = spawnSync(executable, args, {
    cwd: DEPLOY_CONTRACT.canonicalRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function runWithRedactedOutput(
  label,
  executable,
  args,
  env,
  sensitiveValues,
  { printOnSuccess = true } = {},
) {
  console.log(`[deploy-production] ${label}`);
  const result = spawnSync(executable, args, {
    cwd: DEPLOY_CONTRACT.canonicalRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (printOnSuccess || result.status !== 0 || result.error) {
    if (result.stdout) {
      process.stdout.write(redactSensitiveOutput(result.stdout, sensitiveValues));
    }
    if (result.stderr) {
      process.stderr.write(redactSensitiveOutput(result.stderr, sensitiveValues));
    }
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

async function assertRemoteVercelProject(token) {
  const url = new URL(
    `/v9/projects/${DEPLOY_CONTRACT.vercel.projectId}`,
    "https://api.vercel.com",
  );
  url.searchParams.set("teamId", DEPLOY_CONTRACT.vercel.orgId);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const project = await response.json();
  if (
    !response.ok ||
    project.id !== DEPLOY_CONTRACT.vercel.projectId ||
    project.accountId !== DEPLOY_CONTRACT.vercel.orgId ||
    project.name !== DEPLOY_CONTRACT.vercel.projectName
  ) {
    throw new Error(
      `Remote Vercel identity mismatch (HTTP ${response.status}, project=${project.id ?? "missing"}, team=${project.accountId ?? "missing"}, name=${project.name ?? "missing"})`,
    );
  }
  console.log(
    `[deploy-production] remote Vercel identity PASS (${project.id} / ${project.accountId} / ${project.name})`,
  );
}

const preflight = runDeployPreflight();
if (!preflight.ok) process.exit(1);

if (!npmCli) {
  console.error("[deploy-production] npm_execpath is required; run this wrapper through npm run deploy:production.");
  process.exit(1);
}

const token = process.env.VERCEL_TOKEN?.trim();
if (!token) {
  console.error("[deploy-production] VERCEL_TOKEN is required; load it from the approved local Codex env before deployment.");
  process.exit(1);
}

const nodeOptions = process.env.NODE_OPTIONS ?? "";
const env = {
  ...process.env,
  VERCEL_TOKEN: token,
  NODE_OPTIONS: nodeOptions.includes("--use-system-ca")
    ? nodeOptions
    : `${nodeOptions} --use-system-ca`.trim(),
};

try {
  await assertRemoteVercelProject(token);
  run("local gates", process.execPath, [npmCli, "run", "verify:local"], env);
  const vercelDeployArgs = [
    npmCli,
    "exec",
    "--yes",
    "--package",
    VERCEL_CLI_PACKAGE,
    "--",
    "vercel",
    "deploy",
    "--prod",
    "--yes",
  ];
  runWithRedactedOutput(
    "Vercel CLI dry run",
    process.execPath,
    [...vercelDeployArgs, "--dry"],
    env,
    [token],
    { printOnSuccess: false },
  );
  runWithRedactedOutput(
    "Vercel production deploy",
    process.execPath,
    vercelDeployArgs,
    env,
    [token],
  );
  run("canonical live readback", process.execPath, [npmCli, "run", "verify:production"], env);
  console.log("[deploy-production] PASS");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
