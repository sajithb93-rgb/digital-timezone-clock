import { describe, expect, it } from "vitest";
import { classifyProtectedStructureBreak } from "./engine";

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
});
