import type { CoinScored } from "./types";

export type DecisionBucket =
  | "research-priority"
  | "clear-but-expensive"
  | "cheap-but-unclear-capture"
  | "dilution-risk"
  | "narrative-only"
  | "data-missing"
  | "ignore";

export interface EvidenceItem {
  label: string;
  detail: string;
  strength: "strong" | "medium" | "weak";
  source: "defillama" | "coingecko" | "inferred";
}

export interface RiskItem {
  label: string;
  severity: "high" | "medium" | "low";
  detail: string;
}

export interface DecisionSummary {
  bucket: DecisionBucket;
  priority: number;
  thesis: string;
  evidence: EvidenceItem[];
  risks: RiskItem[];
  unknowns: string[];
  nextQuestions: string[];
}

const hasDirectCapture = (c: CoinScored) =>
  c.valueCapture.label === "강한 가치포획" ||
  c.valueCapture.label === "가치포획 후보" ||
  ((c.holderRevenueAnnual ?? 0) > 0 && (c.holderRevenue30d ?? 0) > 0);

const hasMeaningfulRevenue = (c: CoinScored) =>
  (c.revenueAnnual ?? 0) > 0 || (c.feesAnnual ?? 0) > 0;

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

function formatMultiple(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "없음";
  if (v >= 100) return `${v.toFixed(0)}x`;
  if (v >= 10) return `${v.toFixed(1)}x`;
  return `${v.toFixed(2)}x`;
}

function evidenceFor(c: CoinScored): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  if ((c.holderRevenueAnnual ?? 0) > 0 && (c.holderRevenue30d ?? 0) > 0) {
    evidence.push({
      label: "holder revenue 실측",
      detail: "최근 30일 holder revenue가 있고 연율 holder revenue도 산출됩니다.",
      strength: "strong",
      source: "defillama",
    });
  }
  if (c.valueCapture.holderRevenueShare !== null) {
    evidence.push({
      label: "귀속 비중 산출",
      detail: `매출/수수료 대비 holder revenue 비중 ${(c.valueCapture.holderRevenueShare * 100).toFixed(1)}%`,
      strength: c.valueCapture.holderRevenueShare >= 0.5 ? "strong" : "medium",
      source: "defillama",
    });
  }
  if (c.sectorPercentiles.phr !== null && c.sectorPercentiles.phr >= 70) {
    evidence.push({
      label: "P/HR 섹터 상위",
      detail: `P/HR ${formatMultiple(c.multiples.phr)}로 같은 섹터 안에서 저렴한 편입니다.`,
      strength: "strong",
      source: "inferred",
    });
  } else if (c.valueScore !== null && c.valueScore >= 70) {
    evidence.push({
      label: "밸류 매력",
      detail: `종합 밸류 점수 ${c.valueScore}점으로 상대적으로 저렴한 후보입니다.`,
      strength: "medium",
      source: "inferred",
    });
  }
  if (hasMeaningfulRevenue(c) && !hasDirectCapture(c)) {
    evidence.push({
      label: "매출/수수료 실측",
      detail: "프로토콜 활동은 보이지만 토큰 홀더 귀속 경로는 아직 확인되지 않았습니다.",
      strength: "medium",
      source: "defillama",
    });
  }
  return evidence;
}

function risksFor(c: CoinScored): RiskItem[] {
  const risks: RiskItem[] = [];
  if (!hasDirectCapture(c) && hasMeaningfulRevenue(c)) {
    risks.push({
      label: "holder revenue 없음",
      severity: "high",
      detail: "프로토콜 매출/수수료가 토큰 홀더에게 직접 귀속된다는 데이터가 없습니다.",
    });
  }
  if (c.highDilution) {
    risks.push({
      label: "고희석",
      severity: "high",
      detail: `FDV/Mcap ${formatMultiple(c.multiples.dilution)}로 미래 공급 압력이 큽니다.`,
    });
  }
  if (c.lowActivity) {
    risks.push({
      label: "저활동/신선도 낮음",
      severity: "medium",
      detail: "최근 현금흐름이 약하거나 오래된 데이터라 저평가 신호를 신뢰하기 어렵습니다.",
    });
  }
  if (c.valueScore !== null && c.valueScore < 40 && hasDirectCapture(c)) {
    risks.push({
      label: "비싼 밸류",
      severity: "medium",
      detail: "가치포획은 보이지만 현재 멀티플은 싸지 않습니다.",
    });
  }
  return risks;
}

