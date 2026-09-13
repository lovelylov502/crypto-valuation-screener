import { describe, expect, it } from "vitest";
import { parsePageSize, pageNumbers } from "./pagination";

describe("list navigation", () => {
  it("defaults to 100 and restores only supported saved sizes", () => {
    for (const invalid of [null, "", "30", "0", "-50", "Infinity", "oops"]) expect(parsePageSize(invalid)).toBe(100);
    for (const size of [50, 100, 200]) expect(parsePageSize(String(size))).toBe(size);
  });
  it("makes every page directly available for a small result set", () => {
    expect(pageNumbers(2, 4)).toEqual([1, 2, 3, 4]);
    expect(pageNumbers(1, 1)).toEqual([1]);
  });
  it("keeps the current, first and last pages reachable across large result sets", () => {
    for (let current = 1; current <= 15; current++) {
      const numbers = pageNumbers(current, 15).filter((n): n is number => typeof n === "number");
      expect(numbers).toContain(1);
      expect(numbers).toContain(current);
      expect(numbers).toContain(15);
      expect(numbers).toEqual([...new Set(numbers)].sort((a, b) => a - b));
      expect(numbers.length).toBeLessThanOrEqual(7);
    }
  });
});
