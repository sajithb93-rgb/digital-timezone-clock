import type { Candle } from "./engine";
import { analyzeSMC, isValidTradeGeometry } from "./engine";

export type SMCSignalDirection = "BUY" | "SELL";
export type SMCSignalStatus = "ACTIVE";

export type SMCSignal = {
  direction: SMCSignalDirection;
  status: SMCSignalStatus;
  entry: number;
  stop: number;
  targets: number[];
  rr: number;
  confidence: number;
  timeframe?: string;
  asOf: number;
  confirmations: string[];
  sweepIndex: number;
  structureIndex: number;
  zoneIndex: number;
  zoneType: "FVG" | "OB" | "BREAKER";
  entryZone: { low: number; high: number };
  premiumDiscount: "Premium" | "Discount" | "Equilibrium";
};

function finite(n: number) {
  return Number.isFinite(n);
}

function lastClosedIndex(candles: Candle[], asOf: number) {
  const end = Math.min(Math.floor(asOf), candles.length - 1);
  for (let i = end; i >= 0; i--) {
    if (candles[i]?.closed !== false) return i;
  }
  return -1;
}

/**
 * Confirmed-only SMC signal adapter.
 *
 * The project already has a causal SMC engine in engine.ts. Reusing it here
 * avoids maintaining a second, weaker BOS/CHOCH/OB/FVG implementation that
 * could disagree with the dashboard's SMC analysis.
 */
export function generateSMCSignal(
  candles: Candle[],
  asOf = candles.length - 1,
  timeframe?: string,
): SMCSignal | null {
  const end = lastClosedIndex(candles, asOf);
  if (end < 24) return null;

  // Preserve candle positions exactly. Filtering individual candles here can
  // shift causal sweep/BOS/zone indices; analyzeSMC already normalizes the
  // series and stops at the first open candle.
  const closed = candles.slice(0, end + 1);
  if (closed.length < 25 || closed.some(c => c.closed === false)) return null;

  const result = analyzeSMC(closed);
  const setup = result.setup;

  if (
    setup.status !== "ACTIVE" ||
    (setup.direction !== "BUY" && setup.direction !== "SELL") ||
    setup.entry === null ||
    setup.stop === null ||
    setup.targets.length < 2 ||
    !result.entryZone
  ) {
    return null;
  }

  const entry = setup.entry;
  const stop = setup.stop;
  const targets = setup.targets.filter(finite);
  if (
    !finite(entry) ||
    !finite(stop) ||
    targets.length < 2 ||
    !isValidTradeGeometry(setup.direction, entry, stop, targets, 1.5)
  ) {
    return null;
  }

  const direction: SMCSignalDirection = setup.direction;
  const event = result.events
    .slice()
    .reverse()
    .find(e => (direction === "BUY" ? e.direction === "bullish" : e.direction === "bearish"));
  const sweep = result.sweeps
    .slice()
    .reverse()
    .find(s => direction === "BUY" ? s.type === "low" : s.type === "high");

  const zone = result.entryZone;
  if (zone?.type !== "entry") return null;

  // Identify the actual source zone from the engine's confirmed-zone price
  // rather than defaulting every unknown zone to OB.
  const zoneType: SMCSignal["zoneType"] =
    result.setup.confirmations.some(x => /fair value gap/i.test(x))
      ? "FVG"
      : result.setup.confirmations.some(x => /breaker/i.test(x))
        ? "BREAKER"
        : "OB";

  const zoneIndex =
    zoneType === "OB"
      ? result.orderBlocks.find(o => o.low === zone.low && o.high === zone.high)?.index
      : zoneType === "FVG"
        ? result.fvgs.find(f => f.low === zone.low && f.high === zone.high)?.to
        : result.breakers.find(b => b.low === zone.low && b.high === zone.high)?.index;

  const risk = Math.abs(entry - stop);
  const rr = Math.abs(targets[0] - entry) / risk;
  if (!finite(rr) || rr < 1.5) return null;

  return {
    direction,
    status: "ACTIVE",
    entry,
    stop,
    targets,
    rr,
    confidence: Math.max(0, Math.min(100, Math.round(setup.confidence))),
    timeframe,
    asOf: result.asOf,
    confirmations: [...setup.confirmations],
    sweepIndex: sweep?.index ?? -1,
    structureIndex: event?.index ?? -1,
    zoneIndex: zoneIndex ?? event?.index ?? result.asOf,
    zoneType,
    entryZone: { low: zone.low, high: zone.high },
    premiumDiscount: result.premiumDiscount,
  };
}

export function isConfirmedSMCSignal(signal: SMCSignal | null): signal is SMCSignal {
  if (!signal || signal.status !== "ACTIVE") return false;
  if (!finite(signal.entry) || !finite(signal.stop) || signal.entry <= 0 || signal.stop <= 0) return false;

  const validDirection =
    signal.direction === "BUY" ? signal.stop < signal.entry : signal.stop > signal.entry;
  if (!validDirection || signal.targets.length < 2) return false;

  return isValidTradeGeometry(signal.direction, signal.entry, signal.stop, signal.targets, 1.5);
}
