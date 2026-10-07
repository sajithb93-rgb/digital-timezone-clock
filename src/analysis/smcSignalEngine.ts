import type { Candle } from "./engine";

export type SMCSignalDirection = "BUY" | "SELL";
export type SMCSignalStatus = "ACTIVE" | "WAIT" | "INVALID";

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
  zoneType: "FVG" | "OB";
  entryZone: { low: number; high: number };
  premiumDiscount: "Premium" | "Discount" | "Equilibrium";
};

type Pivot = { index: number; price: number; type: "H" | "L"; confirmedAt: number };
type Sweep = { index: number; level: number; type: "high" | "low" };

const finite = (n: number) => Number.isFinite(n);
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function atrAt(c: Candle[], end: number, n = 14): number {
  if (end < 0 || !c.length) return 0;
  const e = Math.min(end, c.length - 1);
  const s = Math.max(0, e - n + 1);
  let sum = 0;
  for (let i = s; i <= e; i++) {
    const prev = i > 0 ? c[i - 1].close : c[i].open;
    sum += Math.max(c[i].high - c[i].low, Math.abs(c[i].high - prev), Math.abs(c[i].low - prev));
  }
  return sum / Math.max(1, e - s + 1);
}

function pivots(c: Candle[], w = 2): Pivot[] {
  const out: Pivot[] = [];
  for (let i = w; i < c.length - w; i++) {
    if (c[i].closed === false) continue;
    let hi = true, lo = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (c[j].high >= c[i].high) hi = false;
      if (c[j].low <= c[i].low) lo = false;
    }
    if (hi) out.push({ index: i, price: c[i].high, type: "H", confirmedAt: i + w });
    if (lo) out.push({ index: i, price: c[i].low, type: "L", confirmedAt: i + w });
  }
  return out;
}

function latestConfirmed(ps: Pivot[], index: number, type: "H" | "L"): Pivot | null {
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    if (p.type === type && p.index < index && p.confirmedAt <= index) return p;
  }
  return null;
}

function latestSweep(c: Candle[], ps: Pivot[], asOf: number, type: "high" | "low"): Sweep | null {
  for (let i = asOf; i >= 0; i--) {
    if (c[i].closed === false) continue;
    const levelPivot = type === "high"
      ? latestConfirmed(ps, i, "H")
      : latestConfirmed(ps, i, "L");
    if (!levelPivot) continue;
    const hit = type === "high"
      ? c[i].high > levelPivot.price && c[i].close < levelPivot.price
      : c[i].low < levelPivot.price && c[i].close > levelPivot.price;
    if (!hit) continue;

    let invalidated = false;
    for (let j = i + 1; j <= asOf; j++) {
      if (type === "high" && c[j].close > levelPivot.price) invalidated = true;
      if (type === "low" && c[j].close < levelPivot.price) invalidated = true;
    }
    if (!invalidated) return { index: i, level: levelPivot.price, type };
  }
  return null;
}

function displacement(c: Candle[], i: number, bullish: boolean): boolean {
  if (i < 1 || c[i].closed === false) return false;
  const a = atrAt(c, i - 1, 14);
  if (a <= 0) return false;
  const body = Math.abs(c[i].close - c[i].open);
  const range = Math.max(c[i].high - c[i].low, 1e-12);
  return body >= a * 0.9 && body / range >= 0.6 &&
    (bullish ? c[i].close > c[i].open : c[i].close < c[i].open);
}

function findStructureBreak(c: Candle[], ps: Pivot[], sweep: Sweep, asOf: number, bullish: boolean): number {
  for (let i = sweep.index + 1; i <= asOf; i++) {
    if (c[i].closed === false) continue;
    const p = latestConfirmed(ps, i, bullish ? "H" : "L");
    if (!p || p.index <= sweep.index) continue;
    const broken = bullish ? c[i].close > p.price : c[i].close < p.price;
    if (broken && displacement(c, i, bullish)) return i;
  }
  return -1;
}

function findFVG(c: Candle[], start: number, asOf: number, bullish: boolean) {
  for (let i = start + 1; i <= Math.min(asOf, c.length - 1); i++) {
    if (i < 2 || c[i].closed === false) continue;
    const valid = bullish ? c[i].low > c[i - 2].high : c[i].high < c[i - 2].low;
    if (!valid) continue;
    const low = bullish ? c[i - 2].high : c[i].high;
    const high = bullish ? c[i].low : c[i - 2].low;
    return { index: i, low, high, type: "FVG" as const };
  }
  return null;
}

