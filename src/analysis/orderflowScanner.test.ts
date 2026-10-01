import { describe, expect, it } from "vitest";
import { classifyOrderFlowSetup } from "./orderflowScanner";
import type { OrderFlowResult } from "./orderflow";

const base: OrderFlowResult = {
  source: "BINANCE_FOOTPRINT", buyVolume: 120, sellVolume: 80, delta: 40, deltaRatio: 0.2,
  cumulativeDelta: 40, buyerPressure: 60, sellerPressure: 40, pressure: "BUYERS",
  pressureTrend: "BUYING PRESSURE INCREASING", imbalance: "BUY", imbalanceRatio: 3.5,
  absorption: "BUYER", absorptionStrength: 80, liquiditySweep: "LOW", liquiditySweepPrice: 100,
  microStructure: "BULLISH", direction: "WAIT", signal: "WAIT", confidence: 0, confirmations: [],
  entry: 110, stop: 105, targets: [117.5,120,125], recentBars: [], footprint: {
    candleTime: 1, intervalMs: 300000, confirmed: true, levels: [], buyVolume: 70, sellVolume: 30,
    delta: 40, deltaRatio: 0.4, poc: 110, stackedBuyImbalances: 2, stackedSellImbalances: 0,
    maxBuyImbalanceRatio: 3.5, maxSellImbalanceRatio: 0, maxPositiveDelta: 40, maxNegativeDelta: 0,
    absorption: "BUYER", absorptionStrength: 80
  }, footprintHistoryCount: 12
};

describe("Order Flow pair scanner", () => {
  it("detects a confirmed pair", () => {
    const row = classifyOrderFlowSetup("BTCUSDT", "5m", {...base, direction:"BUY", signal:"BUY CONFIRMED — CLOSED CANDLE"});
    expect(row.state).toBe("CONFIRMED");
    expect(row.direction).toBe("BUY");
  });
  it("detects a forming setup without calling it confirmed", () => {
    const row = classifyOrderFlowSetup("ETHUSDT", "5m", base);
    expect(row.state).toBe("SETUP");
    expect(row.direction).toBe("BUY");
  });
  it("never scans fallback candle estimates as a real footprint setup", () => {
    const row = classifyOrderFlowSetup("SOLUSDT", "5m", {...base, source:"CANDLE_ESTIMATE_FALLBACK", footprint:null, footprintHistoryCount:0});
    expect(row.state).toBe("WAIT");
    expect(row.direction).toBe("NONE");
  });
});
