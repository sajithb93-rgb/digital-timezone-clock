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
  internalIndex: number;
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
  const causal = result.causalSequence;
  if (
    !causal ||
    causal.direction !== (direction === "BUY" ? "bullish" : "bearish") ||
    causal.sweepIndex < 0 ||
    causal.structureIndex < 0 ||
    causal.internalIndex < 0
  ) {
    return null;
  }

  const zone = result.entryZone;
  if (zone?.type !== "entry") return null;

  // The core SMC engine now exposes the exact source kind/origin. Never
  // infer this from human-readable confirmation strings because a setup can
  // contain multiple confirmations at once.
  const zoneType = zone.sourceKind;
  if (!zoneType) return null;
  const zoneIndex = zone.originIndex;

  const risk = Math.abs(entry - stop);
  const rr = Math.abs(targets[0] - entry) / risk;
  if (!finite(rr) || rr < 1.5) return null;

  const signal: SMCSignal = {
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
    sweepIndex: causal.sweepIndex,
    structureIndex: causal.structureIndex,
    internalIndex: causal.internal.index,
    zoneIndex: zoneIndex ?? result.asOf,
    zoneType,
    entryZone: { low: zone.low, high: zone.high },
    premiumDiscount: result.premiumDiscount,
  };
  return isConfirmedSMCSignal(signal) ? signal : null;
}

export function isConfirmedSMCSignal(signal: SMCSignal | null): signal is SMCSignal {
  if (!signal || signal.status !== "ACTIVE") return false;
  if (!finite(signal.entry) || !finite(signal.stop) || signal.entry <= 0 || signal.stop <= 0) return false;
  if (!Number.isInteger(signal.asOf) || signal.asOf < 0) return false;
  if (
    !Number.isInteger(signal.sweepIndex) ||
    !Number.isInteger(signal.structureIndex) ||
    !Number.isInteger(signal.internalIndex) ||
    !Number.isInteger(signal.zoneIndex) ||
    signal.sweepIndex < 0 ||
    signal.structureIndex < 0 ||
    signal.internalIndex < 0 ||
    signal.zoneIndex < 0 ||
    signal.sweepIndex >= signal.structureIndex ||
    signal.structureIndex >= signal.internalIndex ||
    signal.internalIndex >= signal.asOf ||
    signal.zoneIndex < signal.sweepIndex ||
    signal.sweepIndex > signal.asOf ||
    signal.structureIndex > signal.asOf ||
    signal.internalIndex > signal.asOf ||
    signal.zoneIndex > signal.asOf
  ) return false;
  const causalZone =
    signal.zoneType === "OB"
      ? signal.zoneIndex < signal.structureIndex
      : signal.zoneType === "FVG"
        ? signal.zoneIndex <= signal.structureIndex + 3
        : signal.zoneIndex >= signal.structureIndex;
  if (!causalZone) return false;
  if (
    !finite(signal.entryZone.low) ||
    !finite(signal.entryZone.high) ||
    signal.entryZone.low <= 0 ||
    signal.entryZone.low >= signal.entryZone.high ||
    signal.entry < signal.entryZone.low ||
    signal.entry > signal.entryZone.high
  ) return false;
  if (
    signal.zoneType !== "FVG" &&
    signal.zoneType !== "OB" &&
    signal.zoneType !== "BREAKER"
  ) return false;
  if (!finite(signal.confidence) || signal.confidence < 0 || signal.confidence > 100) return false;
  if (!finite(signal.rr) || signal.rr < 1.5) return false;
  if (
    (signal.direction === "BUY" && signal.premiumDiscount !== "Discount") ||
    (signal.direction === "SELL" && signal.premiumDiscount !== "Premium")
  ) return false;

  const validDirection =
    signal.direction === "BUY" ? signal.stop < signal.entry : signal.stop > signal.entry;
  if (!validDirection || signal.targets.length < 2) return false;

  const geometryRR = Math.abs(signal.targets[0] - signal.entry) / Math.abs(signal.entry - signal.stop);
  if (!finite(geometryRR) || Math.abs(geometryRR - signal.rr) > Math.max(1e-9, signal.rr * 1e-6)) return false;

  return isValidTradeGeometry(signal.direction, signal.entry, signal.stop, signal.targets, 1.5);
}

