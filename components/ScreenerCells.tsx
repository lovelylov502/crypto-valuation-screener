import type { CoinScored } from "@/lib/types";
import { fmtUsd, fmtMult, fmtPct, fmtPrice } from "@/lib/format";
import { researchMultiple } from "@/lib/research";
import { revenueAmount } from "@/lib/revenueHistory";
import { protocolResearch } from "@/lib/protocolResearch";
import { holderEconomicTypeLabel } from "@/lib/holderValue";
import { flowLabel } from "@/lib/signals";
import type { SortKey } from "@/lib/screenerColumns";
import { ScoreBadge } from "./ScoreBadge";
import { TriangleAlert } from "lucide-react";
import { multipleLabel, feeLabel, knownRevenue } from "@/lib/fundamentals";
import { salesMultiple, salesReason, protocolMultiple, protocolReason, holderMultiple, holderReason, datedHolderValue, type CapitalBasis } from "@/lib/valuationMetrics";
import type { RevenueWindowDays } from "@/lib/revenueHistory";

export const METRIC_DAYS: Partial<Record<SortKey, RevenueWindowDays>> = { phr: 30, phr7d: 7, phr90d: 90, phr1y: 365, pr: 30, pr7d: 7, pr90d: 90, pr1y: 365 };

// 코인 외부 링크: canonical CMC 우선, 없으면 CoinGecko/DefiLlama 폴백
export function coinUrl(c: CoinScored): string {
  if (c.cmcSlug) return `https://coinmarketcap.com/currencies/${c.cmcSlug}/`;
  if (c.geckoId) return `https://www.coingecko.com/en/coins/${c.geckoId}`;
  return `https://defillama.com/protocol/${c.slug.replace(/^parent#/, "")}`;
}

export function sortValue(c: CoinScored, key: SortKey, basis: CapitalBasis = "mcap"): number | string | null {
  if (key === "psSales") return salesMultiple(c, basis);
  if (key.startsWith("phr")) return holderMultiple(c, METRIC_DAYS[key] ?? 30, basis);
  if (key === "pr" || key.startsWith("pr7") || key.startsWith("pr90") || key === "pr1y") return protocolMultiple(c, METRIC_DAYS[key] ?? 30, basis);
  switch (key) {
    case "price": return c.price;
    case "change1d": return c.change1d;
    case "multiple7d": return researchMultiple(c, 7);
    case "multiple90d": return researchMultiple(c, 90);
    case "multiple1y": return researchMultiple(c, 365);
    case "revenue7d": return revenueAmount(c, 7);
    case "revenue90d": return revenueAmount(c, 90);
    case "revenue1y": return revenueAmount(c, 365);
    case "holderRoute": return protocolResearch(c)?.holder?.route ?? holderTypeSummary(c);
    case "payoutAsset": return protocolResearch(c)?.holder?.asset ?? null;
    case "holderCondition": return protocolResearch(c)?.holder?.recipient ?? null;
    case "signals":
      return (
        Number(c.opportunities.business) +
        Number(c.opportunities.holder) +
        Number(c.opportunities.transition)
      );
    case "revenueGrowth":
      return knownRevenue(c) ? c.opportunities.revenue.changePct : null;
    case "holderGrowth":
      return c.opportunities.eligibleHolder.changePct;
    case "name":
      return c.name.toLowerCase();
    case "category":
      return (c.category ?? "").toLowerCase();
    case "valueScore":
      return c.valueScore;
    case "scoreAxes":
      return c.scoreAxes.discovery;
    case "confidence":
      return c.confidence;
    case "gateStatus":
      return c.gates.passed ? 1 : 0;
    case "captureScore":
      return c.valueCapture.score;
    case "revenueMultiple":
      return researchMultiple(c);
    case "revenueAnnual":
      return c.revenueAnnual;
    case "holderValueRunRate":
      return datedHolderValue(c).eligibleRunRate;
    case "holderValueTtm":
      return c.holderValue.rawTtm;
    case "revenue30d":
      return revenueAmount(c, 30);
    case "mcap":
      return c.mcap;
    case "totalVolume":
      return c.totalVolume;
    case "fdv":
      return c.fdv;
    case "tvl":
      return c.tvl;
    case "priceChange7d":
      return c.priceChange7d;
    case "priceChange14d":
      return c.priceChange14d;
    case "priceChange30d":
      return c.priceChange30d;
    case "priceChange60d":
      return c.priceChange60d;
    case "priceChange1y":
      return c.priceChange1y;
    case "athChangePercentage":
      return c.athChangePercentage;
    case "atlChangePercentage":
      return c.atlChangePercentage;
    case "feesChange7d":
      return c.feesChange7dover7d;
  }
  return null;
}

