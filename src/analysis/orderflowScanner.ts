import type { OrderFlowResult } from "./orderflow";

export type OrderFlowScanState = "CONFIRMED" | "SETUP" | "WATCH" | "WAIT";
export type OrderFlowScanRow = {
  symbol: string;
  timeframe: string;
  state: OrderFlowScanState;
  direction: "BUY" | "SELL" | "NONE";
  score: number;
  price: number | null;
  deltaRatio: number;
  pressure: string;
  liquiditySweep: string;
  absorption: string;
  footprintBars: number;
  reason: string;
};

export function classifyOrderFlowSetup(symbol: string, timeframe: string, result: OrderFlowResult): OrderFlowScanRow {
  const fp = result.footprint;
  const buyChecks = [
    result.pressure === "BUYERS",
    result.deltaRatio >= 0.08,
    result.liquiditySweep === "LOW",
    result.absorption === "BUYER",
    !!fp && fp.confirmed && fp.deltaRatio >= 0.08,
    !!fp && fp.maxBuyImbalanceRatio >= 3,
    !!fp && fp.stackedBuyImbalances >= 2,
    result.microStructure === "BULLISH",
  ];
  const sellChecks = [
    result.pressure === "SELLERS",
    result.deltaRatio <= -0.08,
    result.liquiditySweep === "HIGH",
    result.absorption === "SELLER",
    !!fp && fp.confirmed && fp.deltaRatio <= -0.08,
    !!fp && fp.maxSellImbalanceRatio >= 3,
    !!fp && fp.stackedSellImbalances >= 2,
    result.microStructure === "BEARISH",
  ];
  const buyScore = buyChecks.filter(Boolean).length;
  const sellScore = sellChecks.filter(Boolean).length;
  const direction: OrderFlowScanRow["direction"] =
    buyScore > sellScore && buyScore >= 3 ? "BUY" :
    sellScore > buyScore && sellScore >= 3 ? "SELL" : "NONE";
  const score = Math.round(Math.max(buyScore, sellScore) / buyChecks.length * 100);

  let state: OrderFlowScanState = "WAIT";
  if (result.direction !== "WAIT") state = "CONFIRMED";
  else if (direction !== "NONE" && score >= 75) state = "SETUP";
  else if (direction !== "NONE" && score >= 50) state = "WATCH";
  
  const missing = direction === "BUY"
    ? ["buyers pressure", "positive delta", "low sweep", "buyer absorption", "footprint delta", "3x buy imbalance", "2 stacked buys", "bullish break"].filter((_, i) => !buyChecks[i])
    : direction === "SELL"
      ? ["sellers pressure", "negative delta", "high sweep", "seller absorption", "footprint delta", "3x sell imbalance", "2 stacked sells", "bearish break"].filter((_, i) => !sellChecks[i])
      : [];
  const reason = state === "CONFIRMED"
    ? result.signal
    : state === "SETUP"
      ? `${direction} setup forming · waiting for ${missing.slice(0, 2).join(" + ") || "final close confirmation"}`
      : state === "WATCH"
        ? `${direction} watch · ${Math.max(buyScore, sellScore)}/8 confluences active`
        : "No qualifying Order Flow setup";

  return {
    symbol,
    timeframe,
    state,
    direction,
    score,
    price: result.entry,
    deltaRatio: result.deltaRatio,
    pressure: result.pressure,
    liquiditySweep: result.liquiditySweep,
    absorption: result.absorption,
    footprintBars: result.footprintHistoryCount,
    reason,
  };
}
