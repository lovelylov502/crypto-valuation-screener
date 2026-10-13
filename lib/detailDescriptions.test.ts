import { describe, expect, it } from "vitest";
import { koreanDetailDescription } from "./detailDescriptions";
import { koreanDescription } from "./protocolDescriptions";
import translations from "./protocolDescriptions.detail.ko.json";

describe("display-only Korean introductions", () => {
  it("translates missing introductions without changing collected descriptions", () => {
    const source = "QuickSwap is a next-gen DEX and Lending for DeFi.";
    expect(koreanDetailDescription(source)).toBe("QuickSwap은 DeFi를 위한 차세대 DEX와 대출 서비스입니다.");
    expect(koreanDescription(source)).toBeNull();
    expect(koreanDetailDescription(source.replace("DeFi", "a different product"))).toBeNull();
    expect(koreanDetailDescription("toString")).toBeNull();
    expect(koreanDetailDescription(null)).toBeNull();
  });

  it("preserves borrowing, lending and perpetual-futures terminology", () => {
    const source = "Hyperliquid is a Layer 1 blockchain best known for perpetual futures and spot trading. Beyond its flagship decentralized exchange (DEX), the ecosystem supports borrowing, lending, RWAs, and a full-fledged EVM.";
    expect(koreanDetailDescription(source)).toContain("무기한 선물");
    expect(koreanDetailDescription(source)).toContain("차입, 대출");
    expect(koreanDetailDescription("Trade options & perps. Earn yield with restaking derivatives.")).toContain("옵션과 무기한 선물");
  });

  it("contains Korean text without unresolved translation placeholders", () => {
    const invalid = Object.entries(translations).filter(([, value]) => !/[가-힣]/.test(value) || /⟬P\d+X|⟦TOVENIT/.test(value)
      || (value.match(/\b(?:is|are|the|a|an|with|by|for|to|and|that|on|of|this|aim|has|we|our|users|allows)\b/gi) ?? []).length >= 4);
    expect(invalid).toEqual([]);
  });
});
