"use client";

import type { ReactNode } from "react";
import { bucketLabel } from "@/lib/decision";
import { fmtMult, fmtUsd } from "@/lib/format";
import type { ResearchReport, ReportSeverity, ReportStrength } from "@/lib/researchReports";
import type { CoinDecisionRow } from "./CandidateDrawer";

function strengthClass(strength: ReportStrength): string {
  if (strength === "strong") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-300";
  if (strength === "medium") return "border-amber-400/35 bg-amber-400/10 text-amber-200";
  return "border-slate-400/30 bg-slate-400/10 text-slate-300";
}

function severityClass(severity: ReportSeverity): string {
  if (severity === "high") return "border-red-400/40 bg-red-400/10 text-red-200";
  if (severity === "medium") return "border-amber-400/40 bg-amber-400/10 text-amber-200";
  return "border-slate-400/30 bg-slate-400/10 text-slate-300";
}

export function ResearchReportScreen({
  report,
  row,
  onOpenCoin,
}: {
  report: ResearchReport;
  row?: CoinDecisionRow;
  onOpenCoin?: () => void;
}) {
  const liveCoin = row?.coin;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">Curated research memo</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">{report.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{report.subtitle}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                {bucketLabel(report.bucket)}
              </span>
              <MetaPill label="조사일" value={report.researchedAt} />
              <MetaPill label="데이터 기준" value={report.dataAsOf} />
              <MetaPill label="상태" value={report.reviewStatus} />
              {liveCoin && (
                <button
                  type="button"
                  onClick={onOpenCoin}
                  className="rounded-full border border-[var(--color-accent)]/60 px-3 py-1 text-xs text-sky-200 hover:bg-[var(--color-accent)]/15"
                >
                  실시간 스크리너 행 열기
                </button>
              )}
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs leading-relaxed text-[var(--color-muted)] sm:max-w-xs">
            <div className="grid grid-cols-[82px_1fr] gap-x-3 gap-y-1">
              <span>조사일</span><strong className="font-medium text-[var(--color-text)]">{report.researchedAt}</strong>
              <span>데이터 기준</span><strong className="font-medium text-[var(--color-text)]">{report.dataAsOf}</strong>
              <span>업데이트</span><strong className="font-medium text-[var(--color-text)]">{report.reviewStatus}</strong>
              {report.nextReviewAt && <><span>재검토</span><strong className="font-medium text-[var(--color-text)]">{report.nextReviewAt}</strong></>}
            </div>
            <p>{report.fxNote}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">Thesis</p>
          <h3 className="mt-2 text-xl font-semibold">한줄 판단</h3>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-text)]">{report.thesis}</p>
          <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
            <h4 className="text-sm font-semibold">만질이 판단</h4>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{report.verdict}</p>
            <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm leading-relaxed text-sky-200">다음 행동: {report.nextAction}</p>
          </div>
        </div>

        <LiveSnapshot row={row} report={report} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {report.metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
            <div className="text-[11px] text-[var(--color-muted)]">{metric.label}</div>
            <div className="mt-1 text-base font-semibold tabular-nums text-[var(--color-text)]">{metric.value}</div>
            {(metric.note || metric.source) && (
              <div className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
                {metric.source && <span>{metric.source}</span>}
                {metric.note && <span>{metric.source ? " · " : ""}{metric.note}</span>}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {report.scenarios.map((scenario) => (
          <div key={scenario.name} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
            <div className="text-xs text-[var(--color-muted)]">시나리오</div>
            <h3 className="mt-1 text-lg font-semibold">{scenario.name}</h3>
            <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <div className="text-[11px] text-[var(--color-muted)]">가격 범위</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-sky-200">{scenario.priceRange}</div>
              <div className="mt-1 text-xs text-[var(--color-muted)]">시총 {scenario.marketCapRange}</div>
            </div>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--color-muted)]">
              {scenario.assumptions.map((item) => <li key={item}>• {item}</li>)}
            </ul>
            <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs leading-relaxed text-amber-200">필요 증거: {scenario.evidenceNeeded}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="검증된 근거">
          <div className="space-y-3">
            {report.evidence.map((item) => (
              <a
                key={item.label}
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 hover:border-[var(--color-accent)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">{item.label}</h4>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${strengthClass(item.strength)}`}>{item.strength}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">{item.detail}</p>
                <p className="mt-2 text-[11px] text-sky-200">{item.sourceLabel} ↗</p>
              </a>
            ))}
          </div>
        </Panel>

        <Panel title="리스크 / 모니터링">
          <div className="space-y-3">
            {report.risks.map((risk) => (
              <div key={risk.label} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">{risk.label}</h4>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${severityClass(risk.severity)}`}>{risk.severity}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">{risk.detail}</p>
                {risk.monitor && <p className="mt-2 text-[11px] text-amber-200">봐야 할 것: {risk.monitor}</p>}
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {report.sections.map((section) => (
          <Panel key={section.title} title={section.title} subtitle={section.summary}>
            <ul className="space-y-2 text-sm leading-relaxed text-[var(--color-muted)]">
              {section.bullets.map((bullet) => <li key={bullet}>• {bullet}</li>)}
            </ul>
          </Panel>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="대표/팀 인터뷰">
          <div className="space-y-3">
            {report.interviews.map((interview) => (
              <a key={`${interview.date}-${interview.speaker}`} href={interview.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 hover:border-[var(--color-accent)]">
                <div className="text-xs text-[var(--color-muted)]">{interview.date} · {interview.venue}</div>
                <h4 className="mt-1 text-sm font-semibold">{interview.speaker}</h4>
                <ul className="mt-2 space-y-1 text-xs leading-relaxed text-[var(--color-muted)]">
                  {interview.points.map((point) => <li key={point}>• {point}</li>)}
                </ul>
                <p className="mt-2 text-[11px] text-sky-200">영상/자막 근거 보기 ↗</p>
              </a>
            ))}
          </div>
        </Panel>

        <Panel title="친한 VC·프로젝트·시장 접점">
          <div className="space-y-3">
            {report.allies.map((ally) => (
              <div key={ally.group} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                <h4 className="text-sm font-semibold">{ally.group}</h4>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ally.names.map((name) => (
                    <span key={name} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]">{name}</span>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">{ally.note}</p>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Panel title="아직 모르는 것">
          <ol className="space-y-2 text-sm leading-relaxed text-[var(--color-muted)]">
            {report.openQuestions.map((question, index) => (
              <li key={question} className="flex gap-2">
                <span className="text-[var(--color-accent)]">{index + 1}.</span>
                <span>{question}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="검증 자료 / 출처">
          <div className="grid gap-2 sm:grid-cols-2">
            {report.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs hover:border-[var(--color-accent)]">
                <span className="font-medium text-[var(--color-text)]">{source.label}</span>
                {source.note && <span className="mt-1 block leading-relaxed text-[var(--color-muted)]">{source.note}</span>}
                <span className="mt-1 block text-sky-200">열기 ↗</span>
              </a>
            ))}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-muted)]">
      {label} <strong className="font-medium text-[var(--color-text)]">{value}</strong>
    </span>
  );
}

function LiveSnapshot({ row, report }: { row?: CoinDecisionRow; report: ResearchReport }) {
  if (!row) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">Live screener</p>
        <h3 className="mt-2 text-lg font-semibold">실시간 {report.protocol.symbol} 행 없음</h3>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
          정적 리포트는 표시되지만, 현재 빌드 데이터에서 {report.protocol.name} 행을 찾지 못했습니다. 주식·토큰 리포트는 출처별 정적 데이터 기준도 함께 봅니다.
        </p>
      </div>
    );
  }

  const coin = row.coin;
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">Live screener</p>
      <h3 className="mt-2 text-lg font-semibold">현재 앱 데이터</h3>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <MiniMetric label="Mcap" value={fmtUsd(coin.mcap)} />
        <MiniMetric label="FDV" value={fmtUsd(coin.fdv)} />
        <MiniMetric label="P/HR" value={fmtMult(coin.multiples.phr)} />
        <MiniMetric label="FDV/Mcap" value={fmtMult(coin.multiples.dilution)} />
        <MiniMetric label="Holder rev" value={fmtUsd(coin.holderRevenueAnnual)} />
        <MiniMetric label="Value score" value={coin.valueScore === null ? "–" : String(coin.valueScore)} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">자동 판단: {row.decision.thesis}</p>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
      <h3 className="text-base font-semibold">{title}</h3>
      {subtitle && <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
      <div className="text-[11px] text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
