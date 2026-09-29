import { NextResponse } from "next/server";
import { getPublication } from "@/lib/serverScreener";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
export async function GET() {
  try { return NextResponse.json(await getPublication(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "수집 기록 보관소를 확인할 수 없습니다." }, { status: 503 }); }
}
