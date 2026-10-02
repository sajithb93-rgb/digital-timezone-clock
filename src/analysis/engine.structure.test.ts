import { describe, expect, it } from "vitest";
import { classifyProtectedStructureBreak, equalLevels, type Pivot } from "./engine";

describe("protected SMC structure breaks", () => {
  it("does not classify a newer unprotected low as CHOCH", () => {
    expect(
      classifyProtectedStructureBreak("bullish", "low", "low", 10, 14),
    ).toBeNull();
  });

  it("classifies the actual protected low break as CHOCH", () => {
    expect(
      classifyProtectedStructureBreak("bullish", "low", "low", 10, 10),
    ).toBe("CHOCH");
  });

  it("keeps continuation breaks as BOS", () => {
    expect(
      classifyProtectedStructureBreak("bullish", "high", "low", 10, 12),
    ).toBe("BOS");
    expect(
      classifyProtectedStructureBreak("bearish", "low", "high", 10, 12),
    ).toBe("BOS");
  });
  it("keeps a transitive equal-level price chain in one liquidity cluster", () => {
    const pivots: Pivot[] = [
      { index: 3, price: 100, type: "H", confirmedAt: 3 },
      { index: 8, price: 100.4, type: "H", confirmedAt: 8 },
      { index: 13, price: 100.8, type: "H", confirmedAt: 13 },
    ];
    const levels = equalLevels(pivots, 0.45);
    expect(levels).toHaveLength(1);
    expect(levels[0].index).toBe(13);
  });
});
