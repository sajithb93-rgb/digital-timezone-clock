import { describe, expect, it } from "vitest";
import { detectRegime, flowSnapshot } from "./advanced";

const candles = (closed?: boolean) => [
  ...Array.from({ length: 20 }, (_, i) => ({
    time: i + 1, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i,
    volume: 1000, closed: true,
  })),
  { time: 21, open: 10000, high: 12000, low: 9000, close: 11000, volume: 999999, closed },
];

describe("advanced closed-candle guards", () => {
  it("does not let an unfinished candle alter flow snapshot", () => {
    const base = candles(true).slice(0, 20);
    const withOpen = candles(false);
    expect(flowSnapshot(withOpen)).toEqual(flowSnapshot(base));
  });

  it("does not let an unfinished candle alter market regime", () => {
    const base = candles(true).slice(0, 20);
    const withOpen = candles(false);
    expect(detectRegime(withOpen)).toEqual(detectRegime(base));
  });
});
