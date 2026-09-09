import { DEPLOY_CONTRACT } from "./deploy-contract.mjs";

// A first ISR read can be stale. Confirm the regenerated response with bounded retries.
let fresh = false;
for (let attempt = 0; attempt < 7; attempt++) {
  const responses = await Promise.all(
    ["/", "/api/screener"].map((path) =>
      fetch(`${DEPLOY_CONTRACT.liveBaseUrl}${path}`, {
        signal: AbortSignal.timeout(60_000),
      }),
    ),
  );
  if (responses.some((response) => !response.ok))
    throw new Error("Screener warm-up HTTP failure");
  await responses[0].arrayBuffer();
  const data = await responses[1].json();
  const age = Date.now() - Date.parse(data.updatedAt ?? "");
  if (
    data.scoreVersion === DEPLOY_CONTRACT.scoreVersion &&
    Array.isArray(data.coins) &&
    data.coins.length > 0 &&
    Number.isFinite(age) &&
    age >= -300_000 &&
    age < 30 * 60_000
  ) {
    fresh = true;
    break;
  }
  if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 8000));
}
if (!fresh)
  throw new Error("Website did not return a fresh matching-version snapshot");
console.log("Website snapshot freshness confirmed");
