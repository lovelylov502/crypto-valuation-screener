"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { SortKey } from "@/lib/screenerColumns";

interface Drag {
  key: SortKey; over: SortKey | null; zone: string; x: number; y: number; moved: boolean;
}

/** Pointer capture works with mouse, pen and touch; keyboard arrows remain available. */
export function useColumnReorder(columns: SortKey[], onMove: (from: SortKey, to: SortKey) => void) {
  const active = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const cancel = () => { active.current = null; setDrag(null); };
  useEffect(() => {
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  const handle = (key: SortKey, zone: string) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      e.currentTarget.focus({ preventScroll: true });
      e.currentTarget.setPointerCapture(e.pointerId);
      active.current = { key, over: key, zone, x: e.clientX, y: e.clientY, moved: false };
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const current = active.current;
      if (!current) return;
      if (!current.moved && Math.hypot(e.clientX - current.x, e.clientY - current.y) < 5) return;
      current.moved = true;
      const container = e.currentTarget.closest<HTMLElement>("[data-reorder-zone]");
      if (container) {
        const bounds = container.getBoundingClientRect();
        if (zone === "columns") container.scrollTop += e.clientY < bounds.top + 24 ? -16 : e.clientY > bounds.bottom - 24 ? 16 : 0;
        else container.scrollLeft += e.clientX < bounds.left + 32 ? -20 : e.clientX > bounds.right - 32 ? 20 : 0;
      }
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-column-key]");
      const over = target?.closest<HTMLElement>("[data-reorder-zone]")?.dataset.reorderZone === zone ? target.dataset.columnKey as SortKey : null;
      current.over = over && columns.includes(over) ? over : null;
      setDrag({ ...current });
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      const current = active.current;
      cancel();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (current?.moved && current.over) onMove(current.key, current.over);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      const index = columns.indexOf(key);
      const offset = ["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : ["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : 0;
      if (!offset) return;
      e.preventDefault();
      const target = columns[index + offset];
      if (target) onMove(key, target);
    },
  });
  return { drag, handle };
}
