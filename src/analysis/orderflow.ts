import type { Candle } from "./engine";

export type OrderFlowPressure = "BUYERS" | "SELLERS" | "BALANCED";
export type OrderFlowDirection = "BUY" | "SELL" | "WAIT";
export type OrderFlowAbsorption = "BUYER" | "SELLER" | "NONE";
export type LiquiditySweep = "HIGH" | "LOW" | "NONE";
export type MicroStructure = "BULLISH" | "BEARISH" | "NEUTRAL";
export type OrderFlowDataSource = "BINANCE_TAKER_FLOW" | "CANDLE_ESTIMATE_FALLBACK";

export type OrderFlowBar = {
  index: number;
  time: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  deltaRatio: number;
  buyerPressure: number;
  sellerPressure: number;
  imbalanceRatio: number;
  imbalance: "BUY" | "SELL" | "NONE";
  absorption: OrderFlowAbsorption;
  absorptionStrength: number;
  liquiditySweep: LiquiditySweep;
  sweepPrice: number | null;
  microStructure: MicroStructure;
};

export type OrderFlowResult = {
  source: OrderFlowDataSource;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  deltaRatio: number;
  cumulativeDelta: number;
  buyerPressure: number;
  sellerPressure: number;
  pressure: OrderFlowPressure;
  pressureTrend: string;
  imbalance: "BUY" | "SELL" | "NONE";
  imbalanceRatio: number;
  absorption: OrderFlowAbsorption;
  absorptionStrength: number;
  liquiditySweep: LiquiditySweep;
  liquiditySweepPrice: number | null;
  microStructure: MicroStructure;
  direction: OrderFlowDirection;
  signal: string;
  confidence: number;
  confirmations: string[];
  entry: number | null;
  stop: number | null;
  targets: number[];
  recentBars: OrderFlowBar[];
};

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function safe(n: number) {
  return Number.isFinite(n) ? n : 0;
}

function barRange(c: Candle) {
  return Math.max(c.high - c.low, 1e-12);
}