function unknownsFor(c: CoinScored): string[] {
  const unknowns: string[] = [];
  if (c.mcap === null || c.valueScore === null) unknowns.push("기본 밸류 데이터 부족");
  if (!hasDirectCapture(c)) unknowns.push("토큰 포획 경로 미확인");
  if (c.valueCapture.holderRevenueShare === null) unknowns.push("매출 대비 holder revenue 귀속 비중 미확인");
  if (c.fdv === null || c.multiples.dilution === null) unknowns.push("FDV/희석 데이터 부족");
  return [...new Set(unknowns)];
}

function questionsFor(c: CoinScored, bucket: DecisionBucket): string[] {
  const questions: string[] = [];
  if (bucket === "data-missing") {
    questions.push("시총, FDV, revenue, holder revenue 데이터가 왜 비어 있는지 원자료에서 확인할 것.");
  }
  if (!hasDirectCapture(c)) {
    questions.push("토큰이 수수료, 매출, 보안, 소각, 분배 중 어디에서 가치를 포획하는지 확인할 것.");
    questions.push("fee switch 또는 revenue sharing이 현재 켜져 있는지, 가능성뿐인지 확인할 것.");
  } else {
    questions.push("현재 holder revenue가 일회성 이벤트가 아니라 지속 가능한 수익인지 확인할 것.");
    questions.push("수익이 분배, 바이백, 소각, 스테이킹 중 어떤 방식으로 토큰 홀더에게 귀속되는지 확인할 것.");
  }
  if (c.highDilution) {
    questions.push("언락 일정과 유통량 증가가 현재 가치포획을 희석시키는지 확인할 것.");
  }
  return questions;
}

export function bucketLabel(bucket: DecisionBucket): string {
  switch (bucket) {
    case "research-priority": return "검토 우선";
    case "clear-but-expensive": return "포획 명확·비쌈";
    case "cheap-but-unclear-capture": return "싸지만 포획 불명확";
    case "dilution-risk": return "고희석 주의";
    case "narrative-only": return "내러티브 우선";
    case "data-missing": return "데이터 부족";
    case "ignore": return "보류";
  }
}

export function summarizeDecision(c: CoinScored): DecisionSummary {
  const direct = hasDirectCapture(c);
  const cheap = (c.valueScore ?? -1) >= 70;
  const expensive = c.valueScore !== null && c.valueScore < 45;
  const missingCore = c.mcap === null || c.valueScore === null;
  let bucket: DecisionBucket;

  if (missingCore) bucket = "data-missing";
  else if (c.lowActivity) bucket = "ignore";
  else if (c.highDilution) bucket = "dilution-risk";
  else if (direct && cheap) bucket = "research-priority";
  else if (direct && expensive) bucket = "clear-but-expensive";
  else if (cheap && !direct) bucket = "cheap-but-unclear-capture";
  else if (hasMeaningfulRevenue(c) && !direct) bucket = "narrative-only";
  else bucket = "data-missing";

  const evidence = evidenceFor(c);
  const risks = risksFor(c);
  const unknowns = unknownsFor(c);
  const nextQuestions = questionsFor(c, bucket);

  const basePriority = (() => {
    switch (bucket) {
      case "research-priority": return 82;
      case "dilution-risk": return 68;
      case "cheap-but-unclear-capture": return 62;
      case "clear-but-expensive": return 48;
      case "narrative-only": return 42;
      case "data-missing": return 28;
      case "ignore": return 18;
    }
  })();
  const valueBoost = c.valueScore === null ? 0 : (c.valueScore - 50) * 0.15;
  const captureBoost = c.valueCapture.score === null ? 0 : (c.valueCapture.score - 50) * 0.12;
  const priority = Math.round(clamp(basePriority + valueBoost + captureBoost));

  const thesis = (() => {
    switch (bucket) {
      case "research-priority":
        return `holder revenue가 실측되고 밸류도 상대적으로 싸서 리서치 우선 후보입니다.`;
      case "clear-but-expensive":
        return `토큰 가치포획은 보이지만 현재 밸류는 싸지 않아 가격/성장 정당화 확인이 필요합니다.`;
      case "cheap-but-unclear-capture":
        return `숫자는 싸 보이지만 holder revenue나 토큰 포획 경로가 불명확한 함정 후보입니다.`;
      case "dilution-risk":
        return `가치포획 신호가 있어도 FDV/Mcap 희석 압력이 커서 언락 구조 확인이 먼저입니다.`;
      case "narrative-only":
        return `프로토콜 활동은 보이지만 토큰 가격으로 연결되는 직접 포획 근거가 약합니다.`;
      case "data-missing":
        return `판단에 필요한 핵심 데이터가 부족해 원자료와 토큰 구조 확인이 먼저입니다.`;
      case "ignore":
        return `활동성이나 신선도가 낮아 지금은 우선순위를 낮춥니다.`;
    }
  })();

  return { bucket, priority, thesis, evidence, risks, unknowns, nextQuestions };
}