function changeClass(v: number | null): string {
  if (v === null) return "";
  return v >= 0 ? "text-emerald-400" : "text-red-400";
}

function captureClass(score: number | null): string {
  if (score === null) return "text-[var(--color-muted)]";
  if (score >= 70) return "text-emerald-400";
  if (score >= 45) return "text-amber-300";
  return "text-[var(--color-muted)]";
}

export function holderTypeSummary(c: CoinScored, eligibleOnly = false): string {
  const labels = [
    ...new Set(
      c.holderValue.components
        .filter(
          (component) =>
            (!eligibleOnly || component.eligible) && ((component.current30d ?? 0) > 0 || (component.ttm ?? 0) > 0),
        )
        .map((component) => holderEconomicTypeLabel(component.economicType)),
    ),
  ];
  if (labels.length === 0) return "유형 없음";
  if (labels.length <= 2) return labels.join("+");
  return `${labels.slice(0, 2).join("+")} 외 ${labels.length - 2}`;
}

function holderValueDetail(c: CoinScored): string {
  const componentDetail = c.holderValue.components.map(
    (component) =>
      `${component.name}: ${holderEconomicTypeLabel(component.economicType)} · ${component.eligible ? "P/HR 포함" : "제외"} · 30d ${fmtUsd(component.current30d)} · 1년 원천 집계 ${fmtUsd(component.ttm)} · ${component.reason}`,
  );
  return [
    "DefiLlama-derived 분류 (공식·온체인 검증 아님)",
    c.holderValue.currentVsEligibleTtmRatio !== null
      ? `현재 run-rate / 적격 1년 원천 집계 ${c.holderValue.currentVsEligibleTtmRatio.toFixed(2)}x`
      : null,
    c.holderValue.excludedDoublecountedCount > 0
      ? `doublecounted ${c.holderValue.excludedDoublecountedCount}개 제외`
      : null,
    c.holderValue.warning,
    ...componentDetail,
  ]
    .filter((value): value is string => !!value)
    .join(" / ");
}

