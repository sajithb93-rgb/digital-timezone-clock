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
  if (result.source !== "BINANCE_FOOTPRINT" || !fp) {
    return {symbol,timeframe,state:"WAIT",direction:"NONE",score:0,price:result.entry,deltaRatio:result.deltaRatio,pressure:result.pressure,liquiditySweep:result.liquiditySweep,absorption:result.absorption,footprintBars:result.footprintHistoryCount,reason:"Waiting for 12 confirmed Binance footprint bars"};
  }
  // A missing diagnostic is not the same as a passed diagnostic. Scanner
  // confirmation must rely on explicit evidence from the analysis engine.
  const diagnosticPassed=(key:string)=>result.diagnostics.find(d=>d.key===key)?.passed===true;
  const geometryValid=diagnosticPassed("trade_geometry");
  const targetQualityValid=diagnosticPassed("target_quality");
  const recentSweepBuyValid=diagnosticPassed("sweep_recent_buy");
  const recentSweepSellValid=diagnosticPassed("sweep_recent_sell");
  const sweepIntegrityBuyValid=diagnosticPassed("sweep_integrity_buy");
  const sweepIntegritySellValid=diagnosticPassed("sweep_integrity_sell");
  const coreDataValid=["closed","history","exact","footprint_history","footprint_coverage","latest_fp_coverage","latest_fp"].every(diagnosticPassed);
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

  const directionGateValid = direction==="BUY"
    ? recentSweepBuyValid && sweepIntegrityBuyValid
    : direction==="SELL"
      ? recentSweepSellValid && sweepIntegritySellValid
      : false;
  let state: OrderFlowScanState = "WAIT";
  if (result.direction !== "WAIT" && geometryValid && targetQualityValid && coreDataValid && directionGateValid) state = "CONFIRMED";
  else if (!geometryValid || !targetQualityValid || !coreDataValid || !directionGateValid) state = "WAIT";
  else if (direction !== "NONE" && score >= 75) state = "SETUP";
  else if (direction !== "NONE" && score >= 50) state = "WATCH";
  
  const missing = direction === "BUY"
    ? ["buyers pressure", "positive delta", "low sweep", "buyer absorption", "footprint delta", "3x buy imbalance", "2 stacked buys", "bullish break"].filter((_, i) => !buyChecks[i])
    : direction === "SELL"
      ? ["sellers pressure", "negative delta", "high sweep", "seller absorption", "footprint delta", "3x sell imbalance", "2 stacked sells", "bearish break"].filter((_, i) => !sellChecks[i])
      : [];
  const reason = !geometryValid
    ? "Order Flow confluence present · blocked by invalid entry/SL/TP geometry"
    : !targetQualityValid
      ? "Order Flow confluence present · blocked by target quality"
    : !coreDataValid
      ? "Order Flow confluence present · blocked by incomplete confirmed footprint data"
    : !directionGateValid
      ? "Order Flow confluence present · blocked by stale/invalid liquidity sweep"
    : state === "CONFIRMED"
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
