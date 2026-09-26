"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { ScreenerResponse } from "@/lib/types";
import { fmtKstMinute } from "@/lib/format";

export function DataGuide({ onClose, data, checkedAt }: { onClose: () => void; data: ScreenerResponse | null; checkedAt: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => previous?.focus({ preventScroll: true }); }, []);
  return <dialog ref={dialog} className="guide-dialog" aria-labelledby="guide-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div><header className="detail-header"><h2 id="guide-title">어떤 숫자를 비교하나요?</h2><button className="icon-button" aria-label="데이터 안내 닫기" onClick={onClose}><X size={18}/></button></header>
    <dl className="guide-definitions">
      <div><dt>P/R · 프로토콜 수익 대비</dt><dd>토큰 가치 ÷ 연간 프로토콜 수익. 서비스 수익 중 재무금고·팀·홀더 등에 귀속되는 몫을 기준으로 합니다. 회사 전체 매출이나 비용을 모두 뺀 순이익과는 다릅니다. 각 종목의 원천 집계 범위는 계산 근거에서 확인할 수 있습니다.</dd></div>
      <div><dt>P/HR · 홀더 환원</dt><dd>직접 분배·시장매입·매입 후 소각·네이티브 수수료 소각·스테이킹 및 락업·투표 조건부 분배 중, 집계 정의와 수령 대상이 확인된 금액입니다. 각 방식과 수령 조건을 따로 표시합니다. 소각은 현금 지급이 아니며, 매입 후 소각을 두 번 더하지 않습니다. 신규 발행량을 차감한 순환원 지표는 아닙니다. 공급자 보상이나 다른 토큰의 수령액이 섞여 분리되지 않으면 보류합니다.</dd></div>
    </dl>
    <p><strong>P/R은 수익 규모, P/HR은 홀더 환원 규모를 비교합니다.</strong> 같은 기간·범위라면 수익에 환원액이 포함될 수 있으므로 두 금액을 더하지 않습니다.</p>
    <p>가상 예시: 시총 1,000억 원, 연간 프로토콜 수익 100억 원, 그중 홀더 환원액 20억 원이면 P/R은 10배, P/HR은 50배입니다. 실제 종목의 수치가 아닙니다.</p>
    <p><a href="https://docs.llama.fi/analysts/data-definitions" target="_blank" rel="noreferrer">DefiLlama의 수익·홀더 수익 정의</a>를 참고하되, 이 스캐너의 P/HR에는 위에 설명한 확인된 환원만 반영합니다.</p>
    <p>분자: 현재 유통 시총 또는 FDV. 분모: 1년은 365일 합계, 짧은 기간은 금액 × 365 ÷ 일수입니다. 24시간은 최근 완료된 UTC 하루(한국 시간 오전 9시~다음 날 오전 9시)입니다. 24시간·7·30·90일은 서로 겹치며 미래 예측이나 과거 주가 배수가 아닙니다. 증가율·증가액은 바로 앞의 동일 기간과 비교합니다.</p>
    <details><summary>종목 상세의 사업 매출 참고 자료</summary><p>P/S는 별도로 확인한 사업 매출에 토큰 가치를 비교합니다. 출처·범위·기준일과 외부 추정 여부를 종목 상세에 표시합니다. 온체인 소각액이나 선불 크레딧 결제액을 사업 매출로 바꿔 넣지 않습니다.</p><p>다른 서비스는 프로토콜 수익 배수를 P/S라고 부르기도 하므로 분모를 확인해야 합니다. 이 앱의 P/R과 별도 사업 매출 P/S는 서로 대체하지 않습니다.</p></details>
    <p>FDV가 없으면 FDV 배수는 비워둡니다. 유통 시총 배수는 상단에서 기준을 바꿔 확인할 수 있습니다. 시총 배수는 FDV 정렬·필터에 섞지 않습니다.</p>
    <p>사업 매출을 확보하지 못한 종목도 P/R·P/HR 자료가 있을 수 있습니다. ‘자료 없음’은 매출이 0이라는 뜻이 아닙니다. 회사 매출과 토큰 가치를 비교할 때는 지분권과 환원 경로를 함께 확인하세요.</p>
    <p>토큰 연결, 집계 정의 변경, 누락 일수, 중복 구성요소를 검사합니다. 제공처의 자료 대조이며 회계감사나 모든 거래의 온체인 검증을 뜻하지 않습니다.</p>
    <details><summary>수집 상태 · 마지막 서버 확인 {checkedAt ? fmtKstMinute(checkedAt) : "확인 중"}</summary>{data?.sources.map(s => <p key={s.url}><span className={s.status === "ok" ? "positive" : "caution-text"}>{s.status === "ok" ? "응답 수신" : "수집 실패"}</span> · <a href={s.url} target="_blank" rel="noreferrer">{new URL(s.url).hostname} {new URL(s.url).searchParams.get("dataType") ?? ""}</a> · {fmtKstMinute(s.observedAt)}</p>)}<p>수집 시각과 원천 생성 시각은 다릅니다. 매출 근거에는 별도 기준일과 재검토 기한이 있습니다.</p></details>
  </div></dialog>;
}

