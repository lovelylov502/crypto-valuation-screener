import { NextResponse } from "next/server";
import { getScreener } from "@/lib/serverScreener";
import { queryScreener } from "@/lib/screenerQuery";
import { parseWorkspace } from "@/lib/workspacePreferences";
import { jsonResponse } from "@/lib/jsonTransport.mjs";
import { readDailyComparisonBatch } from "@/lib/dailyValuationRead";
import { readTablePage } from "@/lib/tableRead";
import { HOSTED_DATABASE_ENABLED } from "@/lib/dataDeliveryPolicy";

// Only the joined snapshot is cached. A second ISR cache could extend stale data by 30 minutes.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if ((params.get("prefs")?.length ?? 0) > 10000 || (params.get("favorites")?.length ?? 0) > 30000) return NextResponse.json({ error: "검색 조건이 너무 깁니다." }, { status: 400 });
    const prefs = parseWorkspace(params.get("prefs"));
    if (params.get("view") === "table") {
      const result = await readTablePage(prefs, params.getAll("favorites").flatMap(v => v.split(",")), Number(params.get("page") ?? 1), Number(params.get("size") ?? 100));
      const response = await jsonResponse(result, request.signal);
      response.headers.set("X-Tovenit-Read-Model", result.readModel);
      return response;
    }
    const data = await getScreener();
    const result = queryScreener(data, prefs, params.getAll("favorites").flatMap(v => v.split(",")), Number(params.get("page") ?? 1), Number(params.get("size") ?? 100));
    if (!HOSTED_DATABASE_ENABLED) return jsonResponse(result, request.signal);
    try {
      const valuationComparison = await readDailyComparisonBatch({ coins: result.coins, capital: prefs.capital, snapshot: data });
      return jsonResponse({ ...result, valuationComparison }, request.signal);
    } catch {
      console.error("daily_valuation_summary_unavailable");
    }
    return jsonResponse(result,request.signal);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: "데이터를 불러오지 못했습니다.", detail: message },
      { status: 502 },
    );
  }
}
