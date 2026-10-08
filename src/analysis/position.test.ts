import { describe, expect, it } from "vitest";
import { getPositionExecutionState, isValidPositionGeometry } from "./position";

describe("auto long/short position geometry", () => {
  it("enforces BUY geometry and RR", () => {
    expect(isValidPositionGeometry("BUY", 100, 95, 110, 1.5)).toBe(true);
    expect(isValidPositionGeometry("BUY", 100, 101, 110, 1.5)).toBe(false);
    expect(isValidPositionGeometry("BUY", 100, 95, 105, 1.5)).toBe(false);
  });
  it("enforces SELL geometry and RR", () => {
    expect(isValidPositionGeometry("SELL", 100, 105, 90, 1.5)).toBe(true);
    expect(isValidPositionGeometry("SELL", 100, 95, 90, 1.5)).toBe(false);
    expect(isValidPositionGeometry("SELL", 100, 105, 95, 1.5)).toBe(false);
  });
  it("classifies BUY execution state", () => {
    expect(getPositionExecutionState("BUY", 99, 100, 95, 110)).toBe("PENDING");
    expect(getPositionExecutionState("BUY", 103, 100, 95, 110)).toBe("ACTIVE");
    expect(getPositionExecutionState("BUY", 111, 100, 95, 110)).toBe("TP1_HIT");
    expect(getPositionExecutionState("BUY", 94, 100, 95, 110)).toBe("STOP_HIT");
  });
  it("classifies SELL execution state", () => {
    expect(getPositionExecutionState("SELL", 101, 100, 105, 90)).toBe("PENDING");
    expect(getPositionExecutionState("SELL", 97, 100, 105, 90)).toBe("ACTIVE");
    expect(getPositionExecutionState("SELL", 89, 100, 105, 90)).toBe("TP1_HIT");
    expect(getPositionExecutionState("SELL", 106, 100, 105, 90)).toBe("STOP_HIT");
  });
});
