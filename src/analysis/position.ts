export type PositionDirection = "BUY" | "SELL";
export type PositionExecutionState = "PENDING" | "ACTIVE" | "TP1_HIT" | "STOP_HIT";

/**
 * Classifies execution state without changing strategy confirmation.
 * This is intentionally separate from SMC/Elliott/Orderflow signal generation.
 */
export function getPositionExecutionState(
  direction: PositionDirection,
  currentPrice: number,
  entry: number,
  stop: number,
  target: number,
): PositionExecutionState {
  if (![currentPrice, entry, stop, target].every(Number.isFinite)) return "PENDING";
  if (direction === "BUY") {
    if (currentPrice <= stop) return "STOP_HIT";
    if (currentPrice >= target) return "TP1_HIT";
    if (currentPrice >= entry) return "ACTIVE";
    return "PENDING";
  }
  if (currentPrice >= stop) return "STOP_HIT";
  if (currentPrice <= target) return "TP1_HIT";
  if (currentPrice <= entry) return "ACTIVE";
  return "PENDING";
}

export function isValidPositionGeometry(
  direction: PositionDirection,
  entry: number,
  stop: number,
  target: number,
  minRR = 1.5,
): boolean {
  if (![entry, stop, target].every(Number.isFinite)) return false;
  if (entry <= 0 || stop <= 0 || target <= 0) return false;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return false;
  if (direction === "BUY" && !(stop < entry && target > entry)) return false;
  if (direction === "SELL" && !(target < entry && stop > entry)) return false;
  const rr = Math.abs(target - entry) / risk;
  return Number.isFinite(rr) && rr >= minRR;
}
