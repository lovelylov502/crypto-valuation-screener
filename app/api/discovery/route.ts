import { NextResponse } from "next/server";
import { readDiscovery } from "@/lib/discoveryRead";
import { parseWorkspace, defaultPreferences } from "@/lib/workspacePreferences";
import { jsonResponse } from "@/lib/jsonTransport.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  return respond(new URL(request.url).searchParams, request.signal);
}
export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (body.length > 180000) throw Error("large_request");
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || !Array.isArray(value.favorites) || value.favorites.length > 1000 || value.favorites.some((slug: unknown) => typeof slug !== "string" || slug.length > 150)) throw Error("invalid_request");
    return respond(new URLSearchParams({ mode: value.mode, prefs: JSON.stringify(value.prefs), favorites: value.favorites.join(","), page: String(value.page) }), request.signal);
  } catch { return NextResponse.json({ error: "조회 조건을 확인해 주세요." }, { status: 400 }); }
}
async function respond(params: URLSearchParams, signal: AbortSignal) {
  const mode = params.get("mode") ?? "map", page = Number(params.get("page") ?? 1);
  if (!["map", "watchlist"].includes(mode) || !Number.isInteger(page) || page < 1 || page > 1000 || (params.get("prefs")?.length ?? 0) > 10000 || (params.get("favorites")?.length ?? 0) > 151000)
    return NextResponse.json({ error: "조회 조건을 확인해 주세요." }, { status: 400 });
  const favorites = (params.get("favorites") ?? "").split(",").filter(Boolean), parsed = parseWorkspace(params.get("prefs"));
  const prefs = mode === "watchlist" ? { ...defaultPreferences(), capital: parsed.capital, view: "favorites" as const } : parsed;
  try { return jsonResponse(await readDiscovery(prefs, favorites, page, mode as "map" | "watchlist"), signal); }
  catch { return NextResponse.json({ error: "검증된 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
