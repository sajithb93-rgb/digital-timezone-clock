import { describe, expect, it } from "vitest";
import { generateSMCSignal, isConfirmedSMCSignal } from "./smcSignalEngine";
import { analyzeSMC, type Candle } from "./engine";

function candles(rows: Array<[number, number, number, number]>): Candle[] {
  return rows.map(([open, high, low, close], time) => ({
    time,
    open,
    high,
    low,
    close,
    volume: 100,
    closed: true,
  }));
}

describe("SMC signal engine", () => {
  it("does not use an open candle as the analysis endpoint", () => {
    const c = candles(Array.from({ length: 80 }, (_, i) => [
      100 + i * 0.1,
      101 + i * 0.1,
      99 + i * 0.1,
      100 + i * 0.1,
    ]));
    c[c.length - 1].closed = false;
    const s = generateSMCSignal(c);
    expect(s === null || s.asOf < c.length - 1).toBe(true);
  });

  it("rejects invalid BUY geometry", () => {
    const invalid = {
      status: "ACTIVE" as const,
      direction: "BUY" as const,
      entry: 100,
      stop: 101,
      targets: [110, 120],
      rr: 1.5,
      confidence: 90,
      asOf: 50,
      confirmations: [],
      sweepIndex: 1,
      structureIndex: 2,
      zoneIndex: 3,
      zoneType: "FVG" as const,
      entryZone: { low: 99, high: 101 },
      premiumDiscount: "Discount" as const,
    };
    expect(isConfirmedSMCSignal(invalid)).toBe(false);
  });

  it("keeps causal indices stable when the latest open candle is excluded", () => {
    const c = candles(Array.from({ length: 100 }, (_, i) => [
      100 + Math.sin(i / 5),
      101 + Math.sin(i / 5),
      99 + Math.sin(i / 5),
      100 + Math.sin(i / 5),
    ]));
    c[c.length - 1].closed = false;

    const prefix = c.slice(0, -1);
    const result = analyzeSMC(prefix);
    expect(result.asOf).toBe(prefix.length - 1);

    const direct = generateSMCSignal(c, c.length - 2, "5m");
    expect(direct === null || direct.asOf <= c.length - 2).toBe(true);
    if (direct) {
      expect(direct.sweepIndex).toBeLessThanOrEqual(direct.asOf);
      expect(direct.structureIndex).toBeLessThanOrEqual(direct.asOf);
      expect(direct.zoneIndex).toBeLessThanOrEqual(direct.asOf);
    }
  });

  it("never accepts an earlier open candle as confirmed history", () => {
    const c = candles(Array.from({ length: 80 }, (_, i) => [
      100 + i * 0.1,
      101 + i * 0.1,
      99 + i * 0.1,
      100 + i * 0.1,
    ]));
    c[60].closed = false;
    const result = analyzeSMC(c);
    expect(result.asOf).toBeLessThan(60);
  });

  it("rejects targets that do not meet minimum RR", () => {
    const invalid = {
      status: "ACTIVE" as const,
      direction: "SELL" as const,
      entry: 100,
      stop: 101,
      targets: [99, 98],
      rr: 1,
      confidence: 90,
      asOf: 50,
      confirmations: [],
      sweepIndex: 1,
      structureIndex: 2,
      zoneIndex: 3,
      zoneType: "OB" as const,
      entryZone: { low: 99, high: 101 },
      premiumDiscount: "Premium" as const,
    };
    expect(isConfirmedSMCSignal(invalid)).toBe(false);
  });
});
