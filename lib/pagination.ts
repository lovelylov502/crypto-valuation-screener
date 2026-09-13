export const PAGE_SIZES = [50, 100, 200] as const;
export const PAGE_SIZE_KEY = "crypto-screener-page-size-v1";

export function parsePageSize(value: string | null): number {
  const size = Number(value);
  return PAGE_SIZES.some(n => n === size) ? size : 100;
}

export function pageNumbers(current: number, total: number): (number | "gap")[] {
  if (total <= 9) return Array.from({ length: total }, (_, i) => i + 1);
  const start = Math.max(2, Math.min(current - 2, total - 5));
  const end = Math.min(total - 1, Math.max(current + 2, 6));
  return [1, ...(start > 2 ? ["gap" as const] : []),
    ...Array.from({ length: end - start + 1 }, (_, i) => start + i),
    ...(end < total - 1 ? ["gap" as const] : []), total];
}
