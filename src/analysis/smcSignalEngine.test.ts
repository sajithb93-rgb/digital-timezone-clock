import { describe, expect, it } from "vitest";
import { generateSMCSignal, isConfirmedSMCSignal } from "./smcSignalEngine";
import type { Candle } from "./engine";

function candles(rows: Array<[number,number,number,number]>): Candle[] {
  return rows.map(([open, high, low, close], time) => ({ time, open, high, low, close, volume: 100, closed: true }));
}

describe("SMC signal engine", () => {
  it("never confirms an open candle", () => {
    const c = candles(Array.from({ length: 60 }, (_, i) => [100+i*0.1, 101+i*0.1, 99+i*0.1, 100+i*0.1]));
    c[c.length - 1].closed = false;
    const s = generateSMCSignal(c);
    expect(s?.asOf).toBeLessThan(c.length - 1);
  });

  it("rejects invalid trade geometry", () => {
    expect(isConfirmedSMCSignal(null)).toBe(false);
    const s: any = { status:"ACTIVE", direction:"BUY", entry:100, stop:101, targets:[110,120] };
    expect(isConfirmedSMCSignal(s)).toBe(false);
  });
});
