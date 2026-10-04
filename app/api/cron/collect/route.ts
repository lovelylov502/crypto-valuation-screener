import { JOURNAL_REPOSITORY } from "../../../../lib/publication";
import { schedulerReceipt, secretMatches, signSchedulerReceipt } from "../../../../lib/schedulerDispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (secret.length < 32 || !secretMatches(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return reply({ error: "Unauthorized" }, 401);
  }
  if (process.env.VERCEL_ENV !== "production" || !process.env.SCREENER_DISPATCH_TOKEN) {
    return reply({ error: "Scheduler is not configured" }, 503);
  }
  let receipt;
  try {
    if (request.headers.get("user-agent") !== "vercel-cron/1.0") throw new Error("Missing cron user agent");
    receipt = schedulerReceipt(request.headers.get("x-vercel-cron-schedule") ?? "", Date.now(), request.headers.get("x-vercel-id") ?? "");
  }
  catch { return reply({ error: "Invalid scheduler invocation" }, 400); }
  const serialized = JSON.stringify(receipt);
  try {
    const response = await fetch(`https://api.github.com/repos/${JOURNAL_REPOSITORY}/actions/workflows/daily-snapshot.yml/dispatches`, {
      method: "POST", headers: { authorization: `Bearer ${process.env.SCREENER_DISPATCH_TOKEN}`, accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "content-type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { scheduler_receipt: serialized, scheduler_signature: signSchedulerReceipt(serialized, secret) } }),
      signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    console.log(JSON.stringify({ ...receipt, dispatchStatus: response.status }));
    if (response.status !== 204) return reply({ error: "Workflow dispatch failed", requestId: receipt.requestId }, 502);
    return reply({ dispatched: true, ...receipt }, 202);
  } catch {
    console.error(JSON.stringify({ ...receipt, dispatchStatus: "unconfirmed" }));
    return reply({ error: "Workflow dispatch unconfirmed", requestId: receipt.requestId }, 502);
  }
}
