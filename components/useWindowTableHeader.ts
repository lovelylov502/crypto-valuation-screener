import { useEffect, useRef } from "react";

// Move the real header inside the horizontal scroller. CSS sticky alone would
// attach it to that scroller instead of the document, even without a height cap.
export function useWindowTableHeader() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = ref.current;
    const table = scroller?.querySelector("table");
    const head = table?.tHead;
    if (!scroller || !table || !head) return;
    let frame = 0;
    const update = () => {
      const top = table.getBoundingClientRect().top;
      const offset = Math.max(0, Math.min(-top, table.offsetHeight - head.offsetHeight));
      head.style.transform = `translateY(${offset}px)`;
      frame = 0;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(table);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  return ref;
}
