import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";

it.each(["unreferenced-timeout", "unsettled-promise"])("keeps the collector alive and gives %s an explicit result", scenario => {
  const work = scenario === "unreferenced-timeout"
    ? "new Promise(resolve => setTimeout(() => resolve('completed'), 20).unref())"
    : "new Promise(() => {})";
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `
    const { withDeadline } = require('./lib/withDeadline.ts');
    withDeadline(() => ${work}, 70).then(console.log).catch(e => { console.error(e.message); process.exitCode = 1; });
  `], { encoding: "utf8", timeout: 5000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(scenario === "unreferenced-timeout" ? 0 : 1);
  expect(result.stdout + result.stderr).toContain(scenario === "unreferenced-timeout" ? "completed" : "collector_deadline_exceeded");
});
