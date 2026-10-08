import type {EconomicDecision} from "@/lib/economicTypes";

const status={approved:"지표 분류 검토 완료",pending:"경제적 귀속 검토 대기","evidence-unavailable":"검토 증거 조회 미확인","reviewed-unavailable":"검토 후 해당 배수 비적용"};
export function EconomicEvidence({decision:d}:{decision:EconomicDecision}) {
  return <details><summary>{status[d.disposition]} · {d.reason}</summary>
    <p>영향을 받는 계산: {d.affectedOutputs.join(" · ")}</p>
    <p>변경된 정의: {d.changedFields.join(" · ")||"관측된 문구 변경 없음"} · 이 지표의 의존 정의: {d.requiredFields.join(" · ")}</p>
    <p>{d.basis==="legacy-definition-only"?"기존 여섯 정의를 대조한 분류입니다. 계산 코드의 연속성은 검증하지 않았습니다.":d.basis==="reviewed-code-contract"?d.disposition==="evidence-unavailable"?"계산 근거 대조에 필요한 원천 응답을 확보하지 못했습니다.":d.disposition==="approved"?"검토한 지표 정의와 계산 근거가 현재 저장소 파일과 일치합니다. 제공처 서버가 실제로 실행한 버전은 확인하지 못했습니다.":"관측된 정의와 계산 근거를 검토 계약에 대조했으며, 이 지표의 승인 조건이 충족되지 않았습니다. 제공처 서버의 실행 버전은 확인하지 못했습니다.":"경제적 귀속을 검토하지 않은 원천입니다."}</p>
    {d.evidence.reviewedAt&&<p>검토 기준일: {d.evidence.reviewedAt}</p>}
    {d.recipient&&<p>귀속 범위: <span lang="en">{d.recipient}</span></p>}
    {d.funding&&<p>재원: <span lang="en">{d.funding}</span></p>}
    {d.temporal&&<p>인식 기간: <span lang="en">{d.temporal}</span></p>}
    {d.missingProof&&<p>추가로 필요한 근거: <span lang="en">{d.missingProof}</span></p>}
    {d.limits.length>0&&<ul>{d.limits.map((limit,i)=><li key={i} lang="en">{limit}</li>)}</ul>}
    {d.evidence.commit&&<details><summary>원천 파일과 저장된 증거</summary><p>관측 commit: {d.evidence.commit}</p><ul>{d.evidence.dependencyPaths.map(path=><li key={path}><a href={`https://github.com/DefiLlama/dimension-adapters/blob/${d.evidence.commit}/${path}`} target="_blank" rel="noreferrer">{path}</a></li>)}</ul><p>원천 응답 hash: {d.evidence.receiptHashes.join(" · ")}</p><p>정책: {d.policy.algorithm} · {d.policy.artifact} · {d.policy.sha256}</p></details>}
  </details>;
}