function avg(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function volumeSplit(c: Candle) {
  if (Number.isFinite(c.takerBuyVolume)) {
    const buy = Math.max(0, Math.min(c.volume, c.takerBuyVolume!));
    return { buy, sell: Math.max(0, c.volume - buy), exact: true };
  }

  // Fallback is intentionally explicit: it is not true bid/ask order flow.
  const range = barRange(c);
  const bodyBias = Math.max(-1, Math.min(1, (c.close - c.open) / range));
  const buyShare = 0.5 + bodyBias * 0.25;
  const buy = c.volume * buyShare;
  return { buy, sell: Math.max(0, c.volume - buy), exact: false };
}

function analyzeBar(candles: Candle[], i: number, buy: number, sell: number): OrderFlowBar {
  const c = candles[i];
  const total = Math.max(buy + sell, 1e-12);
  const delta = buy - sell;
  const deltaRatio = delta / total;
  const buyerPressure = buy / total * 100;
  const sellerPressure = sell / total * 100;

  const imbalanceRatio = Math.max(buy, sell) / Math.max(Math.min(buy, sell), 1e-12);
  const imbalance: OrderFlowBar["imbalance"] =
    buy > sell && imbalanceRatio >= 1.6 ? "BUY" :
    sell > buy && imbalanceRatio >= 1.6 ? "SELL" : "NONE";

  const range = barRange(c);
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const closeLocation = (c.close - c.low) / range;

  // Absorption = aggressive flow appears but price does not continue in that direction.
  const sellerAbsorbed =
    buy / total >= 0.60 &&
    (upperWick >= range * 0.25 || closeLocation <= 0.42) &&
    (c.close <= c.open || upperWick >= Math.max(body, range * 0.1));

  const buyerAbsorbed =
    sell / total >= 0.60 &&
    (lowerWick >= range * 0.25 || closeLocation >= 0.58) &&
    (c.close >= c.open || lowerWick >= Math.max(body, range * 0.1));

  let absorption: OrderFlowAbsorption = "NONE";
  let absorptionStrength = 0;

  if (sellerAbsorbed && !buyerAbsorbed) {
    absorption = "SELLER";
    absorptionStrength = clamp(buyerPressure + Math.min(25, upperWick / range * 100) - 45);
  } else if (buyerAbsorbed && !sellerAbsorbed) {
    absorption = "BUYER";
    absorptionStrength = clamp(sellerPressure + Math.min(25, lowerWick / range * 100) - 45);
  }

  let liquiditySweep: LiquiditySweep = "NONE";
  let sweepPrice: number | null = null;
  const lookbackStart = Math.max(0, i - 10);
  const history = candles.slice(lookbackStart, i);

  if (history.length >= 3) {
    const previousHigh = Math.max(...history.map(x => x.high));
    const previousLow = Math.min(...history.map(x => x.low));
    if (c.high > previousHigh && c.close < previousHigh) {
      liquiditySweep = "HIGH";
      sweepPrice = previousHigh;
    } else if (c.low < previousLow && c.close > previousLow) {
      liquiditySweep = "LOW";
      sweepPrice = previousLow;
    }
  }

  const structureStart = Math.max(0, i - 3);
  const structure = candles.slice(structureStart, i);
  let microStructure: MicroStructure = "NEUTRAL";
  if (structure.length >= 2) {
    const previousHigh = Math.max(...structure.map(x => x.high));
    const previousLow = Math.min(...structure.map(x => x.low));
    if (c.close > previousHigh) microStructure = "BULLISH";
    else if (c.close < previousLow) microStructure = "BEARISH";
  }

  return {
    index: i,
    time: c.time,
    buyVolume: buy,
    sellVolume: sell,
    delta,
    deltaRatio,
    buyerPressure,
    sellerPressure,
    imbalanceRatio: Number.isFinite(imbalanceRatio) ? imbalanceRatio : 0,
    imbalance,
    absorption,
    absorptionStrength,
    liquiditySweep,
    sweepPrice,
    microStructure,
  };
}

export function analyzeOrderFlow(candles: Candle[]): OrderFlowResult {
  const empty: OrderFlowResult = {
    source: "BINANCE_TAKER_FLOW",
    buyVolume: 0,
    sellVolume: 0,
    delta: 0,
    deltaRatio: 0,
    cumulativeDelta: 0,
    buyerPressure: 0,
    sellerPressure: 0,
    pressure: "BALANCED",
    pressureTrend: "NEUTRAL",
    imbalance: "NONE",
    imbalanceRatio: 0,
    absorption: "NONE",
    absorptionStrength: 0,
    liquiditySweep: "NONE",
    liquiditySweepPrice: null,
    microStructure: "NEUTRAL",
    direction: "WAIT",
    signal: "WAIT — insufficient closed-candle data",
    confidence: 0,
    confirmations: [],
    entry: null,
    stop: null,
    targets: [],
    recentBars: [],
  };

  const closed = candles.filter(c => c.closed !== false);
  if (!closed.length) return empty;

  let buyVolume = 0;
  let sellVolume = 0;
  let cumulativeDelta = 0;
  let allExact = true;
  const bars: OrderFlowBar[] = [];

  for (let i = 0; i < closed.length; i += 1) {
    const split = volumeSplit(closed[i]);
    allExact = allExact && split.exact;
    buyVolume += split.buy;
    sellVolume += split.sell;
    cumulativeDelta += split.buy - split.sell;
    bars.push(analyzeBar(closed, i, split.buy, split.sell));
  }

  const last = bars.at(-1);
  if (!last) return empty;

  const total = Math.max(buyVolume + sellVolume, 1e-12);
  const delta = buyVolume - sellVolume;
  const deltaRatio = delta / total;
  const buyerPressure = buyVolume / total * 100;
  const sellerPressure = sellVolume / total * 100;

  const pressure: OrderFlowPressure =
    deltaRatio >= 0.08 ? "BUYERS" :
    deltaRatio <= -0.08 ? "SELLERS" : "BALANCED";

  const recent3 = bars.slice(-3).map(b => b.deltaRatio);
  const prior3 = bars.slice(-6, -3).map(b => b.deltaRatio);
  const recentAvg = avg(recent3);
  const priorAvg = avg(prior3);
  const pressureTrend =
    recentAvg - priorAvg >= 0.04 ? "BUYING PRESSURE INCREASING" :
    recentAvg - priorAvg <= -0.04 ? "SELLING PRESSURE INCREASING" :
    "PRESSURE STABLE";

  const recentBars = bars.slice(-12);
  const sweepLow = recentBars.find(b => b.liquiditySweep === "LOW");
  const sweepHigh = recentBars.find(b => b.liquiditySweep === "HIGH");
  const buyerAbsorption = recentBars.find(b => b.absorption === "BUYER");
  const sellerAbsorption = recentBars.find(b => b.absorption === "SELLER");

  const longChecks = [
    !!sweepLow,
    !!buyerAbsorption,
    last.deltaRatio >= 0.08,
    last.imbalance === "BUY",
    last.microStructure === "BULLISH",
  ];
  const shortChecks = [
    !!sweepHigh,
    !!sellerAbsorption,
    last.deltaRatio <= -0.08,
    last.imbalance === "SELL",
    last.microStructure === "BEARISH",
  ];

  const longScore = longChecks.filter(Boolean).length * 20;
  const shortScore = shortChecks.filter(Boolean).length * 20;

  let direction: OrderFlowDirection = "WAIT";
  let score = Math.max(longScore, shortScore);
  if (longScore >= 80 && longScore > shortScore) direction = "BUY";
  else if (shortScore >= 80 && shortScore > longScore) direction = "SELL";
  else score = Math.min(score, 60);

  const confirmations: string[] = [];
  if (direction === "BUY") {
    if (sweepLow) confirmations.push("Liquidity sweep low");
    if (buyerAbsorption) confirmations.push("Buyer absorption");
    if (last.deltaRatio >= 0.08) confirmations.push("Positive delta");
    if (last.imbalance === "BUY") confirmations.push("Buy imbalance ≥ 1.6×");
    if (last.microStructure === "BULLISH") confirmations.push("Bullish micro-structure break");
  } else if (direction === "SELL") {
    if (sweepHigh) confirmations.push("Liquidity sweep high");
    if (sellerAbsorption) confirmations.push("Seller absorption");
    if (last.deltaRatio <= -0.08) confirmations.push("Negative delta");
    if (last.imbalance === "SELL") confirmations.push("Sell imbalance ≥ 1.6×");
    if (last.microStructure === "BEARISH") confirmations.push("Bearish micro-structure break");
  }

  const signal =
    direction === "BUY" ? "BUY CONFIRMATION" :
    direction === "SELL" ? "SELL CONFIRMATION" :
    "WAIT — order-flow confluence incomplete";

  let entry: number | null = null;
  let stop: number | null = null;
  let targets: number[] = [];

  if (direction === "BUY") {
    entry = closed.at(-1)!.close;
    const baseStop = sweepLow?.sweepPrice ?? Math.min(...closed.slice(-5).map(c => c.low));
    const buffer = avg(closed.slice(-5).map(c => barRange(c))) * 0.10;
    stop = Math.max(0, baseStop - buffer);
  } else if (direction === "SELL") {
    entry = closed.at(-1)!.close;
    const baseStop = sweepHigh?.sweepPrice ?? Math.max(...closed.slice(-5).map(c => c.high));
    const buffer = avg(closed.slice(-5).map(c => barRange(c))) * 0.10;
    stop = baseStop + buffer;
  }

  if (entry != null && stop != null && entry !== stop) {
    const risk = Math.abs(entry - stop);
    targets = direction === "BUY"
      ? [entry + risk * 1.5, entry + risk * 2, entry + risk * 3]
      : [entry - risk * 1.5, entry - risk * 2, entry - risk * 3];
  } else {
    entry = null;
    stop = null;
  }

  const lastTotal = Math.max(last.buyVolume + last.sellVolume, 1e-12);
  const lastImbalanceRatio = Math.max(last.buyVolume, last.sellVolume) / Math.max(Math.min(last.buyVolume, last.sellVolume), 1e-12);

  return {
    source: allExact ? "BINANCE_TAKER_FLOW" : "CANDLE_ESTIMATE_FALLBACK",
    buyVolume,
    sellVolume,
    delta: safe(delta),
    deltaRatio: safe(deltaRatio),
    cumulativeDelta: safe(cumulativeDelta),
    buyerPressure: clamp(buyerPressure, 0, 100),
    sellerPressure: clamp(sellerPressure, 0, 100),
    pressure,
    pressureTrend,
    imbalance: last.imbalance,
    imbalanceRatio: safe(lastImbalanceRatio),
    absorption: last.absorption,
    absorptionStrength: last.absorptionStrength,
    liquiditySweep: last.liquiditySweep,
    liquiditySweepPrice: last.sweepPrice,
    microStructure: last.microStructure,
    direction,
    signal,
    confidence: clamp(score),
    confirmations,
    entry,
    stop,
    targets,
    recentBars,
  };
}
