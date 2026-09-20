"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function SettingsDialog({ title, onClose, children, wide = false, headerAction, footerNote = "변경 사항은 이 브라우저에 자동 저장됩니다." }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; headerAction?: ReactNode; footerNote?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const dialog = ref.current, overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = overflow; prior?.focus({preventScroll:true}); };
  }, []);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("[data-dialog-close]")?.focus(); },[title]);
  return <dialog ref={ref} className={"settings-dialog" + (wide ? " settings-wide" : "")} aria-label={title} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e=>{
    if (e.key !== "Tab") return;
    const controls=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]')].filter(el=>el.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }}>
    <div className="settings-content"><header><h2>{title}</h2><div className="settings-header-actions">{headerAction}<button data-dialog-close className="icon-button" aria-label={title + " 닫기"} onClick={onClose}><X size={19}/></button></div></header>
      <div className="settings-body">{children}</div>
      <footer><span>{footerNote}</span><button className="button primary" onClick={onClose}>완료</button></footer>
    </div>
  </dialog>;
}
