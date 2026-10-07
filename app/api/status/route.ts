import { NextResponse } from "next/server";
import { getPublication } from "@/lib/serverScreener";
import { publicFreshness } from "@/lib/datedFreshness";
import { READER_COMPATIBILITY,readerDeployment,collectionReleaseState } from "@/lib/pipelineRelease";
import { publicRecovery } from "@/lib/freshnessRecovery";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
export async function GET() {
  try { const p=await getPublication(),now=Date.now(),release=collectionReleaseState(); return NextResponse.json({...p,compatibility:READER_COMPATIBILITY,deployment:readerDeployment(),collectionRelease:release,publicFreshness:publicFreshness(p.recovery?.summary,now),...(p.recovery?{publicRecovery:publicRecovery(p,now,release.schedule==="paused")}: {})}, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "수집 기록 보관소를 확인할 수 없습니다." }, { status: 503 }); }
}
