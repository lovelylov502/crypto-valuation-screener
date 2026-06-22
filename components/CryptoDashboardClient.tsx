"use client";

import { useMemo, useState } from "react";
import type { CoinScored, OnchainDashboard } from "@/lib/types";
import { summarizeDecision } from "@/lib/decision";
import { ScreenerClient } from "./ScreenerClient";
import { CandidateDrawer, type CoinDecisionRow } from "./CandidateDrawer";
import { DecisionBoard } from "./DecisionBoard";
import { ValueCaptureMap } from "./ValueCaptureMap";
import { MethodologyScreen } from "./MethodologyScreen";
import { ResearchReportScreen } from "./ResearchReportScreen";
import { PENDLE_REPORT, RESEARCH_REPORTS, recentResearchReports, type ResearchReport } from "@/lib/researchReports";

type Tab = "research" | "decision" | "queue" | "map" | "raw" | "methodology";

const NAV: { key: Tab; label: string; description: string }[] = [
  { key: "research", label: "조사노트", description: "최근 3개" },
  { key: "decision", label: "의사결정", description: "오늘 볼 후보" },
  { key: "queue", label: "후보 큐", description: "메모 카드" },
  { key: "map", label: "가치포획 맵", description: "싸냐 vs 꽂히냐" },
  { key: "raw", label: "원자료", description: "기존 스크리너" },
  { key: "methodology", label: "방법론", description: "사용법" },
];

