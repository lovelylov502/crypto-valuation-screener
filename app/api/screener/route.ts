import { NextResponse } from "next/server";
import { getScreener } from "@/lib/serverScreener";

// Only the joined snapshot is cached. A second ISR cache could extend stale data by 30 minutes.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getScreener();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: "데이터를 불러오지 못했습니다.", detail: message },
      { status: 502 },
    );
  }
}
