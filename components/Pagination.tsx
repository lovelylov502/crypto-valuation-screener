import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZES, pageNumbers } from "@/lib/pagination";

export function Pagination({ total, page, size, position, onPage, onSize }: {
  total: number;
  page: number;
  size: number;
  position: "top" | "bottom";
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <div className={`pagination pagination-${position}`}>
    <div className="page-summary">
      <label htmlFor={`page-size-${position}`}>페이지당
        <select id={`page-size-${position}`} value={size} onChange={e => onSize(Number(e.target.value))}>
          {PAGE_SIZES.map(n => <option value={n} key={n}>{n}개</option>)}
        </select>
      </label>
      <span aria-live="polite">{total ? (page - 1) * size + 1 : 0}–{Math.min(page * size, total)} / {total}개</span>
    </div>
    <nav aria-label={`결과 페이지 ${position === "top" ? "위" : "아래"}`}>
      <button className="page-button" aria-label="이전 페이지" disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>
      {pageNumbers(page, pages).map((n, i) => n === "gap"
        ? <span className="page-gap" key={`gap-${i}`}>…</span>
        : <button className="page-button" key={n} aria-label={`${n}페이지`} aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}>{n}</button>)}
      <button className="page-button" aria-label="다음 페이지" disabled={page === pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button>
    </nav>
  </div>;
}
