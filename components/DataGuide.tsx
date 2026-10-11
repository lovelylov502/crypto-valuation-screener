"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { ScreenerResponse } from "@/lib/types";
import { fmtKstMinute } from "@/lib/format";
import { BRAND } from "@/lib/brand";

export function DataGuide({ onClose, data, checkedAt }: { onClose: () => void; data: ScreenerResponse | null; checkedAt: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => previous?.focus({ preventScroll: true }); }, []);
  return <dialog ref={dialog} className="guide-dialog" aria-labelledby="guide-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div><header className="detail-header"><h2 id="guide-title">어떤 숫자를 비교하나요?</h2><button className="icon-button" aria-label="데이터 안내 닫기" onClick={onClose}><X size={18}/></button></header>
    <p className="guide-brand">{BRAND.name} · {BRAND.koreanName}<span>{BRAND.tagline}</span></p>
    <dl className="guide-definitions">
      <div><dt>Revenue 원천 금액</dt><dd>DefiLlama가 제공한 금액입니다. 프로토콜 수익·홀더 환원·추정 손익 등 종목마다 집계 성격이 달라, 수익 분류와 검토 상태를 따로 표시합니다. 일별 이력이 완전하면 완료 UTC 합계를, 이력이 부족하면 제공처 기간 합계를 표시합니다.</dd></div>
      <div><dt>P/R · 원천 참고 배수</dt><dd>현재 유통 시총 또는 FDV를 표시한 Revenue의 연환산액으로 나눈 값입니다. 수익 분류 검토 대기 중에도 원천 금액으로 계산합니다. 미검토 금액을 사업 매출이나 순이익으로 확정하는 지표는 아닙니다.</dd></div>
      <div><dt>P/HR · 원천 참고 배수</dt><dd>현재 유통 시총 또는 FDV를 표시한 Holders Revenue의 연환산액으로 나눈 값입니다. 제공처 전체 합계에 직접 분배·시장매입·소각·조건부 분배가 포함될 수 있습니다. 수령 대상·재원·실행 검토는 별도로 표시하며, 원천 합계를 일반 보유자의 현금 지급액으로 해석하지 않습니다.</dd></div>
    </dl>
    <p><strong>참고 배수와 수익 분류·검토 상태를 함께 확인하세요.</strong> Revenue와 Holders Revenue의 금액은 서로 겹칠 수 있으므로 더하지 않습니다.</p>
    <p>가상 예시: 시총 1,000억 원, 연간 Revenue 100억 원, 그중 Holders Revenue 20억 원이면 원천 참고 P/R은 10배, P/HR은 50배입니다. 실제 종목의 수치가 아닙니다.</p>
    <p><a href="https://docs.llama.fi/analysts/data-definitions" target="_blank" rel="noreferrer">DefiLlama의 수익·홀더 수익 정의</a>와 각 종목의 원천 설명에서 집계 범위를 확인할 수 있습니다.</p>
    <p>분자: 현재 유통 시총 또는 FDV. 짧은 기간의 분모는 표시 금액 × 365 ÷ 일수입니다. 완료 UTC 하루는 한국 시간 오전 9시~다음 날 오전 9시이며, 별도 표시한 제공처 기간 합계는 집계 범위가 다를 수 있습니다. 원천 1년 합계는 365일 확보를 보장하지 않습니다. 단기 연환산은 미래 예측이 아닙니다. 증가율·증가액은 검토된 바로 앞의 동일 기간과 비교합니다.</p>
    <details><summary>종목 상세의 사업 매출 참고 자료</summary><p>P/S는 별도로 확인한 사업 매출에 토큰 가치를 비교합니다. 출처·범위·기준일과 외부 추정 여부를 종목 상세에 표시합니다. 온체인 소각액이나 선불 크레딧 결제액을 사업 매출로 바꿔 넣지 않습니다.</p><p>다른 서비스는 프로토콜 수익 배수를 P/S라고 부르기도 하므로 분모를 확인해야 합니다. 이 앱의 P/R과 별도 사업 매출 P/S는 서로 대체하지 않습니다.</p></details>
    <p>FDV가 없으면 FDV 배수는 비워둡니다. 유통 시총 배수는 상단에서 기준을 바꿔 확인할 수 있습니다. 시총 배수는 FDV 정렬·필터에 섞지 않습니다.</p>
    <p>사업 매출을 확보하지 못한 종목도 P/R·P/HR 자료가 있을 수 있습니다. ‘자료 없음’은 매출이 0이라는 뜻이 아닙니다. 회사 매출과 토큰 가치를 비교할 때는 지분권과 환원 경로를 함께 확인하세요.</p>
    <p>토큰 미연결, 분자 미확인, 원천 금액 0 이하와 일부 구성요소만 확보한 합계는 참고 배수를 계산하지 않습니다. 정의 변경과 누락 일수는 자료 상태로 표시합니다. 제공처의 자료 대조이며 회계감사나 모든 거래의 온체인 검증을 뜻하지 않습니다.</p>
    {data?.collection && <p>전체 {data.collection.projects.toLocaleString()}개 프로젝트 · 원천 항목 {data.collection.sourceSlugs.toLocaleString()}개 대조. 30일 원천 금액 {data.collection.sourceRevenue30d.toLocaleString()}개 · 표시 {data.collection.displayedRevenue30d.toLocaleString()}개(일별 이력 포함, 부분 집계 {data.collection.partialRevenue30d.toLocaleString()}개). CoinGecko 연결 자산 {data.collection.gecko.requested.toLocaleString()}개 중 응답 {data.collection.gecko.received.toLocaleString()}개 · 제공처 미반환 {data.collection.gecko.notReturned.toLocaleString()}개 · 조회 실패 {data.collection.gecko.failed.toLocaleString()}개. 시총 순위로 조회 대상을 자르지 않습니다.</p>}
    <details><summary>수집 상태 · 마지막 서버 확인 {checkedAt ? fmtKstMinute(checkedAt) : "확인 중"}</summary>{data?.sources.map(s => <p key={s.url}><span className={s.status === "ok" ? "positive" : "caution-text"}>{s.status === "ok" ? "응답 수신" : s.status === "withheld" ? `보완 보류 · ${s.reason === "value_conflict" ? "기존 날짜 금액 불일치" : "부모·하위 집계 범위 불일치"}` : "수집 실패"}</span> · <a href={s.url} target="_blank" rel="noreferrer">{new URL(s.url).hostname}{new URL(s.url).pathname} {new URL(s.url).searchParams.get("dataType") ?? ""}</a> · {fmtKstMinute(s.observedAt)}</p>)}<p>부모 합산 범위가 다르면 해당 보완 이력은 사용하지 않고 기존 구성요소 자료를 유지합니다. 수집 시각과 원천 생성 시각은 다릅니다. 매출 근거에는 별도 기준일과 재검토 기한이 있습니다.</p></details>
  </div></dialog>;
}

