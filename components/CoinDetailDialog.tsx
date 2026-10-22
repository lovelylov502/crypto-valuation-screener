"use client";

import { useEffect, useRef } from "react";
import type { CoinScored } from "@/lib/types";
import type { CapitalBasis } from "@/lib/valuationMetrics";
import { CoinDetailOverview } from "./CoinDetailOverview";

export function CoinDetailDialog({ coin, capital, publicationId, snapshotUpdatedAt, onRefreshPublication, onClose, returnFocus, favorite, onFavorite }: {
  coin: CoinScored;
  capital: CapitalBasis;
  publicationId?: string;
  snapshotUpdatedAt?: string;
  onRefreshPublication?: () => void;
  onClose: () => void;
  returnFocus: HTMLButtonElement | null;
  favorite?: boolean;
  onFavorite?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current, overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    dialog?.querySelector<HTMLButtonElement>("[data-detail-close]")?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      returnFocus?.focus({ preventScroll: true });
    };
  }, [returnFocus]);
  return <dialog ref={ref} id={`detail-${coin.slug}`} className="coin-detail-dialog coin-detail-dialog--charts" aria-label={coin.name + " 상세"} aria-describedby="coin-detail-dismiss-hint"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(el => el.getClientRects().length && !el.closest('details:not([open]) :not(summary)'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <div className="coin-detail-surface"><CoinDetailOverview coin={coin} capital={capital} publicationId={publicationId} snapshotUpdatedAt={snapshotUpdatedAt} onRefreshPublication={onRefreshPublication} onClose={onClose} favorite={favorite} onFavorite={onFavorite}/></div>
    <p className="sr-only" id="coin-detail-dismiss-hint">팝업 밖을 클릭하거나 Escape 키를 누르면 닫힙니다.</p>
  </dialog>;
}
