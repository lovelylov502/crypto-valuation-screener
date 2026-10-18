import { NextResponse } from "next/server";
import { connectHistory, queryHistory } from "@/lib/historyDatabase";
import { REVENUE_WINDOWS } from "@/lib/revenueHistory";

export const dynamic="force-dynamic";
export const maxDuration=30;
const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export async function GET(request:Request) {
  const p=new URL(request.url).searchParams,slug=p.get("slug")??"",days=Number(p.get("days")??30);
  const today=new Date().toISOString().slice(0,10),range=p.get("range")??"all";
  const from=p.get("from")??(range==="ytd"?`${today.slice(0,4)}-01-01`:"2000-01-01"),to=p.get("to")??today,after=p.get("after")??"1999-12-31",limit=Number(p.get("limit")??1000);
  if(!/^[a-zA-Z0-9_#.-]{1,150}$/.test(slug)||!REVENUE_WINDOWS.some(d=>d===days)||!["all","ytd"].includes(range)||![from,to,after].every(validDate)||from>to||to>today||!Number.isInteger(limit)||limit<1||limit>1000)
    return NextResponse.json({error:"유효하지 않은 이력 조회 조건입니다."},{status:400});
  if(!process.env.TURSO_DATABASE_URL||!process.env.TURSO_AUTH_TOKEN)return NextResponse.json({error:"이력 저장소 연결을 준비 중입니다."},{status:503});
  const db=connectHistory();
  try {
    const result=await queryHistory(db,{slug,days,from,to,after,limit});
    if(!result)return NextResponse.json({error:"저장된 종목 이력이 없습니다."},{status:404});
    return NextResponse.json(result,{headers:{"Cache-Control":"public, s-maxage=600, stale-while-revalidate=3600"}});
  } catch {
    return NextResponse.json({error:"이력 저장소를 일시적으로 조회할 수 없습니다."},{status:503});
  } finally {db.close();}
}
