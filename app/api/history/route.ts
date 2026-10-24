import { NextResponse } from "next/server";
import { getScreener } from "@/lib/serverScreener";
import { connectDailyValuationReader, DailyValuationIdentityChanged, DailyValuationRevisionChanged, readDailyValuationHistory } from "@/lib/dailyValuationRead";
import { readCompactDailyHistory, readDailyHistoryVersion } from "@/lib/dailyValuationPrepared";
import { HOSTED_DATABASE_ENABLED } from "@/lib/dataDeliveryPolicy";
import { artifactHistory, currentArtifactSet } from "@/lib/readArtifacts";
import { decodeCompactHistory, expandCompactHistory } from "@/lib/dailyValuationCompact";
import { dailyValuationAsOf } from "@/lib/dailyValuation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const response = (body: unknown, status = 200, readModel?: "prepared" | "raw-fallback") => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...(readModel ? { "X-Tovenit-Read-Model": readModel } : {}) } });

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams, slug = p.get("slug") ?? "", expectedIdentity = p.get("expectedIdentity") ?? "", capital = p.get("capital") ?? "fdv", format = p.get("format");
  const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  const from = p.get("from") ?? "1900-01-01", to = p.get("to") ?? yesterday, after = p.get("after") ?? "1899-12-31", limit = Number(p.get("limit") ?? 1000), expectedRevision = p.get("expectedRevision") ?? undefined;
  if (!/^[a-zA-Z0-9_#.-]{1,150}$/.test(slug) || !/^(gecko:[a-zA-Z0-9._-]+|cmc:[1-9]\d*)$/.test(expectedIdentity) || !["mcap", "fdv"].includes(capital)
    || format !== null && !["version", "compact"].includes(format) || format !== null && (p.has("after") || p.has("limit"))
    || p.has("days") || ![from, to, after].every(validDate) || from > to || to > today || !Number.isInteger(limit) || limit < 1 || limit > 1000
    || expectedRevision !== undefined && !/^[a-zA-Z0-9._:-]{1,256}$/.test(expectedRevision))
    return response({ error: "유효하지 않은 일별 이력 조회 조건입니다." }, 400);
  try {
    if (!HOSTED_DATABASE_ENABLED) {
      const set = await currentArtifactSet(), entry = set.catalog.entries.find(entry => entry.row.slug === slug);
      if (!entry) return response({ error: "공개본에서 종목을 찾을 수 없습니다." }, 404);
      if (entry.row.identity !== expectedIdentity || entry.binding.identityStatus !== "verified" || entry.binding.capitalExclusionReason) return response({ error: "현재 토큰과 이력의 연결을 확인해 주세요." }, 409);
      const stored = await artifactHistory(set, slug);
      if (!stored) return response({ error: "현재 토큰에 연결된 일별 원자료가 없습니다." }, 404);
      const envelope = { ...stored, freshness: dailyValuationAsOf(set.catalog.metadata).freshness };
      if (expectedRevision && expectedRevision !== envelope.rawRevision) throw new DailyValuationRevisionChanged();
      if (format === "compact") return response(envelope, 200, "prepared");
      if (format === "version") { const { encoding, payload, sha256, ...version } = envelope; void encoding; void payload; void sha256; return response(version, 200, "prepared"); }
      const history = expandCompactHistory(await decodeCompactHistory(envelope), capital as "mcap" | "fdv", from, to), remaining = history.points.filter(point => point.day > after), points = remaining.slice(0, limit);
      return response({ ...history, points, nextCursor: remaining.length > limit ? points.at(-1)!.day : null }, 200, "prepared");
    }
    const context = format ? await (await import("@/lib/tableRead")).getTableCoinContext(slug) : null;
    const snapshot = format ? context?.snapshot : await getScreener(), coin = format ? context?.coin : snapshot && "coins" in snapshot ? snapshot.coins.find(coin => coin.slug === slug) : undefined;
    if (!coin) return response({ error: "공개본에서 종목을 찾을 수 없습니다." }, 404);
    const identity = coin.geckoId ? `gecko:${coin.geckoId}` : coin.cmcId ? `cmc:${coin.cmcId}` : "unlinked";
    if (coin.identityStatus !== "verified" || coin.capitalExclusionReason || identity === "unlinked" || identity !== expectedIdentity)
      return response({ error: "현재 토큰과 이력의 연결을 확인해 주세요." }, 409);
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) return response({ error: "이력 저장소 연결을 준비 중입니다." }, 503);
    const db = connectDailyValuationReader();
    try {
      if (!snapshot) return response({ error: "공개본에서 종목을 찾을 수 없습니다." }, 404);
      let readModel: "prepared" | "raw-fallback" | undefined;
      const onReadModel = (mode: "prepared" | "raw-fallback") => { readModel = mode; };
      const result = format === "version" ? await readDailyHistoryVersion(db, { coin, snapshot, expectedIdentity, onReadModel })
        : format === "compact" ? await readCompactDailyHistory(db, { coin, snapshot, expectedIdentity, expectedRevision, onReadModel })
          : await readDailyValuationHistory(db, { coin, snapshot, capital: capital as "mcap" | "fdv", from, to, after, limit, expectedIdentity, expectedRevision });
      if (!result) return response({ error: "현재 토큰에 연결된 일별 원자료가 없습니다." }, 404);
      return response(result, 200, readModel);
    } finally { db.close(); }
  } catch (error) {
    if (error instanceof DailyValuationRevisionChanged || error instanceof DailyValuationIdentityChanged) return response({ error: "일별 원자료가 갱신되었습니다. 다시 불러와 주세요." }, 409);
    return response({ error: "일별 이력을 일시적으로 조회할 수 없습니다." }, 503);
  }
}