function shortReason(reason: string): string {
  if (reason.includes("FDV")) return "FDV 미확인";
  if (reason.includes("이력 부족")) return reason.split(" · ")[0];
  if (reason.includes("토큰 연결")) return "연결 확인";
  if (reason.includes("스테이블")) return "비적용";
  if (reason.includes("환원으로 분류")) return "환원 자료";
  if (reason.includes("0 이하")) return "0 이하";
  if (reason.includes("자료 없음") || reason.includes("미연결") || reason.includes("이력 없음")) return "자료 미확보";
  return "확인 필요";
}
function metricReading(value: number | null, reason: string, basis: CapitalBasis, mcapValue: number | null, note?: string) {
  return <span className="metric-reading" title={reason}><strong>{fmtMult(value)}</strong>{value === null ? <small>{shortReason(reason)}</small> : note ? <small>{note}</small> : null}{basis === "fdv" && value === null && mcapValue !== null && <small className="capital-fallback">시총 기준 {fmtMult(mcapValue)}</small>}</span>;
}
export function holderConditionSummary(c: CoinScored): string {
  return [...new Set(c.holderValue.components.filter(p=>p.eligible).map(p=>p.condition).filter(Boolean))].join(" · ") || "수령 조건 미확인";
}
// Selected-capital values are never replaced by a circulating-capital reference in sorting or filters.
export function renderCell(c: CoinScored, key: SortKey, basis: CapitalBasis = "mcap") {
  if (key === "psSales") return metricReading(salesMultiple(c,basis),salesReason(c,basis),basis,salesMultiple(c),c.sales?.basis === "annualized_estimate" ? "외부 매출 추정" : "보고 매출");
  if (key.startsWith("phr")) {
    const days=METRIC_DAYS[key] ?? 30;
    return metricReading(holderMultiple(c,days,basis),holderReason(c,days,basis)+" · "+holderConditionSummary(c),basis,holderMultiple(c,days),holderTypeSummary(c,true) + (holderConditionSummary(c).includes("락업") ? " · 락업" : holderConditionSummary(c).includes("스테이킹") ? " · 스테이킹" : "") + (c.holderValue.availability === "mixed" ? " · 확인분" : ""));
  }
  if (["pr","pr7d","pr90d","pr1y"].includes(key)) {
    const days=METRIC_DAYS[key] ?? 30;
    return metricReading(protocolMultiple(c,days,basis),protocolReason(c,days,basis),basis,protocolMultiple(c,days),c.fundamentals.revenue.kind === "service_sales" ? "서비스 매출 집계" : undefined);
  }
  switch (key) {
    case "price": return fmtPrice(c.price);
    case "change1d": return <span className={changeClass(c.change1d)}>{fmtPct(c.change1d)}</span>;
    case "multiple1y": return fmtMult(researchMultiple(c, 365));
    case "multiple90d": return fmtMult(researchMultiple(c, 90));
    case "multiple7d": return fmtMult(researchMultiple(c, 7));
    case "revenue7d": return fmtUsd(revenueAmount(c, 7));
    case "revenue90d": return fmtUsd(revenueAmount(c, 90));
    case "revenue1y": return fmtUsd(revenueAmount(c, 365));
    case "holderRoute": return <span className="route-cell">{protocolResearch(c)?.holder?.route ?? holderTypeSummary(c)}<small>{protocolResearch(c)?.holder ? "공식 문서 확인" : "원천 설명 자동 분류"}</small></span>;
    case "payoutAsset": return <span className="route-cell">{protocolResearch(c)?.holder?.asset ?? "미확인"}</span>;
    case "holderCondition": return <span className="route-cell">{protocolResearch(c)?.holder?.recipient ?? holderConditionSummary(c)}</span>;
    case "signals":
      return (
        <span className="signal-cell">
          <span className="signal-tags">
            {c.opportunities.business && (
              <span className="tag business">사업 수익·수수료 성장</span>
            )}
            {c.opportunities.holder && (
              <span className="tag holder">홀더 환원</span>
            )}
            {c.opportunities.transition && (
              <span className="tag transition">홀더 0↔양수</span>
            )}
            {!c.opportunities.business &&
              !c.opportunities.holder &&
              !c.opportunities.transition && (
                <span className="muted">관측 신호 없음</span>
              )}
          </span>
          <span className="cell-note">
            {c.opportunities.dataIssues[0] ??
              c.opportunities.risks[0] ??
              "최근 30일 관측"}
          </span>
        </span>
      );
    case "revenueGrowth":
      return (
        <span className={changeClass(c.opportunities.revenue.changePct)}>
          {flowLabel(c.opportunities.revenue)}
        </span>
      );
    case "holderGrowth":
      return (
        <span className={changeClass(c.opportunities.eligibleHolder.changePct)}>
          {flowLabel(c.opportunities.eligibleHolder)}
        </span>
      );
    case "category":
      return (
        <span
          title={c.category ?? undefined}
          className="text-[var(--color-muted)] block max-w-[100px] truncate"
        >
          {c.category ?? "–"}
        </span>
      );
    case "valueScore":
      return (
        <ScoreBadge
          score={c.valueScore}
          status={c.status}
          confidenceGrade={c.confidenceGrade}
          confidence={c.confidence}
          reasons={c.gates.reasons}
        />
      );
    case "scoreAxes":
      return (
        <span
          title={c.scoreNotes.join(" · ") || "산출 근거 없음"}
          className="inline-grid min-w-[165px] grid-cols-4 gap-1 text-center text-[10px]"
        >
          {[
            ["가치", c.scoreAxes.value, 30],
            ["개선", c.scoreAxes.improvement, 25],
            ["미발견", c.scoreAxes.discovery, 25],
            ["품질", c.scoreAxes.quality, 20],
          ].map(([label, value, maximum]) => (
            <span
              key={String(label)}
              className="rounded bg-[var(--color-panel-2)] px-1 py-1"
            >
              <span className="block text-[var(--color-muted)]">{label}</span>
              <strong className="block text-xs text-[var(--color-text)]">
                {value}/{maximum}
              </strong>
            </span>
          ))}
        </span>
      );
    case "confidence":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <strong>{c.confidenceGrade}</strong>
          <span className="text-xs text-[var(--color-muted)]">
            {Math.round(c.confidence * 100)}%
          </span>
        </span>
      );
    case "gateStatus":
      return c.gates.passed ? (
        <span className="text-emerald-400">통과</span>
      ) : (
        <span
          title={c.gates.reasons.join(" · ")}
          className="inline-flex max-w-[190px] flex-col items-end"
        >
          <strong className="text-amber-300">
            {c.gates.reasons.length}개 미통과
          </strong>
          <span className="block max-w-[190px] truncate text-[10px] text-[var(--color-muted)]">
            {c.gates.reasons[0]}
          </span>
        </span>
      );
    case "captureScore":
      return (
        <span
          title={
            [
              ...c.valueCapture.signals,
              ...c.valueCapture.risks.map((r) => `위험: ${r}`),
            ].join(" · ") || c.valueCapture.label
          }
          className="inline-flex flex-col items-end gap-0.5 whitespace-nowrap"
        >
          <span
            className={`font-semibold tabular-nums ${captureClass(c.valueCapture.score)}`}
          >
            {c.valueCapture.score ?? "–"}
          </span>
          <span className="text-[11px] text-[var(--color-muted)]">
            {c.valueCapture.label}
          </span>
        </span>
      );
    case "revenueMultiple":
      return <span className="metric-cell" title={multipleLabel(c)}><strong>{fmtMult(researchMultiple(c))}</strong>{researchMultiple(c) === null && !knownRevenue(c) && <span className="muted">정의 확인 필요</span>}{!c.revenueHistory && researchMultiple(c) !== null && <span className="muted">원천 기간 집계</span>}</span>;
    case "revenueAnnual":
      return fmtUsd(c.revenueAnnual);
    case "holderValueRunRate":
      return (
        <span
          title={holderValueDetail(c)}
          className="inline-flex min-w-[155px] flex-col items-end gap-0.5"
        >
          <strong
            className={
              datedHolderValue(c).eligibleRunRate !== null
                ? "text-emerald-300"
                : "text-[var(--color-muted)]"
            }
          >
            {fmtUsd(datedHolderValue(c).eligibleRunRate)}
            {c.holderValue.warning && (
              <TriangleAlert size={12} className="ml-1 inline text-amber-300" />
            )}
          </strong>
          {(c.opportunities.conditionalCurrent30d ?? 0) > 0 && (
            <span className="text-xs text-violet-300">
              조건부 30일 {fmtUsd(c.opportunities.conditionalCurrent30d)}
            </span>
          )}
          <span className="block max-w-[180px] truncate text-[10px] text-[var(--color-muted)]">
            {holderTypeSummary(c)} · DL 파생
          </span>
        </span>
      );
    case "holderValueTtm":
      return (
        <span
          title={holderValueDetail(c)}
          className="inline-flex min-w-[120px] flex-col items-end gap-0.5"
        >
          <span>{fmtUsd(c.holderValue.rawTtm)}</span>
          <span className="text-[10px] text-[var(--color-muted)]">
            {(c.holderValue.excludedTtm ?? 0) > 0
              ? "제외 유형 포함"
              : "365일 확보 미확인"}
          </span>
        </span>
      );
    case "revenue30d":
      return (
        <span className="metric-cell">
          <strong>{fmtUsd(revenueAmount(c, 30))}</strong>
          <span className={changeClass(c.opportunities.revenue.changePct)}>
            {flowLabel(c.opportunities.revenue)}
          </span>
        </span>
      );
    case "mcap":
      return fmtUsd(c.mcap);
    case "totalVolume":
      return fmtUsd(c.totalVolume);
    case "fdv":
      return (
        <span className="whitespace-nowrap">
          {fmtUsd(c.fdv)}
          {c.highDilution && (
            <span title="유통량 30% 미만 (MC/FDV<0.3) — 미래 언락 매도압 주의">
              <TriangleAlert size={12} className="ml-1 inline text-amber-400" />
            </span>
          )}
        </span>
      );
    case "tvl":
      return fmtUsd(c.tvl);
    case "priceChange7d":
      return (
        <span className={changeClass(c.priceChange7d)}>
          {fmtPct(c.priceChange7d)}
        </span>
      );
    case "priceChange14d":
      return (
        <span className={changeClass(c.priceChange14d)}>
          {fmtPct(c.priceChange14d)}
        </span>
      );
    case "priceChange30d":
      return (
        <span className={changeClass(c.priceChange30d)}>
          {fmtPct(c.priceChange30d)}
        </span>
      );
    case "priceChange60d":
      return (
        <span className={changeClass(c.priceChange60d)}>
          {fmtPct(c.priceChange60d)}
        </span>
      );
    case "priceChange1y":
      return (
        <span className={changeClass(c.priceChange1y)}>
          {fmtPct(c.priceChange1y)}
        </span>
      );
    case "athChangePercentage":
      return (
        <span className={changeClass(c.athChangePercentage)}>
          {fmtPct(c.athChangePercentage)}
        </span>
      );
    case "atlChangePercentage":
      return (
        <span className={changeClass(c.atlChangePercentage)}>
          {fmtPct(c.atlChangePercentage)}
        </span>
      );
    case "feesChange7d":
      return (
        <span className="inline-flex flex-col items-end gap-0.5" title={feeLabel(c)}>
          <small>{feeLabel(c)}</small>
          <span className={changeClass(c.feesChange7dover7d)}>
            {fmtPct(c.feesChange7dover7d)}
          </span>
          <span
            className={`${changeClass(c.feesChange30dover30d)} text-[11px] opacity-75`}
          >
            30d {fmtPct(c.feesChange30dover30d)}
          </span>
        </span>
      );
    default:
      return null;
  }
}
