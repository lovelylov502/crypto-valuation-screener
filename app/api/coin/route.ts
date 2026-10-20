import { NextResponse } from "next/server";
import { jsonResponse } from "@/lib/jsonTransport.mjs";
import { readTableDetail, TablePublicationChanged } from "@/lib/tableRead";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, slug = params.get("slug"), publicationId = params.get("publicationId"), identity = params.get("identity");
  if (!slug || slug.length > 240 || !publicationId || !/^data-[a-zA-Z0-9-]+$/.test(publicationId) || !identity || identity.length > 240 || !/^(gecko:.+|cmc:\d+|unlinked)$/.test(identity)) return NextResponse.json({ error: "Invalid detail request" }, { status: 400 });
  try {
    const result = await readTableDetail(slug, publicationId, identity);
    if (!result) return NextResponse.json({ error: "Coin not found" }, { status: 404 });
    const response = await jsonResponse(result, request.signal); response.headers.set("X-Tovenit-Read-Model", result.readModel); return response;
  } catch (error) {
    if (error instanceof TablePublicationChanged) return NextResponse.json({ error: "Publication changed" }, { status: 409 });
    console.error("table_detail_unavailable"); return NextResponse.json({ error: "Detail unavailable" }, { status: 503 });
  }
}
