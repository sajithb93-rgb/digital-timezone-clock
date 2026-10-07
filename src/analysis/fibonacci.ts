import type { Candle, SMCResult } from "./engine";
import type { AdvancedElliottResult } from "./elliott";
import type { OrderFlowResult } from "./orderflow";

export type FibonacciSource = "SMC" | "ELLIOTT" | "ORDER_FLOW";

export type FibonacciLevel = {
  ratio: number;
  label: string;
  price: number;
};

export type AutoFibonacciSet = {
  source: FibonacciSource;
  direction: "UP" | "DOWN";
  startIndex: number;
  endIndex: number;
  startPrice: number;
  endPrice: number;
  levels: FibonacciLevel[];
  reason: string;
};

const RETRACEMENTS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function inferFibLookbackBars(candles: Candle[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const d = candles[i].time - candles[i - 1].time;
    if (Number.isFinite(d) && d > 0) deltas.push(d);
  }
  if (!deltas.length) return 12;
  deltas.sort((a, b) => a - b);
  const intervalMs = deltas[Math.floor(deltas.length / 2)];
  const target = Math.round((12 * 5 * 60 * 1000) / Math.max(intervalMs, 1));
  return Math.max(3, Math.min(60, target));
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function makeSet(
  source: FibonacciSource,
  startIndex: number,
  startPrice: number,
  endIndex: number,
  endPrice: number,
  reason: string,
): AutoFibonacciSet | null {
  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(endIndex) ||
    startIndex < 0 ||
    endIndex < 0 ||
    startIndex === endIndex ||
    !finite(startPrice) ||
    !finite(endPrice) ||
    startPrice === endPrice
  ) {
    return null;
  }

  const direction = endPrice > startPrice ? "UP" : "DOWN";
  const high = Math.max(startPrice, endPrice);
  const low = Math.min(startPrice, endPrice);
  const range = high - low;
  if (!(range > 0)) return null;

  // Standard retracement convention:
  // UP leg: 0% at the high and 100% at the low.
  // DOWN leg: 0% at the low and 100% at the high.
  const levels = RETRACEMENTS.map((ratio) => ({
    ratio,
    label: `${(ratio * 100).toFixed(ratio === 0 || ratio === 1 ? 0 : 1)}%`,
    price:
      direction === "UP"
        ? endPrice - range * ratio
        : endPrice + range * ratio,
  }));

  return {
    source,
    direction,
    startIndex,
    endIndex,
    startPrice,
    endPrice,
    levels,
    reason,
  };
}

function smcFib(candles: Candle[], smc: SMCResult): AutoFibonacciSet | null {
  const lastClosed = candles.reduce((last, c, i) => (c.closed === false ? last : i), -1);
  if (lastClosed < 0) return null;

  const events = smc.events
    .filter((e) => e.index >= 0 && e.index <= lastClosed && finite(e.price))
    .sort((a, b) => a.index - b.index);
  const event = events.at(-1);

  if (event) {
    if (event.direction === "bullish") {
      const highPivot =
        smc.pivots
          .filter((p) => p.type === "H" && p.index < event.index && (p.confirmedAt ?? p.index) <= event.index)
          .find((p) => Math.abs(p.price - event.price) <= Math.max(Math.abs(event.price) * 1e-10, 1e-12)) ??
        smc.pivots
          .filter((p) => p.type === "H" && p.index < event.index && (p.confirmedAt ?? p.index) <= event.index)
          .at(-1);
      const lowPivot = highPivot
        ? smc.pivots
            .filter((p) => p.type === "L" && p.index < highPivot.index && (p.confirmedAt ?? p.index) <= event.index)
            .at(-1)
        : undefined;
      if (highPivot && lowPivot) {
        return makeSet(
          "SMC",
          lowPivot.index,
          lowPivot.price,
          highPivot.index,
          highPivot.price,
          `Latest confirmed ${event.type} bullish structural leg`,
        );
      }
    } else {
      const lowPivot =
        smc.pivots
          .filter((p) => p.type === "L" && p.index < event.index && (p.confirmedAt ?? p.index) <= event.index)
          .find((p) => Math.abs(p.price - event.price) <= Math.max(Math.abs(event.price) * 1e-10, 1e-12)) ??
        smc.pivots
          .filter((p) => p.type === "L" && p.index < event.index && (p.confirmedAt ?? p.index) <= event.index)
          .at(-1);
      const highPivot = lowPivot
        ? smc.pivots
            .filter((p) => p.type === "H" && p.index < lowPivot.index && (p.confirmedAt ?? p.index) <= event.index)
            .at(-1)
        : undefined;
      if (highPivot && lowPivot) {
        return makeSet(
          "SMC",
          highPivot.index,
          highPivot.price,
          lowPivot.index,
          lowPivot.price,
          `Latest confirmed ${event.type} bearish structural leg`,
        );
      }
    }
  }

  // Safe fallback: use the latest confirmed alternating swing pair, never the
  // current forming candle. This keeps the tool useful before a fresh BOS/CHOCH.
  const pivots = smc.pivots.filter((p) => p.index <= lastClosed && (p.confirmedAt ?? p.index) <= lastClosed);
  for (let i = pivots.length - 1; i > 0; i -= 1) {
    const a = pivots[i - 1];
    const b = pivots[i];
    if (a.type === b.type || a.price === b.price) continue;
    return makeSet(
      "SMC",
      a.index,
      a.price,
      b.index,
      b.price,
      "Latest confirmed SMC swing leg",
    );
  }
  return null;
}

