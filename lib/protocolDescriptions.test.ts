import { describe, expect, it } from "vitest";
import { koreanDescription } from "./protocolDescriptions";

describe("Korean protocol descriptions", () => {
  it("preserves Safe as a project name", () => {
    const source = "Safe is the most trusted decentralized custody protocol and collective asset management platform on Ethereum and the EVM";
    const translated = koreanDescription(source);
    expect(translated).toMatch(/^Safe는/);
    expect(translated).toContain("Ethereum");
    expect(translated).toContain("EVM");
    expect(translated).not.toContain("안전은");
  });

  it("does not attach a stale translation to new or changed source text", () => {
    expect(koreanDescription("Safe has launched a different product.")).toBeNull();
    expect(koreanDescription("toString")).toBeNull();
    expect(koreanDescription("")).toBeNull();
    expect(koreanDescription(null)).toBeNull();
    expect(koreanDescription(undefined)).toBeNull();
  });
});
