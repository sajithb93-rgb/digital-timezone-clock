import { analyzeSMC, type Candle, type SMCResult } from "./engine";
import type { OrderFlowResult } from "./orderflow";
import { normalizeCandleSeries } from "./candles";

export type ReversalDirection = "BUY" | "SELL" | "NONE";
export type ReversalState = "NONE" | "WATCH" | "SETUP" | "CONFIRMED";

export type ReversalEvidence = {
  name: string;
  active: boolean;
  points: number;
  detail: string;
};

export type ReversalEngineResult = {
  direction: ReversalDirection;
  state: ReversalState;
  score: number;
  asOf: number;
  triggerIndex: number | null;
  triggerPrice: number | null;
  sweepIndex: number | null;
  sweepPrice: number | null;
  structureIndex: number | null;
  displacementRatio: number;
  fvg: { low: number; high: number; index: number } | null;
  orderBlock: { low: number; high: number; index: number } | null;
  orderflowConfirmed: boolean;
  deltaDivergence: boolean;
  entryZone: { low: number; high: number } | null;
  invalidation: number | null;
  targets: number[];
  evidence: ReversalEvidence[];
  reason: string;
};

const EMPTY: ReversalEngineResult = {
  direction: "NONE",
  state: "NONE",
  score: 0,
  asOf: -1,
  triggerIndex: null,
  triggerPrice: null,
  sweepIndex: null,
  sweepPrice: null,
  structureIndex: null,
  displacementRatio: 0,
  fvg: null,
  orderBlock: null,
  orderflowConfirmed: false,
  deltaDivergence: false,
  entryZone: null,
  invalidation: null,
  targets: [],
  evidence: [],
  reason: "Insufficient closed-candle data",
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function body(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function trueRange(candles: Candle[], i: number): number {
  if (i <= 0) return Math.max(candles[i].high - candles[i].low, 0);
  return Math.max(
    candles[i].high - candles[i].low,
    Math.abs(candles[i].high - candles[i - 1].close),
    Math.abs(candles[i].low - candles[i - 1].close),
  );
}

function atrAt(candles: Candle[], end: number, period = 14): number {
  if (!candles.length || end < 0) return 0;
  const e = Math.min(end, candles.length - 1);
  const start = Math.max(0, e - period + 1);
  let sum = 0;
  for (let i = start; i <= e; i += 1) sum += trueRange(candles, i);
  return sum / Math.max(1, e - start + 1);
}

function sweepStillValid(candles:Candle[],sweepIndex:number,sweepPrice:number,type:"high"|"low"):boolean{
  if(sweepIndex<0||sweepIndex>=candles.length||!Number.isFinite(sweepPrice))return false;
  for(let i=sweepIndex+1;i<candles.length;i++){
    if(type==="low"&&candles[i].close<sweepPrice)return false;
    if(type==="high"&&candles[i].close>sweepPrice)return false;
  }
  return true;
}

function displacementRatio(candles: Candle[], index: number): number {
  if (index < 0 || index >= candles.length) return 0;
  // Measure the candidate candle against volatility that existed before it.
  // Including the candidate in its own ATR denominator suppresses genuine
  // displacement exactly when the candle is unusually large.
  return body(candles[index]) / Math.max(atrAt(candles, index - 1), 1e-12);
}

function findDeltaDivergence(candles: Candle[], flow: OrderFlowResult, direction: ReversalDirection): boolean {
  // Divergence compares equal-length recent and prior flow windows. A shorter
  // history must not silently fall back to a one-bar baseline.
  if (flow.recentBars.length < 12 || candles.length < 12) return false;
  const recentBars = flow.recentBars.slice(-6);
  const priorBars = flow.recentBars.slice(-12, -6);
  if (recentBars.length < 6 || priorBars.length < 6) return false;
  // Divergence is only meaningful when the flow bars refer to the same
  // candle timestamps as the price series. Positional matching can silently
  // compare different candles after a feed gap or normalization step.
  const candleByTime=new Map(candles.map(c=>[c.time,c]));
  const recentCandles=recentBars.map(b=>candleByTime.get(b.time)).filter((x):x is Candle=>!!x);
  const priorCandles=priorBars.map(b=>candleByTime.get(b.time)).filter((x):x is Candle=>!!x);
  if (recentCandles.length < 6 || priorCandles.length < 6) return false;
  const recentDelta = recentBars.reduce((sum, b) => sum + b.deltaRatio, 0) / recentBars.length;
  const priorDelta = priorBars.reduce((sum, b) => sum + b.deltaRatio, 0) / priorBars.length;
  const recentLow = Math.min(...recentCandles.map(c => c.low));
  const priorLow = Math.min(...priorCandles.map(c => c.low));
  const recentHigh = Math.max(...recentCandles.map(c => c.high));
  const priorHigh = Math.max(...priorCandles.map(c => c.high));
  if (direction === "BUY") return recentLow < priorLow && recentDelta > priorDelta + 0.03;
  if (direction === "SELL") return recentHigh > priorHigh && recentDelta < priorDelta - 0.03;
  return false;
}

function chooseZone(smc: SMCResult, direction: ReversalDirection, sweepIndex: number, triggerIndex: number, lastClose: number): { low: number; high: number } | null {
  if (direction === "NONE" || sweepIndex < 0 || triggerIndex < sweepIndex) return null;
  const wanted = direction === "BUY" ? "bullish" : "bearish";
  // Reversal zones must belong to the post-sweep leg. A pre-sweep OB/FVG can
  // be valid SMC structure but cannot be used as causal reversal confirmation.
  const zones = [
    ...smc.fvgs.filter(x => x.type === wanted && !x.filled && !x.partial && x.to >= sweepIndex && x.to <= triggerIndex && triggerIndex - x.to <= 12).map(x => ({ low: x.low, high: x.high, index: x.to })),
    ...smc.orderBlocks.filter(x => x.type === wanted && !x.mitigated && x.index >= sweepIndex && x.index <= triggerIndex && triggerIndex - x.index <= 20).map(x => ({ low: x.low, high: x.high, index: x.index })),
  ];
  if (!zones.length) return null;
  zones.sort((a, b) => {
    const da = Math.abs(lastClose - (a.low + a.high) / 2);
    const db = Math.abs(lastClose - (b.low + b.high) / 2);
    return da - db || b.index - a.index;
  });
  return { low: zones[0].low, high: zones[0].high };
}

function findRelevantFvg(smc: SMCResult, direction: ReversalDirection, sweepIndex: number, anchorIndex: number): ReversalEngineResult["fvg"] {
  const wanted = direction === "BUY" ? "bullish" : "bearish";
  const item = smc.fvgs.filter(x => x.type === wanted && !x.filled && !x.partial && x.to >= sweepIndex && x.to <= anchorIndex && anchorIndex - x.to <= 12).at(-1);
  return item ? { low: item.low, high: item.high, index: item.to } : null;
}

function findRelevantOb(smc: SMCResult, direction: ReversalDirection, sweepIndex: number, anchorIndex: number): ReversalEngineResult["orderBlock"] {
  const wanted = direction === "BUY" ? "bullish" : "bearish";
  const item = smc.orderBlocks.filter(x => x.type === wanted && !x.mitigated && x.index >= sweepIndex && x.index <= anchorIndex && anchorIndex - x.index <= 20).at(-1);
  return item ? { low: item.low, high: item.high, index: item.index } : null;
}

function calculateTargets(candles: Candle[], entry: number, invalidation: number, direction: ReversalDirection): number[] {
  const risk = Math.abs(entry - invalidation);
  if (!risk || !Number.isFinite(risk) || direction === "NONE") return [];
  // Targets must be derived from structure that existed before the signal candle.
  // Including the current candle can select a level that price has already
  // touched before the reversal entry is considered active.
  const signalCandle=candles.at(-1);
  const recent = candles.slice(0, -1).slice(-60);
  const minRR = 1.5;
  // A structural level already touched by the signal candle is not a future
  // objective. Require BUY targets above the signal high and SELL targets below
  // the signal low before admitting them to the TP ladder.
  const levels = direction === "BUY"
    ? recent.map(c => c.high).filter(p => p > entry + risk * minRR && (!signalCandle || p > signalCandle.high)).sort((a, b) => a - b)
    : recent.map(c => c.low).filter(p => p < entry - risk * minRR && (!signalCandle || p < signalCandle.low)).sort((a, b) => b - a);
  const unique: number[] = [];
  const spacing = risk * 0.25;
  for (const level of levels) {
    if (!unique.some(x => Math.abs(x - level) <= spacing)) unique.push(level);
    if (unique.length >= 3) break;
  }
  const fallback = direction === "BUY"
    ? [entry + risk * 1.5, entry + risk * 2, entry + risk * 3]
    : [entry - risk * 1.5, entry - risk * 2, entry - risk * 3];
  for (const level of fallback) {
    if (unique.length >= 3) break;
    if(signalCandle){
      const futureSide=direction==="BUY"?level>signalCandle.high:level<signalCandle.low;
      if(!futureSide)continue;
    }
    if (!unique.some(x => Math.abs(x - level) <= spacing)) unique.push(level);
  }
  unique.sort((a, b) => direction === "BUY" ? a - b : b - a);
  return unique.slice(0, 3);
}

export function analyzeReversal(candles: Candle[], smc: SMCResult, orderFlow: OrderFlowResult, options: { requireOrderFlow?: boolean } = {}): ReversalEngineResult {
  const requireOrderFlow = options.requireOrderFlow !== false;
  // Reversal indices must remain stable even when the upstream exchange feed
  // arrives out of order or contains duplicate/malformed candles.
  const closed=normalizeCandleSeries(candles,true);
  if (closed.length < 30) return { ...EMPTY, asOf: closed.length - 1 };

  const asOf = closed.length - 1;
  if (smc.asOf !== asOf) {
    return { ...EMPTY, asOf, reason: "SMC context is out of sync with the reversal candle series" };
  }
  const last = closed[asOf];
  const lookbackStart = Math.max(0, asOf - 20);
  let best: ReversalEngineResult | null = null;

  for (const direction of ["BUY", "SELL"] as const) {
    const sweepType = direction === "BUY" ? "low" : "high";
    const structureDirection = direction === "BUY" ? "bullish" : "bearish";
    const sweep = smc.sweeps
      .filter(s => s.confirmed && s.type === sweepType && s.index >= lookbackStart && s.index <= asOf)
      .filter(s => sweepStillValid(closed,s.index,s.price,s.type))
      .sort((a, b) => b.index - a.index)[0] ?? null;
    if (!sweep) continue;

    // Reversal causality uses a strict three-stage sequence:
    // sweep -> CHOCH -> displacement. The structure shift must happen after
    // the sweep and within the same 12-bar causal window.
    const choch = smc.events
      .filter(e =>
        e.type === "CHOCH"
        && e.direction === structureDirection
        && e.index > sweep.index
        && e.index <= asOf
        && e.index - sweep.index <= 12
      )
      .sort((a, b) => b.index - a.index)[0] ?? null;
    const priorEvent = choch ? smc.events.filter(e => e.index < choch.index).at(-1) ?? null : null;
    const opposingStructure = !!priorEvent && priorEvent.direction !== structureDirection;
    const anchor = choch?.index ?? sweep.index;

    let bestDisplacement = 0;
    let bestDisplacementIndex = anchor;
    const displacementStart = choch ? choch.index + 1 : anchor;
    for (let i = Math.max(0, displacementStart); i <= asOf && i - anchor <= 12; i += 1) {
      const ratio = displacementRatio(closed, i);
      if (ratio > bestDisplacement) {
        bestDisplacement = ratio;
        bestDisplacementIndex = i;
      }
    }
    const displacementOk = bestDisplacement >= 0.7;
    const triggerIndex = Math.max(anchor, bestDisplacementIndex);

    const fvg = findRelevantFvg(smc, direction, sweep.index, triggerIndex);
    const orderBlock = findRelevantOb(smc, direction, sweep.index, triggerIndex);
    const zone = chooseZone(smc, direction, sweep.index, triggerIndex, last.close);

    // When Order Flow is required, only the Order Flow engine's own
    // confirmed directional state may satisfy the gate. Pressure + absorption
    // alone are descriptive context and must not bypass footprint/sweep/
    // structure/geometry confirmation performed by analyzeOrderFlow.
    const orderflowConfirmed = direction === "BUY"
      ? orderFlow.direction === "BUY"
      : orderFlow.direction === "SELL";
    const deltaDivergence = findDeltaDivergence(closed, orderFlow, direction);

    const orderFlowGate = !requireOrderFlow || orderflowConfirmed;
    const orderFlowPoints = requireOrderFlow && orderflowConfirmed ? 15 : 0;
    const rawScore = 15 + (choch ? 25 : 0) + (displacementOk ? 15 : 0) + (fvg ? 10 : 0) + (orderBlock ? 10 : 0) + orderFlowPoints + (deltaDivergence ? 5 : 0) + (opposingStructure ? 5 : 0);
    const score = clamp(rawScore);
    const structuralGate = !!choch && opposingStructure && displacementOk;
    const confirmedThreshold = requireOrderFlow ? 75 : 60;
    const state: ReversalState = score >= confirmedThreshold && structuralGate && orderFlowGate ? "CONFIRMED" : score >= 45 ? "SETUP" : "WATCH";

    const evidence: ReversalEvidence[] = [
      { name: "Liquidity sweep", active: true, points: 15, detail: direction === "BUY" ? "Sell-side liquidity swept and reclaimed" : "Buy-side liquidity swept and reclaimed" },
      { name: "MSS / CHOCH", active: !!choch, points: 25, detail: choch ? "Closed-candle structure shift confirmed after sweep" : "Waiting for closed-candle structure shift" },
      { name: "Displacement", active: displacementOk, points: 15, detail: displacementOk ? "Body/ATR " + bestDisplacement.toFixed(2) + "×" : "Body/ATR " + bestDisplacement.toFixed(2) + "× — below threshold" },
      { name: "Fair value gap", active: !!fvg, points: 10, detail: fvg ? "Fresh directional FVG detected" : "No fresh directional FVG" },
      { name: "Order block", active: !!orderBlock, points: 10, detail: orderBlock ? "Fresh directional order block detected" : "No fresh directional order block" },
      { name: "Order flow", active: orderflowConfirmed, points: 15, detail: orderflowConfirmed ? "Directional buyer/seller pressure confirmed" : requireOrderFlow ? "Order-flow confirmation incomplete" : "Not required in structural MTF mode" },
      { name: "Delta divergence", active: deltaDivergence, points: 5, detail: deltaDivergence ? "Price and delta show reversal divergence" : "No qualifying delta divergence" },
      { name: "Opposing structure", active: opposingStructure, points: 5, detail: opposingStructure ? "Pre-CHOCH structure was in the opposite direction" : "No confirmed opposite pre-CHOCH structure" },
    ];

    const entry = last.close;
    const buffer = Math.max(atrAt(closed, asOf) * 0.15, Math.abs(entry) * 0.00005);
    const sweepCandle = closed[sweep.index];
    const sweepExtreme = sweepCandle ? (direction === "BUY" ? sweepCandle.low : sweepCandle.high) : sweep.price;
    const invalidation = direction === "BUY" ? sweepExtreme - buffer : sweepExtreme + buffer;
    const targets = zone ? calculateTargets(closed, entry, invalidation, direction) : [];
    const risk=Math.abs(entry-invalidation);
    const validEntryGeometry=!!zone&&Number.isFinite(invalidation)&&invalidation>0&&risk>0&&(
      direction==="BUY"?invalidation<entry:invalidation>entry
    );
    const validTargets=targets.length===3&&targets.every(t=>Number.isFinite(t)&&(
      direction==="BUY"?t>entry:t<entry
    )&&Math.abs(t-entry)/risk>=1.5);
    const confirmationReady=validEntryGeometry&&validTargets;

    const gatedState:ReversalState = state==="CONFIRMED"&&!confirmationReady
      ?"SETUP"
      :state;

    const result: ReversalEngineResult = {
      direction, state:gatedState, score, asOf,
      triggerIndex, triggerPrice: closed[triggerIndex]?.close ?? null,
      sweepIndex: sweep.index, sweepPrice: sweep.price,
      structureIndex: choch?.index ?? null,
      displacementRatio: Number(bestDisplacement.toFixed(4)),
      fvg, orderBlock, orderflowConfirmed, deltaDivergence,
      entryZone: zone, invalidation, targets, evidence,
      reason: gatedState === "CONFIRMED"
        ? direction + " reversal confirmed by sweep → opposite CHOCH → displacement" + (requireOrderFlow ? " → order flow" : " · structural MTF mode")
        : state === "CONFIRMED"&&!confirmationReady
          ? direction + " reversal confluence confirmed, but entry zone/target geometry is not ready"
          : choch
            ? direction + " reversal setup forming; wait for remaining confluence"
            : direction + " reversal watch: liquidity sweep detected; structure shift not confirmed",
    };

    if (!best || result.score > best.score || (result.score === best.score && result.state === "CONFIRMED" && best.state !== "CONFIRMED")) best = result;
  }

  return best ?? { ...EMPTY, asOf };
}


export type MTFReversalFrame = {
  interval: string;
  direction: ReversalDirection;
  state: ReversalState;
  score: number;
  structure: "ALIGNED" | "OPPOSED" | "NEUTRAL" | "UNAVAILABLE";
};

export type MTFReversalResult = {
  direction: ReversalDirection;
  state: ReversalState;
  score: number;
  triggerTimeframe: string;
  confirmationTimeframe: string;
  contextTimeframe: string;
  contextDirection: "Bullish" | "Bearish" | "Neutral";
  frames: MTFReversalFrame[];
  confirmed: boolean;
  reason: string;
};

export function analyzeReversalMTF(mtfFrames: { interval: string; candles: Candle[] }[]): MTFReversalResult {
  const wanted = new Map(mtfFrames.map(f => [f.interval, f.candles]));
  const primaryCandles = wanted.get("15m") ?? [];
  const triggerCandles = wanted.get("5m") ?? [];
  const contextCandles = wanted.get("1h") ?? [];

  const run = (candles: Candle[]): ReversalEngineResult => {
    if (candles.length < 30) return { ...EMPTY, asOf: candles.length - 1 };
    const smc = analyzeSMC(candles);
    const flow = {
      source: "CANDLE_ESTIMATE_FALLBACK" as const,
      buyVolume: 0, sellVolume: 0, delta: 0, deltaRatio: 0, cumulativeDelta: 0,
      buyerPressure: 50, sellerPressure: 50, pressure: "BALANCED" as const,
      pressureTrend: "PRESSURE STABLE", imbalance: "NONE" as const, imbalanceRatio: 1,
      absorption: "NONE" as const, absorptionStrength: 0, liquiditySweep: "NONE" as const,
      liquiditySweepPrice: null, microStructure: "NEUTRAL" as const, direction: "WAIT" as const,
      signal: "WAIT", confidence: 0, confirmations: [], entry: null, stop: null, targets: [],
      recentBars: [], diagnostics: [], rejectionReason: "Fallback flow — order-flow confirmation intentionally unavailable", footprint: null, footprintHistoryCount: 0
    };
    return analyzeReversal(candles, smc, flow, { requireOrderFlow: false });
  };

  const primary = run(primaryCandles);
  const trigger = run(triggerCandles);

  const contextSmc = contextCandles.length >= 30 ? analyzeSMC(contextCandles) : null;
  const contextDirection = contextSmc?.trend ?? "Neutral";

  const direction: ReversalDirection =
    primary.direction !== "NONE" && trigger.direction === primary.direction
      ? primary.direction
      : primary.direction !== "NONE"
        ? primary.direction
        : trigger.direction;

  const aligned = direction !== "NONE" && primary.direction === direction && trigger.direction === direction;
  const opposedToContext =
    (direction === "BUY" && contextDirection === "Bearish") ||
    (direction === "SELL" && contextDirection === "Bullish");
  const neutralContext = contextDirection === "Neutral";
  const score = Math.max(0, Math.min(100, Math.round(
    primary.score * 0.55 +
    trigger.score * 0.30 +
    (aligned ? 10 : 0) +
    (neutralContext ? 2 : 0)
  )));
  const confirmed = aligned && primary.state === "CONFIRMED" && trigger.state === "CONFIRMED";
  const state: ReversalState = confirmed ? "CONFIRMED" : score >= 65 && aligned ? "SETUP" : score >= 40 ? "WATCH" : "NONE";

  const makeFrame = (interval: string, r: ReversalEngineResult, structure: MTFReversalFrame["structure"]): MTFReversalFrame => ({
    interval, direction: r.direction, state: r.state, score: r.score, structure
  });

  const frames: MTFReversalFrame[] = [
    makeFrame("1h", contextSmc ? { ...EMPTY, direction: contextDirection === "Bullish" ? "BUY" : contextDirection === "Bearish" ? "SELL" : "NONE", state: "NONE", score: contextSmc.score } : EMPTY,
      direction === "NONE" || contextDirection === "Neutral" ? "NEUTRAL" : opposedToContext ? "OPPOSED" : "ALIGNED"),
    makeFrame("15m", primary, primary.direction === direction ? "ALIGNED" : primary.direction === "NONE" ? "NEUTRAL" : "OPPOSED"),
    makeFrame("5m", trigger, trigger.direction === direction ? "ALIGNED" : trigger.direction === "NONE" ? "NEUTRAL" : "OPPOSED"),
  ];

  return {
    direction,
    state,
    score,
    triggerTimeframe: "5m",
    confirmationTimeframe: "15m",
    contextTimeframe: "1h",
    contextDirection,
    frames,
    confirmed,
    reason: confirmed
      ? direction + " MTF reversal structurally confirmed: 15m structure + 5m trigger aligned" + (opposedToContext ? " against 1h context" : "")
      : aligned
        ? direction + " MTF reversal setup: 15m and 5m aligned, waiting for full confirmation"
        : "Waiting for 5m + 15m directional alignment"
  };
}