function elliottFib(elliott: AdvancedElliottResult): AutoFibonacciSet | null {
  const primary = elliott.primary;
  if (primary && Array.isArray(primary.points) && primary.points.length >= 6) {
    const p2 = primary.points[2];
    const p3 = primary.points[3];
    const p4 = primary.points[4];
    const p5 = primary.points[5];

    // Wave 3 is the correct retracement anchor while the validated count is
    // in the Wave-4 context. Once Wave 5 is complete and the engine is working
    // on its ABC continuation, the current actionary leg is Wave 5 instead.
    if (elliott.activeWave === "Wave 4") {
      return makeSet(
        "ELLIOTT",
        p2.index,
        p2.price,
        p3.index,
        p3.price,
        "Validated Elliott Wave-3 leg · Wave-4 retracement context",
      );
    }

    if (elliott.liveSetup || elliott.activeWave === "A" || elliott.activeWave === "B" || elliott.activeWave === "C") {
      return makeSet(
        "ELLIOTT",
        p4.index,
        p4.price,
        p5.index,
        p5.price,
        "Completed Elliott Wave-5 leg · post-impulse retracement context",
      );
    }

    // Historical completed counts should still use their latest completed
    // actionary leg rather than displaying a stale Wave-3 retracement.
    return makeSet(
      "ELLIOTT",
      p4.index,
      p4.price,
      p5.index,
      p5.price,
      "Completed Elliott Wave-5 leg · latest validated actionary swing",
    );
  }

  const correction = elliott.correction;
  if (correction && Array.isArray(correction.points) && correction.points.length >= 2) {
    const a = correction.points.at(-2)!;
    const b = correction.points.at(-1)!;
    return makeSet(
      "ELLIOTT",
      a.index,
      a.price,
      b.index,
      b.price,
      "Validated Elliott correction leg",
    );
  }

  return null;
}
function orderFlowFib(candles: Candle[], orderFlow: OrderFlowResult): AutoFibonacciSet | null {
  const lastClosed = candles.reduce((last, c, i) => (c.closed === false ? last : i), -1);
  if (lastClosed < 0) return null;

  const bars = orderFlow.recentBars
    .filter((b) => b.index >= 0 && b.index <= lastClosed && candles[b.index]?.closed !== false)
    .sort((a, b) => a.index - b.index);
  const lookbackBars = inferFibLookbackBars(candles);
  const latestBuySweep = bars.filter((b) => b.liquiditySweep === "LOW" && finite(b.sweepPrice)).at(-1);
  const latestSellSweep = bars.filter((b) => b.liquiditySweep === "HIGH" && finite(b.sweepPrice)).at(-1);

  if (latestBuySweep) {
    const confirm = bars
      .filter((b) => b.index > latestBuySweep.index && b.index <= lastClosed && b.microStructure === "BULLISH")
      .at(-1);
    if (confirm) {
      const c = candles[confirm.index];
      if (c) {
        return makeSet(
          "ORDER_FLOW",
          latestBuySweep.index,
          latestBuySweep.sweepPrice!,
          confirm.index,
          c.high,
          "Liquidity sweep → bullish footprint/micro-structure confirmation",
        );
      }
    }
  }

  if (latestSellSweep) {
    const confirm = bars
      .filter((b) => b.index > latestSellSweep.index && b.index <= lastClosed && b.microStructure === "BEARISH")
      .at(-1);
    if (confirm) {
      const c = candles[confirm.index];
      if (c) {
        return makeSet(
          "ORDER_FLOW",
          latestSellSweep.index,
          latestSellSweep.sweepPrice!,
          confirm.index,
          c.low,
          "Liquidity sweep → bearish footprint/micro-structure confirmation",
        );
      }
    }
  }

  // If no sweep-confirmation sequence exists, use the latest confirmed
  // micro-structure break. Do not manufacture a Fibonacci anchor from raw
  // delta alone.
  const micro = bars.slice().reverse().find((b) => b.microStructure !== "NEUTRAL");
  if (micro) {
    const c = candles[micro.index];
    if (c) {
      const lookbackStart = Math.max(0, micro.index - lookbackBars);
      const lookback = candles.slice(lookbackStart, micro.index);
      if (micro.microStructure === "BULLISH") {
        const low = lookback.reduce<{index:number;price:number}|null>((best, x, offset) => {
          const index = lookbackStart + offset;
          return !best || x.low < best.price ? {index, price:x.low} : best;
        }, null);
        if (low) return makeSet("ORDER_FLOW", low.index, low.price, micro.index, c.high, "Latest confirmed bullish micro-structure leg");
      } else {
        const high = lookback.reduce<{index:number;price:number}|null>((best, x, offset) => {
          const index = lookbackStart + offset;
          return !best || x.high > best.price ? {index, price:x.high} : best;
        }, null);
        if (high) return makeSet("ORDER_FLOW", high.index, high.price, micro.index, c.low, "Latest confirmed bearish micro-structure leg");
      }
    }
  }

  return null;
}

export function buildAutoFibonacci(
  candles: Candle[],
  smc: SMCResult,
  elliott: AdvancedElliottResult,
  orderFlow: OrderFlowResult,
  mode: "smc" | "elliott" | "combined" | "orderflow",
): AutoFibonacciSet[] {
  if (candles.length < 3) return [];

  const smcSet = smcFib(candles, smc);
  const elliottSet = elliottFib(elliott);
  const orderFlowSet = orderFlowFib(candles, orderFlow);

  if (mode === "smc") return smcSet ? [smcSet] : [];
  if (mode === "elliott") return elliottSet ? [elliottSet] : [];
  if (mode === "orderflow") return orderFlowSet ? [orderFlowSet] : [];

  return [smcSet, elliottSet, orderFlowSet].filter(
    (x): x is AutoFibonacciSet => x !== null,
  );
}