function findOB(c: Candle[], start: number, asOf: number, bullish: boolean) {
  const end = Math.min(asOf, start + 6);
  for (let i = start; i <= end; i++) {
    const opposite = bullish ? c[i].close < c[i].open : c[i].close > c[i].open;
    if (!opposite) continue;
    return { index: i, low: c[i].low, high: c[i].high, type: "OB" as const };
  }
  return null;
}

function inZone(price: number, zone: { low: number; high: number }) {
  return price >= zone.low && price <= zone.high;
}

export function generateSMCSignal(candles: Candle[], asOf = candles.length - 1, timeframe?: string): SMCSignal | null {
  const end = Math.min(asOf, candles.length - 1);
  if (end < 40) return null;
  const closed = candles.slice(0, end + 1).filter(c => c.closed !== false);
  if (closed.length < 40) return null;

  // Analysis is strictly based on closed candles. The last candle is therefore
  // never used as a future-confirming pivot unless its own confirmation exists.
  const c = candles.slice(0, end + 1);
  const ps = pivots(c, 2);
  const last = c[end];
  const rangeHigh = Math.max(...c.slice(Math.max(0, end - 59), end + 1).map(x => x.high));
  const rangeLow = Math.min(...c.slice(Math.max(0, end - 59), end + 1).map(x => x.low));
  const mid = (rangeHigh + rangeLow) / 2;
  const premiumDiscount = last.close > mid ? "Premium" : last.close < mid ? "Discount" : "Equilibrium";

  const candidates: SMCSignal[] = [];

  for (const bullish of [true, false]) {
    const sweep = latestSweep(c, ps, end, bullish ? "low" : "high");
    if (!sweep) continue;

    // A sweep must precede the structural confirmation.
    const structureIndex = findStructureBreak(c, ps, sweep, end, bullish);
    if (structureIndex <= sweep.index) continue;

    const fvg = findFVG(c, structureIndex, end, bullish);
    const ob = findOB(c, structureIndex, end, bullish);
    const zone = fvg ?? ob;
    if (!zone) continue;

    // Longs should originate in discount; shorts in premium.
    if (bullish && premiumDiscount === "Premium") continue;
    if (!bullish && premiumDiscount === "Discount") continue;

    const entry = (zone.low + zone.high) / 2;
    const atr = atrAt(c, end, 14);
    const stop = bullish
      ? Math.min(sweep.level, zone.low) - atr * 0.15
      : Math.max(sweep.level, zone.high) + atr * 0.15;
    const risk = Math.abs(entry - stop);
    if (!finite(risk) || risk <= 0) continue;

    const target1 = bullish ? entry + risk * 1.5 : entry - risk * 1.5;
    const target2 = bullish ? entry + risk * 2.5 : entry - risk * 2.5;
    const active = inZone(last.close, zone);
    const confirmations = [
      bullish ? "Sell-side liquidity sweep" : "Buy-side liquidity sweep",
      "Confirmed displacement",
      bullish ? "Bullish structure break" : "Bearish structure break",
      zone.type === "FVG" ? "Fresh FVG" : "Order Block",
      bullish ? "Discount location" : "Premium location"
    ];
    let confidence = 65 + (active ? 15 : 0) + (zone.type === "FVG" ? 5 : 0);
    if (displacement(c, structureIndex, bullish)) confidence += 5;

    candidates.push({
      direction: bullish ? "BUY" : "SELL",
      status: active ? "ACTIVE" : "WAIT",
      entry, stop,
      targets: [target1, target2],
      rr: 1.5,
      confidence: clamp(confidence),
      timeframe,
      asOf: end,
      confirmations,
      sweepIndex: sweep.index,
      structureIndex,
      zoneIndex: zone.index,
      zoneType: zone.type,
      entryZone: { low: zone.low, high: zone.high },
      premiumDiscount
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates[0] ?? null;
}

export function isConfirmedSMCSignal(signal: SMCSignal | null): signal is SMCSignal {
  if (!signal || signal.status !== "ACTIVE") return false;
  if (!finite(signal.entry) || !finite(signal.stop)) return false;
  if (signal.direction === "BUY" && signal.stop >= signal.entry) return false;
  if (signal.direction === "SELL" && signal.stop <= signal.entry) return false;
  return signal.targets.length >= 2 &&
    signal.targets.every(t => signal.direction === "BUY" ? t > signal.entry : t < signal.entry);
}
