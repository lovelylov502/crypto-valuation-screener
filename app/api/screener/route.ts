import { NextResponse } from "next/server";
import { buildScreener } from "@/lib/screener";

// 라우트 응답 캐시 (초). 내부 fetch도 각자 revalidate를 가짐.
export const revalidate = 1800;

export async function GET() {
  try {
    const data = await buildScreener();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: "데이터를 불러오지 못했습니다.", detail: message },
      { status: 502 },
    );
  }
}
