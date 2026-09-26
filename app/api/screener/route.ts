import { NextResponse } from "next/server";
import { getScreener } from "@/lib/serverScreener";
import { queryScreener } from "@/lib/screenerQuery";
import { parseWorkspace } from "@/lib/workspacePreferences";

// Only the joined snapshot is cached. A second ISR cache could extend stale data by 30 minutes.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if ((params.get("prefs")?.length ?? 0) > 10000 || (params.get("favorites")?.length ?? 0) > 30000) return NextResponse.json({ error: "검색 조건이 너무 깁니다." }, { status: 400 });
    const data = await getScreener();
    const result = queryScreener(data, parseWorkspace(params.get("prefs")), params.getAll("favorites").flatMap(v => v.split(",")), Number(params.get("page") ?? 1), Number(params.get("size") ?? 100));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: "데이터를 불러오지 못했습니다.", detail: message },
      { status: 502 },
    );
  }
}
