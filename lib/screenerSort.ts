import type { CoinScored } from "./types";
import type { SortKey } from "./screenerColumns";
import { researchMultiple } from "./research";
import { revenueAmount } from "./revenueHistory";
import { protocolResearch } from "./protocolResearch";
import { holderEconomicTypeLabel } from "./holderValue";
import { knownRevenue } from "./fundamentals";
import { salesMultiple, protocolMultiple, holderMultiple, datedHolderValue, type CapitalBasis } from "./valuationMetrics";
import { METRIC_COLUMN_DAYS as METRIC_DAYS } from "./metricCoverage";

export function sortValue(c: CoinScored, key: SortKey, basis: CapitalBasis = "mcap"): number | string | null {
  if (key === "psSales") return salesMultiple(c, basis);
  if (key.startsWith("phr")) return holderMultiple(c, METRIC_DAYS[key] ?? 30, basis);
  if (key === "pr24h" || key === "pr" || key.startsWith("pr7") || key.startsWith("pr90") || key === "pr1y") return protocolMultiple(c, METRIC_DAYS[key] ?? 30, basis);
  switch (key) {
    case "price": return c.price;
    case "change1d": return c.change1d;
    case "multiple7d": return researchMultiple(c, 7);
    case "multiple90d": return researchMultiple(c, 90);
    case "multiple1y": return researchMultiple(c, 365);
    case "revenue7d": return revenueAmount(c, 7);
    case "revenue90d": return revenueAmount(c, 90);
    case "revenue1y": return revenueAmount(c, 365);
    case "holderRoute": return protocolResearch(c)?.holder?.route ?? c.holderValue.components.map(p => holderEconomicTypeLabel(p.economicType)).join("+");
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
