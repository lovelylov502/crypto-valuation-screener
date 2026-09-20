"use client";

import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import type { CoinScored } from "@/lib/types";
import { fmtKstMinute, fmtMult, fmtUsd, fmtPrice, fmtPct } from "@/lib/format";
import { compareFlow, flowLabel } from "@/lib/signals";
import { holderEconomicTypeLabel } from "@/lib/holderValue";
import { MECHANISM_EVIDENCE } from "@/lib/mechanismEvidence";
import { protocolResearch } from "@/lib/protocolResearch";
import { researchReasons } from "@/lib/research";
import { RevenuePanel } from "./RevenuePanel";
import type { Snapshot, SnapshotChange } from "@/lib/snapshotHistory";
import { coinUrl } from "./ScreenerCells";
import { revenueLabel, feeLabel, multipleLabel } from "@/lib/fundamentals";
import { ValuationEvidence } from "./ValuationEvidence";
import { datedHolderValue, type CapitalBasis } from "@/lib/valuationMetrics";

export function CoinDetail({
  coin: c,
  change,
  onClose,
  history,
  multipleReference,
  capital = "mcap",
}: {
  coin: CoinScored;
  change: SnapshotChange;
  onClose: () => void;
  history: Snapshot[];
  multipleReference: number | null;
  capital?: CapitalBasis;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const panel = dialog.current;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    panel?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      panel?.close();
      document.body.style.overflow = overflow;
      prior?.focus({ preventScroll: true });
      window.scrollTo(scrollX, scrollY);
    };
  }, []);
  const evidence = MECHANISM_EVIDENCE[c.slug];
  const research = protocolResearch(c);
  const reasons = researchReasons(c, multipleReference);
  const safeUrl = (v: string | null | undefined) => v && /^https?:\/\//i.test(v) ? v : undefined;
  const share = c.valueCapture.eligibleHolderValueShare;
  return (
    <dialog
      ref={dialog}
      className="detail-dialog"
      aria-labelledby="coin-detail-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="detail-content">
        <header className="detail-header">
          <div>
            <p className="eyebrow">프로토콜 상세</p>
            <h2 id="coin-detail-title">
              {c.name} <span>{c.symbol}</span>
            </h2>
            <p className="muted">{c.category ?? "섹터 미확인"}</p>
          </div>
          <button
            className="icon-button"
            aria-label="상세 닫기"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <section className="market-overview" aria-label="현재 가격과 시장 규모">
          <div className="current-price">{fmtPrice(c.price)}</div>
          <div className="price-changes">{[["24시간", c.change1d], ["7일", c.priceChange7d], ["30일", c.priceChange30d]].map(([label, value]) => <span key={String(label)}>{label} <strong className={typeof value === "number" ? value >= 0 ? "positive" : "negative" : ""}>{fmtPct(value as number | null)}</strong></span>)}</div>
          <dl className="market-summary"><div><dt>시가총액</dt><dd>{fmtUsd(c.mcap)}</dd></div><div><dt>FDV</dt><dd>{fmtUsd(c.fdv)}</dd></div><div><dt>24시간 거래량</dt><dd>{fmtUsd(c.totalVolume)}</dd></div></dl>
          <p className="detail-note muted">시세 기준 {c.marketDataUpdatedAt ? fmtKstMinute(c.marketDataUpdatedAt) : "원천 시각 미확인"}</p>
        </section>
        <ValuationEvidence coin={c} capital={capital} />
        <section className="detail-section project-introduction">
          <h3>어떤 사업인가요?</h3>
          <p>{research?.description ?? c.descriptionKo ?? (c.description ? "한국어 소개를 준비 중입니다. 아래에서 원문을 확인할 수 있습니다." : "프로젝트 소개 자료를 확보하지 못했습니다. 원천 페이지에서 사업과 수익원을 확인해 주세요.")}</p>
          <p className="detail-note muted">{research ? `${research.scope} · 공식 자료 확인 ${research.reviewedAt}` : `${c.descriptionKo ? "DefiLlama 소개 한국어 번역" : "DefiLlama 소개"}${c.isParent ? " · 구성 제품의 소개이며, 표의 금액은 그룹 단위로 합산합니다." : " · 최신 내용은 공식 자료에서 확인"}`}</p>
          {c.description && <details className="description-original"><summary>DefiLlama 원문 보기</summary><p lang="en">{c.description}</p></details>}
          <div className="detail-links">{safeUrl(research?.source ?? c.descriptionSource) && <a href={safeUrl(research?.source ?? c.descriptionSource)} target="_blank" rel="noreferrer">소개 출처 <ExternalLink size={13} /></a>}{safeUrl(c.website) && <a href={safeUrl(c.website)} target="_blank" rel="noreferrer">프로젝트 홈페이지 <ExternalLink size={13} /></a>}<a href={coinUrl(c)} target="_blank" rel="noreferrer">시장 원자료 <ExternalLink size={13} /></a></div>
          {reasons.length > 0 && <div className="detail-reasons">{reasons.map(r => <span key={r}>{r}</span>)}</div>}
        </section>
        <details className="detail-section"><summary>원천 집계 정의와 과거 관측 보기</summary><RevenuePanel coin={c} history={history} reference={multipleReference} /></details>
        <section className="detail-section">
          <h3>홀더에게 어떻게 귀속되나요?</h3>
          {research?.holder && <div className="holder-facts"><strong>{research.holder.route}</strong><dl>{[["재원", research.holder.funding], ["지급·소각 자산", research.holder.asset], ["수령 대상", research.holder.recipient], ["참여 조건", research.holder.condition], ["시행·검증 상태", research.holder.status]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><a href={research.holder.source} target="_blank" rel="noreferrer">공식 근거 <ExternalLink size={13} /></a><small>문서 확인 {research.reviewedAt} · 아래 금액은 원천 집계이며 정책 비율로 재계산하지 않습니다.</small></div>}
          {!research?.holder && <div className="holder-facts unverified"><strong>지급 자산 · 수령 조건 · 정책 상태 미확인</strong><p>아래는 원천 설명의 자동 분류입니다. 금액만으로 현금 배당이나 보유자의 수령 권리를 판단하지 않습니다.</p></div>}
          {!research?.holder && evidence && (
            <div className="evidence-card">
              <strong>{evidence.route}</strong>
              <p>{evidence.condition}</p>
              <a href={evidence.url} target="_blank" rel="noreferrer">
                {evidence.title} <ExternalLink size={13} />
              </a>
              <small>
                공식 문서 확인 {evidence.reviewedAt} · 금액에는 자동 분류 원자료
                사용
              </small>
            </div>
          )}
          {c.holderValue.warning && (
            <p className="notice">{c.holderValue.warning}</p>
          )}
          {c.holderValue.components.length === 0 ? (
            <p className="muted">표시할 배분 금액·방식의 자동 분류 항목이 없습니다.</p>
          ) : (
            c.holderValue.components.map((part) => (
              <article className="component-row" key={part.slug}>
                <div>
                  <a
                    href={`https://defillama.com/protocol/${encodeURIComponent(part.slug)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {part.name} <ExternalLink size={12} />
                  </a>
                  <span className="tag neutral">
                    {holderEconomicTypeLabel(part.economicType)}
                  </span>
                  <span className="cell-note">
                    {part.eligible ? "P/HR 포함" : "별도 관찰 · P/HR 제외"}
                  </span>
                </div>
                <div className="component-amount">
                  <strong>{fmtUsd(part.current30d)}</strong>
                  <small>최근 30일</small>
                </div>
                <p>{part.reason}{part.condition && <><br/><strong>{part.condition}</strong></>}</p>
              </article>
            ))
          )}
          <p className="muted detail-note">
            DefiLlama 설명문에서 자동 분류했습니다. 일반 배분·매입과 조건부
            락업·투표 보상을 구분하며, 매입 후 소각·배분을 중복 합산하지
            않습니다.
          </p>
        </section>
        <details className="detail-section source-accounting">
          <summary>원천 집계와 금액 비율</summary>
          <div className="detail-table-wrap">
            <table className="detail-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>직전 30일</th>
                  <th>최근 30일</th>
                  <th>변화</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    `Revenue · ${revenueLabel(c)}`,
                    c.revenuePrev30d,
                    c.revenue30d,
                    flowLabel(compareFlow(c.revenue30d, c.revenuePrev30d)),
                  ],
                  [
                    `Fees · ${feeLabel(c)}`,
                    c.feesPrev30d,
                    c.fees30d,
                    flowLabel(c.opportunities.fees),
                  ],
                  [
                    "P/HR 적격 홀더",
                    datedHolderValue(c).eligiblePrevious30d,
                    datedHolderValue(c).eligibleCurrent30d,
                    flowLabel(c.opportunities.eligibleHolder),
                  ],
                ].map(([name, prev, curr, growth]) => (
                  <tr key={String(name)}>
                    <th>{name}</th>
                    <td>{fmtUsd(prev as number | null)}</td>
                    <td>{fmtUsd(curr as number | null)}</td>
                    <td>{growth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted detail-note">
            이 표는 집계액·수수료·홀더 금액 모두 원천의 최근·직전 30일 집계입니다. 위의 완료된 UTC 날짜 기준 집계액과 기간 경계가 다를 수 있습니다. 누락은 ‘–’, 보고된 0은 ‘$0’입니다.
          </p>
          <dl className="detail-metrics">
            <div>
              <dt>P/HR · 30일 연환산</dt>
              <dd>{fmtMult(c.multiples.phr)}</dd>
            </div>
            <div>
              <dt>{multipleLabel(c)} · 30일 연환산</dt>
              <dd>{fmtMult(c.multiples.revenueMultiple)}</dd>
            </div>
            <div>
              <dt>
                홀더 금액 /{" "}
                {revenueLabel(c)} ·
                30일
              </dt>
              <dd>{share === null ? "–" : `${(share * 100).toFixed(1)}%`}</dd>
            </div>
          </dl>
          <p className="muted detail-note">
            같은 원천 30일 집계에서 재원·구성 범위가 검토된 경우에만 비율을 계산합니다. 금액이 같다는 이유만으로 100% 환원으로 판단하지 않습니다. 공식 배분율과 지급 시차는 별도 확인이 필요합니다.
          </p>
          {c.valueCapture.risks
            .filter((r) => r.includes("분모"))
            .map((r) => (
              <p className="notice" key={r}>
                {r}
              </p>
            ))}
        </details>
        <section className="detail-section detail-split">
          <div>
            <h3>추가 확인 항목 {c.opportunities.dataIssues.length}개</h3>
            <ul className="reason-list">
              {(c.opportunities.dataIssues.length
                ? c.opportunities.dataIssues
                : ["기본 자료 확보"]
              ).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>위험 조건 확인</h3>
            <ul className="reason-list">
              {(c.opportunities.risks.length
                ? c.opportunities.risks
                : ["현재 규칙에서 표시할 위험 없음"]
              ).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="muted detail-note">
              언락 일정·보안·운영비는 이 데이터에 포함되지 않습니다.
            </p>
          </div>
        </section>
        <section className="detail-section">
          <h3>확인 완료한 자료와 비교</h3>
          {change.state === "comparable" ? (
            <dl className="detail-metrics">
              <div>
                <dt>시총/집계액 변화 · 기록 시점 기준</dt>
                <dd>
                  {change.multipleDelta === null
                    ? "–"
                    : `${change.multipleDelta > 0 ? "+" : ""}${change.multipleDelta.toFixed(2)}배`}
                </dd>
              </div>
              <div>
                <dt>집계액 30일 금액 변화</dt>
                <dd>{fmtUsd(change.revenueDelta)}</dd>
              </div>
              <div>
                <dt>홀더 30일 금액 변화</dt>
                <dd>{fmtUsd(change.holderDelta)}</dd>
              </div>
              <div>
                <dt>P/HR 변화</dt>
                <dd>
                  {change.phrDelta === null
                    ? "–"
                    : `${change.phrDelta > 0 ? "+" : ""}${change.phrDelta.toFixed(2)}x`}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="muted">
              {change.state === "definition_changed" ? "집계 정의 또는 기간 기준이 바뀌어 이전 기록과 비교하지 않습니다." : change.state === "rules_changed"
                ? "계산 규칙이 바뀌어 이전 기록과 비교하지 않습니다."
                : change.state === "identity_changed"
                  ? "토큰 연결이 바뀌어 이전 자료와 비교하지 않습니다."
                  : "확인 완료한 기준과 비교 가능한 자료가 아직 없습니다."}
            </p>
          )}
        </section>
        <details className="detail-section score-explainer">
          <summary>기존 실험 점수 · 기본 탐색에는 사용하지 않음</summary>
          <p>
            {c.valueScore ?? "산출 보류"} / 100 · {c.status} · 자료 완성도{" "}
            {Math.round(c.confidence * 100)}%
          </p>
          <p>
            가치 {c.scoreAxes.value}/30 · 개선 {c.scoreAxes.improvement}/25 ·
            미발견 {c.scoreAxes.discovery}/25 · 품질 {c.scoreAxes.quality}/20
          </p>
          <p>
            P/HR 표본 {c.peerCounts.phr} · 시총/집계액 {c.peerCounts.revenueMultiple} · P/F{" "}
            {c.peerCounts.pf}. 같은 섹터·집계 종류·기간 기준의 표본 8개 미만이면 해당 상대점수를
            산출하지 않습니다.
          </p>
          <p className="muted">
            홀더 귀속 중심의 탐색 점수입니다. 자료가 없으면 점수에 불리하며,
            실적 개선 신호는 점수와 별도로 표시합니다. 미래 수익률은 검증되지
            않았습니다.
          </p>
          {c.gates.reasons.length > 0 && <p>{c.gates.reasons.join(" · ")}</p>}
        </details>
        <footer className="detail-section">
          <a
            className="button"
            href={coinUrl(c)}
            target="_blank"
            rel="noreferrer"
          >
            시장 원자료 <ExternalLink size={14} />
          </a>
          <p className="muted detail-note">
            {c.identityReason} · CMC 원천{" "}
            {c.marketDataUpdatedAt
              ? fmtKstMinute(c.marketDataUpdatedAt)
              : "시각 미확인"}
          </p>
        </footer>
      </div>
    </dialog>
  );
}