export function CryptoDashboardClient({
  coins,
  categories,
  updatedAt,
  fdvCoverage,
}: {
  coins: CoinScored[];
  categories: string[];
  updatedAt: string;
  fdvCoverage: number;
  onchain: OnchainDashboard;
}) {
  const [tab, setTab] = useState<Tab>("research");
  const [selected, setSelected] = useState<CoinDecisionRow | null>(null);
  const [selectedReportId, setSelectedReportId] = useState(PENDLE_REPORT.id);
  const rows = useMemo<CoinDecisionRow[]>(() => {
    return coins
      .map((coin) => ({ coin, decision: summarizeDecision(coin) }))
      .sort((a, b) => b.decision.priority - a.decision.priority);
  }, [coins]);
  const activeReport = useMemo(() => {
    return RESEARCH_REPORTS.find((report) => report.id === selectedReportId) ?? PENDLE_REPORT;
  }, [selectedReportId]);
  const activeReportRow = useMemo(() => findReportRow(activeReport, rows), [activeReport, rows]);

  return (
    <div className="space-y-5">
      <nav className="grid gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-2 sm:grid-cols-6">
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-xl px-3 py-2 text-left transition-colors ${
              tab === item.key
                ? "bg-[var(--color-accent)] text-white shadow-lg shadow-blue-950/30"
                : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            }`}
          >
            <span className="block text-sm font-semibold">{item.label}</span>
            <span className={`mt-0.5 block text-[11px] ${tab === item.key ? "text-white/75" : "text-[var(--color-muted)]"}`}>{item.description}</span>
          </button>
        ))}
      </nav>

      {tab === "decision" && (
        <DecisionBoard rows={rows} updatedAt={updatedAt} onSelect={setSelected} />
      )}
      {tab === "queue" && (
        <CandidateQueue rows={rows} onSelect={setSelected} />
      )}
      {tab === "map" && (
        <ValueCaptureMap rows={rows} onSelect={setSelected} />
      )}
      {tab === "research" && (
        <ResearchDesk
          reports={recentResearchReports(3)}
          activeReport={activeReport}
          activeRow={activeReportRow}
          onSelectReport={(report) => setSelectedReportId(report.id)}
          onOpenCoin={activeReportRow ? () => setSelected(activeReportRow) : undefined}
        />
      )}
      {tab === "raw" && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">Raw explorer</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">원자료 탐색</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-muted)]">
              기존 밸류 스크리너입니다. 투자 판단은 의사결정 보드에서 시작하고, 여기서는 멀티플과 필터를 직접 확인합니다.
            </p>
          </section>
          <ScreenerClient coins={coins} categories={categories} updatedAt={updatedAt} fdvCoverage={fdvCoverage} />
        </div>
      )}
      {tab === "methodology" && <MethodologyScreen />}

      <CandidateDrawer row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function findReportRow(report: ResearchReport, rows: CoinDecisionRow[]): CoinDecisionRow | undefined {
  return rows.find(({ coin }) =>
    coin.geckoId === report.protocol.geckoId ||
    report.protocol.slugMatchers.includes(coin.slug) ||
    coin.symbol?.toUpperCase() === report.protocol.symbol
  );
}

function ResearchDesk({
  reports,
  activeReport,
  activeRow,
  onSelectReport,
  onOpenCoin,
}: {
  reports: ResearchReport[];
  activeReport: ResearchReport;
  activeRow?: CoinDecisionRow;
  onSelectReport: (report: ResearchReport) => void;
  onOpenCoin?: () => void;
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">Research notes</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">최근 조사노트</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-muted)]">
          모든 주식·토큰 조사는 <strong className="text-[var(--color-text)]">조사일 · 데이터 기준일 · 업데이트 상태</strong>를 함께 보여줍니다.
          숫자가 낡았는지 먼저 보고, 그 다음 논지와 시나리오를 봅니다.
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {reports.map((report) => (
          <button
            key={report.id}
            type="button"
            onClick={() => onSelectReport(report)}
            className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-accent)] ${
              report.id === activeReport.id ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10" : "border-[var(--color-border)] bg-[var(--color-panel)]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-sky-200">{report.protocol.symbol}</span>
              <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]">{report.reviewStatus}</span>
            </div>
            <h3 className="mt-2 line-clamp-2 text-base font-semibold">{report.title}</h3>
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--color-muted)]">{report.subtitle}</p>
            <div className="mt-3 grid gap-1 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted)]">
              <span>조사일 <strong className="font-medium text-[var(--color-text)]">{report.researchedAt}</strong></span>
              <span>데이터 기준 <strong className="font-medium text-[var(--color-text)]">{report.dataAsOf}</strong></span>
            </div>
          </button>
        ))}
      </section>

      <ResearchReportScreen report={activeReport} row={activeRow} onOpenCoin={onOpenCoin} />
    </div>
  );
}

function CandidateQueue({ rows, onSelect }: { rows: CoinDecisionRow[]; onSelect: (row: CoinDecisionRow) => void }) {
  const columns = [
    { title: "검토 우선", rows: rows.filter((r) => r.decision.bucket === "research-priority").slice(0, 8) },
    { title: "포획 불명확", rows: rows.filter((r) => r.decision.bucket === "cheap-but-unclear-capture").slice(0, 8) },
    { title: "고희석", rows: rows.filter((r) => r.decision.bucket === "dilution-risk").slice(0, 8) },
    { title: "데이터 부족", rows: rows.filter((r) => r.decision.bucket === "data-missing").slice(0, 8) },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">Candidate queue</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">후보 큐</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-muted)]">
          Research Desk의 후보를 메모 카드처럼 버킷별로 봅니다. 다음 단계에서는 이 상태를 저장/위키화할 수 있습니다.
        </p>
      </section>
      <section className="grid gap-3 xl:grid-cols-4">
        {columns.map((column) => (
          <div key={column.title} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold">{column.title}</h3>
              <span className="text-xs text-[var(--color-muted)]">{column.rows.length}</span>
            </div>
            <div className="space-y-2">
              {column.rows.map((row) => (
                <button key={row.coin.slug} type="button" onClick={() => onSelect(row)} className="block w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-left hover:border-[var(--color-accent)]">
                  <div className="font-medium">{row.coin.name}</div>
                  <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-[var(--color-muted)]">{row.decision.thesis}</p>
                  <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-muted)]">{row.decision.nextQuestions[0]}</p>
                </button>
              ))}
              {column.rows.length === 0 && <div className="rounded-xl border border-dashed border-[var(--color-border)] p-5 text-center text-sm text-[var(--color-muted)]">비어 있음</div>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
