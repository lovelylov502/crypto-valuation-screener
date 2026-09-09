"use client";

import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import type { CoinScored } from "@/lib/types";
import { fmtKstMinute, fmtMult, fmtUsd } from "@/lib/format";
import { flowLabel } from "@/lib/signals";
import { holderEconomicTypeLabel } from "@/lib/holderValue";
import { MECHANISM_EVIDENCE } from "@/lib/mechanismEvidence";
import type { SnapshotChange } from "@/lib/snapshotHistory";
import { coinUrl } from "./ScreenerCells";

export function CoinDetail({
  coin: c,
  change,
  onClose,
}: {
  coin: CoinScored;
  change: SnapshotChange;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const panel = dialog.current;
    panel?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      panel?.close();
      document.body.style.overflow = overflow;
      prior?.focus();
    };
  }, []);
  const evidence = MECHANISM_EVIDENCE[c.slug];
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
        <section className="detail-section">
          <h3>무엇이 포착됐나요?</h3>
          <ul className="reason-list">
            {(c.opportunities.reasons.length
              ? c.opportunities.reasons
              : ["현재 세 포착 기준에 해당하는 관측 신호 없음"]
            ).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {c.opportunities.transition && (
            <p className="notice">
              0↔양수는 관측 금액의 변화입니다. 정책의 신설·재개·중단 여부는 공식
              자료에서 확인해야 합니다.
            </p>
          )}
        </section>
        <section className="detail-section">
          <h3>같은 30일로 비교</h3>
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
                    "프로토콜 매출",
                    c.revenuePrev30d,
                    c.revenue30d,
                    flowLabel(c.opportunities.revenue),
                  ],
                  [
                    "전체 수수료",
                    c.feesPrev30d,
                    c.fees30d,
                    flowLabel(c.opportunities.fees),
                  ],
                  [
                    "P/HR 적격 홀더",
                    c.holderValue.eligiblePrevious30d,
                    c.holderValue.eligibleCurrent30d,
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
            매출은 운영비·토큰 인센티브를 차감한 순이익이 아닙니다. 누락은 ‘–’,
            보고된 0은 ‘$0’으로 표시합니다.
          </p>
          <dl className="detail-metrics">
            <div>
              <dt>P/HR · 30일 연환산</dt>
              <dd>{fmtMult(c.multiples.phr)}</dd>
            </div>
            <div>
              <dt>P/S · 30일 연환산</dt>
              <dd>{fmtMult(c.multiples.ps)}</dd>
            </div>
            <div>
              <dt>
                홀더 금액 /{" "}
                {c.valueCapture.shareBasis === "fees30d" ? "수수료" : "매출"} ·
                30일
              </dt>
              <dd>{share === null ? "–" : `${(share * 100).toFixed(1)}%`}</dd>
            </div>
          </dl>
          <p className="muted detail-note">
            금액 비율은 공식 배분율과 다를 수 있습니다. 재원·집계 범위·지급
            시차의 영향을 받습니다.
          </p>
          {c.valueCapture.risks
            .filter((r) => r.includes("분모"))
            .map((r) => (
              <p className="notice" key={r}>
                {r}
              </p>
            ))}
        </section>
        <section className="detail-section">
          <h3>홀더에게 어떻게 귀속되나요?</h3>
          {evidence && (
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
            <p className="muted">배분 금액·방식에 관한 원천 자료가 없습니다.</p>
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
                <p>{part.reason}</p>
              </article>
            ))
          )}
          <p className="muted detail-note">
            DefiLlama 설명문에서 자동 분류했습니다. 일반 배분·매입과 조건부
            락업·투표 보상을 구분하며, 매입 후 소각·배분을 중복 합산하지
            않습니다.
          </p>
        </section>
        <section className="detail-section detail-split">
          <div>
            <h3>자료 확인 {c.opportunities.dataIssues.length}</h3>
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
          <h3>지난 확인과 비교</h3>
          {change.state === "comparable" ? (
            <dl className="detail-metrics">
              <div>
                <dt>실험 점수 변화</dt>
                <dd>
                  {change.scoreDelta === null
                    ? "–"
                    : `${change.scoreDelta > 0 ? "+" : ""}${change.scoreDelta}점`}
                </dd>
              </div>
              <div>
                <dt>매출 30일 금액 변화</dt>
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
              {change.state === "rules_changed"
                ? "계산 규칙이 변경되어 이전 점수와 비교하지 않습니다."
                : change.state === "identity_changed"
                  ? "토큰 연결이 바뀌어 이전 자료와 비교하지 않습니다."
                  : "다음 확인부터 이 브라우저의 기록과 비교할 수 있습니다."}
            </p>
          )}
        </section>
        <details className="detail-section score-explainer">
          <summary>실험 점수와 비교 표본</summary>
          <p>
            {c.valueScore ?? "산출 보류"} / 100 · {c.status} · 자료 완성도{" "}
            {Math.round(c.confidence * 100)}%
          </p>
          <p>
            가치 {c.scoreAxes.value}/30 · 개선 {c.scoreAxes.improvement}/25 ·
            미발견 {c.scoreAxes.discovery}/25 · 품질 {c.scoreAxes.quality}/20
          </p>
          <p>
            P/HR 표본 {c.peerCounts.phr} · P/S {c.peerCounts.ps} · P/F{" "}
            {c.peerCounts.pf}. 같은 섹터 표본 8개 미만이면 해당 상대점수를
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
